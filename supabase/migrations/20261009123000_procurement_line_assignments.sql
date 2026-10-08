-- Mua hàng — giao việc theo dòng (chủ SP duyệt 08/10/2026).
-- Công trường gom nhu cầu vào một phiếu; phòng Mua chia từng dòng cho người mua.
--   * Người xử lý của phiếu (procurement_inbox_assignments) = người điều phối: dòng chưa giao riêng thuộc người này.
--   * Mỗi dòng một người mua; người đó tự tách nhiều NCC / nhiều đợt bằng nhiều PO.
--   * Trưởng phòng giao dòng; ai có quyền Mua hàng — Quản trị cũng tự nhận được dòng chưa ai nhận riêng.
-- Chỉ phiếu có dòng vật tư (đề xuất công trường, KH vật tư). PO / nhập kho / công nợ không đổi.

create table public.procurement_inbox_line_assignments (
  source_type text not null check (source_type in ('material_request', 'material_plan')),
  source_id text not null,
  line_id text not null,
  assignee_user_id uuid not null references public.users(id),
  assigned_by uuid references public.users(id),
  assigned_at timestamptz not null default now(),
  primary key (source_type, source_id, line_id)
);
create index procurement_inbox_line_assignments_assignee on public.procurement_inbox_line_assignments (assignee_user_id);
alter table public.procurement_inbox_line_assignments enable row level security;
create policy procurement_inbox_line_assignments_select on public.procurement_inbox_line_assignments for select to authenticated
  using (app_private.has_permission(public.current_app_user_id(), 'system.procurement.view')
    or app_private.has_permission(public.current_app_user_id(), 'system.procurement.manage'));
revoke all on public.procurement_inbox_line_assignments from anon;
revoke insert, update, delete on public.procurement_inbox_line_assignments from authenticated;
grant select on public.procurement_inbox_line_assignments to authenticated;

-- Giao / nhận / trả về điều phối một hoặc nhiều dòng của một phiếu.
-- p_input: { sourceType, sourceId, lineIds: text[], assigneeUserId: uuid | null, claim: bool }
--   claim = true  → giao cho chính mình; dòng đã có người khác nhận riêng thì từ chối (PROCUREMENT_LINE_TAKEN).
--   assigneeUserId null (không claim) → bỏ giao riêng, dòng về người điều phối.
create function app_private.procurement_assign_lines(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_type text := p_input->>'sourceType';
  v_id text := nullif(p_input->>'sourceId', '');
  v_claim boolean := coalesce((p_input->>'claim')::boolean, false);
  v_to uuid := case when coalesce((p_input->>'claim')::boolean, false) then public.current_app_user_id() else nullif(p_input->>'assigneeUserId', '')::uuid end;
  v_lines text[];
  v_code text;
  v_n integer;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_type is null or v_type not in ('material_request', 'material_plan') or v_id is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  if jsonb_typeof(p_input->'lineIds') is distinct from 'array' or jsonb_array_length(p_input->'lineIds') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_LINES_REQUIRED'; end if;
  select array_agg(distinct value) into v_lines from jsonb_array_elements_text(p_input->'lineIds') where nullif(value, '') is not null;
  if v_lines is null then raise exception using errcode = '22023', message = 'PROCUREMENT_LINES_REQUIRED'; end if;

  select d.code into v_code from app_private.procurement_inbox_documents() d where d.source_type = v_type and d.source_id = v_id;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  if exists (select 1 from public.procurement_need_closures c where c.source_type = v_type and c.source_id = v_id) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_NEED_CLOSED'; end if;
  if exists (select 1 from unnest(v_lines) x(line_id) where not exists (
      select 1 from app_private.material_request_supply_lines_v1(array[v_id]) s where v_type = 'material_request' and s.line_id = x.line_id
      union all
      select 1 from public.project_material_plan_lines l where v_type = 'material_plan' and l.plan_id::text = v_id and l.id::text = x.line_id and l.requested_qty > 0)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_LINE_NOT_FOUND'; end if;
  if v_to is not null and not exists (select 1 from public.users u where u.id = v_to and u.is_active and u.account_status = 'ACTIVE'
      and app_private.has_permission(u.id, 'system.procurement.manage')) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ASSIGNEE_INVALID'; end if;

  if v_to is null then
    delete from public.procurement_inbox_line_assignments a
    where a.source_type = v_type and a.source_id = v_id and a.line_id = any (v_lines);
  elsif v_claim then
    insert into public.procurement_inbox_line_assignments (source_type, source_id, line_id, assignee_user_id, assigned_by)
    select v_type, v_id, x, v_to, v_actor from unnest(v_lines) x
    on conflict (source_type, source_id, line_id) do nothing;
    if exists (select 1 from public.procurement_inbox_line_assignments a
        where a.source_type = v_type and a.source_id = v_id and a.line_id = any (v_lines) and a.assignee_user_id <> v_to) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_LINE_TAKEN'; end if;
  else
    insert into public.procurement_inbox_line_assignments (source_type, source_id, line_id, assignee_user_id, assigned_by)
    select v_type, v_id, x, v_to, v_actor from unnest(v_lines) x
    on conflict (source_type, source_id, line_id) do update set assignee_user_id = excluded.assignee_user_id,
      assigned_by = excluded.assigned_by, assigned_at = now();
  end if;
  v_n := cardinality(v_lines);

  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('need', v_type || ':' || v_id, case when v_claim then 'claim_lines' when v_to is null then 'unassign_lines' else 'assign_lines' end,
    v_actor, jsonb_build_object('lineIds', to_jsonb(v_lines), 'assigneeId', v_to));

  if v_to is not null and v_to is distinct from v_actor then
    insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
      priority, push_enabled, metadata, delivery_reason)
    values (v_to::text, 'info', 'procurement', 'Bạn được giao mua ' || v_n || ' dòng vật tư',
      v_code || ': ' || v_n || ' dòng vật tư được giao cho bạn trong Mua hàng.', v_code || ': ' || v_n || ' dòng vật tư được giao cho bạn trong Mua hàng.',
      'info', '🛒', '/#/procurement', 'procurement_inbox_assigned', 'procurement_assign_lines:' || gen_random_uuid(),
      'normal', true, jsonb_build_object('sourceType', v_type, 'sourceId', v_id, 'lineIds', to_jsonb(v_lines)), 'assigned');
  end if;
  return jsonb_build_object('assigned', v_n, 'assigneeUserId', v_to);
end $$;

create function public.assign_procurement_inbox_lines_v1(p_input jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select app_private.procurement_assign_lines(p_input); $$;
revoke all on function app_private.procurement_assign_lines(jsonb), public.assign_procurement_inbox_lines_v1(jsonb) from public, anon;
grant execute on function app_private.procurement_assign_lines(jsonb), public.assign_procurement_inbox_lines_v1(jsonb) to authenticated;

-- Chi tiết phiếu: mỗi dòng kèm người được giao riêng (null = theo người điều phối).
CREATE OR REPLACE FUNCTION app_private.procurement_legacy_get_v1(p_source_type text, p_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_doc record;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select d.*, pr.code project_code, pr.name project_name, w.name warehouse_name into v_doc
  from app_private.procurement_inbox_documents() d
  left join public.projects pr on pr.id = d.project_id
  left join public.warehouses w on w.id = d.warehouse_id
  where d.source_type = p_source_type and d.source_id = p_source_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'sourceType', v_doc.source_type, 'sourceId', v_doc.source_id, 'code', v_doc.code, 'title', v_doc.title,
    'projectId', v_doc.project_id, 'projectCode', v_doc.project_code, 'projectName', v_doc.project_name,
    'warehouseId', v_doc.warehouse_id, 'warehouseName', v_doc.warehouse_name, 'neededDate', v_doc.needed_date,
    'requesterName', v_doc.requester_name, 'approvedAt', v_doc.approved_at, 'approvedByName', v_doc.approved_by_name,
    'constructionSiteId', v_doc.construction_site_id, 'periodType', v_doc.period_type, 'periodStart', v_doc.period_start,
    'closure', case when v_doc.closed_at is null then null else jsonb_build_object(
      'closedAt', v_doc.closed_at, 'reason', v_doc.close_reason, 'closedByName', v_doc.closed_by_name) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('lineId', l.line_id, 'itemId', l.item_id, 'itemName', l.item_name,
        'sku', l.sku, 'unit', l.unit, 'needQty', l.need_qty, 'orderedQty', l.ordered_qty, 'receivedQty', round(l.received_qty, 3),
        'purchaseUnit', (select i.purchase_unit from public.items i where i.id = l.item_id and nullif(btrim(i.purchase_unit), '') is not null
          and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, ''))) and coalesce(i.purchase_conversion_factor, 0) > 0),
        'purchaseFactor', (select nullif(i.purchase_conversion_factor, 0) from public.items i where i.id = l.item_id),
        'remainingQty', greatest(l.need_qty - l.ordered_qty, 0),
        -- Giao việc theo dòng: null = theo người điều phối (người xử lý của phiếu).
        'assigneeUserId', la.assignee_user_id, 'assigneeName', (select u.name from public.users u where u.id = la.assignee_user_id),
        'stockQty', case when v_doc.warehouse_id is null then null else coalesce((select sum(b.on_hand_qty)
          from public.inventory_balances b where b.material_id = l.item_id and b.warehouse_id = v_doc.warehouse_id), 0) end,
        -- Việc 1 — Cấp từ kho: tồn khả dụng ở kho khác (trừ phiếu chuyển chờ xuất) và phiếu chuyển đã lập cho dòng.
        'otherStock', case when p_source_type = 'material_request' then coalesce((select jsonb_agg(jsonb_build_object('warehouseId', w.id,
            'warehouseName', w.name, 'warehouseType', w.type, 'qty', round(q.qty, 3),
            'transferReady', app_private.material_request_transfer_ready(w.id) and app_private.material_request_transfer_ready(v_doc.warehouse_id)) order by q.qty desc)
          from (select b.warehouse_id, sum(b.on_hand_qty) - coalesce((select sum((y.value->>'quantity')::numeric)
                from public.transactions t cross join lateral jsonb_array_elements(t.items) y
                where t.type = 'TRANSFER'::public.transaction_type and t.status = 'PENDING'::public.transaction_status
                  and t.source_warehouse_id = b.warehouse_id and y.value->>'itemId' = l.item_id), 0) qty
            from public.inventory_balances b where b.material_id = l.item_id and b.warehouse_id is distinct from v_doc.warehouse_id
            group by b.warehouse_id) q
          join public.warehouses w on w.id = q.warehouse_id and not coalesce(w.is_archived, false)
          where q.qty > 0.0005), '[]'::jsonb) end,
        'transfers', case when p_source_type = 'material_request' then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status,
            'qty', (y.value->>'quantity')::numeric, 'sourceWarehouseName', (select w.name from public.warehouses w where w.id = t.source_warehouse_id)) order by t.date)
          from public.transactions t cross join lateral jsonb_array_elements(t.items) y
          where t.source_type = 'material_request_supply' and t.source_id = p_source_id and y.value->>'requestLineId' = l.line_id), '[]'::jsonb) end,
        'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'poNumber', o.po_number, 'status', o.status,
            'vendorName', o.vendor_name, 'expectedDeliveryDate', o.expected_delivery_date, 'orderedQty', k.qty) order by o.po_number)
          from (select prl.purchase_order_id, sum(prl.ordered_qty) qty from public.purchase_order_request_lines prl
                where p_source_type = 'material_request' and prl.material_request_id = p_source_id and prl.request_line_id = l.line_id group by 1
                union all
                select pl.purchase_order_id, sum(pl.ordered_qty) from public.procurement_po_plan_links pl
                where p_source_type = 'material_plan' and pl.material_plan_line_id::text = l.line_id group by 1) k
          join public.purchase_orders o on o.id = k.purchase_order_id and o.archived_at is null), '[]'::jsonb))
        order by l.item_name)
      from app_private.procurement_inbox_lines() l
      left join public.procurement_inbox_line_assignments la on la.source_type = l.source_type and la.source_id = l.source_id and la.line_id = l.line_id
      where l.source_type = p_source_type and l.source_id = p_source_id), '[]'::jsonb),
    'assignment', (select jsonb_build_object('assigneeUserId', a.assignee_user_id,
        'assigneeName', (select u.name from public.users u where u.id = a.assignee_user_id), 'assignedAt', a.assigned_at, 'note', a.note)
      from public.procurement_inbox_assignments a where a.source_type = p_source_type and a.source_id = p_source_id)
  );
end;
$function$;

-- Danh sách: người mua theo dòng (lineAssignees), số dòng còn thiếu chưa có người mua, lọc "Việc của tôi" theo dòng.
CREATE OR REPLACE FUNCTION app_private.procurement_legacy_list_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with lines as materialized (
      -- Người mua thực tế của dòng = người được giao dòng, chưa giao riêng thì theo người điều phối của phiếu.
      select l.*, coalesce(la.assignee_user_id, asg.assignee_user_id) eff_assignee, la.assignee_user_id is not null line_assigned,
        l.ordered_qty < l.need_qty open_line
      from app_private.procurement_inbox_lines() l
      left join public.procurement_inbox_line_assignments la on la.source_type = l.source_type and la.source_id = l.source_id and la.line_id = l.line_id
      left join public.procurement_inbox_assignments asg on asg.source_type = l.source_type and asg.source_id = l.source_id),
    people as (
      select l.source_type, l.source_id, l.eff_assignee, count(*) n, count(*) filter (where l.open_line) open_n
      from lines l group by 1, 2, 3
    ),
    people_json as (
      select p.source_type, p.source_id,
        jsonb_agg(jsonb_build_object('userId', p.eff_assignee, 'name', (select u.name from public.users u where u.id = p.eff_assignee),
          'lines', p.n, 'openLines', p.open_n) order by p.eff_assignee is null, p.open_n desc, p.n desc) filter (where p.eff_assignee is not null) assignees,
        coalesce(sum(p.open_n) filter (where p.eff_assignee is null), 0) unassigned_open
      from people p group by 1, 2
    ),
    agg as (
      select l.source_type, l.source_id, count(*) line_count,
        count(*) filter (where l.ordered_qty >= l.need_qty and l.need_qty > 0) ordered_lines,
        count(*) filter (where l.ordered_qty > 0 and l.ordered_qty < l.need_qty) partial_lines,
        count(*) filter (where l.received_qty >= l.need_qty and l.need_qty > 0) received_lines,
        bool_or(l.line_assigned) split
      from lines l group by 1, 2
    ),
    docs as (
      select d.*, a.line_count, a.ordered_lines, a.partial_lines, a.received_lines, a.split,
        coalesce(pj.assignees, '[]'::jsonb) line_assignees, coalesce(pj.unassigned_open, 0) unassigned_open,
        pr.code project_code, pr.name project_name, w.name warehouse_name,
        asg.assignee_user_id, (select u.name from public.users u where u.id = asg.assignee_user_id) assignee_name,
        case when d.closed_at is not null then 'closed'
          when a.received_lines = a.line_count then 'received'
          when a.ordered_lines = a.line_count then 'ordered'
          when a.ordered_lines + a.partial_lines > 0 then 'partial' else 'new' end progress
      from app_private.procurement_inbox_documents() d
      join agg a on a.source_type = d.source_type and a.source_id = d.source_id
      left join public.projects pr on pr.id = d.project_id
      left join public.warehouses w on w.id = d.warehouse_id
      left join public.procurement_inbox_assignments asg on asg.source_type = d.source_type and asg.source_id = d.source_id
      left join people_json pj on pj.source_type = d.source_type and pj.source_id = d.source_id
    ),
    filtered as (
      select * from docs
      where (nullif(v_filter->>'source', '') is null or source_type = v_filter->>'source')
        and (nullif(v_filter->>'projectId', '') is null or project_id = v_filter->>'projectId')
        -- Lọc theo người mua của từng dòng: phiếu mở chỉ tính dòng còn thiếu.
        and (nullif(v_filter->>'assigneeId', '') is null
          or exists (select 1 from people p where p.source_type = docs.source_type and p.source_id = docs.source_id
            and (case when v_filter->>'assigneeId' = 'none' then p.eff_assignee is null else p.eff_assignee::text = v_filter->>'assigneeId' end)
            and (p.open_n > 0 or docs.progress not in ('new', 'partial'))))
        and (coalesce(v_filter->>'progress', 'open') = 'all'
          or (coalesce(v_filter->>'progress', 'open') = 'open' and progress in ('new', 'partial'))
          or progress = v_filter->>'progress')
        and (nullif(v_filter->>'search', '') is null or lower(concat_ws(' ', code, title, project_code, project_name))
          like '%' || lower(v_filter->>'search') || '%')
    ),
    pos as (
      select app_private.procurement_po_stage(o.status) stage,
        app_private.procurement_date_or_null(o.expected_delivery_date) < v_today late
      from public.purchase_orders o where o.archived_at is null
    )
    select jsonb_build_object(
      'today', v_today,
      'canManage', app_private.procurement_can('manage'),
      'documents', coalesce((select jsonb_agg(jsonb_build_object(
          'sourceType', f.source_type, 'sourceId', f.source_id, 'code', f.code, 'title', f.title,
          'projectId', f.project_id, 'projectCode', f.project_code, 'projectName', f.project_name,
          'constructionSiteId', f.construction_site_id, 'warehouseId', f.warehouse_id, 'warehouseName', f.warehouse_name,
          'neededDate', f.needed_date, 'requesterName', f.requester_name, 'approvedAt', f.approved_at,
          'approvedByName', f.approved_by_name, 'createdAt', f.created_at, 'periodType', f.period_type, 'periodStart', f.period_start,
          'lineCount', f.line_count, 'orderedLines', f.ordered_lines, 'partialLines', f.partial_lines,
          'receivedLines', f.received_lines, 'progress', f.progress,
          'assigneeUserId', f.assignee_user_id, 'assigneeName', f.assignee_name,
          'lineAssignees', f.line_assignees, 'unassignedOpenLines', f.unassigned_open, 'splitByLine', f.split,
          'closedAt', f.closed_at, 'closeReason', f.close_reason, 'closedByName', f.closed_by_name)
        order by f.needed_date nulls last, f.created_at) from filtered f), '[]'::jsonb),
      'sourceCounts', coalesce((select jsonb_object_agg(s.source_type, s.n) from (
          select source_type, count(*) n from docs where progress in ('new', 'partial') group by 1) s), '{}'::jsonb),
      'stages', jsonb_build_object(
        'intake', (select count(*) from docs where progress in ('new', 'partial')),
        'intakeUrgent', (select count(*) from docs where progress in ('new', 'partial') and needed_date <= v_today + 3),
        'unassigned', (select count(*) from docs where progress in ('new', 'partial') and unassigned_open > 0),
        'drafting', (select count(*) from pos where stage = 'drafting'),
        'ordered', (select count(*) from pos where stage = 'ordered'),
        'orderedLate', (select count(*) from pos where stage = 'ordered' and late),
        'delivering', (select count(*) from pos where stage = 'delivering'),
        'deliveringLate', (select count(*) from pos where stage = 'delivering' and late),
        'receiving', (select count(*) from pos where stage = 'received'),
        'awaitingMe', (select count(*) from public.purchase_orders o where o.archived_at is null
          and app_private.procurement_po_awaits_me(o.id, o.status, o.submitted_to_user_id, public.current_app_user_id()::text))),
      'projects', coalesce((select jsonb_agg(distinct jsonb_build_object('id', d.project_id, 'code', d.project_code, 'name', d.project_name))
        from docs d where d.project_id is not null), '[]'::jsonb),
      'assignees', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
        from public.users u where u.is_active and u.account_status = 'ACTIVE'
          and app_private.has_permission(u.id, 'system.procurement.manage') and u.role <> 'ADMIN'), '[]'::jsonb)
    ) from (select 1) one
  );
end;
$function$;
