-- Văn phòng phẩm — Báo cáo + chi phí sang Tài chính (17/10/2026).
--   * Báo cáo tháng: bảng Nhập–Xuất–Tồn theo mẫu XNT của thủ kho (lấy từ sổ kho Kho VPP), tổng hợp đề xuất / đã cấp / giá trị
--     theo người và theo phòng ban (phòng ban chụp lúc gửi đề xuất).
--   * Chi phí VPP = giá trị đã cấp − giá trị trả lại, theo ngày chứng từ; trả lại tháng sau thì giảm chi phí tháng trả.
--   * Kế toán (Tài chính — Ghi nhận) chốt chi phí VPP tháng đã qua theo phòng ban; khoản đã chốt tự vào Chi phí chung của
--     Phân bổ tháng (chia về dự án như chi phí chung khác). Phiếu chi mua VPP nhập kho chọn loại "Mua VPP nhập kho" —
--     loại này mặc định không tính vào Chi phí chung để không ghi chi phí hai lần (mua là tài sản, cấp ra mới là chi phí).

-- ---------------------------------------------------------------------------
-- 1. Bảng chốt chi phí VPP
-- ---------------------------------------------------------------------------
create table public.finance_office_supply_postings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  warehouse_id text not null references public.warehouses(id),
  period_month date not null check (extract(day from period_month) = 1),
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  issued_total numeric(18,2) not null default 0,
  returned_total numeric(18,2) not null default 0,
  total numeric(18,2) not null,
  note text,
  posted_by uuid not null references public.users(id),
  posted_at timestamptz not null default now(),
  reversed_by uuid references public.users(id),
  reversed_at timestamptz,
  reverse_reason text
);
create unique index finance_office_supply_postings_one_active on public.finance_office_supply_postings (warehouse_id, period_month) where status = 'posted';

create table public.finance_office_supply_posting_lines (
  posting_id uuid not null references public.finance_office_supply_postings(id),
  line_no integer not null,
  org_unit_id uuid,
  org_unit_name text not null,
  issued_value numeric(18,2) not null default 0,
  returned_value numeric(18,2) not null default 0,
  net_value numeric(18,2) not null,
  request_count integer not null default 0,
  people_count integer not null default 0,
  primary key (posting_id, line_no)
);

do $$ declare t text; begin
  foreach t in array array['finance_office_supply_postings', 'finance_office_supply_posting_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Chi phí chung của Phân bổ tháng nhận thêm nguồn "office_supply" (chi phí VPP đã chốt).
alter table public.finance_allocation_pool drop constraint finance_allocation_pool_source_type_check;
alter table public.finance_allocation_pool add constraint finance_allocation_pool_source_type_check
  check (source_type in ('expense_request', 'office_salary', 'office_supply', 'manual'));

-- ---------------------------------------------------------------------------
-- 2. Hàm nội bộ
-- ---------------------------------------------------------------------------
create or replace function app_private.vpp_default_warehouse()
returns text language sql stable security definer set search_path = '' as $$
  select s.warehouse_id from public.office_supply_settings s join public.warehouses w on w.id = s.warehouse_id
  where not coalesce(w.is_archived, false) order by s.warehouse_id limit 1;
$$;

-- Ai xem báo cáo VPP: Xem báo cáo / Quản trị VPP, thủ kho VPP, người xem Tài chính.
create or replace function app_private.vpp_report_access(p_warehouse_id text, p_user uuid default public.current_app_user_id())
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and (app_private.vpp_can_report(p_user) or app_private.vpp_is_keeper(p_warehouse_id, p_user)
    or app_private.finance_can('view'));
$$;

-- Khoảng thời gian một tháng theo giờ Việt Nam.
create or replace function app_private.vpp_month_bounds(p_month date, out ts_from timestamptz, out ts_to timestamptz)
language sql stable set search_path = '' as $$
  select (p_month::timestamp at time zone 'Asia/Ho_Chi_Minh'), ((p_month + interval '1 month')::timestamp at time zone 'Asia/Ho_Chi_Minh');
$$;

create or replace function app_private.vpp_parse_month(p_text text)
returns date language plpgsql immutable set search_path = '' as $$
declare v date;
begin
  if p_text is null or p_text = '' then return date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date; end if;
  begin v := to_date(left(p_text, 7) || '-01', 'YYYY-MM-DD');
  exception when others then raise exception using errcode = '22023', message = 'VPP_MONTH_INVALID'; end;
  if v < date '2020-01-01' or v > date '2100-01-01' then raise exception using errcode = '22023', message = 'VPP_MONTH_INVALID'; end if;
  return v;
end $$;

-- Dòng sổ kho của phiếu VPP (cấp = ra, trả lại / đảo = vào) trong tháng, kèm phiếu đề xuất.
-- Chi phí của một dòng = ra × giá − vào × giá.
create or replace function app_private.vpp_cost_moves(p_warehouse_id text, p_month date)
returns table (request_id uuid, requester_id uuid, org_unit_id uuid, org_unit_name text, material_id text,
  qty_out numeric, qty_in numeric, value_out numeric, value_in numeric)
language sql stable security definer set search_path = '' as $$
  select r.id, r.requester_id, r.org_unit_id, r.org_unit_name, e.material_id,
    e.quantity_out, e.quantity_in, e.quantity_out * e.unit_price, e.quantity_in * e.unit_price
  from public.inventory_ledger_entries e
  cross join app_private.vpp_month_bounds(p_month) b
  join public.office_supply_requests r on r.id::text = e.metadata->>'officeSupplyRequestId'
  where e.warehouse_id = p_warehouse_id and e.transaction_date >= b.ts_from and e.transaction_date < b.ts_to;
$$;

-- Chi phí VPP tháng theo phòng ban (số sống, chưa chốt).
create or replace function app_private.vpp_month_costs(p_warehouse_id text, p_month date)
returns table (org_unit_id uuid, org_unit_name text, issued_value numeric, returned_value numeric, net_value numeric,
  request_count integer, people_count integer)
language sql stable security definer set search_path = '' as $$
  select m.org_unit_id, coalesce(max(m.org_unit_name), 'Chưa có phòng ban'),
    round(sum(m.value_out), 2), round(sum(m.value_in), 2), round(sum(m.value_out) - sum(m.value_in), 2),
    count(distinct m.request_id)::integer, count(distinct m.requester_id)::integer
  from app_private.vpp_cost_moves(p_warehouse_id, p_month) m
  group by m.org_unit_id;
$$;

create or replace function app_private.vpp_qty_text(p numeric)
returns text language sql immutable set search_path = '' as $$
  select rtrim(rtrim(to_char(p, 'FM999999990.000'), '0'), '.');
$$;

-- Phân bổ tháng nháp đang mở của tháng đó dựng lại theo số VPP mới chốt / vừa đảo.
create or replace function app_private.vpp_rebuild_allocation_draft(p_month date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_run uuid;
begin
  select id into v_run from public.finance_allocation_runs where period_month = p_month and status = 'draft';
  if v_run is not null then perform app_private.finance_allocation_build(v_run); end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Báo cáo tháng
-- p: { month: 'YYYY-MM' }
-- ---------------------------------------------------------------------------
create or replace function public.get_office_supply_report_v1(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_wh text := app_private.vpp_default_warehouse();
  v_month date := app_private.vpp_parse_month(p->>'month');
  v_from timestamptz; v_to timestamptz;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_wh is null then raise exception using errcode = '22023', message = 'VPP_WAREHOUSE_MISSING'; end if;
  if not app_private.vpp_report_access(v_wh, v_actor) then raise exception using errcode = '42501', message = 'VPP_REPORT_DENIED'; end if;
  select b.ts_from, b.ts_to into v_from, v_to from app_private.vpp_month_bounds(v_month) b;

  return (with led as (
    -- Tồn đầu kỳ ghi bằng phiếu "opening_balance" tính vào cột Tồn đầu của tháng đó.
    select e.material_id, e.quantity_in qi, e.quantity_out qo, e.quantity_in * e.unit_price vi, e.quantity_out * e.unit_price vo,
      e.transaction_date < v_from or coalesce(e.metadata->>'businessEventType', '') = 'opening_balance' is_open
    from public.inventory_ledger_entries e where e.warehouse_id = v_wh and e.transaction_date < v_to
  ), agg as (
    select l.material_id,
      sum(l.qi - l.qo) filter (where l.is_open) open_qty, sum(l.vi - l.vo) filter (where l.is_open) open_val,
      sum(l.qi) filter (where not l.is_open) in_qty, sum(l.vi) filter (where not l.is_open) in_val,
      sum(l.qo) filter (where not l.is_open) out_qty, sum(l.vo) filter (where not l.is_open) out_val
    from led l group by l.material_id
  ), mv as (
    select * from app_private.vpp_cost_moves(v_wh, v_month)
  ), who as (
    -- Ghi chú = cấp cho ai trong tháng (đã trừ trả lại).
    select z.material_id, string_agg(coalesce(u.name, '?') || ' ' || app_private.vpp_qty_text(z.q), ', ' order by z.q desc, u.name) note
    from (select m.material_id, m.requester_id, sum(m.qty_out - m.qty_in) q from mv m group by 1, 2) z
    left join public.users u on u.id = z.requester_id
    where z.q <> 0 group by z.material_id
  ), xnt as (
    select i.id, i.sku, i.name, i.unit, i.price_in,
      coalesce(a.open_qty, 0) open_qty, coalesce(a.open_val, 0) open_val, coalesce(a.in_qty, 0) in_qty, coalesce(a.in_val, 0) in_val,
      coalesce(a.out_qty, 0) out_qty, coalesce(a.out_val, 0) out_val, w.note
    from public.items i left join agg a on a.material_id = i.id left join who w on w.material_id = i.id
    where (i.category = 'VPP' and i.status = 'active') or a.material_id is not null
  ), req as (
    -- Đề xuất gửi trong tháng (không tính phiếu đã hủy).
    select r.id, r.requester_id, r.org_unit_id, r.org_unit_name, r.status, l.item_id, l.item_name, l.unit, l.requested_qty, l.approved_qty
    from public.office_supply_requests r join public.office_supply_request_lines l on l.request_id = r.id
    cross join app_private.vpp_month_bounds(v_month) b
    where r.warehouse_id = v_wh and r.status <> 'cancelled' and r.submitted_at >= b.ts_from and r.submitted_at < b.ts_to
  ), person_keys as (
    select requester_id from req union select requester_id from mv
  ), person as (
    select k.requester_id,
      (select u.name from public.users u where u.id = k.requester_id) name,
      coalesce((select r.org_unit_name from public.office_supply_requests r where r.requester_id = k.requester_id order by r.submitted_at desc limit 1), 'Chưa có phòng ban') org,
      (select count(distinct q.id) from req q where q.requester_id = k.requester_id) request_count,
      (select coalesce(sum(q.requested_qty), 0) from req q where q.requester_id = k.requester_id) requested_qty,
      (select coalesce(sum(m.qty_out - m.qty_in), 0) from mv m where m.requester_id = k.requester_id) issued_qty,
      (select coalesce(sum(m.value_out - m.value_in), 0) from mv m where m.requester_id = k.requester_id) value
    from person_keys k
  ), dept_keys as (
    select org_unit_id, org_unit_name from req union select org_unit_id, org_unit_name from mv
  ), dept as (
    select d.org_unit_id, coalesce(max(d.org_unit_name), 'Chưa có phòng ban') name,
      (select count(distinct x.requester_id) from (select q.requester_id from req q where q.org_unit_id is not distinct from d.org_unit_id
        union select m.requester_id from mv m where m.org_unit_id is not distinct from d.org_unit_id) x) people,
      (select count(distinct q.id) from req q where q.org_unit_id is not distinct from d.org_unit_id) request_count,
      (select coalesce(sum(q.requested_qty), 0) from req q where q.org_unit_id is not distinct from d.org_unit_id) requested_qty,
      (select coalesce(sum(m.qty_out - m.qty_in), 0) from mv m where m.org_unit_id is not distinct from d.org_unit_id) issued_qty,
      (select coalesce(sum(m.value_out), 0) from mv m where m.org_unit_id is not distinct from d.org_unit_id) issued_value,
      (select coalesce(sum(m.value_in), 0) from mv m where m.org_unit_id is not distinct from d.org_unit_id) returned_value
    from dept_keys d group by d.org_unit_id
  )
  select jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'), 'warehouseId', v_wh, 'warehouseName', (select w.name from public.warehouses w where w.id = v_wh),
    'firstMonth', (select to_char(date_trunc('month', min(e.transaction_date) at time zone 'Asia/Ho_Chi_Minh'), 'YYYY-MM')
      from public.inventory_ledger_entries e where e.warehouse_id = v_wh),
    'can', jsonb_build_object('post', app_private.finance_can('record'), 'reverse', app_private.finance_can('record') or app_private.finance_can('manage')),
    'totals', (select jsonb_build_object('openValue', round(coalesce(sum(x.open_val), 0)), 'inValue', round(coalesce(sum(x.in_val), 0)),
        'outValue', round(coalesce(sum(x.out_val), 0)), 'closeValue', round(coalesce(sum(x.open_val + x.in_val - x.out_val), 0)),
        'cost', (select round(coalesce(sum(m.value_out - m.value_in), 0)) from mv m),
        'returned', (select round(coalesce(sum(m.value_in), 0)) from mv m),
        'requestCount', (select count(distinct q.id) from req q),
        'issuedRequestCount', (select count(distinct m.request_id) from mv m where m.qty_out > 0)) from xnt x),
    'xnt', coalesce((select jsonb_agg(jsonb_build_object('itemId', x.id, 'sku', x.sku, 'name', x.name, 'unit', x.unit,
        'openQty', x.open_qty, 'inQty', x.in_qty, 'outQty', x.out_qty, 'closeQty', x.open_qty + x.in_qty - x.out_qty,
        'openValue', round(x.open_val), 'inValue', round(x.in_val), 'outValue', round(x.out_val),
        'closeValue', round(x.open_val + x.in_val - x.out_val),
        'unitPrice', round(case when x.open_qty + x.in_qty - x.out_qty > 0 then (x.open_val + x.in_val - x.out_val) / (x.open_qty + x.in_qty - x.out_qty)
                                when x.open_qty + x.in_qty > 0 then (x.open_val + x.in_val) / (x.open_qty + x.in_qty)
                                else coalesce(x.price_in, 0) end),
        'note', x.note) order by x.sku nulls last, x.name) from xnt x), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('userId', pe.requester_id, 'name', pe.name, 'orgUnitName', pe.org,
        'requestCount', pe.request_count, 'requestedQty', pe.requested_qty, 'issuedQty', pe.issued_qty, 'value', round(pe.value),
        'items', (select jsonb_agg(jsonb_build_object('name', it.name, 'unit', it.unit, 'requestedQty', it.rq, 'issuedQty', it.iq, 'value', round(it.v))
                    order by it.v desc, it.name)
                  from (select coalesce(i.name, q2.item_name) name, coalesce(i.unit, q2.unit) unit, sum(q2.rq) rq, sum(q2.iq) iq, sum(q2.v) v
                        from (select q.item_id, q.item_name, q.unit, q.requested_qty rq, 0::numeric iq, 0::numeric v from req q where q.requester_id = pe.requester_id
                              union all select m.material_id, null, null, 0, m.qty_out - m.qty_in, m.value_out - m.value_in from mv m where m.requester_id = pe.requester_id) q2
                        left join public.items i on i.id = q2.item_id
                        group by coalesce(i.name, q2.item_name), coalesce(i.unit, q2.unit)) it))
        order by pe.value desc, pe.name) from person pe), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('orgUnitId', d.org_unit_id, 'name', d.name, 'people', d.people,
        'requestCount', d.request_count, 'requestedQty', d.requested_qty, 'issuedQty', d.issued_qty,
        'issuedValue', round(d.issued_value), 'returnedValue', round(d.returned_value), 'value', round(d.issued_value - d.returned_value))
        order by d.issued_value - d.returned_value desc, d.name) from dept d), '[]'::jsonb),
    'posting', app_private.vpp_posting_json(v_wh, v_month))
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. Chi phí VPP sang Tài chính
-- ---------------------------------------------------------------------------
-- Tình trạng chốt của một tháng: số sống, khoản đã chốt (nếu có), chênh lệch phát sinh sau chốt, chốt được chưa.
create or replace function app_private.vpp_posting_json(p_warehouse_id text, p_month date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with live as (select coalesce(sum(c.net_value), 0) net, coalesce(sum(c.issued_value), 0) issued, coalesce(sum(c.returned_value), 0) returned
                from app_private.vpp_month_costs(p_warehouse_id, p_month) c),
  po as (select * from public.finance_office_supply_postings x where x.warehouse_id = p_warehouse_id and x.period_month = p_month and x.status = 'posted'),
  alloc as (select a.code, a.status from public.finance_allocation_runs a where a.period_month = p_month and a.status in ('draft', 'submitted', 'confirmed'))
  select jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM'),
    'liveTotal', (select round(net) from live), 'liveIssued', (select round(issued) from live), 'liveReturned', (select round(returned) from live),
    'closed', p_month < date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date,
    'allocation', (select jsonb_build_object('code', a.code, 'status', a.status) from alloc a),
    'posted', (select jsonb_build_object('id', po.id, 'code', po.code, 'total', po.total, 'postedAt', po.posted_at,
        'postedByName', (select u.name from public.users u where u.id = po.posted_by), 'note', po.note,
        'lines', (select jsonb_agg(jsonb_build_object('orgUnitId', l.org_unit_id, 'name', l.org_unit_name, 'issuedValue', l.issued_value,
            'returnedValue', l.returned_value, 'value', l.net_value, 'requestCount', l.request_count, 'people', l.people_count) order by l.line_no)
          from public.finance_office_supply_posting_lines l where l.posting_id = po.id)) from po),
    'history', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'status', x.status, 'total', x.total, 'postedAt', x.posted_at,
        'postedByName', (select u.name from public.users u where u.id = x.posted_by), 'reversedAt', x.reversed_at,
        'reversedByName', (select u.name from public.users u where u.id = x.reversed_by), 'reverseReason', x.reverse_reason) order by x.posted_at desc)
      from public.finance_office_supply_postings x where x.warehouse_id = p_warehouse_id and x.period_month = p_month and x.status = 'reversed'), '[]'::jsonb));
$$;

-- Kế toán chốt chi phí VPP một tháng đã qua theo phòng ban. Đã có bản chốt → chốt lại (đảo bản cũ, cần lý do).
-- p: { month: 'YYYY-MM', expectedTotal, reason? }
create or replace function public.post_office_supply_costs_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_wh text := app_private.vpp_default_warehouse();
  v_month date := app_private.vpp_parse_month(p->>'month');
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_old public.finance_office_supply_postings%rowtype;
  v_id uuid; v_total numeric; v_issued numeric; v_returned numeric; v_n integer; v_code text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_wh is null then raise exception using errcode = '22023', message = 'VPP_WAREHOUSE_MISSING'; end if;
  if v_month >= date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date then
    raise exception using errcode = '22023', message = 'VPP_MONTH_OPEN'; end if;
  perform pg_advisory_xact_lock(hashtext('office_supply_cost_post:' || v_wh || ':' || v_month::text));
  if exists (select 1 from public.finance_allocation_runs a where a.period_month = v_month and a.status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'VPP_ALLOCATION_LOCKED'; end if;

  select coalesce(sum(c.net_value), 0), coalesce(sum(c.issued_value), 0), coalesce(sum(c.returned_value), 0)
  into v_total, v_issued, v_returned from app_private.vpp_month_costs(v_wh, v_month) c;
  if nullif(p->>'expectedTotal', '') is not null and abs((p->>'expectedTotal')::numeric - round(v_total)) > 0.5 then
    raise exception using errcode = 'PT409', message = 'VPP_COST_CHANGED'; end if;

  select * into v_old from public.finance_office_supply_postings
  where warehouse_id = v_wh and period_month = v_month and status = 'posted' for update;
  if found then
    if v_reason is null then raise exception using errcode = '22023', message = 'VPP_REASON_REQUIRED'; end if;
    update public.finance_office_supply_postings set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = v_reason
    where id = v_old.id;
  end if;

  select count(*) into v_n from public.finance_office_supply_postings where warehouse_id = v_wh and period_month = v_month;
  v_code := 'CPVPP-' || to_char(v_month, 'YYMM') || case when v_n > 0 then '-' || (v_n + 1)::text else '' end;
  insert into public.finance_office_supply_postings (code, warehouse_id, period_month, issued_total, returned_total, total, note, posted_by)
  values (v_code, v_wh, v_month, v_issued, v_returned, v_total, v_reason, v_actor) returning id into v_id;
  insert into public.finance_office_supply_posting_lines (posting_id, line_no, org_unit_id, org_unit_name, issued_value, returned_value, net_value, request_count, people_count)
  select v_id, row_number() over (order by c.net_value desc, c.org_unit_name), c.org_unit_id, c.org_unit_name, c.issued_value, c.returned_value, c.net_value,
    c.request_count, c.people_count
  from app_private.vpp_month_costs(v_wh, v_month) c;

  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after, payload)
  values ('office_supply_cost', v_id::text, case when v_old.id is null then 'vpp_cost_post' else 'vpp_cost_repost' end, v_actor, v_reason,
    case when v_old.id is not null then jsonb_build_object('id', v_old.id, 'code', v_old.code, 'total', v_old.total) end,
    jsonb_build_object('code', v_code, 'total', v_total), jsonb_build_object('month', v_month, 'warehouseId', v_wh));
  perform app_private.vpp_rebuild_allocation_draft(v_month);
  return app_private.vpp_posting_json(v_wh, v_month);
end $$;

-- Đảo bản chốt (sai sót, chốt nhầm). Phân bổ tháng đã gửi chốt / đã chốt thì phải đảo phân bổ trước.
-- p: { month: 'YYYY-MM', reason }
create or replace function public.reverse_office_supply_costs_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_wh text := app_private.vpp_default_warehouse();
  v_month date := app_private.vpp_parse_month(p->>'month');
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_old public.finance_office_supply_postings%rowtype;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if not (app_private.finance_can('record') or app_private.finance_can('manage')) then
    raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'VPP_REASON_REQUIRED'; end if;
  select * into v_old from public.finance_office_supply_postings
  where warehouse_id = v_wh and period_month = v_month and status = 'posted' for update;
  if not found then raise exception using errcode = 'PT409', message = 'VPP_POSTING_NOT_FOUND'; end if;
  if exists (select 1 from public.finance_allocation_runs a where a.period_month = v_month and a.status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'VPP_ALLOCATION_LOCKED'; end if;
  update public.finance_office_supply_postings set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = v_reason
  where id = v_old.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, payload)
  values ('office_supply_cost', v_old.id::text, 'vpp_cost_reverse', v_actor, v_reason,
    jsonb_build_object('code', v_old.code, 'total', v_old.total), jsonb_build_object('month', v_month, 'warehouseId', v_wh));
  perform app_private.vpp_rebuild_allocation_draft(v_month);
  return app_private.vpp_posting_json(v_wh, v_month);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Phân bổ tháng: chi phí VPP đã chốt vào Chi phí chung; phiếu chi "Mua VPP nhập kho" mặc định không tính.
--    (Giữ nguyên phần còn lại của hàm gốc 20261008134400_finance_allocation_site_fund.sql.)
-- ---------------------------------------------------------------------------
create or replace function app_private.finance_allocation_build(p_run uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.finance_allocation_runs%rowtype; v_year integer; v_month integer; v_from date; v_to date; v_period public.hrm_timesheet_periods%rowtype;
  v_office numeric; v_pool numeric; v_receipts numeric; v_item_salary uuid; v_item_overhead uuid;
begin
  select * into r from public.finance_allocation_runs where id = p_run;
  v_year := extract(year from r.period_month); v_month := extract(month from r.period_month);
  v_from := r.period_month; v_to := (r.period_month + interval '1 month')::date;
  select * into v_period from public.hrm_timesheet_periods where year = v_year and month = v_month;

  -- (1) Lương: chỉ khi bảng công đã chốt; số công = công trong bản chốt, công trường lấy từ chấm công ngày đó.
  create temp table if not exists pg_temp.fin_alloc_auto (employee_id uuid, employee_name text, gross numeric, site_days jsonb, office_days numeric) on commit drop;
  truncate pg_temp.fin_alloc_auto;
  if v_period.status = 'closed' then
    insert into pg_temp.fin_alloc_auto
    with pay as (
      select p."employeeId" employee_id, sum(coalesce(p."grossSalary", 0)) gross from public.hrm_payrolls p
      where p.year = v_year and p.month = v_month and p.status in ('confirmed', 'paid') group by 1
    ), days as (
      select s.employee_id, (d->>'date')::date dt, coalesce((d->>'workCredit')::numeric, 0) credit
      from public.hrm_timesheet_snapshots s cross join jsonb_array_elements(coalesce(s.row->'days', '[]'::jsonb)) d
      where s.year = v_year and s.month = v_month and s.version = v_period.version and coalesce((d->>'workCredit')::numeric, 0) > 0
    ), placed as (
      select dy.employee_id, dy.credit,
        (select ap.id from public.hrm_attendance a join app_private.finance_allocation_projects() ap on ap.site_id = a."constructionSiteId"
          where a."employeeId" = dy.employee_id and a.date::date = dy.dt limit 1) project_id
      from days dy
    ), agg as (
      select employee_id, coalesce(jsonb_object_agg(project_id, d) filter (where project_id is not null), '{}'::jsonb) site_days,
        coalesce(sum(d) filter (where project_id is null), 0) office_days
      from (select employee_id, project_id, sum(credit) d from placed group by 1, 2) z group by 1
    )
    select pay.employee_id, e.full_name, pay.gross, coalesce(agg.site_days, '{}'::jsonb), coalesce(agg.office_days, 0)
    from pay join public.employees e on e.id = pay.employee_id left join agg on agg.employee_id = pay.employee_id;
  end if;
  delete from public.finance_allocation_staff s where s.run_id = p_run and not s.edited
    and not exists (select 1 from pg_temp.fin_alloc_auto a where a.employee_id = s.employee_id);
  insert into public.finance_allocation_staff (run_id, employee_id, employee_name, gross, site_days, office_days, auto_site_days, auto_office_days)
  select p_run, a.employee_id, a.employee_name, a.gross, a.site_days, a.office_days, a.site_days, a.office_days from pg_temp.fin_alloc_auto a
  on conflict (run_id, employee_id) do update set employee_name = excluded.employee_name, gross = excluded.gross,
    auto_site_days = excluded.auto_site_days, auto_office_days = excluded.auto_office_days,
    site_days = case when public.finance_allocation_staff.edited then public.finance_allocation_staff.site_days else excluded.site_days end,
    office_days = case when public.finance_allocation_staff.edited then public.finance_allocation_staff.office_days else excluded.office_days end;

  -- (2) Chi phí chung: phiếu chi khác không gắn dự án đã chi trong tháng (giữ lựa chọn cũ), phần lương văn phòng.
  --     Mua VPP nhập kho không tính (chi phí VPP vào theo số đã cấp, dòng office_supply bên dưới).
  insert into public.finance_allocation_pool (run_id, source_type, source_id, description, category, amount, included)
  select p_run, 'expense_request', q.id::text, concat_ws(' · ', q.code, nullif(q.supplier_name, ''), nullif(q.note, '')), q.expense_category, q.amount,
    coalesce(q.expense_category, 'other') not in ('salary', 'loan_repay', 'staff_advance', 'tax', 'office_supply_stock')
  from public.finance_payment_requests q
  where q.kind = 'expense' and q.project_id is null and q.status = 'paid'
    and (q.paid->>'paymentDate')::date >= v_from and (q.paid->>'paymentDate')::date < v_to
  on conflict (run_id, source_type, source_id) where source_type <> 'manual' do update set amount = excluded.amount, description = excluded.description;
  delete from public.finance_allocation_pool p where p.run_id = p_run and p.source_type = 'expense_request'
    and not exists (select 1 from public.finance_payment_requests q where q.id::text = p.source_id and q.status = 'paid'
      and (q.paid->>'paymentDate')::date >= v_from and (q.paid->>'paymentDate')::date < v_to);

  insert into public.finance_allocation_pool (run_id, source_type, source_id, description, category, amount, included)
  select p_run, 'office_supply', x.id::text, x.code || ' · Chi phí văn phòng phẩm đã cấp tháng ' || to_char(x.period_month, 'MM/YYYY'), 'office_supply',
    greatest(x.total, 0), true
  from public.finance_office_supply_postings x where x.period_month = r.period_month and x.status = 'posted'
  on conflict (run_id, source_type, source_id) where source_type <> 'manual' do update set amount = excluded.amount, description = excluded.description;
  delete from public.finance_allocation_pool p where p.run_id = p_run and p.source_type = 'office_supply'
    and not exists (select 1 from public.finance_office_supply_postings x where x.id::text = p.source_id and x.status = 'posted');

  select coalesce(sum(case when tot > 0 then s.gross * s.office_days / tot else s.gross end), 0) into v_office
  from (select x.*, x.office_days + coalesce((select sum(value::numeric) from jsonb_each_text(x.site_days)), 0) tot
    from public.finance_allocation_staff x where x.run_id = p_run) s;
  insert into public.finance_allocation_pool (run_id, source_type, source_id, description, category, amount, included)
  values (p_run, 'office_salary', 'office', 'Lương nhân viên phần không ở công trường (văn phòng, nhà máy)', 'salary', round(v_office, 2), true)
  on conflict (run_id, source_type, source_id) where source_type <> 'manual' do update set amount = excluded.amount;

  -- (3) Kết quả theo dự án.
  select id into v_item_salary from public.contract_cost_items where symbol = 'CPL1' and status = 'active' limit 1;
  select id into v_item_overhead from public.contract_cost_items where symbol = 'CPQL' and status = 'active' limit 1;
  delete from public.finance_allocation_lines where run_id = p_run;
  insert into public.finance_allocation_lines (run_id, project_id, kind, cost_item_id, amount, basis, share)
  select p_run, z.project_id, 'salary', v_item_salary, round(sum(z.amt), 2), sum(z.days), null
  from (select d.key project_id, d.value::numeric days, s.gross * d.value::numeric
      / nullif(s.office_days + (select sum(value::numeric) from jsonb_each_text(s.site_days)), 0) amt
    from public.finance_allocation_staff s cross join jsonb_each_text(s.site_days) d where s.run_id = p_run) z
  where z.amt > 0 group by z.project_id;

  select coalesce(sum(amount) filter (where included), 0) into v_pool from public.finance_allocation_pool where run_id = p_run;
  select coalesce(sum(rc.amount), 0) into v_receipts from public.finance_customer_receipts rc join app_private.finance_allocation_projects() ap on ap.id = rc.project_id
  where rc.status = 'confirmed' and rc.receipt_date >= v_from and rc.receipt_date < v_to;
  if v_receipts > 0 and v_pool > 0 then
    insert into public.finance_allocation_lines (run_id, project_id, kind, cost_item_id, amount, basis, share)
    select p_run, rc.project_id, 'overhead', v_item_overhead, round(v_pool * sum(rc.amount) / v_receipts, 2), sum(rc.amount), round(sum(rc.amount) / v_receipts, 6)
    from public.finance_customer_receipts rc join app_private.finance_allocation_projects() ap on ap.id = rc.project_id
    where rc.status = 'confirmed' and rc.receipt_date >= v_from and rc.receipt_date < v_to group by rc.project_id;
  end if;

  update public.finance_allocation_runs set timesheet_version = case when v_period.status = 'closed' then v_period.version end,
    payroll_count = (select count(*) from public.finance_allocation_staff where run_id = p_run),
    payroll_total = (select coalesce(sum(gross), 0) from public.finance_allocation_staff where run_id = p_run),
    site_total = (select coalesce(sum(amount), 0) from public.finance_allocation_lines where run_id = p_run and kind = 'salary'),
    office_total = round(v_office, 2), pool_total = v_pool, receipts_total = v_receipts, updated_at = now()
  where id = p_run;
end $$;

-- Điều kiện của tháng thêm "officeSupply": chi phí VPP tháng đó đã chốt chưa.
create or replace function app_private.finance_allocation_readiness(p_month date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'timesheet', (select jsonb_build_object('status', t.status, 'version', t.version, 'decidedAt', t.decided_at) from public.hrm_timesheet_periods t
      where t.year = extract(year from p_month) and t.month = extract(month from p_month)),
    'payroll', (select jsonb_build_object('confirmed', count(*) filter (where p.status in ('confirmed', 'paid')), 'draft', count(*) filter (where p.status = 'draft'),
        'gross', coalesce(sum(p."grossSalary") filter (where p.status in ('confirmed', 'paid')), 0))
      from public.hrm_payrolls p where p.year = extract(year from p_month) and p.month = extract(month from p_month)),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('projectId', ap.id, 'projectCode', ap.code, 'amount', z.amount) order by z.amount desc)
      from (select rc.project_id, sum(rc.amount) amount from public.finance_customer_receipts rc where rc.status = 'confirmed'
        and rc.receipt_date >= p_month and rc.receipt_date < (p_month + interval '1 month')::date group by 1) z
      join app_private.finance_allocation_projects() ap on ap.id = z.project_id), '[]'::jsonb),
    'officeSupply', (select jsonb_build_object('liveTotal', round(coalesce(sum(c.net_value), 0)),
        'postedTotal', (select x.total from public.finance_office_supply_postings x where x.warehouse_id = w.wh and x.period_month = p_month and x.status = 'posted'),
        'postedCode', (select x.code from public.finance_office_supply_postings x where x.warehouse_id = w.wh and x.period_month = p_month and x.status = 'posted'))
      from (select app_private.vpp_default_warehouse() wh) w left join lateral app_private.vpp_month_costs(w.wh, p_month) c on true
      where w.wh is not null group by w.wh));
$$;

-- ---------------------------------------------------------------------------
-- 6. Quyền gọi
-- ---------------------------------------------------------------------------
revoke all on function app_private.vpp_default_warehouse(), app_private.vpp_report_access(text, uuid), app_private.vpp_month_bounds(date),
  app_private.vpp_parse_month(text), app_private.vpp_cost_moves(text, date), app_private.vpp_month_costs(text, date), app_private.vpp_qty_text(numeric),
  app_private.vpp_rebuild_allocation_draft(date), app_private.vpp_posting_json(text, date)
  from public, anon, authenticated;
revoke all on function public.get_office_supply_report_v1(jsonb), public.post_office_supply_costs_v1(jsonb), public.reverse_office_supply_costs_v1(jsonb)
  from public, anon;
grant execute on function public.get_office_supply_report_v1(jsonb), public.post_office_supply_costs_v1(jsonb), public.reverse_office_supply_costs_v1(jsonb)
  to authenticated;

notify pgrst, 'reload schema';
