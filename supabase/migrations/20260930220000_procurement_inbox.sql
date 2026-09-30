-- Mua hàng trung tâm — M1 Tiếp nhận (chủ sản phẩm duyệt 30/09/2026).
--
-- One inbox for every approved purchase need, read straight from its source:
--   * material_request — project material requests (requests, origin project)
--     approved or in transit; progress from purchase_order_request_lines;
--   * material_plan    — approved Kế hoạch vật tư (project_material_plans).
-- New sources (module Đề xuất, Quy trình) add a branch to the same shape.
-- Access: company procurement staff (system.procurement.view / .manage).

create table public.procurement_inbox_assignments (
  source_type text not null check (source_type in ('material_request', 'material_plan')),
  source_id text not null,
  assignee_user_id uuid references public.users(id),
  assigned_by uuid references public.users(id),
  assigned_at timestamptz not null default now(),
  note text,
  primary key (source_type, source_id)
);
alter table public.procurement_inbox_assignments enable row level security;
create policy procurement_inbox_assignments_select on public.procurement_inbox_assignments for select to authenticated
  using (app_private.has_permission(public.current_app_user_id(), 'system.procurement.view'));
revoke all on public.procurement_inbox_assignments from anon;
revoke insert, update, delete on public.procurement_inbox_assignments from authenticated;
grant select on public.procurement_inbox_assignments to authenticated;

create function app_private.procurement_can(p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (
    app_private.has_permission(public.current_app_user_id(), 'system.procurement.' || p_action)
    or (p_action = 'view' and app_private.has_permission(public.current_app_user_id(), 'system.procurement.manage')));
$$;

-- One row per approved need line, all sources.
create function app_private.procurement_inbox_lines()
returns table (source_type text, source_id text, line_id text, item_id text, item_name text, sku text, unit text,
  need_qty numeric, ordered_qty numeric, received_qty numeric)
language sql stable security definer set search_path = '' as $$
  select 'material_request', r.id, x.value->>'lineId', x.value->>'itemId',
    coalesce(i.name, x.value->>'itemNameSnapshot', x.value->>'itemName', x.value->>'itemId'), i.sku,
    coalesce(nullif(x.value->>'unitSnapshot', ''), i.unit),
    -- Older approved requests carry approvedQty 0 (approved as requested).
    coalesce(nullif(nullif(x.value->>'approvedQty', '')::numeric, 0), nullif(x.value->>'requestQty', '')::numeric, 0),
    coalesce((select sum(l.ordered_qty) from public.purchase_order_request_lines l
      join public.purchase_orders o on o.id = l.purchase_order_id and o.status not in ('cancelled', 'returned')
      where l.material_request_id = r.id and l.request_line_id = x.value->>'lineId'), 0),
    coalesce((select sum(l.actual_received_qty_snapshot) from public.purchase_order_request_lines l
      join public.purchase_orders o on o.id = l.purchase_order_id and o.status not in ('cancelled', 'returned')
      where l.material_request_id = r.id and l.request_line_id = x.value->>'lineId'), 0)
  from public.requests r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end) x
  left join public.items i on i.id = x.value->>'itemId'
  where r.request_origin = 'project' and r.status in ('APPROVED', 'IN_TRANSIT')
  union all
  select 'material_plan', p.id::text, l.id::text, l.item_id, l.item_name_snapshot, l.sku_snapshot, l.unit,
    l.requested_qty, 0::numeric, 0::numeric
  from public.project_material_plans p join public.project_material_plan_lines l on l.plan_id = p.id and l.requested_qty > 0
  where p.status = 'approved';
$$;

-- One row per source document.
create function app_private.procurement_inbox_documents()
returns table (source_type text, source_id text, code text, title text, project_id text, construction_site_id text,
  warehouse_id text, needed_date date, requester_name text, approved_at timestamptz, approved_by_name text, created_at timestamptz,
  period_type text, period_start date)
language sql stable security definer set search_path = '' as $$
  select 'material_request', r.id, r.code, r.title, r.project_id, r.construction_site_id, r.site_warehouse_id,
    r.expected_date::date, (select u.name from public.users u where u.id = r.requester_id),
    null::timestamptz, null::text, coalesce(r.created_date, r.created_at), null::text, null::date
  from public.requests r
  where r.request_origin = 'project' and r.status in ('APPROVED', 'IN_TRANSIT')
  union all
  select 'material_plan', p.id::text, p.code,
    'Kế hoạch vật tư ' || case p.period_type when 'month' then 'tháng ' || to_char(p.period_start, 'MM/YYYY')
      else 'tuần ' || to_char(p.period_start, 'DD/MM') || '–' || to_char(p.period_end, 'DD/MM/YYYY') end,
    p.project_id, p.construction_site_id, p.destination_warehouse_id, coalesce(p.needed_date, p.period_start),
    (select u.name from public.users u where u.id = p.created_by), p.approved_at,
    (select u.name from public.users u where u.id = p.approved_by), p.created_at, p.period_type, p.period_start
  from public.project_material_plans p where p.status = 'approved';
$$;

create function public.list_procurement_inbox_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with lines as materialized (select * from app_private.procurement_inbox_lines()),
    agg as (
      select l.source_type, l.source_id, count(*) line_count,
        count(*) filter (where l.ordered_qty >= l.need_qty and l.need_qty > 0) ordered_lines,
        count(*) filter (where l.ordered_qty > 0 and l.ordered_qty < l.need_qty) partial_lines,
        count(*) filter (where l.received_qty >= l.need_qty and l.need_qty > 0) received_lines
      from lines l group by 1, 2
    ),
    docs as (
      select d.*, a.line_count, a.ordered_lines, a.partial_lines, a.received_lines,
        pr.code project_code, pr.name project_name, w.name warehouse_name,
        asg.assignee_user_id, (select u.name from public.users u where u.id = asg.assignee_user_id) assignee_name,
        case when a.received_lines = a.line_count then 'received'
          when a.ordered_lines = a.line_count then 'ordered'
          when a.ordered_lines + a.partial_lines > 0 then 'partial' else 'new' end progress
      from app_private.procurement_inbox_documents() d
      join agg a on a.source_type = d.source_type and a.source_id = d.source_id
      left join public.projects pr on pr.id = d.project_id
      left join public.warehouses w on w.id = d.warehouse_id
      left join public.procurement_inbox_assignments asg on asg.source_type = d.source_type and asg.source_id = d.source_id
    ),
    filtered as (
      select * from docs
      where (nullif(v_filter->>'source', '') is null or source_type = v_filter->>'source')
        and (nullif(v_filter->>'projectId', '') is null or project_id = v_filter->>'projectId')
        and (nullif(v_filter->>'assigneeId', '') is null
          or (v_filter->>'assigneeId' = 'none' and assignee_user_id is null)
          or assignee_user_id::text = v_filter->>'assigneeId')
        and (coalesce(v_filter->>'progress', 'open') = 'all'
          or (coalesce(v_filter->>'progress', 'open') = 'open' and progress in ('new', 'partial'))
          or progress = v_filter->>'progress')
        and (nullif(v_filter->>'search', '') is null or lower(concat_ws(' ', code, title, project_code, project_name))
          like '%' || lower(v_filter->>'search') || '%')
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
          'assigneeUserId', f.assignee_user_id, 'assigneeName', f.assignee_name)
        order by f.needed_date nulls last, f.created_at) from filtered f), '[]'::jsonb),
      'sourceCounts', coalesce((select jsonb_object_agg(s.source_type, s.n) from (
          select source_type, count(*) n from docs where progress in ('new', 'partial') group by 1) s), '{}'::jsonb),
      'stages', jsonb_build_object(
        'intake', (select count(*) from docs where progress in ('new', 'partial')),
        'intakeUrgent', (select count(*) from docs where progress in ('new', 'partial') and needed_date <= v_today + 3),
        'unassigned', (select count(*) from docs where progress in ('new', 'partial') and assignee_user_id is null),
        'drafting', (select count(*) from public.purchase_orders where status in ('draft', 'sent') and archived_at is null),
        'ordered', (select count(*) from public.purchase_orders where status = 'confirmed' and archived_at is null),
        'delivering', (select count(*) from public.purchase_orders where status in ('in_transit', 'partial') and archived_at is null),
        'orderedLate', (select count(*) from public.purchase_orders where status = 'confirmed'
          and archived_at is null and case when expected_delivery_date ~ '^\d{4}-\d{2}-\d{2}' then left(expected_delivery_date, 10)::date end < v_today),
        'deliveringLate', (select count(*) from public.purchase_orders where status in ('in_transit', 'partial')
          and archived_at is null and case when expected_delivery_date ~ '^\d{4}-\d{2}-\d{2}' then left(expected_delivery_date, 10)::date end < v_today),
        'receiving', (select count(*) from public.purchase_orders where status = 'delivered' and archived_at is null)),
      'projects', coalesce((select jsonb_agg(distinct jsonb_build_object('id', d.project_id, 'code', d.project_code, 'name', d.project_name))
        from docs d where d.project_id is not null), '[]'::jsonb),
      'assignees', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
        from public.users u where u.is_active and u.account_status = 'ACTIVE'
          and app_private.has_permission(u.id, 'system.procurement.manage') and u.role <> 'ADMIN'), '[]'::jsonb)
    ) from (select 1) one
  );
end;
$$;

create function public.get_procurement_inbox_document_v1(p_source_type text, p_source_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    'lines', coalesce((select jsonb_agg(jsonb_build_object('lineId', l.line_id, 'itemId', l.item_id, 'itemName', l.item_name,
        'sku', l.sku, 'unit', l.unit, 'needQty', l.need_qty, 'orderedQty', l.ordered_qty, 'receivedQty', l.received_qty,
        'remainingQty', greatest(l.need_qty - l.ordered_qty, 0),
        'stockQty', case when v_doc.warehouse_id is null then null else coalesce((select sum(b.on_hand_qty)
          from public.inventory_balances b where b.material_id = l.item_id and b.warehouse_id = v_doc.warehouse_id), 0) end,
        'orders', coalesce((select jsonb_agg(distinct jsonb_build_object('id', o.id, 'poNumber', o.po_number, 'status', o.status,
            'vendorName', o.vendor_name, 'expectedDeliveryDate', o.expected_delivery_date))
          from public.purchase_order_request_lines prl join public.purchase_orders o on o.id = prl.purchase_order_id
          where p_source_type = 'material_request' and prl.material_request_id = p_source_id and prl.request_line_id = l.line_id), '[]'::jsonb))
        order by l.item_name)
      from app_private.procurement_inbox_lines() l where l.source_type = p_source_type and l.source_id = p_source_id), '[]'::jsonb),
    'assignment', (select jsonb_build_object('assigneeUserId', a.assignee_user_id,
        'assigneeName', (select u.name from public.users u where u.id = a.assignee_user_id), 'assignedAt', a.assigned_at, 'note', a.note)
      from public.procurement_inbox_assignments a where a.source_type = p_source_type and a.source_id = p_source_id)
  );
end;
$$;

create function public.assign_procurement_inbox_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_to uuid := nullif(p_input->>'assigneeUserId', '')::uuid; v_n integer;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'sources') is distinct from 'array' or jsonb_array_length(p_input->'sources') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCES_REQUIRED'; end if;
  if v_to is not null and not app_private.has_permission(v_to, 'system.procurement.manage') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ASSIGNEE_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(p_input->'sources') s where not exists (
    select 1 from app_private.procurement_inbox_documents() d where d.source_type = s.value->>'sourceType' and d.source_id = s.value->>'sourceId')) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  insert into public.procurement_inbox_assignments (source_type, source_id, assignee_user_id, assigned_by, assigned_at, note)
  select s.value->>'sourceType', s.value->>'sourceId', v_to, v_actor, now(), nullif(btrim(p_input->>'note'), '')
  from jsonb_array_elements(p_input->'sources') s
  on conflict (source_type, source_id) do update set assignee_user_id = excluded.assignee_user_id,
    assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at, note = coalesce(excluded.note, procurement_inbox_assignments.note);
  get diagnostics v_n = row_count;
  if v_to is not null and v_to is distinct from v_actor then
    insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
      priority, push_enabled, metadata, delivery_reason)
    values (v_to::text, 'info', 'procurement', 'Bạn được giao xử lý nhu cầu mua',
      v_n || ' phiếu nhu cầu được giao cho bạn trong Mua hàng.', v_n || ' phiếu nhu cầu được giao cho bạn trong Mua hàng.',
      'info', '🛒', '/#/procurement', 'procurement_inbox_assigned', 'procurement_assign:' || gen_random_uuid(),
      'normal', true, jsonb_build_object('sources', p_input->'sources'), 'assigned');
  end if;
  return jsonb_build_object('assigned', v_n);
end;
$$;

revoke all on function app_private.procurement_can(text), app_private.procurement_inbox_lines(),
  app_private.procurement_inbox_documents() from public, anon, authenticated;
revoke all on function public.list_procurement_inbox_v1(jsonb), public.get_procurement_inbox_document_v1(text, text),
  public.assign_procurement_inbox_v1(jsonb) from public, anon;
grant execute on function public.list_procurement_inbox_v1(jsonb), public.get_procurement_inbox_document_v1(text, text),
  public.assign_procurement_inbox_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
