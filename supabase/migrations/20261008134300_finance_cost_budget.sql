-- ===========================================================================
-- Tài chính đợt 3b-1: Chi phí & ngân sách + Quỹ dự án
--   * Ngân sách dự án theo cây khoản mục đang dùng (contract_cost_items). Vật tư luôn lấy số sống từ dự toán vật tư;
--     khoản mục khác do kế toán / QS lập (quyền Ghi nhận), Quản trị Tài chính duyệt (khác người lập). Mỗi lần điều chỉnh
--     là một phiên bản mới; bản cũ giữ nguyên (superseded).
--   * Chi phí đã ghi nhận theo khoản mục (giao dịch chưa phân loại tự xếp theo loại chi phí, đánh dấu rõ); cam kết =
--     đơn mua đã duyệt chưa nhận hết (giá trước VAT) + phiếu chi khác đã duyệt chưa chi. Cảnh báo từ ngưỡng % (mặc định 90).
--     Dự báo khi hoàn thành = chi phí ÷ tiến độ Gantt, chỉ khi tiến độ ≥ 20%.
--   * Vượt ngân sách: phiếu chi khác gắn dự án hoặc đơn mua (Mua hàng) làm khoản mục vượt 100% → thêm bước "Duyệt vượt
--     ngân sách" (người cài ở Quản trị).
--   * Quỹ dự án (không phải tài khoản thật): số dư = đầu kỳ 30/09 (kế toán khai, người khác chốt) + tiền CĐT trả + vốn công
--     ty cấp − tiền đã chi cho dự án, tự tính từ sổ thu chi. Khoản chi làm quỹ âm → thêm bước "Cấp vốn dự án" (người cấp vốn
--     ở Quản trị, mặc định chị Mơ); khi chi xong tự ghi khoản cấp vốn đúng phần thiếu. Cấp vốn / thu hồi vốn tay có lý do.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
alter table public.finance_settings
  add column budget_warn_percent numeric(5,2) not null default 90 check (budget_warn_percent between 50 and 100),
  add column budget_extra_approver_ids uuid[] not null default '{}',
  add column capital_provider_ids uuid[] not null default '{}';
-- Duyệt vượt ngân sách: TGĐ Dương Xuân Thịnh; người cấp vốn dự án: chị Nguyễn Thị Mơ (chủ SP chọn 03/10).
update public.finance_settings set budget_extra_approver_ids = array['d2c494c2-bbd4-4ea2-a194-ad3cb0faa6d5']::uuid[],
  capital_provider_ids = array['2c4eeb7a-2cff-480c-8b12-be6b9bc67b0c']::uuid[] where id = 1;

create table public.finance_project_budgets (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id),
  version_no integer not null check (version_no > 0),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'withdrawn', 'superseded')),
  reason text not null check (length(btrim(reason)) > 0),
  material_budget numeric(18,2),
  other_total numeric(18,2) not null default 0,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  row_version bigint not null default 1,
  unique (project_id, version_no)
);
create unique index finance_project_budgets_one_pending on public.finance_project_budgets (project_id) where status = 'submitted';
create unique index finance_project_budgets_one_current on public.finance_project_budgets (project_id) where status = 'approved';

create table public.finance_project_budget_lines (
  budget_id uuid not null references public.finance_project_budgets(id),
  cost_item_id uuid not null references public.contract_cost_items(id),
  amount numeric(18,2) not null check (amount >= 0),
  note text,
  primary key (budget_id, cost_item_id)
);

create table public.finance_project_fund_openings (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id),
  cutover_date date not null,
  received_to_date numeric(18,2) not null check (received_to_date >= 0),
  spent_to_date numeric(18,2) not null check (spent_to_date >= 0),
  balance numeric(18,2) generated always as (received_to_date - spent_to_date) stored,
  note text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected', 'cancelled')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index finance_project_fund_openings_one_active on public.finance_project_fund_openings (project_id) where status in ('submitted', 'confirmed');

create sequence public.finance_capital_seq;
create table public.finance_project_capital (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  project_id text not null references public.projects(id),
  kind text not null check (kind in ('topup', 'return')),
  amount numeric(18,2) not null check (amount > 0),
  entry_date date not null,
  reason text not null check (length(btrim(reason)) > 0),
  source_type text not null default 'manual' check (source_type in ('manual', 'payment_request')),
  source_id text,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  reversed_by uuid references public.users(id),
  reversed_at timestamptz,
  reverse_reason text
);
create index finance_project_capital_project_idx on public.finance_project_capital (project_id, entry_date);
create index finance_project_capital_source_idx on public.finance_project_capital (source_type, source_id);

do $$ declare t text; begin
  foreach t in array array['finance_project_budgets', 'finance_project_budget_lines', 'finance_project_fund_openings', 'finance_project_capital'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on sequence public.finance_capital_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Chi phí, cam kết, ngân sách theo khoản mục
-- ---------------------------------------------------------------------------
-- Khoản mục lá dùng cho ngân sách (bỏ thuế VAT và thu nhập chịu thuế tính trước — không phải chi phí), theo thứ tự cây.
create function app_private.finance_budget_items()
returns table (id uuid, symbol text, name text, group_symbol text, group_name text, ord integer)
language sql stable security definer set search_path = '' as $$
  select c.id, c.symbol, c.name, coalesce(p.symbol, c.symbol), coalesce(p.name, c.name),
    (row_number() over (order by coalesce(p.sort_order, c.sort_order), case when coalesce(p.symbol, c.symbol) = 'CPTT' then 0 else 1 end,
      coalesce(p.symbol, c.symbol), case when p.id is null then -1 else c.sort_order end, c.symbol))::integer
  from public.contract_cost_items c left join public.contract_cost_items p on p.id = c.parent_id
  where c.status = 'active' and upper(c.symbol) not in ('VAT', 'TNCT')
    and not exists (select 1 from public.contract_cost_items x where x.parent_id = c.id and x.status = 'active');
$$;

-- Giao dịch chưa gắn khoản mục: xếp theo loại chi phí (vật tư → CPNVL, nhân công → CPNC, máy → CPMTC, chung → CPQL, khác → CPK).
create function app_private.finance_cost_item_of(p_item uuid, p_category text)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(p_item, (select c.id from public.contract_cost_items c where c.status = 'active' and c.symbol = case coalesce(p_category, 'other')
    when 'materials' then 'CPNVL' when 'labor' then 'CPNC' when 'machinery' then 'CPMTC' when 'overhead' then 'CPQL' else 'CPK' end limit 1));
$$;

-- Đơn mua đã duyệt chưa nhận hết = cam kết vật tư (giá trước VAT). Đơn Mua hàng "đang chờ duyệt" chưa tính.
create function app_private.finance_po_commitments(p_project text)
returns table (po_id text, po_number text, project_id text, vendor_name text, status text, expected_date date, net_total numeric,
  received_net numeric, open_net numeric, stale boolean, hub boolean)
language sql stable security definer set search_path = '' as $$
  select o.id, o.po_number, o.project_id, o.vendor_name, o.status, app_private.procurement_date_or_null(o.expected_delivery_date),
    coalesce(o.total_amount, 0), r.net, greatest(coalesce(o.total_amount, 0) - r.net, 0),
    coalesce(app_private.procurement_date_or_null(o.expected_delivery_date) < (now() at time zone 'Asia/Ho_Chi_Minh')::date - 30, false),
    app_private.procurement_po_is_hub(o.metadata)
  from public.purchase_orders o
  cross join lateral (select coalesce(sum(b.accepted_gross_amount), 0) / (1 + coalesce(o.vat_rate, 0) / 100) net
    from public.purchase_order_delivery_batches b where b.purchase_order_id = o.id and b.status in ('received', 'received_short', 'received_over')) r
  where o.archived_at is null and o.project_id is not null and (p_project is null or o.project_id = p_project)
    and (o.status in ('confirmed', 'in_transit', 'partial') or (o.status = 'sent' and not app_private.procurement_po_is_hub(o.metadata)));
$$;

-- Từng khoản mục của dự án: ngân sách (vật tư = dự toán sống; khác = phiên bản đã duyệt; null = chưa lập), đã ghi nhận,
-- phần tự xếp theo loại, cam kết. Dòng cost_item_id null = giao dịch không xếp được khoản mục.
create function app_private.finance_project_cost_lines(p_project text, p_exclude uuid default null)
returns table (cost_item_id uuid, budget numeric, actual numeric, auto_mapped numeric, committed numeric)
language sql stable security definer set search_path = '' as $$
  with cur as (select b.id from public.finance_project_budgets b where b.project_id = p_project and b.status = 'approved'),
  mat as (select nullif(sum(m.budget_total), 0) v from public.material_budget_items m where m.project_id = p_project),
  act as (
    select app_private.finance_cost_item_of(t.contract_cost_item_id, t.category) item, sum(t.amount) actual,
      coalesce(sum(t.amount) filter (where t.contract_cost_item_id is null), 0) auto
    from public.project_transactions t
    where t.project_id = p_project and t.type = 'expense' and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
    group by 1
  ),
  po as (select coalesce(sum(c.open_net), 0) v from app_private.finance_po_commitments(p_project) c where c.po_id is not null),
  req as (
    select app_private.finance_cost_item_of(null, r.cost_category) item, sum(r.amount) v from public.finance_payment_requests r
    where r.kind = 'expense' and r.project_id = p_project and r.status = 'approved' and r.id is distinct from p_exclude group by 1
  ),
  keys as (select i.id item from app_private.finance_budget_items() i union select a.item from act a where a.item is not null
    union select q.item from req q where q.item is not null)
  select k.item,
    case when c.symbol = 'CPNVL' then (select v from mat)
      else (select l.amount from public.finance_project_budget_lines l where l.budget_id = (select id from cur) and l.cost_item_id = k.item) end,
    coalesce(a.actual, 0), coalesce(a.auto, 0), coalesce(q.v, 0) + case when c.symbol = 'CPNVL' then (select v from po) else 0 end
  from keys k join public.contract_cost_items c on c.id = k.item left join act a on a.item = k.item left join req q on q.item = k.item
  union all
  select null, null, a.actual, a.auto, 0 from act a where a.item is null;
$$;

-- Một khoản mục có vượt ngân sách nếu thêm p_amount? Chưa có ngân sách → không xét (over = false, budget null).
create function app_private.finance_budget_check(p_project text, p_item uuid, p_amount numeric, p_exclude uuid)
returns table (over boolean, budget numeric, projected numeric, item_name text)
language sql stable security definer set search_path = '' as $$
  select coalesce(l.budget is not null and l.actual + l.committed + p_amount > l.budget + 0.5, false), l.budget, l.actual + l.committed + p_amount,
    (select c.symbol || ' ' || c.name from public.contract_cost_items c where c.id = p_item)
  from app_private.finance_project_cost_lines(p_project, p_exclude) l where l.cost_item_id = p_item
  union all select false, null, p_amount, (select c.symbol || ' ' || c.name from public.contract_cost_items c where c.id = p_item)
  where not exists (select 1 from app_private.finance_project_cost_lines(p_project, p_exclude) l where l.cost_item_id = p_item)
  limit 1;
$$;

-- Đơn Mua hàng: duyệt đơn có làm vật tư (CPNVL) của dự án vượt dự toán? null = không xét (không gắn một dự án / chưa có dự toán).
create function app_private.finance_po_budget_check(p_po text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_po public.purchase_orders%rowtype; v_item uuid; l record; v_this numeric; v_counted numeric;
begin
  select * into v_po from public.purchase_orders where id = p_po;
  if not found or v_po.project_id is null then return null; end if;
  select id into v_item from public.contract_cost_items where symbol = 'CPNVL' and status = 'active' limit 1;
  select * into l from app_private.finance_project_cost_lines(v_po.project_id, null) x where x.cost_item_id = v_item;
  if not found or l.budget is null then return null; end if;
  v_this := coalesce(v_po.total_amount, 0);
  -- Đơn đã nằm trong cam kết (VD đơn cũ) thì không cộng hai lần.
  select coalesce(sum(c.open_net), 0) into v_counted from app_private.finance_po_commitments(v_po.project_id) c where c.po_id = v_po.id;
  return jsonb_build_object('over', l.actual + l.committed - v_counted + v_this > l.budget + 0.5, 'budget', l.budget, 'actual', l.actual,
    'committed', l.committed - v_counted, 'order', v_this, 'projected', l.actual + l.committed - v_counted + v_this,
    'projectCode', (select code from public.projects where id = v_po.project_id));
end $$;

-- Đơn Mua hàng vượt dự toán vật tư: ghi "chờ duyệt vượt ngân sách" vào đơn và báo người duyệt (Tài chính → Chi phí & ngân sách).
-- Người duyệt đơn chỉ duyệt được sau khi đã duyệt vượt ngân sách. Gọi trong hàm Mua hàng (đã bật ngữ cảnh Mua hàng).
create function app_private.finance_po_budget_mark(p_po text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_check jsonb := app_private.finance_po_budget_check(p_po); v_po public.purchase_orders%rowtype; v_ids uuid[];
begin
  if not coalesce((v_check->>'over')::boolean, false) then return v_check; end if;
  select * into v_po from public.purchase_orders where id = p_po;
  if coalesce(v_po.metadata->'budgetApproval'->>'status', '') in ('pending', 'approved') then
    return v_check || jsonb_build_object('status', v_po.metadata->'budgetApproval'->>'status'); end if;
  select budget_extra_approver_ids into v_ids from public.finance_settings where id = 1;
  update public.purchase_orders set metadata = metadata || jsonb_build_object('budgetApproval', v_check || jsonb_build_object('status', 'pending',
    'requestedBy', p_actor, 'requestedByName', app_private.finance_user_name(p_actor), 'requestedAt', now(),
    'approverNames', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_ids) i)))
  where id = p_po;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', p_po, 'po_budget_request', p_actor, v_check || jsonb_build_object('poNumber', v_po.po_number));
  perform app_private.finance_notify_cost(v_ids, 'Đơn mua vượt ngân sách vật tư chờ duyệt',
    v_po.po_number || ' · ' || (v_check->>'projectCode') || ': sau đơn ' || to_char((v_check->>'projected')::numeric, 'FM999G999G999G990')
      || ' / dự toán ' || to_char((v_check->>'budget')::numeric, 'FM999G999G999G990') || ' đ', v_po.project_id, p_actor);
  return v_check || jsonb_build_object('status', 'pending');
end $$;

-- Người duyệt vượt ngân sách (Quản trị) duyệt / không duyệt. Không duyệt = trả đơn về người lập kèm lý do.
create function public.decide_finance_po_budget_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_po public.purchase_orders%rowtype; v_ids uuid[];
begin
  select budget_extra_approver_ids into v_ids from public.finance_settings where id = 1;
  if v_actor is null or not (v_actor = any(v_ids)) then raise exception using errcode = '42501', message = 'FINANCE_BUDGET_APPROVER_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or v_po.status <> 'sent' or coalesce(v_po.metadata->'budgetApproval'->>'status', '') <> 'pending' then
    raise exception using errcode = '22023', message = 'FINANCE_PO_BUDGET_STATE'; end if;
  if v_po.created_by_id = v_actor::text then raise exception using errcode = '42501', message = 'FINANCE_BUDGET_SELF_DECIDE'; end if;
  if v_action not in ('approve', 'reject') then raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  if v_action = 'reject' and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  if v_action = 'approve' then
    update public.purchase_orders set metadata = jsonb_set(metadata, '{budgetApproval}', (metadata->'budgetApproval') || jsonb_build_object('status', 'approved',
      'decidedBy', v_actor, 'decidedByName', app_private.finance_user_name(v_actor), 'decidedAt', now(), 'note', v_reason))
    where id = v_po.id returning * into v_po;
    perform app_private.procurement_notify(v_po.submitted_to_user_id::uuid, 'Đơn hàng đã được duyệt vượt ngân sách',
      v_po.po_number || ': ' || app_private.finance_user_name(v_actor) || ' đã duyệt vượt ngân sách vật tư — mở đơn để duyệt.', v_po.id, 'assigned');
  else
    update public.purchase_orders set status = 'returned', submitted_to_user_id = null, submitted_to_name = null, submitted_to_permission = null,
      last_action_by = v_actor::text, last_action_at = now(),
      metadata = jsonb_set(metadata, '{budgetApproval}', (metadata->'budgetApproval') || jsonb_build_object('status', 'rejected',
        'decidedBy', v_actor, 'decidedByName', app_private.finance_user_name(v_actor), 'decidedAt', now(), 'note', v_reason))
        || jsonb_build_object('returnReason', 'Không duyệt vượt ngân sách vật tư: ' || v_reason)
    where id = v_po.id returning * into v_po;
    perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Đơn hàng bị trả lại (vượt ngân sách)', v_po.po_number || ': ' || v_reason, v_po.id, 'responsible');
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'budget_' || v_action, v_actor, v_reason, v_po.metadata->'budgetApproval');
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'po_budget_' || v_action, v_actor, v_reason, v_po.metadata->'budgetApproval');
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'status', v_po.status);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Quỹ dự án
-- ---------------------------------------------------------------------------
-- Dòng tiền của quỹ dự án (sổ thu chi + vốn công ty). Quỹ công trường của chính dự án coi như tiền đã giao cho dự án:
-- chuyển tiền sang là chi (−), chuyển về là thu (+); khoản chi / thu ngay trên quỹ công trường không tính lại.
create function app_private.finance_project_fund_rows(p_project text)
returns table (entry_date date, kind text, code text, description text, amount numeric, source_type text, source_id text, reversal boolean)
language sql stable security definer set search_path = '' as $$
  with site as (select f.id from public.cash_funds f where f.kind = 'site' and f.project_id = p_project),
  e as (select x.* from public.finance_cash_entries x where x.account_id not in (select id from site))
  select e.entry_date,
    case e.source_type when 'customer_receipt' then 'customer_receipt' when 'advance_refund' then 'advance_refund' when 'cash_movement' then 'other_receipt'
      when 'external_payment' then 'supplier_payment' else case r.kind when 'expense' then 'expense' else 'supplier_payment' end end,
    e.code, e.description, case e.direction when 'in' then e.amount else -e.amount end, e.source_type, e.source_id, e.reversal_of is not null
  from e left join public.finance_payment_requests r on e.source_type = 'payment_request' and r.id::text = e.source_id
  where (e.project_id = p_project and e.source_type in ('customer_receipt', 'advance_refund', 'cash_movement', 'external_payment'))
    or (e.source_type = 'payment_request' and r.kind in ('expense', 'advance') and r.project_id = p_project)
  union all
  select e.entry_date, 'supplier_payment', e.code, e.description, case e.direction when 'in' then 1 else -1 end * l.amount, e.source_type, e.source_id,
    e.reversal_of is not null
  from e join public.finance_payment_requests r on e.source_type = 'payment_request' and r.id::text = e.source_id and r.kind = 'payable'
  cross join lateral (select sum(x.amount) amount from public.finance_payment_request_lines x where x.request_id = r.id and x.project_id = p_project) l
  where l.amount is not null
  union all
  select e.entry_date, 'site_transfer', e.code, e.description, case e.direction when 'in' then e.amount else -e.amount end, e.source_type, e.source_id,
    e.reversal_of is not null
  from e join public.finance_cash_movements m on e.source_type = 'cash_transfer' and m.id::text = e.source_id
  where (m.to_account_id in (select id from site) and e.account_id = m.from_account_id)
    or (m.from_account_id in (select id from site) and e.account_id = m.to_account_id)
  union all
  select c.entry_date, case c.kind when 'topup' then 'capital' else 'capital_return' end, c.code, c.reason,
    case c.kind when 'topup' then c.amount else -c.amount end, 'capital', c.id::text, false
  from public.finance_project_capital c where c.project_id = p_project and c.status = 'posted';
$$;

-- Tóm tắt quỹ: chưa chốt đầu kỳ thì số dư = null (chưa biết), vẫn hiện dòng tiền từ mốc.
create function app_private.finance_project_fund(p_project text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with o as (select x.balance, x.cutover_date from public.finance_project_fund_openings x where x.project_id = p_project and x.status = 'confirmed'),
  r as (select x.* from app_private.finance_project_fund_rows(p_project) x where x.entry_date >= (select ap_cutover_date from public.finance_settings where id = 1))
  select jsonb_build_object('opening', (select balance from o), 'openingDate', (select cutover_date from o),
    'received', coalesce((select sum(amount) from r where kind = 'customer_receipt'), 0),
    'otherIn', coalesce((select sum(amount) from r where kind in ('advance_refund', 'other_receipt')), 0),
    'spent', coalesce((select -sum(amount) from r where kind in ('supplier_payment', 'expense', 'site_transfer')), 0),
    'capital', coalesce((select sum(amount) from r where kind in ('capital', 'capital_return')), 0),
    'flow', coalesce((select sum(amount) from r), 0),
    'balance', (select balance from o) + coalesce((select sum(amount) from r), 0));
$$;

-- Đề nghị chi / tạm ứng / chi khác đang duyệt hoặc chờ chi của dự án (chưa ra khỏi quỹ).
create function app_private.finance_project_fund_pending(p_project text, p_exclude uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when r.kind = 'payable'
      then (select coalesce(sum(l.amount), 0) from public.finance_payment_request_lines l where l.request_id = r.id and l.project_id = p_project)
      else r.amount end), 0)
  from public.finance_payment_requests r
  where r.status in ('pending', 'approved') and r.id is distinct from p_exclude
    and ((r.kind in ('expense', 'advance') and r.project_id = p_project)
      or (r.kind = 'payable' and exists (select 1 from public.finance_payment_request_lines l where l.request_id = r.id and l.project_id = p_project)));
$$;

-- ---------------------------------------------------------------------------
-- 4. Bước duyệt thêm: vượt ngân sách, cấp vốn dự án
-- ---------------------------------------------------------------------------
-- Thêm một bước vào cuối luồng; người duyệt đã có trong luồng thì gắn cờ vào bước của họ (một người không duyệt hai bước).
create function app_private.finance_route_add_step(p_route jsonb, p_label text, p_ids uuid[], p_creator uuid, p_flag text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_eligible uuid[]; v_steps jsonb := '[]'::jsonb; s jsonb; v_hit boolean := false;
begin
  if cardinality(p_ids) = 0 then
    return p_route || jsonb_build_object('problemStep', coalesce(p_route->>'problemStep', p_label || ' (chưa cài người duyệt ở Quản trị)'));
  end if;
  for s in select value from jsonb_array_elements(p_route->'steps') loop
    if exists (select 1 from jsonb_array_elements_text(s->'approverIds') x where x::uuid = any(p_ids)) then
      s := s || jsonb_build_object(p_flag, true, 'label', (s->>'label') || ' · ' || p_label); v_hit := true;
    end if;
    v_steps := v_steps || jsonb_build_array(s);
  end loop;
  if v_hit then return jsonb_set(p_route, '{steps}', v_steps); end if;
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_eligible
  from (select unnest(p_ids) u union select unnest(app_private.finance_active_delegates(i)) from unnest(p_ids) i) q
  join public.users usr on usr.id = q.u and coalesce(usr.is_active, true)
  where q.u is distinct from p_creator;
  p_route := jsonb_set(p_route, '{steps}', v_steps || jsonb_build_array(jsonb_build_object('label', p_label, 'approverIds', to_jsonb(p_ids),
    'eligibleIds', to_jsonb(v_eligible), 'extra', true, p_flag, true,
    'approverNames', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(p_ids) i),
    'eligibleNames', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_eligible) i))));
  if cardinality(v_eligible) = 0 and p_route->>'problemStep' is null then p_route := p_route || jsonb_build_object('problemStep', p_label); end if;
  return p_route;
end $$;

-- p_items: [{projectId, amount, costCategory?}]; costCategory chỉ có ở phiếu chi khác (khoản chi mới phát sinh chi phí).
-- Trả route kèm budgetOver / fundShort để màn hình giải thích vì sao có bước thêm.
create function app_private.finance_route_extras(p_route jsonb, p_items jsonb, p_creator uuid, p_exclude uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_set public.finance_settings%rowtype; it record; b record; v_fund jsonb; v_pending numeric; v_over jsonb := '[]'::jsonb; v_short jsonb := '[]'::jsonb;
  v_unknown jsonb := '[]'::jsonb;
begin
  select * into v_set from public.finance_settings where id = 1;
  for it in select x->>'projectId' project_id, x->>'costCategory' cat, sum(round((x->>'amount')::numeric, 2)) amount
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x where nullif(x->>'projectId', '') is not null group by 1, 2 loop
    if it.cat is not null then
      select * into b from app_private.finance_budget_check(it.project_id, app_private.finance_cost_item_of(null, it.cat), it.amount, p_exclude);
      if b.over then v_over := v_over || jsonb_build_object('projectId', it.project_id, 'projectCode', (select code from public.projects where id = it.project_id),
        'item', b.item_name, 'budget', b.budget, 'projected', b.projected); end if;
    end if;
  end loop;
  for it in select x->>'projectId' project_id, sum(round((x->>'amount')::numeric, 2)) amount
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x where nullif(x->>'projectId', '') is not null group by 1 loop
    v_fund := app_private.finance_project_fund(it.project_id);
    if v_fund->>'balance' is null then
      v_unknown := v_unknown || to_jsonb((select code from public.projects where id = it.project_id));
    else
      v_pending := app_private.finance_project_fund_pending(it.project_id, p_exclude);
      if (v_fund->>'balance')::numeric - v_pending - it.amount < -0.5 then
        v_short := v_short || jsonb_build_object('projectId', it.project_id, 'projectCode', (select code from public.projects where id = it.project_id),
          'balance', (v_fund->>'balance')::numeric, 'pending', v_pending, 'amount', it.amount, 'after', (v_fund->>'balance')::numeric - v_pending - it.amount);
      end if;
    end if;
  end loop;
  p_route := p_route || jsonb_build_object('budgetOver', v_over, 'fundShort', v_short, 'fundUnknown', v_unknown);
  if jsonb_array_length(v_over) > 0 then
    p_route := app_private.finance_route_add_step(p_route, 'Duyệt vượt ngân sách', v_set.budget_extra_approver_ids, p_creator, 'budget');
  end if;
  if jsonb_array_length(v_short) > 0 then
    p_route := app_private.finance_route_add_step(p_route, 'Cấp vốn dự án ' || (select string_agg(x->>'projectCode', ', ') from jsonb_array_elements(v_short) x),
      v_set.capital_provider_ids, p_creator, 'fund');
  end if;
  return p_route;
end $$;

-- Khi chi xong khoản đã qua bước "Cấp vốn dự án": quỹ âm bao nhiêu thì ghi bấy nhiêu vốn công ty cấp (tối đa phần chi của dự án),
-- người cấp = người đã duyệt bước đó.
create function app_private.finance_fund_auto_capital(p_request uuid, p_date date, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.finance_payment_requests%rowtype; v_by uuid; p record; v_bal numeric; v_amt numeric; v_id uuid; v_code text;
begin
  select * into v_req from public.finance_payment_requests where id = p_request;
  if not exists (select 1 from jsonb_array_elements(v_req.route) x where coalesce((x->>'fund')::boolean, false)) then return; end if;
  select st.actor_id into v_by from public.finance_payment_request_steps st
  where st.request_id = v_req.id and st.submission_no = v_req.submission_no and st.action = 'approve'
    and coalesce((v_req.route->st.step_no->>'fund')::boolean, false) order by st.created_at desc limit 1;
  for p in select l.project_id, sum(l.amount) share from public.finance_payment_request_lines l where v_req.kind = 'payable' and l.request_id = v_req.id
      and l.project_id is not null group by 1
    union all select v_req.project_id, v_req.amount where v_req.kind <> 'payable' and v_req.project_id is not null loop
    v_bal := (app_private.finance_project_fund(p.project_id)->>'balance')::numeric;
    if v_bal is not null and v_bal < -0.5 then
      v_amt := least(-v_bal, p.share);
      v_code := 'CV-' || to_char(p_date, 'YYMM') || '-' || lpad(nextval('public.finance_capital_seq')::text, 3, '0');
      insert into public.finance_project_capital (code, project_id, kind, amount, entry_date, reason, source_type, source_id, created_by)
      values (v_code, p.project_id, 'topup', round(v_amt, 2), p_date, 'Cấp vốn khi chi ' || v_req.code || ' (quỹ dự án âm)', 'payment_request', v_req.id::text, coalesce(v_by, p_actor))
      returning id into v_id;
      insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
      values ('project_capital', v_id::text, 'capital_auto_topup', coalesce(v_by, p_actor),
        jsonb_build_object('code', v_code, 'projectId', p.project_id, 'amount', round(v_amt, 2), 'request', v_req.code, 'confirmedBy', p_actor));
    end if;
  end loop;
end $$;

create function app_private.finance_notify_cost(p_users uuid[], p_title text, p_message text, p_project text, p_actor uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    priority, push_enabled, metadata, delivery_reason)
  select u::text, 'info', 'finance', p_title, p_message, p_message, 'info', '🏦', '/#/finance?section=cost&project=' || p_project,
    'finance_cost', 'finance_cost:' || p_project || ':' || gen_random_uuid(), 'high', true, '{}'::jsonb, 'responsible'
  from (select distinct unnest(p_users) u) q where u is not null and u is distinct from p_actor;
$$;

create function app_private.finance_users_with(p_action text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u.id), '{}'::uuid[]) from public.users u where coalesce(u.is_active, true)
    and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.finance.' || p_action));
$$;

-- ---------------------------------------------------------------------------
-- 5. Đọc: toàn công ty, một dự án
-- ---------------------------------------------------------------------------
create function app_private.finance_cost_scope()
returns table (id text, code text, name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.code, p.name from public.projects p
  where coalesce(p.status, '') not in ('cancelled', 'archived', 'completed_archived')
    and (exists (select 1 from public.customer_contracts c where c.project_id = p.id and c.status <> 'cancelled')
      or exists (select 1 from public.project_transactions t where t.project_id = p.id));
$$;

-- Tóm tắt một dự án (dùng cho danh sách toàn công ty).
create function app_private.finance_project_cost_summary(p_project text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_set public.finance_settings%rowtype; v_progress numeric; v_mat uuid; r jsonb;
begin
  select * into v_set from public.finance_settings where id = 1;
  select id into v_mat from public.contract_cost_items where symbol = 'CPNVL' and status = 'active' limit 1;
  v_progress := app_private.finance_project_gantt_progress(p_project);
  with l as (select * from app_private.finance_project_cost_lines(p_project, null))
  select jsonb_build_object(
    'budget', (select nullif(sum(budget), 0) from l where budget is not null),
    'actual', coalesce((select sum(actual) from l), 0),
    'committed', coalesce((select sum(committed) from l), 0),
    'autoMapped', coalesce((select sum(auto_mapped) from l), 0),
    'unclassified', coalesce((select sum(actual) from l where cost_item_id is null), 0),
    'materialBudget', (select budget from l where cost_item_id = v_mat),
    'materialActual', coalesce((select actual from l where cost_item_id = v_mat), 0),
    'materialCommitted', coalesce((select committed from l where cost_item_id = v_mat), 0),
    'overItems', (select count(*) from l where budget is not null and actual + committed > budget + 0.5),
    'warnItems', (select count(*) from l where budget > 0 and actual + committed <= budget + 0.5 and (actual + committed) * 100 >= budget * v_set.budget_warn_percent),
    'missingItems', (select count(*) from l where cost_item_id is not null and budget is null and actual + committed > 0.5),
    'overList', coalesce((select jsonb_agg(jsonb_build_object('item', c.symbol || ' ' || c.name, 'budget', l.budget, 'used', l.actual + l.committed) order by l.actual + l.committed - l.budget desc)
      from l join public.contract_cost_items c on c.id = l.cost_item_id where l.budget is not null and l.actual + l.committed > l.budget + 0.5), '[]'::jsonb),
    'progress', v_progress) into r;
  return r || jsonb_build_object('eac', case when v_progress >= 20 then round((r->>'actual')::numeric * 100 / v_progress) end);
end $$;

create function public.get_finance_cost_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return (with s as (select x.*, app_private.finance_project_cost_summary(x.id) cs, app_private.finance_project_fund(x.id) fund from app_private.finance_cost_scope() x),
    st as (select * from app_private.finance_po_commitments(null) c where c.stale)
  select jsonb_build_object('today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'warnPercent', v_set.budget_warn_percent,
    'can', app_private.finance_can_flags() || jsonb_build_object('capital', v_actor = any(v_set.capital_provider_ids)),
    'capitalProviders', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_set.capital_provider_ids) i),
    'budgetApprovers', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_set.budget_extra_approver_ids) i),
    'projects', coalesce((select jsonb_agg(s.cs || s.fund || jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name,
        'contractValue', (select nullif(sum(c.value), 0) from public.customer_contracts c where c.project_id = s.id and c.status <> 'cancelled'),
        'receivedAll', coalesce((select sum(t.amount) from public.project_transactions t where t.project_id = s.id and t.type = 'revenue_received'), 0),
        'currentBudget', (select jsonb_build_object('id', b.id, 'versionNo', b.version_no, 'decidedAt', b.decided_at) from public.finance_project_budgets b
          where b.project_id = s.id and b.status = 'approved'),
        'pendingBudget', (select jsonb_build_object('id', b.id, 'versionNo', b.version_no, 'createdByName', app_private.finance_user_name(b.created_by),
            'canDecide', app_private.finance_can('manage') and b.created_by is distinct from v_actor) from public.finance_project_budgets b
          where b.project_id = s.id and b.status = 'submitted'),
        'openingStatus', coalesce((select o.status from public.finance_project_fund_openings o where o.project_id = s.id and o.status in ('submitted', 'confirmed')), 'none'),
        'openingCanDecide', exists (select 1 from public.finance_project_fund_openings o where o.project_id = s.id and o.status = 'submitted'
          and o.created_by is distinct from v_actor and app_private.finance_can('confirm')))
      order by (s.cs->>'actual')::numeric desc, s.code) from s), '[]'::jsonb),
    'poBudget', coalesce((select jsonb_agg(jsonb_build_object('purchaseOrderId', o.id, 'poNumber', o.po_number, 'projectId', o.project_id,
        'projectCode', (select code from public.projects p where p.id = o.project_id), 'vendor', o.vendor_name, 'order', (o.metadata->'budgetApproval'->>'order')::numeric,
        'budget', (o.metadata->'budgetApproval'->>'budget')::numeric, 'projected', (o.metadata->'budgetApproval'->>'projected')::numeric,
        'requestedByName', o.metadata->'budgetApproval'->>'requestedByName', 'requestedAt', o.metadata->'budgetApproval'->>'requestedAt',
        'approverName', o.submitted_to_name, 'createdByName', app_private.finance_user_name(nullif(o.created_by_id, '')::uuid),
        'canDecide', v_actor = any(v_set.budget_extra_approver_ids) and o.created_by_id is distinct from v_actor::text) order by o.last_action_at)
      from public.purchase_orders o where o.status = 'sent' and o.archived_at is null and o.metadata->'budgetApproval'->>'status' = 'pending'), '[]'::jsonb),
    'stale', jsonb_build_object('count', (select count(*) from st), 'amount', coalesce((select sum(open_net) from st), 0),
      'items', coalesce((select jsonb_agg(jsonb_build_object('poNumber', st.po_number, 'projectCode', p.code, 'vendor', st.vendor_name, 'status', st.status,
          'expectedDate', st.expected_date, 'openNet', st.open_net, 'hub', st.hub) order by st.expected_date)
        from st left join public.projects p on p.id = st.project_id), '[]'::jsonb))));
end $$;

create function public.get_finance_project_cost_v1(p_project_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype; v_p public.projects%rowtype; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_p from public.projects where id = p_project_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return jsonb_build_object('today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'warnPercent', v_set.budget_warn_percent,
    'can', app_private.finance_can_flags() || jsonb_build_object('capital', v_actor = any(v_set.capital_provider_ids)),
    'project', jsonb_build_object('id', v_p.id, 'code', v_p.code, 'name', v_p.name,
      'contractValue', (select nullif(sum(c.value), 0) from public.customer_contracts c where c.project_id = v_p.id and c.status <> 'cancelled'),
      'receivedAll', coalesce((select sum(t.amount) from public.project_transactions t where t.project_id = v_p.id and t.type = 'revenue_received'), 0))
      || app_private.finance_project_cost_summary(v_p.id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'symbol', i.symbol, 'name', i.name, 'groupSymbol', i.group_symbol, 'groupName', i.group_name) order by i.ord)
      from app_private.finance_budget_items() i), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('costItemId', l.cost_item_id, 'symbol', c.symbol, 'name', c.name, 'groupSymbol', coalesce(g.symbol, c.symbol),
        'groupName', coalesce(g.name, c.name), 'budget', l.budget, 'actual', l.actual, 'autoMapped', l.auto_mapped, 'committed', l.committed,
        'budgetSource', case when l.budget is null then null when c.symbol = 'CPNVL' then 'material' else 'budget' end)
      order by coalesce(i.ord, 999), c.symbol nulls last)
      from app_private.finance_project_cost_lines(v_p.id, null) l left join public.contract_cost_items c on c.id = l.cost_item_id
      left join public.contract_cost_items g on g.id = c.parent_id left join app_private.finance_budget_items() i on i.id = l.cost_item_id), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'versionNo', b.version_no, 'status', b.status, 'reason', b.reason,
        'materialBudget', b.material_budget, 'otherTotal', b.other_total, 'createdByName', app_private.finance_user_name(b.created_by), 'createdAt', b.created_at,
        'decidedByName', app_private.finance_user_name(b.decided_by), 'decidedAt', b.decided_at, 'decisionNote', b.decision_note, 'rowVersion', b.row_version,
        'canDecide', b.status = 'submitted' and app_private.finance_can('manage') and b.created_by is distinct from v_actor,
        'canWithdraw', b.status = 'submitted' and b.created_by = v_actor,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('costItemId', l.cost_item_id, 'amount', l.amount, 'note', l.note)) from public.finance_project_budget_lines l
          where l.budget_id = b.id), '[]'::jsonb)) order by b.version_no desc)
      from public.finance_project_budgets b where b.project_id = v_p.id), '[]'::jsonb),
    'commitments', coalesce((select jsonb_agg(jsonb_build_object('poNumber', c.po_number, 'vendor', c.vendor_name, 'status', c.status, 'expectedDate', c.expected_date,
        'netTotal', c.net_total, 'receivedNet', c.received_net, 'openNet', c.open_net, 'stale', c.stale, 'hub', c.hub) order by c.stale desc, c.open_net desc)
      from app_private.finance_po_commitments(v_p.id) c where c.open_net > 0.5), '[]'::jsonb),
    'fund', app_private.finance_project_fund(v_p.id) || jsonb_build_object(
      'openingRecord', (select jsonb_build_object('id', o.id, 'status', o.status, 'cutoverDate', o.cutover_date, 'receivedToDate', o.received_to_date,
          'spentToDate', o.spent_to_date, 'balance', o.balance, 'note', o.note, 'attachments', o.attachments, 'createdByName', app_private.finance_user_name(o.created_by),
          'createdAt', o.created_at, 'decidedByName', app_private.finance_user_name(o.decided_by), 'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
          'canDecide', o.status = 'submitted' and app_private.finance_can('confirm') and o.created_by is distinct from v_actor,
          'canCancel', o.status = 'confirmed' and app_private.finance_can('manage'))
        from public.finance_project_fund_openings o where o.project_id = v_p.id order by o.created_at desc limit 1),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('date', r.entry_date, 'kind', r.kind, 'code', r.code, 'description', r.description, 'amount', r.amount,
          'sourceType', r.source_type, 'reversal', r.reversal) order by r.entry_date desc, r.code)
        from app_private.finance_project_fund_rows(v_p.id) r where r.entry_date >= v_set.ap_cutover_date), '[]'::jsonb),
      'pending', app_private.finance_project_fund_pending(v_p.id, null),
      'capitalList', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'kind', c.kind, 'amount', c.amount, 'date', c.entry_date, 'reason', c.reason,
          'sourceType', c.source_type, 'status', c.status, 'createdByName', app_private.finance_user_name(c.created_by), 'createdAt', c.created_at,
          'reversedByName', app_private.finance_user_name(c.reversed_by), 'reverseReason', c.reverse_reason,
          'canReverse', c.status = 'posted' and c.source_type = 'manual' and v_actor = any(v_set.capital_provider_ids)) order by c.created_at desc)
        from public.finance_project_capital c where c.project_id = v_p.id), '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Ghi: ngân sách
-- ---------------------------------------------------------------------------
create function public.save_finance_project_budget_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_project text := nullif(p_input->>'projectId', ''); v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_id uuid; v_no integer; v_total numeric; v_code text;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_project is null or not exists (select 1 from app_private.finance_cost_scope() s where s.id = v_project) then
    raise exception using errcode = '22023', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  perform 1 from public.projects where id = v_project for update;
  if exists (select 1 from public.finance_project_budgets where project_id = v_project and status = 'submitted') then
    raise exception using errcode = '22023', message = 'FINANCE_BUDGET_PENDING'; end if;
  create temp table if not exists pg_temp.fin_budget_lines (cost_item_id uuid, amount numeric, note text) on commit drop;
  truncate pg_temp.fin_budget_lines;
  insert into pg_temp.fin_budget_lines
  select (x->>'costItemId')::uuid, round(nullif(x->>'amount', '')::numeric, 2), nullif(btrim(x->>'note'), '')
  from jsonb_array_elements(coalesce(p_input->'lines', '[]'::jsonb)) x where nullif(x->>'amount', '') is not null;
  if not exists (select 1 from pg_temp.fin_budget_lines) then raise exception using errcode = '22023', message = 'FINANCE_BUDGET_EMPTY'; end if;
  if exists (select 1 from pg_temp.fin_budget_lines l where l.amount is null or l.amount < 0
      or not exists (select 1 from app_private.finance_budget_items() i where i.id = l.cost_item_id and i.symbol <> 'CPNVL'))
    or (select count(*) <> count(distinct cost_item_id) from pg_temp.fin_budget_lines) then
    raise exception using errcode = '22023', message = 'FINANCE_BUDGET_LINE_INVALID'; end if;
  select coalesce(max(version_no), 0) + 1 into v_no from public.finance_project_budgets where project_id = v_project;
  select sum(amount) into v_total from pg_temp.fin_budget_lines;
  insert into public.finance_project_budgets (project_id, version_no, reason, material_budget, other_total, created_by)
  values (v_project, v_no, v_reason, (select nullif(sum(m.budget_total), 0) from public.material_budget_items m where m.project_id = v_project), v_total, v_actor)
  returning id into v_id;
  insert into public.finance_project_budget_lines (budget_id, cost_item_id, amount, note) select v_id, cost_item_id, amount, note from pg_temp.fin_budget_lines;
  select code into v_code from public.projects where id = v_project;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('project_budget', v_id::text, 'budget_submit', v_actor, v_reason, jsonb_build_object('projectId', v_project, 'versionNo', v_no, 'otherTotal', v_total,
    'lines', (select jsonb_agg(jsonb_build_object('costItemId', cost_item_id, 'amount', amount)) from pg_temp.fin_budget_lines)));
  perform app_private.finance_notify_cost(app_private.finance_users_with('manage'), 'Ngân sách dự án chờ duyệt',
    v_code || ' · phiên bản ' || v_no || ': ' || v_reason, v_project, v_actor);
  return jsonb_build_object('id', v_id, 'versionNo', v_no);
end $$;

create function public.decide_finance_project_budget_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_b public.finance_project_budgets%rowtype; v_code text;
begin
  select * into v_b from public.finance_project_budgets where id = nullif(p_input->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_BUDGET_NOT_FOUND'; end if;
  if v_b.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_b.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_BUDGET_STATE'; end if;
  if v_action = 'withdraw' then
    if v_b.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
  elsif v_action in ('approve', 'reject') then
    if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
    if v_actor is null or v_actor = v_b.created_by then raise exception using errcode = '42501', message = 'FINANCE_BUDGET_SELF_DECIDE'; end if;
    if v_action = 'reject' and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  if v_action = 'approve' then
    update public.finance_project_budgets set status = 'superseded', row_version = row_version + 1 where project_id = v_b.project_id and status = 'approved';
  end if;
  update public.finance_project_budgets set status = case v_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'withdrawn' end,
    decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = v_b.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('project_budget', v_b.id::text, 'budget_' || v_action, v_actor, v_reason, jsonb_build_object('projectId', v_b.project_id, 'versionNo', v_b.version_no));
  select code into v_code from public.projects where id = v_b.project_id;
  if v_action <> 'withdraw' then
    perform app_private.finance_notify_cost(array[v_b.created_by], case v_action when 'approve' then 'Ngân sách dự án đã duyệt' else 'Ngân sách dự án bị trả lại' end,
      v_code || ' · phiên bản ' || v_b.version_no || coalesce(': ' || v_reason, ''), v_b.project_id, v_actor);
  end if;
  return jsonb_build_object('id', v_b.id, 'status', case v_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'withdrawn' end);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Ghi: đầu kỳ quỹ dự án, cấp vốn / thu hồi vốn
-- ---------------------------------------------------------------------------
create function public.save_finance_project_fund_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_project text := nullif(p_input->>'projectId', '');
  v_in numeric := round(nullif(p_input->>'receivedToDate', '')::numeric, 2); v_out numeric := round(nullif(p_input->>'spentToDate', '')::numeric, 2);
  v_id uuid; v_code text; v_cut date;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_project is null or not exists (select 1 from app_private.finance_cost_scope() s where s.id = v_project) then
    raise exception using errcode = '22023', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  if v_in is null or v_out is null or v_in < 0 or v_out < 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  perform 1 from public.projects where id = v_project for update;
  if exists (select 1 from public.finance_project_fund_openings where project_id = v_project and status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'FINANCE_FUND_OPENING_EXISTS'; end if;
  select ap_cutover_date - 1 into v_cut from public.finance_settings where id = 1;
  insert into public.finance_project_fund_openings (project_id, cutover_date, received_to_date, spent_to_date, note, attachments, created_by)
  values (v_project, v_cut, v_in, v_out, nullif(btrim(p_input->>'note'), ''), p_input->'attachments', v_actor) returning id into v_id;
  select code into v_code from public.projects where id = v_project;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('project_fund_opening', v_id::text, 'fund_opening_submit', v_actor, jsonb_build_object('projectId', v_project, 'receivedToDate', v_in, 'spentToDate', v_out));
  perform app_private.finance_notify_cost(app_private.finance_users_with('confirm'), 'Đầu kỳ quỹ dự án chờ chốt',
    v_code || ': đã thu ' || to_char(v_in, 'FM999G999G999G990') || ' − đã chi ' || to_char(v_out, 'FM999G999G999G990'), v_project, v_actor);
  return jsonb_build_object('id', v_id);
end $$;

create function public.decide_finance_project_fund_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_o public.finance_project_fund_openings%rowtype; v_code text;
begin
  select * into v_o from public.finance_project_fund_openings where id = nullif(p_input->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_FUND_OPENING_NOT_FOUND'; end if;
  if v_action in ('confirm', 'reject') then
    if v_o.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_FUND_OPENING_STATE'; end if;
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if v_actor is null or v_actor = v_o.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  elsif v_action = 'cancel' then
    if v_o.status <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_FUND_OPENING_STATE'; end if;
    if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  update public.finance_project_fund_openings set status = case v_action when 'confirm' then 'confirmed' when 'reject' then 'rejected' else 'cancelled' end,
    decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = v_o.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('project_fund_opening', v_o.id::text, 'fund_opening_' || v_action, v_actor, v_reason, jsonb_build_object('projectId', v_o.project_id, 'balance', v_o.balance));
  select code into v_code from public.projects where id = v_o.project_id;
  perform app_private.finance_notify_cost(array[v_o.created_by], case v_action when 'confirm' then 'Đầu kỳ quỹ dự án đã chốt' when 'reject' then 'Đầu kỳ quỹ dự án bị trả lại'
    else 'Đầu kỳ quỹ dự án đã hủy' end, v_code || coalesce(': ' || v_reason, ''), v_o.project_id, v_actor);
  return jsonb_build_object('id', v_o.id, 'status', case v_action when 'confirm' then 'confirmed' when 'reject' then 'rejected' else 'cancelled' end);
end $$;

create function public.save_finance_project_capital_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype; v_project text := nullif(p_input->>'projectId', '');
  v_kind text := p_input->>'kind'; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2); v_date date := nullif(p_input->>'date', '')::date;
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_net numeric; v_id uuid; v_code text; v_pcode text;
begin
  select * into v_set from public.finance_settings where id = 1;
  if v_actor is null or not (v_actor = any(v_set.capital_provider_ids)) then raise exception using errcode = '42501', message = 'FINANCE_CAPITAL_DENIED'; end if;
  if v_project is null or not exists (select 1 from app_private.finance_cost_scope() s where s.id = v_project) then
    raise exception using errcode = '22023', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  if v_kind not in ('topup', 'return') or v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if v_date is null or v_date > v_today or v_date < v_set.ap_cutover_date then raise exception using errcode = '22023', message = 'FINANCE_CAPITAL_DATE_INVALID'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  perform 1 from public.projects where id = v_project for update;
  if v_kind = 'return' then
    select coalesce(sum(case kind when 'topup' then amount else -amount end), 0) into v_net from public.finance_project_capital where project_id = v_project and status = 'posted';
    if v_amount > v_net + 0.5 then raise exception using errcode = '22023', message = 'FINANCE_CAPITAL_RETURN_EXCEEDS'; end if;
  end if;
  v_code := 'CV-' || to_char(v_date, 'YYMM') || '-' || lpad(nextval('public.finance_capital_seq')::text, 3, '0');
  insert into public.finance_project_capital (code, project_id, kind, amount, entry_date, reason, created_by)
  values (v_code, v_project, v_kind, v_amount, v_date, v_reason, v_actor) returning id into v_id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('project_capital', v_id::text, 'capital_' || v_kind, v_actor, v_reason, jsonb_build_object('code', v_code, 'projectId', v_project, 'amount', v_amount, 'date', v_date));
  select code into v_pcode from public.projects where id = v_project;
  perform app_private.finance_notify_cost(app_private.finance_users_with('manage'), case v_kind when 'topup' then 'Công ty cấp vốn cho dự án' else 'Thu hồi vốn từ dự án' end,
    v_pcode || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ: ' || v_reason, v_project, v_actor);
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create function public.reverse_finance_project_capital_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_reason text := nullif(btrim(p_input->>'reason'), ''); v_c public.finance_project_capital%rowtype; v_net numeric;
  v_ids uuid[] := (select capital_provider_ids from public.finance_settings where id = 1);
begin
  if v_actor is null or not (v_actor = any(v_ids)) then
    raise exception using errcode = '42501', message = 'FINANCE_CAPITAL_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into v_c from public.finance_project_capital where id = nullif(p_input->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CAPITAL_NOT_FOUND'; end if;
  if v_c.status <> 'posted' then raise exception using errcode = '22023', message = 'FINANCE_CAPITAL_STATE'; end if;
  if v_c.source_type <> 'manual' then raise exception using errcode = '22023', message = 'FINANCE_CAPITAL_AUTO'; end if;
  if v_c.kind = 'topup' then
    select coalesce(sum(case kind when 'topup' then amount else -amount end), 0) into v_net from public.finance_project_capital
    where project_id = v_c.project_id and status = 'posted' and id <> v_c.id;
    if v_net < -0.5 then raise exception using errcode = '22023', message = 'FINANCE_CAPITAL_RETURN_EXCEEDS'; end if;
  end if;
  update public.finance_project_capital set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = v_reason where id = v_c.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('project_capital', v_c.id::text, 'capital_reverse', v_actor, v_reason, jsonb_build_object('code', v_c.code, 'projectId', v_c.project_id, 'amount', v_c.amount));
  return jsonb_build_object('id', v_c.id, 'status', 'reversed');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Quản trị: ngưỡng cảnh báo, người duyệt vượt ngân sách, người cấp vốn
-- ---------------------------------------------------------------------------
create function public.save_finance_cost_settings_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_warn numeric := nullif(p_input->>'warnPercent', '')::numeric; v_budget uuid[]; v_capital uuid[];
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_budget from jsonb_array_elements_text(coalesce(p_input->'budgetApproverIds', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_capital from jsonb_array_elements_text(coalesce(p_input->'capitalProviderIds', '[]'::jsonb)) x;
  if v_warn is null or v_warn < 50 or v_warn > 100 or cardinality(v_budget) = 0 or cardinality(v_capital) = 0
    or exists (select 1 from unnest(v_budget || v_capital) i where not exists (select 1 from public.users u where u.id = i and coalesce(u.is_active, true))) then
    raise exception using errcode = '22023', message = 'FINANCE_COST_SETTINGS_INVALID'; end if;
  select * into v_set from public.finance_settings where id = 1 for update;
  if v_set.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  update public.finance_settings set budget_warn_percent = v_warn, budget_extra_approver_ids = v_budget, capital_provider_ids = v_capital,
    row_version = row_version + 1, updated_by = v_actor, updated_at = now() where id = 1;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after)
  values ('settings', '1', 'cost_settings_save', v_actor, v_reason,
    jsonb_build_object('warnPercent', v_set.budget_warn_percent, 'budgetApproverIds', to_jsonb(v_set.budget_extra_approver_ids), 'capitalProviderIds', to_jsonb(v_set.capital_provider_ids)),
    jsonb_build_object('warnPercent', v_warn, 'budgetApproverIds', to_jsonb(v_budget), 'capitalProviderIds', to_jsonb(v_capital)));
  perform app_private.finance_notify_admins('Đổi thông số ngân sách / cấp vốn dự án', 'Cảnh báo ' || v_warn || '%: ' || v_reason, v_actor);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function app_private.finance_budget_items(), app_private.finance_cost_item_of(uuid, text), app_private.finance_po_commitments(text),
  app_private.finance_project_cost_lines(text, uuid), app_private.finance_budget_check(text, uuid, numeric, uuid), app_private.finance_po_budget_check(text), app_private.finance_po_budget_mark(text, uuid),
  app_private.finance_project_fund_rows(text), app_private.finance_project_fund(text), app_private.finance_project_fund_pending(text, uuid),
  app_private.finance_route_add_step(jsonb, text, uuid[], uuid, text), app_private.finance_route_extras(jsonb, jsonb, uuid, uuid),
  app_private.finance_fund_auto_capital(uuid, date, uuid), app_private.finance_notify_cost(uuid[], text, text, text, uuid), app_private.finance_users_with(text),
  app_private.finance_cost_scope(), app_private.finance_project_cost_summary(text) from public, anon, authenticated;
revoke all on function public.get_finance_cost_v1(), public.get_finance_project_cost_v1(text), public.save_finance_project_budget_v1(jsonb),
  public.decide_finance_project_budget_v1(jsonb), public.save_finance_project_fund_opening_v1(jsonb), public.decide_finance_project_fund_opening_v1(jsonb),
  public.save_finance_project_capital_v1(jsonb), public.reverse_finance_project_capital_v1(jsonb), public.save_finance_cost_settings_v1(jsonb),
  public.decide_finance_po_budget_v1(jsonb) from public, anon;
grant execute on function public.get_finance_cost_v1(), public.get_finance_project_cost_v1(text), public.save_finance_project_budget_v1(jsonb),
  public.decide_finance_project_budget_v1(jsonb), public.save_finance_project_fund_opening_v1(jsonb), public.decide_finance_project_fund_opening_v1(jsonb),
  public.save_finance_project_capital_v1(jsonb), public.reverse_finance_project_capital_v1(jsonb), public.save_finance_cost_settings_v1(jsonb),
  public.decide_finance_po_budget_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Vá hàm đang chạy: luồng duyệt đề nghị chi / tạm ứng / chi khác (bước thêm), xác nhận chi (tự ghi cấp vốn), đảo chi,
--    duyệt đơn Mua hàng (bước duyệt vượt ngân sách vật tư), Quản trị
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_finance_payment_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId'; v_req uuid := nullif(p_input->>'requestId', '')::uuid;
  v_total numeric; v_docs uuid[]; v_bp record;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select coalesce(sum(round(nullif(a->>'amount', '')::numeric, 2)), 0), coalesce(array_agg((a->>'documentId')::uuid), '{}'::uuid[]) into v_total, v_docs
  from jsonb_array_elements(coalesce(p_input->'lines', '[]'::jsonb)) a;
  select id, name, bank_name, bank_account, tax_code into v_bp from public.business_partners where id = v_supplier;
  return jsonb_build_object('route', app_private.finance_route_extras(app_private.finance_payment_route(v_supplier, greatest(v_total, 0.01), v_docs, v_actor, v_req),
      (select coalesce(jsonb_agg(jsonb_build_object('projectId', d.project_id, 'amount', coalesce(round(nullif(a->>'amount', '')::numeric, 2), 0))), '[]'::jsonb)
        from jsonb_array_elements(coalesce(p_input->'lines', '[]'::jsonb)) a join public.supplier_payable_documents d on d.id = (a->>'documentId')::uuid),
      v_actor, v_req),
    'bank', case when nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then null else jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
    'internal', exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier),
    'reserved', (select coalesce(jsonb_object_agg(d::text, app_private.finance_doc_reserved(d, v_req)), '{}'::jsonb) from unnest(v_docs) d),
    'canRecord', app_private.finance_can('record'));
end $function$;

CREATE OR REPLACE FUNCTION public.save_finance_payment_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId'; v_req public.finance_payment_requests%rowtype;
  v_method text := coalesce(nullif(p_input->>'method', ''), 'bank_transfer'); v_date date := nullif(p_input->>'plannedDate', '')::date;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_bp record; v_total numeric; v_docs uuid[]; v_route jsonb; v_id uuid;
  v_code text; v_submission integer := 1;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_method not in ('bank_transfer', 'cash') then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_METHOD_INVALID'; end if;
  if v_date is null or v_date < v_today - 30 then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier) then
    raise exception using errcode = '22023', message = 'FINANCE_INTERNAL_PARTNER'; end if;
  select id, name, bank_name, bank_account into v_bp from public.business_partners where id = v_supplier;
  if not found then raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  if v_method = 'bank_transfer' and nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then
    raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_BANK_REQUIRED'; end if;
  if nullif(p_input->>'requestId', '') is not null then
    select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
    if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_req.status <> 'returned' or v_req.created_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'FINANCE_REQUEST_STATE'; end if;
    if v_req.supplier_id is distinct from v_supplier then raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    v_submission := v_req.submission_no + 1;
  end if;

  create temp table if not exists pg_temp.fin_req_lines (doc_id uuid, amount numeric, project_id text, site_id text, document_no text, outstanding numeric,
    source_type text, source_id text, recognized numeric, paid numeric) on commit drop;
  truncate pg_temp.fin_req_lines;
  insert into pg_temp.fin_req_lines select * from app_private.finance_check_request_lines(v_supplier, p_input->'lines', v_req.id);
  select sum(amount), array_agg(doc_id) into v_total, v_docs from pg_temp.fin_req_lines;
  v_route := app_private.finance_payment_route(v_supplier, v_total, v_docs, v_actor, v_req.id);
  v_route := app_private.finance_route_extras(v_route, (select coalesce(jsonb_agg(jsonb_build_object('projectId', project_id, 'amount', amount)), '[]'::jsonb)
    from pg_temp.fin_req_lines), v_actor, v_req.id);
  if v_route->>'problemStep' is not null then
    raise exception using errcode = '22023', message = 'FINANCE_NO_ELIGIBLE_APPROVER: ' || (v_route->>'problemStep'); end if;

  if v_req.id is null then
    v_code := 'ĐNC-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_payment_request_seq')::text, 3, '0');
    insert into public.finance_payment_requests (code, supplier_id, supplier_name, method, bank_snapshot, planned_date, amount, note, status,
      matrix_version_id, threshold_amount, prior_requests, route, current_step, created_by)
    values (v_code, v_supplier, v_bp.name, v_method,
      case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      v_date, v_total, nullif(btrim(p_input->>'note'), ''), 'pending', (v_route->>'versionId')::uuid, (v_route->>'thresholdAmount')::numeric,
      v_route->'priorRequests', v_route->'steps', 0, v_actor)
    returning id into v_id;
  else
    v_id := v_req.id;
    delete from public.finance_payment_request_lines where request_id = v_id;
    update public.finance_payment_requests set method = v_method,
      bank_snapshot = case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      planned_date = v_date, amount = v_total, note = nullif(btrim(p_input->>'note'), ''), status = 'pending',
      matrix_version_id = (v_route->>'versionId')::uuid, threshold_amount = (v_route->>'thresholdAmount')::numeric, prior_requests = v_route->'priorRequests',
      route = v_route->'steps', current_step = 0, submission_no = v_submission, submitted_at = now(), decided_at = null,
      updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  insert into public.finance_payment_request_lines (request_id, payable_document_id, project_id, construction_site_id, document_no, outstanding_snapshot, amount)
  select v_id, doc_id, project_id, site_id, document_no, outstanding, amount from pg_temp.fin_req_lines;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_id, v_submission, case when v_submission = 1 then 'Lập và gửi duyệt' else 'Sửa và gửi lại' end, 'submit', v_actor,
    jsonb_build_object('amount', v_total, 'thresholdAmount', v_route->'thresholdAmount', 'tierNo', v_route->'tierNo'));
  select code into v_code from public.finance_payment_requests where id = v_id;
  perform app_private.finance_notify(array(select jsonb_array_elements_text(v_route->'steps'->0->'eligibleIds')::uuid),
    'Đề nghị chi chờ bạn duyệt', v_code || ' · ' || v_bp.name || ' · ' || to_char(v_total, 'FM999G999G999G990') || ' đ', v_id, v_actor);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_id::text, v_supplier, 'payment_request_submit', v_actor, jsonb_build_object('code', v_code, 'amount', v_total, 'submission', v_submission));
  return jsonb_build_object('requestId', v_id, 'code', v_code, 'amount', v_total, 'route', v_route);
end $function$;

CREATE OR REPLACE FUNCTION public.preview_finance_advance_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId'; v_req uuid := nullif(p_input->>'requestId', '')::uuid;
  v_amount numeric := greatest(coalesce(round(nullif(p_input->>'amount', '')::numeric, 2), 0), 0.01); t record; v_bp record;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into t from app_private.finance_advance_target(v_supplier, p_input->>'purchaseOrderId', p_input->>'contractId', p_input->>'projectId', v_req);
  select bank_name, bank_account into v_bp from public.business_partners where id = v_supplier;
  return jsonb_build_object(
    'route', app_private.finance_route_extras(app_private.finance_advance_route(v_supplier, v_amount, case when t.base > 0 then round(v_amount * 100 / t.base, 3) end, v_actor, v_req),
      jsonb_build_array(jsonb_build_object('projectId', t.project_id, 'amount', v_amount)), v_actor, v_req),
    'target', jsonb_build_object('base', t.base, 'received', t.received, 'other', t.other, 'poNumber', t.po_number, 'contractCode', t.contract_code,
      'expectedDate', t.expected_date, 'projectId', t.project_id, 'available', case when t.base is not null then greatest(t.base - t.other, 0) end),
    'bank', case when nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then null else jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
    'internal', exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier),
    'canRecord', app_private.finance_can('record'));
end $function$;

CREATE OR REPLACE FUNCTION public.save_finance_advance_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId'; v_req public.finance_payment_requests%rowtype;
  v_method text := coalesce(nullif(p_input->>'method', ''), 'bank_transfer'); v_date date := nullif(p_input->>'plannedDate', '')::date;
  v_due date := nullif(p_input->>'repayDueDate', '')::date; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_note text := nullif(btrim(p_input->>'note'), ''); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_bp record; t record; v_percent numeric; v_route jsonb; v_id uuid; v_code text; v_submission integer := 1;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_method not in ('bank_transfer', 'cash') then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_METHOD_INVALID'; end if;
  if v_date is null or v_date < v_today - 30 then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if v_note is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_due is null or v_due < v_today then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_DUE_INVALID'; end if;
  if exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier) then
    raise exception using errcode = '22023', message = 'FINANCE_INTERNAL_PARTNER'; end if;
  select id, name, bank_name, bank_account into v_bp from public.business_partners where id = v_supplier;
  if not found then raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  if v_method = 'bank_transfer' and nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then
    raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_BANK_REQUIRED'; end if;
  if nullif(p_input->>'requestId', '') is not null then
    select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
    if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_req.kind <> 'advance' or v_req.status <> 'returned' or v_req.created_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'FINANCE_REQUEST_STATE'; end if;
    if v_req.supplier_id is distinct from v_supplier then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_SCOPE'; end if;
    v_submission := v_req.submission_no + 1;
  end if;
  if nullif(p_input->>'purchaseOrderId', '') is not null then perform 1 from public.purchase_orders where id = p_input->>'purchaseOrderId' for update; end if;
  select * into t from app_private.finance_advance_target(v_supplier, p_input->>'purchaseOrderId', p_input->>'contractId', p_input->>'projectId', v_req.id);
  if t.base is not null and v_amount + t.other > t.base + 0.5 then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_OVER_ORDER'; end if;
  v_percent := case when t.base > 0 then round(v_amount * 100 / t.base, 3) end;
  v_route := app_private.finance_advance_route(v_supplier, v_amount, v_percent, v_actor, v_req.id);
  v_route := app_private.finance_route_extras(v_route, jsonb_build_array(jsonb_build_object('projectId', t.project_id, 'amount', v_amount)), v_actor, v_req.id);
  if v_route->>'problemStep' is not null then
    raise exception using errcode = '22023', message = 'FINANCE_NO_ELIGIBLE_APPROVER: ' || (v_route->>'problemStep'); end if;

  if v_req.id is null then
    v_code := 'TU-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_advance_seq')::text, 3, '0');
    insert into public.finance_payment_requests (code, supplier_id, supplier_name, method, bank_snapshot, planned_date, amount, note, status,
      matrix_version_id, threshold_amount, prior_requests, route, current_step, created_by, kind, purchase_order_id, supplier_contract_id,
      project_id, construction_site_id, advance_base, advance_percent, repay_due_date)
    values (v_code, v_supplier, v_bp.name, v_method,
      case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      v_date, v_amount, v_note, 'pending', (v_route->>'versionId')::uuid, (v_route->>'thresholdAmount')::numeric,
      v_route->'priorRequests', v_route->'steps', 0, v_actor, 'advance', t.purchase_order_id, t.supplier_contract_id,
      t.project_id, t.construction_site_id, t.base, v_percent, v_due)
    returning id into v_id;
  else
    v_id := v_req.id; v_code := v_req.code;
    update public.finance_payment_requests set method = v_method,
      bank_snapshot = case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      planned_date = v_date, amount = v_amount, note = v_note, status = 'pending',
      matrix_version_id = (v_route->>'versionId')::uuid, threshold_amount = (v_route->>'thresholdAmount')::numeric, prior_requests = v_route->'priorRequests',
      route = v_route->'steps', current_step = 0, submission_no = v_submission, submitted_at = now(), decided_at = null,
      purchase_order_id = t.purchase_order_id, supplier_contract_id = t.supplier_contract_id, project_id = t.project_id,
      construction_site_id = t.construction_site_id, advance_base = t.base, advance_percent = v_percent, repay_due_date = v_due,
      updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_id, v_submission, case when v_submission = 1 then 'Lập đề nghị tạm ứng và gửi duyệt' else 'Sửa và gửi lại' end, 'submit', v_actor,
    jsonb_build_object('amount', v_amount, 'percent', v_percent, 'thresholdAmount', v_route->'thresholdAmount', 'tierNo', v_route->'tierNo'));
  perform app_private.finance_notify(array(select jsonb_array_elements_text(v_route->'steps'->0->'eligibleIds')::uuid),
    'Đề nghị tạm ứng chờ bạn duyệt', v_code || ' · ' || v_bp.name || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ', v_id, v_actor);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_id::text, v_supplier, 'advance_submit', v_actor,
    jsonb_build_object('code', v_code, 'amount', v_amount, 'percent', v_percent, 'purchaseOrder', t.po_number, 'contract', t.contract_code, 'submission', v_submission));
  return jsonb_build_object('requestId', v_id, 'code', v_code, 'amount', v_amount, 'route', v_route);
end $function$;

create or replace function public.preview_finance_expense_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object('route', app_private.finance_route_extras(app_private.finance_payment_route(null, greatest(coalesce(round(nullif(p_input->>'amount', '')::numeric, 2), 0), 0.01), '{}'::uuid[],
    public.current_app_user_id(), nullif(p_input->>'requestId', '')::uuid),
    case when nullif(p_input->>'projectId', '') is not null then jsonb_build_array(jsonb_build_object('projectId', p_input->>'projectId',
      'amount', greatest(coalesce(round(nullif(p_input->>'amount', '')::numeric, 2), 0), 0.01), 'costCategory', coalesce(nullif(p_input->>'costCategory', ''), 'other'))) end,
    public.current_app_user_id(), nullif(p_input->>'requestId', '')::uuid), 'canRecord', app_private.finance_can('record'));
end $$;

create or replace function public.save_finance_expense_request_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_date date := nullif(p_input->>'plannedDate', '')::date; v_method text := coalesce(nullif(p_input->>'method', ''), 'bank_transfer');
  v_note text := nullif(btrim(p_input->>'note'), ''); v_party text := nullif(btrim(p_input->>'counterparty'), ''); v_cat text := nullif(p_input->>'category', '');
  v_project text := nullif(p_input->>'projectId', ''); v_cost text := nullif(p_input->>'costCategory', ''); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_route jsonb; v_id uuid; v_code text; v_submission integer := 1;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if v_method not in ('bank_transfer', 'cash') then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_METHOD_INVALID'; end if;
  if v_date is null or v_date < v_today - 30 then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_note is null or v_party is null or v_cat is null then raise exception using errcode = '22023', message = 'FINANCE_EXPENSE_INVALID'; end if;
  if v_project is not null and not exists (select 1 from public.projects where id = v_project) then raise exception using errcode = '22023', message = 'FINANCE_EXPENSE_INVALID'; end if;
  if nullif(p_input->>'requestId', '') is not null then
    select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
    if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_req.kind <> 'expense' or v_req.status <> 'returned' or v_req.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_REQUEST_STATE'; end if;
    v_submission := v_req.submission_no + 1;
  end if;
  v_route := app_private.finance_payment_route(null, v_amount, '{}'::uuid[], v_actor, v_req.id);
  if v_project is not null then
    v_route := app_private.finance_route_extras(v_route, jsonb_build_array(jsonb_build_object('projectId', v_project, 'amount', v_amount, 'costCategory', coalesce(v_cost, 'other'))),
      v_actor, v_req.id);
  end if;
  if v_route->>'problemStep' is not null then raise exception using errcode = '22023', message = 'FINANCE_NO_ELIGIBLE_APPROVER: ' || (v_route->>'problemStep'); end if;
  if v_req.id is null then
    v_code := 'CK-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_expense_seq')::text, 3, '0');
    insert into public.finance_payment_requests (code, supplier_id, supplier_name, method, planned_date, amount, note, status, matrix_version_id, threshold_amount,
      prior_requests, route, current_step, created_by, kind, project_id, expense_category, cost_category)
    values (v_code, null, v_party, v_method, v_date, v_amount, v_note, 'pending', (v_route->>'versionId')::uuid, (v_route->>'thresholdAmount')::numeric,
      v_route->'priorRequests', v_route->'steps', 0, v_actor, 'expense', v_project, v_cat, case when v_project is not null then coalesce(v_cost, 'other') end)
    returning id into v_id;
  else
    v_id := v_req.id; v_code := v_req.code;
    update public.finance_payment_requests set supplier_name = v_party, method = v_method, planned_date = v_date, amount = v_amount, note = v_note, status = 'pending',
      matrix_version_id = (v_route->>'versionId')::uuid, threshold_amount = (v_route->>'thresholdAmount')::numeric, prior_requests = v_route->'priorRequests',
      route = v_route->'steps', current_step = 0, submission_no = v_submission, submitted_at = now(), decided_at = null, project_id = v_project,
      expense_category = v_cat, cost_category = case when v_project is not null then coalesce(v_cost, 'other') end, updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_id, v_submission, case when v_submission = 1 then 'Lập phiếu chi khác và gửi duyệt' else 'Sửa và gửi lại' end, 'submit', v_actor,
    jsonb_build_object('amount', v_amount, 'category', v_cat, 'tierNo', v_route->'tierNo'));
  perform app_private.finance_notify(array(select jsonb_array_elements_text(v_route->'steps'->0->'eligibleIds')::uuid),
    'Phiếu chi khác chờ bạn duyệt', v_code || ' · ' || v_party || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ', v_id, v_actor);
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('payment_request', v_id::text, 'expense_submit', v_actor, jsonb_build_object('code', v_code, 'amount', v_amount, 'category', v_cat, 'projectId', v_project));
  return jsonb_build_object('requestId', v_id, 'code', v_code, 'amount', v_amount, 'route', v_route);
end $$;

create or replace function public.confirm_finance_payment_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype;
  v_date date := nullif(p_input->>'paymentDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), '');
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_lines jsonb; g record; v_bid uuid; v_batches jsonb := '[]'::jsonb;
  v_last_approver uuid; v_cash uuid;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
  if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_req.status <> 'approved' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
  if v_actor = v_req.created_by or exists (select 1 from public.finance_payment_request_steps s where s.request_id = v_req.id
      and s.submission_no = v_req.submission_no and s.action = 'approve' and s.actor_id = v_actor)
    or v_actor = any(select unnest(app_private.finance_doc_handlers(l.payable_document_id)) from public.finance_payment_request_lines l where l.request_id = v_req.id) then
    raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
  if v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_REQUIRED'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if exists (select 1 from public.supplier_payment_batches where supplier_id = v_req.supplier_id and document_ref = v_ref and status in ('submitted', 'paid')) then
    raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_DUPLICATE'; end if;
  select actor_id into v_last_approver from public.finance_payment_request_steps where request_id = v_req.id and submission_no = v_req.submission_no
    and action = 'approve' order by created_at desc limit 1;
  -- Thu chi & quỹ: chọn tài khoản tiền đã chi → sổ thu chi.
  v_cash := app_private.finance_cash_require_account(nullif(p_input->>'cashAccountId', '')::uuid);
  perform app_private.finance_cash_entry(v_cash, v_date, 'out', v_req.amount, 'payment_request', v_req.id::text, v_req.code || ' · ' || v_ref,
    case v_req.kind when 'advance' then 'Tạm ứng NCC ' || v_req.supplier_name when 'expense' then 'Chi khác: ' || coalesce(v_req.note, '') else 'Chi NCC ' || v_req.supplier_name end,
    v_req.supplier_name, v_req.project_id, v_actor);
  perform app_private.finance_fund_auto_capital(v_req.id, v_date, v_actor);
  if v_req.kind = 'expense' then
    return app_private.finance_confirm_expense(v_req.id, v_date, v_ref, p_input->'attachments', nullif(btrim(p_input->>'note'), ''), v_actor);
  end if;
  if v_req.kind = 'advance' then
    return app_private.finance_confirm_advance(v_req.id, v_date, v_ref, p_input->'attachments', nullif(btrim(p_input->>'note'), ''), v_actor, v_last_approver);
  end if;

  -- Kiểm lại phần còn nợ tại lúc chi (có thể đã chi ngoài trong lúc chờ).
  select jsonb_agg(jsonb_build_object('documentId', payable_document_id, 'amount', amount)) into v_lines from public.finance_payment_request_lines where request_id = v_req.id;
  create temp table if not exists pg_temp.fin_pay_lines (doc_id uuid, amount numeric, project_id text, site_id text, document_no text, outstanding numeric,
    source_type text, source_id text, recognized numeric, paid numeric) on commit drop;
  truncate pg_temp.fin_pay_lines;
  insert into pg_temp.fin_pay_lines select * from app_private.finance_check_request_lines(v_req.supplier_id, v_lines, v_req.id);

  perform set_config('app.finance_context', 'on', true);
  for g in select project_id, site_id, sum(amount) total, sum(recognized) recognized from pg_temp.fin_pay_lines group by project_id, site_id loop
    v_bid := gen_random_uuid();
    insert into public.supplier_payment_batches (id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot, payment_date, payment_method,
      bank_account_snapshot, document_ref, total_recognized_snapshot, payment_amount, currency, allocation_mode, status, attachments, metadata, created_by, approved_by, approved_at, note)
    values (v_bid, 'PC-' || to_char(v_today, 'YYMMDD') || '-' || upper(substr(replace(v_bid::text, '-', ''), 1, 5)), g.project_id, g.site_id, v_req.supplier_id,
      v_req.supplier_name, v_date, v_req.method, v_req.bank_snapshot->>'account', v_ref, g.recognized, g.total, 'VND', 'manual', 'submitted', p_input->'attachments',
      jsonb_build_object('kind', 'payment_request', 'requestId', v_req.id, 'requestCode', v_req.code)
        || case when g.project_id is null and g.site_id is null then jsonb_build_object('scope', 'company') else '{}'::jsonb end,
      v_req.created_by, v_last_approver, now(), nullif(btrim(p_input->>'note'), ''));
    insert into public.supplier_payment_allocations (payment_batch_id, payable_document_id, source_type, source_id, document_no_snapshot,
      recognized_amount_snapshot, paid_before_snapshot, outstanding_before_snapshot, allocated_amount, allocation_mode, note)
    select v_bid, doc_id, source_type, source_id, document_no, recognized, paid, outstanding, amount, 'manual', v_req.code
    from pg_temp.fin_pay_lines l where l.project_id is not distinct from g.project_id and l.site_id is not distinct from g.site_id;
    perform app_private.post_supplier_payment_batch(v_bid, v_actor);
    v_batches := v_batches || jsonb_build_object('batchId', v_bid, 'projectId', g.project_id, 'amount', g.total);
  end loop;
  perform set_config('app.finance_context', 'off', true);

  update public.finance_payment_requests set status = 'paid', updated_at = now(), row_version = row_version + 1,
    paid = jsonb_build_object('paymentDate', v_date, 'documentRef', v_ref, 'attachments', p_input->'attachments', 'batches', v_batches,
      'by', v_actor, 'byName', app_private.finance_user_name(v_actor), 'at', now(), 'note', nullif(btrim(p_input->>'note'), ''))
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_req.id, v_req.submission_no, 'Xác nhận đã chi ' || v_ref, 'paid', v_actor, jsonb_build_object('batches', v_batches, 'paymentDate', v_date));
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'payment_request_paid', v_actor,
    jsonb_build_object('code', v_req.code, 'amount', v_req.amount, 'documentRef', v_ref, 'batches', v_batches));
  perform app_private.finance_notify(array[v_req.created_by], 'Đề nghị chi đã chi', v_req.code || ' · ' || v_ref, v_req.id, v_actor);
  return jsonb_build_object('requestId', v_req.id, 'status', 'paid', 'batches', v_batches);
exception when others then
  perform set_config('app.finance_context', 'off', true);
  raise;
end $function$;

create or replace function public.reverse_finance_payment_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), ''); b jsonb;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
  if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_req.status <> 'paid' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_req.kind = 'advance' then perform app_private.finance_assert_advance_reversible(v_req.id); end if;
  perform app_private.finance_cash_reverse_source('payment_request', v_req.id::text, v_reason, v_actor);
  update public.finance_project_capital set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = 'Đảo phiếu chi ' || v_req.code || ': ' || v_reason
  where source_type = 'payment_request' and source_id = v_req.id::text and status = 'posted';
  if v_req.kind = 'expense' then
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name, cost_classification_status)
    select 'finance-expense-reversal-' || v_req.id::text, t."projectFinanceId", t."constructionSiteId", t.project_id, t.project_finance_id, t.construction_site_id,
      'expense', t.category, -t.amount, 'Đảo ' || t.description || ' — ' || v_reason, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text, 'workflow',
      t.source_ref || ':reversal', t.source_ref || ':reversal', '[]'::jsonb, v_actor::text, now(), t.counterparty_name, 'manual'
    from public.project_transactions t where t.source_ref = 'finance_expense:' || v_req.id::text;
  end if;
  perform set_config('app.finance_context', 'on', true);
  for b in select value from jsonb_array_elements(v_req.paid->'batches') loop
    perform app_private.reverse_supplier_payment_batch((b->>'batchId')::uuid, v_actor);
    update public.supplier_payment_batches set metadata = metadata || jsonb_build_object('g7ReversalReason', v_reason) where id = (b->>'batchId')::uuid;
  end loop;
  perform set_config('app.finance_context', 'off', true);
  update public.finance_payment_requests set status = 'reversed', updated_at = now(), row_version = row_version + 1,
    paid = paid || jsonb_build_object('reversal', jsonb_build_object('reason', v_reason, 'by', v_actor, 'byName', app_private.finance_user_name(v_actor), 'at', now()))
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, reason)
  values (v_req.id, v_req.submission_no, 'Đảo phiếu chi', 'reverse', v_actor, v_reason);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'payment_request_reverse', v_actor, v_reason, jsonb_build_object('code', v_req.code, 'amount', v_req.amount));
  perform app_private.finance_notify(array[v_req.created_by], 'Phiếu chi đã bị đảo', v_req.code || ': ' || v_reason, v_req.id, v_actor);
  return jsonb_build_object('requestId', v_req.id, 'status', 'reversed');
exception when others then
  perform set_config('app.finance_context', 'off', true);
  raise;
end $function$;

create or replace function public.get_finance_settings_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_set public.finance_settings%rowtype; v_version public.finance_approval_matrix_versions%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  select * into v_version from public.finance_approval_matrix_versions where is_current;
  return jsonb_build_object('can', app_private.finance_can_flags(),
    'settings', jsonb_build_object('defaultPaymentDays', v_set.default_payment_days, 'cutoverDate', v_set.ap_cutover_date,
      'rowVersion', v_set.row_version, 'updatedAt', v_set.updated_at, 'updatedByName', app_private.finance_user_name(v_set.updated_by),
      'advanceWarnPercent', v_set.advance_warn_percent, 'advanceExtraPercent', v_set.advance_extra_percent,
      'advanceExtraApproverIds', to_jsonb(v_set.advance_extra_approver_ids), 'advanceGraceDays', v_set.advance_repay_grace_days, 'cashMinBalance', v_set.cash_min_balance,
      'budgetWarnPercent', v_set.budget_warn_percent, 'budgetApproverIds', to_jsonb(v_set.budget_extra_approver_ids), 'capitalProviderIds', to_jsonb(v_set.capital_provider_ids)),
    'matrix', jsonb_build_object('id', v_version.id, 'versionNo', v_version.version_no, 'note', v_version.note,
      'createdAt', v_version.created_at, 'createdByName', app_private.finance_user_name(v_version.created_by),
      'rules', coalesce((select jsonb_agg(jsonb_build_object('tierNo', r.tier_no, 'minAmount', r.min_amount, 'maxAmount', r.max_amount,
          'steps', (select jsonb_agg(jsonb_build_object('label', s.value->>'label',
              'approvers', (select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'active', coalesce(u.is_active, true)))
                from jsonb_array_elements_text(s.value->'approverIds') a join public.users u on u.id = a::uuid)) order by s.ordinality)
            from jsonb_array_elements(r.steps) with ordinality s)) order by r.tier_no)
        from public.finance_approval_rules r where r.version_id = v_version.id), '[]'::jsonb)),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('versionNo', v.version_no, 'note', v.note, 'createdAt', v.created_at,
        'createdByName', app_private.finance_user_name(v.created_by), 'current', v.is_current) order by v.version_no desc)
      from public.finance_approval_matrix_versions v), '[]'::jsonb),
    'delegations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'fromUserId', d.from_user_id, 'fromName', app_private.finance_user_name(d.from_user_id),
        'toUserId', d.to_user_id, 'toName', app_private.finance_user_name(d.to_user_id), 'validFrom', d.valid_from, 'validTo', d.valid_to,
        'reason', d.reason, 'createdByName', app_private.finance_user_name(d.created_by), 'revokedAt', d.revoked_at, 'revokeReason', d.revoke_reason)
        order by d.valid_from desc) from public.finance_approval_delegations d), '[]'::jsonb),
    'responsibilities', (select jsonb_object_agg(a.x, (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'admin', u.role = 'ADMIN') order by u.name), '[]'::jsonb)
        from public.users u where coalesce(u.is_active, true) and u.account_status = 'ACTIVE'
          and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.finance.' || a.x))))
      from unnest(array['view', 'record', 'confirm', 'manage']) a(x)),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where coalesce(u.is_active, true) and u.account_status = 'ACTIVE'), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.transition_procurement_hub_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_po public.purchase_orders%rowtype;
  v_name text;
  v_budget jsonb;
begin
  if not app_private.procurement_can('manage') and not public.is_admin() then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  if v_action = 'submit' then
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_SUBMIT_DENIED'; end if;
    if jsonb_array_length(coalesce(v_po.items, '[]'::jsonb)) = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    if exists (select 1 from jsonb_array_elements(v_po.items) x where coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) <= 0) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_MISSING'; end if;
    if v_po.target_warehouse_id is null and not app_private.procurement_po_is_group(v_po.metadata) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_REQUIRED'; end if;
    if v_to is null or v_to = v_actor or not app_private.procurement_po_approver_ok(v_to) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_APPROVER_INVALID'; end if;
    select name into v_name from public.users where id = v_to;
    update public.purchase_orders set status = 'sent', submitted_to_user_id = v_to::text, submitted_to_name = v_name,
      submitted_to_permission = 'system.procurement.manage', submission_note = v_reason, ever_submitted = true,
      last_action_by = v_actor::text, last_action_at = now(), metadata = metadata - 'returnReason' - 'budgetApproval'
    where id = v_po.id returning * into v_po;
    -- Tài chính: đơn làm vật tư của dự án vượt dự toán → báo người duyệt vượt ngân sách ngay khi gửi.
    v_budget := app_private.finance_po_budget_mark(v_po.id, v_actor);
    select * into v_po from public.purchase_orders where id = v_po.id;
    perform app_private.procurement_notify(v_to, 'Đơn hàng chờ bạn duyệt',
      v_po.po_number || ' · ' || coalesce(v_po.vendor_name, '') || ' — ' || to_char(v_po.total_amount, 'FM999G999G999G999') || ' đ', v_po.id, 'assigned');
  elsif v_action in ('approve', 'return') then
    if v_po.status <> 'sent' or v_po.created_by_id = v_actor::text
      or not (v_po.submitted_to_user_id = v_actor::text or public.is_admin()) then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_APPROVE_DENIED'; end if;
    if v_action = 'return' and v_reason is null then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_RETURN_REASON_REQUIRED'; end if;
    if v_action = 'approve' then
      v_budget := app_private.finance_po_budget_mark(v_po.id, v_actor);
      if coalesce((v_budget->>'over')::boolean, false) and v_budget->>'status' <> 'approved' then
        select * into v_po from public.purchase_orders where id = v_po.id;
        perform set_config('app.procurement_hub_context', 'off', true);
        perform set_config('app.material_transition_context', 'off', true);
        return jsonb_build_object('purchaseOrderId', v_po.id, 'status', v_po.status, 'rowVersion', v_po.row_version, 'budgetPending', true,
          'budgetApproverNames', v_po.metadata->'budgetApproval'->'approverNames', 'budget', v_budget->'budget', 'projected', v_budget->'projected');
      end if;
      select * into v_po from public.purchase_orders where id = v_po.id;
      update public.purchase_orders set status = 'confirmed', approved_total_amount = total_amount,
        last_action_by = v_actor::text, last_action_at = now()
      where id = v_po.id returning * into v_po;
      -- Same as the project flow: a single-delivery order gets its delivery note + WMS/QR so the
      -- warehouse receives it (both purchase and stock quantities) — actual qty may be short.
      if coalesce(v_po.purchase_mode, 'single') = 'single' and not app_private.procurement_po_is_group(v_po.metadata) then
        perform app_private.create_delivery_batch_with_wms_qr_core_v2(v_po.id, gen_random_uuid(), v_po.vendor_id, v_po.vendor_name,
          v_po.fulfillment_mode, coalesce(v_po.vat_rate, 0), v_po.target_warehouse_id,
          coalesce(app_private.procurement_date_or_null(v_po.expected_delivery_date), current_date),
          'Đợt giao tự động khi duyệt đơn tại Mua hàng', v_actor,
          (select jsonb_agg(jsonb_build_object('purchaseOrderLineId', coalesce(x.value->>'lineId', x.value->>'itemId'),
              'itemId', x.value->>'itemId', 'purchaseQty', (x.value->>'qty')::numeric, 'purchaseUnit', x.value->>'purchaseUnitSnapshot',
              'stockQty', (x.value->>'qty')::numeric * (x.value->>'purchaseConversionFactor')::numeric,
              'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unitSnapshot'),
              'purchaseUnitPrice', (x.value->>'unitPrice')::numeric,
              'stockUnitPrice', (x.value->>'unitPrice')::numeric / (x.value->>'purchaseConversionFactor')::numeric))
            from jsonb_array_elements(v_po.items) x));
        select * into v_po from public.purchase_orders where id = v_po.id;
      end if;
      perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Đơn hàng đã được duyệt',
        v_po.po_number || ' đã duyệt — gửi NCC và theo dõi giao hàng.', v_po.id, 'responsible');
    else
      update public.purchase_orders set status = 'returned', submitted_to_user_id = null, submitted_to_name = null,
        submitted_to_permission = null, last_action_by = v_actor::text, last_action_at = now(),
        metadata = metadata || jsonb_build_object('returnReason', v_reason)
      where id = v_po.id returning * into v_po;
      perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Đơn hàng bị trả lại',
        v_po.po_number || ': ' || v_reason, v_po.id, 'responsible');
    end if;
  elsif v_action = 'delete' then
    if v_po.status <> 'draft' or v_po.ever_submitted or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_DELETE_DENIED'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po.id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po.id;
    delete from public.purchase_orders where id = v_po.id;
  else
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID';
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, v_action, v_actor, v_reason,
    case when v_to is null then '{}'::jsonb else jsonb_build_object('approverUserId', v_to) end);
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'status', case when v_action = 'delete' then 'deleted' else v_po.status end,
    'rowVersion', v_po.row_version);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_procurement_order_v1(p_po_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_po public.purchase_orders%rowtype; v_actor uuid := public.current_app_user_id(); v_hub boolean; v_manage boolean;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id and archived_at is null;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  v_hub := app_private.procurement_po_is_hub(v_po.metadata);
  v_manage := app_private.procurement_can('manage');
  return jsonb_build_object(
    'id', v_po.id, 'poNumber', v_po.po_number, 'status', v_po.status, 'stage', app_private.procurement_po_stage(v_po.status),
    'isHub', v_hub, 'rowVersion', v_po.row_version, 'vendorId', v_po.vendor_id, 'vendorName', v_po.vendor_name,
    'projectId', v_po.project_id, 'constructionSiteId', v_po.construction_site_id,
    'projectCode', (select code from public.projects where id = v_po.project_id),
    'projectName', (select name from public.projects where id = v_po.project_id),
    'targetWarehouseId', v_po.target_warehouse_id, 'warehouseName', (select name from public.warehouses where id = v_po.target_warehouse_id),
    'orderDate', v_po.order_date, 'expectedDeliveryDate', app_private.procurement_date_or_null(v_po.expected_delivery_date),
    'totalAmount', v_po.total_amount, 'vatRate', v_po.vat_rate, 'note', v_po.note,
    'createdById', v_po.created_by_id, 'createdByName', (select name from public.users where id::text = v_po.created_by_id),
    'createdByTitle', (select e.title from public.employees e where e.user_id::text = v_po.created_by_id limit 1),
    'createdAt', v_po.created_at, 'submittedToUserId', v_po.submitted_to_user_id, 'submittedToName', v_po.submitted_to_name,
    'returnReason', v_po.metadata->>'returnReason', 'everSubmitted', v_po.ever_submitted,
    'purchaseMode', v_po.purchase_mode,
    'kind', case when v_po.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end, 'proactive', v_po.metadata->'proactive', 'approvedTotalAmount', v_po.approved_total_amount, 'shortClose', v_po.metadata->'shortClose', 'budgetApproval', v_po.metadata->'budgetApproval',
    'isGroup', app_private.procurement_po_is_group(v_po.metadata),
    'sites', case when app_private.procurement_po_is_group(v_po.metadata) then app_private.group_po_sites(v_po) else '[]'::jsonb end,
    'deliveries', app_private.procurement_po_deliveries(v_po.id),
    'returns', app_private.procurement_po_returns(v_po.id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
        'name', coalesce(x.value->>'name', x.value->>'itemNameSnapshot'), 'sku', x.value->>'sku', 'unit', x.value->>'unit',
        'qty', coalesce(nullif(x.value->>'qty', '')::numeric, 0), 'unitPrice', coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0),
        'receivedQty', coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), 'note', x.value->>'note', 'specification', x.value->>'specification',
        'returnedQty', coalesce(nullif(x.value->>'returnedQty', '')::numeric, 0),
        'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unit'),
        'remainingToDeliver', app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')),
        'factor', coalesce(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 1),
        'stockQty', app_private.procurement_po_line_stock_qty(x.value),
        'allocatedQty', app_private.procurement_po_line_link_total(v_po.id, coalesce(x.value->>'lineId', x.value->>'itemId')),
        'boq', x.value->'boq',
        'allocations', coalesce((select jsonb_agg(a) from (
            select jsonb_build_object('sourceType', 'material_request', 'sourceId', l.material_request_id,
              'code', coalesce(r.code, l.material_request_code), 'lineId', l.request_line_id, 'qty', l.ordered_qty, 'needQty', l.requested_qty,
              'projectCode', (select pr.code from public.projects pr where pr.id = l.project_id), 'warehouseId', l.target_warehouse_id,
              'warehouseName', (select w.name from public.warehouses w where w.id = l.target_warehouse_id), 'excessReason', l.excess_reason) a
            from public.purchase_order_request_lines l left join public.requests r on r.id = l.material_request_id
            where l.purchase_order_id = v_po.id and l.purchase_order_line_id = coalesce(x.value->>'lineId', x.value->>'itemId')
            union all
            select jsonb_build_object('sourceType', 'material_plan', 'sourceId', k.material_plan_id,
              'code', p.code, 'lineId', k.material_plan_line_id, 'qty', k.ordered_qty, 'needQty', pl.requested_qty)
            from public.procurement_po_plan_links k join public.project_material_plans p on p.id = k.material_plan_id
            join public.project_material_plan_lines pl on pl.id = k.material_plan_line_id
            where k.purchase_order_id = v_po.id and k.purchase_order_line_id = coalesce(x.value->>'lineId', x.value->>'itemId')) q), '[]'::jsonb))
        order by x.ordinality)
      from jsonb_array_elements(case when jsonb_typeof(v_po.items) = 'array' then v_po.items else '[]'::jsonb end) with ordinality x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', u.name, 'reason', e.reason, 'at', e.created_at, 'payload', e.payload)
        order by e.created_at) from public.procurement_hub_events e left join public.users u on u.id = e.actor_id
      where e.entity_type = 'purchase_order' and e.entity_id = v_po.id), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'canEdit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canSubmit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canApprove', v_hub and v_po.status = 'sent' and v_po.created_by_id is distinct from v_actor::text
        and (v_po.submitted_to_user_id = v_actor::text or public.is_admin()),
      'canDelete', v_hub and v_manage and v_po.status = 'draft' and not v_po.ever_submitted and v_po.created_by_id = v_actor::text,
      'canDecideReturn', v_hub and v_manage,
      'canLink', v_hub and v_manage and v_po.source_mode = 'proactive_project' and app_private.procurement_proactive_linkable(v_po.status),
      'canAddDelivery', v_hub and v_manage and v_po.status in ('confirmed', 'in_transit', 'partial')
        and exists (select 1 from jsonb_array_elements(v_po.items) x
          where app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')) > 0),
      'canCloseShort', v_hub and v_manage and v_po.status in ('confirmed', 'in_transit', 'partial')
        and not app_private.procurement_po_has_open_delivery(v_po.id)
        and exists (select 1 from jsonb_array_elements(v_po.items) x
          where coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) < coalesce(nullif(x.value->>'qty', '')::numeric, 0) - 0.0005)),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
        and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))), '[]'::jsonb)
  );
end;
$function$;


notify pgrst, 'reload schema';
