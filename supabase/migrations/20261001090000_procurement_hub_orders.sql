-- Mua hàng M2a — Đơn hàng tại Mua hàng (chủ sản phẩm duyệt 01/10/2026).
--
-- * Đơn hàng (PO) lập từ một hoặc nhiều phiếu nhu cầu cùng dự án/công trường,
--   gộp theo vật tư. PO là PO thường (from_request, single) đánh dấu
--   metadata.channel = 'procurement_hub' để công trường lập đợt giao/nhận hàng
--   bằng luồng sẵn có của tab dự án.
-- * PO phải được duyệt bởi người có quyền Mua hàng — Quản trị hoặc Admin,
--   không phải người lập. Tab dự án không sửa/gửi/duyệt/xóa PO này.
-- * Đơn hàng (từ phiếu đề xuất hoặc mua chủ động) không còn lập ở tab dự án (trừ Admin).
-- * Đóng nhu cầu không cần mua (kèm lý do), mở lại được.
-- * SL đã nhận theo dòng nhu cầu = SL đặt × tỷ lệ đã nhận của dòng PO
--   (purchase_order_request_lines.actual_received_qty_snapshot không được cập nhật).

create function app_private.procurement_hub_context_enabled()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.procurement_hub_context', true), '') = 'on';
$$;

create function app_private.procurement_po_line_received_ratio(p_items jsonb, p_line_id text)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce((
    select least(greatest(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0)
      / nullif(nullif(x.value->>'qty', '')::numeric, 0), 0), 1)
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
    where coalesce(x.value->>'lineId', x.value->>'itemId') = p_line_id
    limit 1), 0);
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.procurement_po_plan_links (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  purchase_order_line_id text not null,
  material_plan_id uuid not null references public.project_material_plans(id),
  material_plan_line_id uuid not null references public.project_material_plan_lines(id),
  item_id text not null,
  ordered_qty numeric not null check (ordered_qty > 0),
  created_at timestamptz not null default now(),
  unique (purchase_order_id, material_plan_line_id)
);
create index procurement_po_plan_links_line_idx on public.procurement_po_plan_links (material_plan_line_id);

create table public.procurement_need_closures (
  source_type text not null check (source_type in ('material_request', 'material_plan')),
  source_id text not null,
  reason text not null check (length(btrim(reason)) > 0),
  closed_by uuid references public.users(id),
  closed_at timestamptz not null default now(),
  primary key (source_type, source_id)
);

create table public.procurement_hub_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('purchase_order', 'need')),
  entity_id text not null,
  action text not null,
  actor_id uuid references public.users(id),
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index procurement_hub_events_entity_idx on public.procurement_hub_events (entity_type, entity_id, created_at);

do $$ declare t text; begin
  foreach t in array array['procurement_po_plan_links', 'procurement_need_closures', 'procurement_hub_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using ('
      'app_private.has_permission(public.current_app_user_id(), ''system.procurement.view'') '
      'or app_private.has_permission(public.current_app_user_id(), ''system.procurement.manage''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Inbox: ordered/received for plan lines, received by PO line ratio, closures
-- ---------------------------------------------------------------------------
create or replace function app_private.procurement_inbox_lines()
returns table (source_type text, source_id text, line_id text, item_id text, item_name text, sku text, unit text,
  need_qty numeric, ordered_qty numeric, received_qty numeric)
language sql stable security definer set search_path = '' as $$
  select 'material_request', r.id, x.value->>'lineId', x.value->>'itemId',
    coalesce(i.name, x.value->>'itemNameSnapshot', x.value->>'itemName', x.value->>'itemId'), i.sku,
    coalesce(nullif(x.value->>'unitSnapshot', ''), i.unit),
    -- Older approved requests carry approvedQty 0 (approved as requested).
    coalesce(nullif(nullif(x.value->>'approvedQty', '')::numeric, 0), nullif(x.value->>'requestQty', '')::numeric, 0),
    coalesce(po.ordered_qty, 0), coalesce(po.received_qty, 0)
  from public.requests r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end) x
  left join public.items i on i.id = x.value->>'itemId'
  left join lateral (
    select sum(l.ordered_qty) ordered_qty,
      sum(l.ordered_qty * app_private.procurement_po_line_received_ratio(o.items, l.purchase_order_line_id)) received_qty
    from public.purchase_order_request_lines l
    join public.purchase_orders o on o.id = l.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
    where l.material_request_id = r.id and l.request_line_id = x.value->>'lineId'
  ) po on true
  where r.request_origin = 'project' and r.status in ('APPROVED', 'IN_TRANSIT')
  union all
  select 'material_plan', p.id::text, l.id::text, l.item_id, l.item_name_snapshot, l.sku_snapshot, l.unit,
    l.requested_qty, coalesce(po.ordered_qty, 0), coalesce(po.received_qty, 0)
  from public.project_material_plans p
  join public.project_material_plan_lines l on l.plan_id = p.id and l.requested_qty > 0
  left join lateral (
    select sum(k.ordered_qty) ordered_qty,
      sum(k.ordered_qty * app_private.procurement_po_line_received_ratio(o.items, k.purchase_order_line_id)) received_qty
    from public.procurement_po_plan_links k
    join public.purchase_orders o on o.id = k.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
    where k.material_plan_line_id = l.id
  ) po on true
  where p.status = 'approved';
$$;

drop function public.list_procurement_inbox_v1(jsonb);
drop function public.get_procurement_inbox_document_v1(text, text);
drop function public.assign_procurement_inbox_v1(jsonb);
drop function app_private.procurement_inbox_documents();

create function app_private.procurement_inbox_documents()
returns table (source_type text, source_id text, code text, title text, project_id text, construction_site_id text,
  warehouse_id text, needed_date date, requester_name text, approved_at timestamptz, approved_by_name text, created_at timestamptz,
  period_type text, period_start date, closed_at timestamptz, close_reason text, closed_by_name text)
language sql stable security definer set search_path = '' as $$
  select d.*, c.closed_at, c.reason, (select u.name from public.users u where u.id = c.closed_by)
  from (
    select 'material_request' source_type, r.id source_id, r.code, r.title, r.project_id, r.construction_site_id,
      r.site_warehouse_id warehouse_id, r.expected_date::date needed_date, (select u.name from public.users u where u.id = r.requester_id) requester_name,
      null::timestamptz approved_at, null::text approved_by_name, coalesce(r.created_date, r.created_at) created_at, null::text period_type, null::date period_start
    from public.requests r
    where r.request_origin = 'project' and r.status in ('APPROVED', 'IN_TRANSIT')
    union all
    select 'material_plan', p.id::text, p.code,
      'Kế hoạch vật tư ' || case p.period_type when 'month' then 'tháng ' || to_char(p.period_start, 'MM/YYYY')
        else 'tuần ' || to_char(p.period_start, 'DD/MM') || '–' || to_char(p.period_end, 'DD/MM/YYYY') end,
      p.project_id, p.construction_site_id, p.destination_warehouse_id, coalesce(p.needed_date, p.period_start),
      (select u.name from public.users u where u.id = p.created_by), p.approved_at,
      (select u.name from public.users u where u.id = p.approved_by), p.created_at, p.period_type, p.period_start
    from public.project_material_plans p where p.status = 'approved'
  ) d
  left join public.procurement_need_closures c on c.source_type = d.source_type and c.source_id = d.source_id;
$$;

-- Company POs are listed read-only; hub POs carry their own approval flow.
create function app_private.procurement_po_is_hub(p_metadata jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_metadata->>'channel', '') = 'procurement_hub';
$$;

create function app_private.procurement_po_stage(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case when p_status in ('draft', 'sent', 'returned') then 'drafting'
    when p_status = 'confirmed' then 'ordered'
    when p_status in ('in_transit', 'partial') then 'delivering'
    when p_status in ('delivered', 'closed') then 'received' else 'other' end;
$$;

create function app_private.procurement_date_or_null(p_text text)
returns date language sql immutable set search_path = '' as $$
  select case when p_text ~ '^\d{4}-\d{2}-\d{2}' then left(p_text, 10)::date end;
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
        case when d.closed_at is not null then 'closed'
          when a.received_lines = a.line_count then 'received'
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
          'closedAt', f.closed_at, 'closeReason', f.close_reason, 'closedByName', f.closed_by_name)
        order by f.needed_date nulls last, f.created_at) from filtered f), '[]'::jsonb),
      'sourceCounts', coalesce((select jsonb_object_agg(s.source_type, s.n) from (
          select source_type, count(*) n from docs where progress in ('new', 'partial') group by 1) s), '{}'::jsonb),
      'stages', jsonb_build_object(
        'intake', (select count(*) from docs where progress in ('new', 'partial')),
        'intakeUrgent', (select count(*) from docs where progress in ('new', 'partial') and needed_date <= v_today + 3),
        'unassigned', (select count(*) from docs where progress in ('new', 'partial') and assignee_user_id is null),
        'drafting', (select count(*) from pos where stage = 'drafting'),
        'ordered', (select count(*) from pos where stage = 'ordered'),
        'orderedLate', (select count(*) from pos where stage = 'ordered' and late),
        'delivering', (select count(*) from pos where stage = 'delivering'),
        'deliveringLate', (select count(*) from pos where stage = 'delivering' and late),
        'receiving', (select count(*) from pos where stage = 'received'),
        'awaitingMe', (select count(*) from public.purchase_orders o where o.archived_at is null and o.status = 'sent'
          and o.submitted_to_user_id = public.current_app_user_id()::text)),
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
    'closure', case when v_doc.closed_at is null then null else jsonb_build_object(
      'closedAt', v_doc.closed_at, 'reason', v_doc.close_reason, 'closedByName', v_doc.closed_by_name) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('lineId', l.line_id, 'itemId', l.item_id, 'itemName', l.item_name,
        'sku', l.sku, 'unit', l.unit, 'needQty', l.need_qty, 'orderedQty', l.ordered_qty, 'receivedQty', round(l.received_qty, 3),
        'purchaseUnit', (select i.purchase_unit from public.items i where i.id = l.item_id and nullif(btrim(i.purchase_unit), '') is not null
          and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, ''))) and coalesce(i.purchase_conversion_factor, 0) > 0),
        'purchaseFactor', (select nullif(i.purchase_conversion_factor, 0) from public.items i where i.id = l.item_id),
        'remainingQty', greatest(l.need_qty - l.ordered_qty, 0),
        'stockQty', case when v_doc.warehouse_id is null then null else coalesce((select sum(b.on_hand_qty)
          from public.inventory_balances b where b.material_id = l.item_id and b.warehouse_id = v_doc.warehouse_id), 0) end,
        'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'poNumber', o.po_number, 'status', o.status,
            'vendorName', o.vendor_name, 'expectedDeliveryDate', o.expected_delivery_date, 'orderedQty', k.qty) order by o.po_number)
          from (select prl.purchase_order_id, sum(prl.ordered_qty) qty from public.purchase_order_request_lines prl
                where p_source_type = 'material_request' and prl.material_request_id = p_source_id and prl.request_line_id = l.line_id group by 1
                union all
                select pl.purchase_order_id, sum(pl.ordered_qty) from public.procurement_po_plan_links pl
                where p_source_type = 'material_plan' and pl.material_plan_line_id::text = l.line_id group by 1) k
          join public.purchase_orders o on o.id = k.purchase_order_id and o.archived_at is null), '[]'::jsonb))
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

-- ---------------------------------------------------------------------------
-- Đóng / mở lại nhu cầu
-- ---------------------------------------------------------------------------
create function public.close_procurement_need_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := coalesce(p_input->>'action', 'close');
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_n integer := 0; s jsonb;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'sources') is distinct from 'array' or jsonb_array_length(p_input->'sources') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCES_REQUIRED'; end if;
  if v_action not in ('close', 'reopen') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID'; end if;
  if v_action = 'close' and v_reason is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CLOSE_REASON_REQUIRED'; end if;
  for s in select value from jsonb_array_elements(p_input->'sources') loop
    if not exists (select 1 from app_private.procurement_inbox_documents() d
        where d.source_type = s->>'sourceType' and d.source_id = s->>'sourceId') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
    if v_action = 'close' then
      insert into public.procurement_need_closures (source_type, source_id, reason, closed_by)
      values (s->>'sourceType', s->>'sourceId', v_reason, v_actor)
      on conflict (source_type, source_id) do nothing;
    else
      delete from public.procurement_need_closures where source_type = s->>'sourceType' and source_id = s->>'sourceId';
    end if;
    if found then
      v_n := v_n + 1;
      insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
      values ('need', (s->>'sourceType') || ':' || (s->>'sourceId'), v_action, v_actor, v_reason, s);
    end if;
  end loop;
  return jsonb_build_object('changed', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Đơn hàng: lập / sửa nháp
-- ---------------------------------------------------------------------------
create function public.save_procurement_hub_po_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_vendor record;
  v_project text; v_site text; v_warehouse text := nullif(p_input->>'targetWarehouseId', '');
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_request_ids text[];
  v_needed date; v_scopes integer; v_line_id text; v_punit text; v_ord integer := 0; it jsonb; al jsonb; v_qty numeric; v_price numeric; v_item record; v_src record;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;

  select b.id, b.name into v_vendor from public.business_partners b
  where b.id = nullif(p_input->>'vendorId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;

  -- Every allocation must be an open need line of the same item, in one project/site.
  create temp table if not exists pg_temp.hub_alloc (item_ord integer, po_line_id text, item_id text, unit_price numeric, item_note text,
    purchase_qty numeric, purchase_unit text,
    source_type text, source_id text, line_id text, qty numeric, need_qty numeric, project_id text, site_id text,
    warehouse_id text, needed_date date, work_boq_item_id text, material_budget_item_id text, code text, unit text) on commit drop;
  truncate pg_temp.hub_alloc;
  for it in select value from jsonb_array_elements(p_input->'items') loop
    v_ord := v_ord + 1;
    v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
    if nullif(it->>'purchaseQty', '')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if jsonb_typeof(it->'allocations') is distinct from 'array' or jsonb_array_length(it->'allocations') = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    for al in select value from jsonb_array_elements(it->'allocations') loop
      v_qty := nullif(al->>'qty', '')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
      select l.need_qty, l.unit, d.project_id, d.construction_site_id, d.warehouse_id, d.needed_date, d.code, d.closed_at
        into v_src
      from app_private.procurement_inbox_lines() l
      join app_private.procurement_inbox_documents() d on d.source_type = l.source_type and d.source_id = l.source_id
      where l.source_type = al->>'sourceType' and l.source_id = al->>'sourceId' and l.line_id = al->>'lineId'
        and l.item_id = it->>'itemId';
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
      if v_src.closed_at is not null then raise exception using errcode = '22023', message = 'PROCUREMENT_NEED_CLOSED'; end if;
      insert into pg_temp.hub_alloc values (v_ord, null, it->>'itemId', v_price,
        nullif(btrim(it->>'note'), ''), nullif(it->>'purchaseQty', '')::numeric, nullif(btrim(it->>'purchaseUnit'), ''), al->>'sourceType', al->>'sourceId', al->>'lineId', v_qty, v_src.need_qty,
        v_src.project_id, v_src.construction_site_id, v_src.warehouse_id, v_src.needed_date, null, null, v_src.code, v_src.unit);
    end loop;
  end loop;
  if exists (select 1 from pg_temp.hub_alloc group by source_type, source_id, line_id having count(*) > 1) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
  select count(distinct coalesce(project_id, '') || '|' || coalesce(site_id, '')), min(project_id), min(site_id), min(needed_date)
    into v_scopes, v_project, v_site, v_needed from pg_temp.hub_alloc;
  if v_scopes <> 1 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;
  if v_warehouse is null then
    select min(warehouse_id) into v_warehouse from pg_temp.hub_alloc having count(distinct warehouse_id) = 1;
  end if;
  if v_warehouse is not null and not exists (select 1 from public.warehouses w where w.id = v_warehouse and not coalesce(w.is_archived, false)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  -- Request line attribution (BOQ links) from the request itself.
  update pg_temp.hub_alloc a set work_boq_item_id = x.value->>'workBoqItemId', material_budget_item_id = x.value->>'materialBudgetItemId'
  from public.requests r cross join lateral jsonb_array_elements(r.items) x
  where a.source_type = 'material_request' and r.id = a.source_id and x.value->>'lineId' = a.line_id;

  -- One PO line per item.
  for v_item in
    select a.item_id, max(a.unit_price) unit_price, sum(a.qty) qty, min(a.needed_date) needed_date, max(a.item_note) note,
      max(a.purchase_qty) manual_purchase_qty, max(a.purchase_unit) manual_purchase_unit,
      count(*) n, min(a.source_type) st, min(a.source_id) sid, min(a.line_id) lid, min(a.code) code,
      coalesce(i.name, min(a.item_id)) name, i.sku, coalesce(i.unit, min(a.unit)) unit,
      -- Need quantities are in the stock unit; the order uses the purchase unit (stock = purchase × factor).
      case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
        and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
      coalesce(nullif(i.purchase_conversion_factor, 0), 1) factor
    from pg_temp.hub_alloc a left join public.items i on i.id = a.item_id
    group by a.item_id, i.name, i.sku, i.unit, i.purchase_unit, i.purchase_conversion_factor order by min(a.item_ord), a.item_id
  loop
    if (select count(distinct unit_price) from pg_temp.hub_alloc where item_id = v_item.item_id) > 1 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    v_line_id := 'mh-' || gen_random_uuid();
    -- The buyer may type the purchase quantity (e.g. 100 kg ↔ 10 cây); otherwise the item's default factor applies.
    v_punit := coalesce(v_item.manual_purchase_unit, v_item.purchase_unit, v_item.unit);
    v_qty := case when v_item.manual_purchase_qty is not null then v_item.manual_purchase_qty
      when v_item.purchase_unit is null then v_item.qty else round(v_item.qty / v_item.factor, 6) end;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.item_id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_item.qty / v_qty, 12), 'stockQty', v_item.qty,
      'qty', v_qty, 'unitPrice', v_item.unit_price, 'neededDate', v_item.needed_date, 'note', v_item.note,
      'requestId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.sid end,
      'requestCode', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.code end,
      'requestLineId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.lid end)));
    v_total := v_total + v_qty * v_item.unit_price;
    update pg_temp.hub_alloc set po_line_id = v_line_id where item_id = v_item.item_id;
  end loop;
  select array_agg(distinct source_id) into v_request_ids from pg_temp.hub_alloc where source_type = 'material_request';

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, material_request_id, note, created_by_id, approval_request_title, metadata)
    values (v_po_id, v_project, v_site, v_vendor.id, v_vendor.name, public.next_purchase_order_number_v2(), v_items,
      v_total, v_vat, to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', 'from_request', 'single', 'RECEIVE_TO_STOCK',
      v_warehouse, case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      nullif(btrim(p_input->>'note'), ''), v_actor::text, 'Đơn hàng lập tại Mua hàng',
      jsonb_build_object('channel', 'procurement_hub'))
    returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'create', v_actor);
  else
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_po.project_id is distinct from v_project or v_po.construction_site_id is distinct from v_site then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po_id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po_id;
    update public.purchase_orders set vendor_id = v_vendor.id, vendor_name = v_vendor.name, items = v_items,
      total_amount = v_total, vat_rate = v_vat, expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''),
      target_warehouse_id = v_warehouse, material_request_id = case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      note = nullif(btrim(p_input->>'note'), '')
    where id = v_po_id returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'update', v_actor);
  end if;

  insert into public.purchase_order_request_lines (project_id, construction_site_id, source_construction_site_id,
    target_warehouse_id, allocation_status, purchase_order_id, purchase_order_line_id, material_request_id,
    material_request_code, request_line_id, item_id, work_boq_item_id, material_budget_item_id, requested_qty,
    ordered_qty, requested_qty_snapshot, ordered_stock_qty_snapshot, actual_received_qty_snapshot, unit)
  select a.project_id, a.site_id, a.site_id, v_warehouse, 'open', v_po_id, a.po_line_id, a.source_id,
    a.code, a.line_id, a.item_id,
    (select b.id from public.project_work_boq_items b where b.id = a.work_boq_item_id),
    (select b.id from public.material_budget_items b where b.id = a.material_budget_item_id),
    a.need_qty, a.qty, a.need_qty, a.qty, 0, a.unit
  from pg_temp.hub_alloc a where a.source_type = 'material_request';
  insert into public.procurement_po_plan_links (purchase_order_id, purchase_order_line_id, material_plan_id,
    material_plan_line_id, item_id, ordered_qty)
  select v_po_id, a.po_line_id, a.source_id::uuid, a.line_id::uuid, a.item_id, a.qty
  from pg_temp.hub_alloc a where a.source_type = 'material_plan';
  perform set_config('app.procurement_hub_context', 'off', true);

  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items));
end;
$$;

-- ---------------------------------------------------------------------------
-- Đơn hàng: gửi duyệt / duyệt / trả lại / xóa nháp
-- ---------------------------------------------------------------------------
create function app_private.procurement_po_approver_ok(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users u where u.id = p_user and u.is_active and u.account_status = 'ACTIVE'
    and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage')));
$$;

create function app_private.procurement_notify(p_user uuid, p_title text, p_message text, p_po_id text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    priority, push_enabled, metadata, delivery_reason)
  values (p_user::text, 'info', 'procurement', p_title, p_message, p_message, 'info', '🛒',
    '/#/procurement?po=' || p_po_id, 'procurement_hub_po', 'procurement_po:' || p_po_id || ':' || gen_random_uuid(),
    'normal', true, jsonb_build_object('purchaseOrderId', p_po_id), p_reason);
$$;

create function public.transition_procurement_hub_po_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_po public.purchase_orders%rowtype;
  v_name text;
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
    if v_po.target_warehouse_id is null then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_REQUIRED'; end if;
    if v_to is null or v_to = v_actor or not app_private.procurement_po_approver_ok(v_to) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_APPROVER_INVALID'; end if;
    select name into v_name from public.users where id = v_to;
    update public.purchase_orders set status = 'sent', submitted_to_user_id = v_to::text, submitted_to_name = v_name,
      submitted_to_permission = 'system.procurement.manage', submission_note = v_reason, ever_submitted = true,
      last_action_by = v_actor::text, last_action_at = now(), metadata = metadata - 'returnReason'
    where id = v_po.id returning * into v_po;
    perform app_private.procurement_notify(v_to, 'Đơn hàng chờ bạn duyệt',
      v_po.po_number || ' · ' || coalesce(v_po.vendor_name, '') || ' — ' || to_char(v_po.total_amount, 'FM999G999G999G999') || ' đ', v_po.id, 'assigned');
  elsif v_action in ('approve', 'return') then
    if v_po.status <> 'sent' or v_po.created_by_id = v_actor::text
      or not (v_po.submitted_to_user_id = v_actor::text or public.is_admin()) then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_APPROVE_DENIED'; end if;
    if v_action = 'return' and v_reason is null then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_RETURN_REASON_REQUIRED'; end if;
    if v_action = 'approve' then
      update public.purchase_orders set status = 'confirmed', approved_total_amount = total_amount,
        last_action_by = v_actor::text, last_action_at = now()
      where id = v_po.id returning * into v_po;
      -- Same as the project flow: a single-delivery order gets its delivery note + WMS/QR so the
      -- warehouse receives it (both purchase and stock quantities) — actual qty may be short.
      if coalesce(v_po.purchase_mode, 'single') = 'single' then
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
$$;

-- ---------------------------------------------------------------------------
-- Đơn hàng: danh sách và chi tiết (mọi PO; chỉ PO lập tại Mua hàng có thao tác)
-- ---------------------------------------------------------------------------
create function app_private.procurement_po_sources(p_po_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object('sourceType', s.source_type, 'sourceId', s.source_id, 'code', s.code)), '[]'::jsonb)
  from (
    select 'material_request' source_type, l.material_request_id source_id, coalesce(r.code, l.material_request_code) code
    from public.purchase_order_request_lines l left join public.requests r on r.id = l.material_request_id
    where l.purchase_order_id = p_po_id
    union all
    select 'material_plan', k.material_plan_id::text, p.code
    from public.procurement_po_plan_links k join public.project_material_plans p on p.id = k.material_plan_id
    where k.purchase_order_id = p_po_id
  ) s;
$$;

create function public.list_procurement_orders_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_actor text := public.current_app_user_id()::text;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with pos as (
      select o.*, app_private.procurement_po_stage(o.status) stage,
        app_private.procurement_date_or_null(o.expected_delivery_date) expected_date,
        app_private.procurement_po_is_hub(o.metadata) is_hub,
        pr.code project_code, pr.name project_name,
        (select u.name from public.users u where u.id::text = o.created_by_id) created_by_name,
        (select coalesce(sum(nullif(x.value->>'qty', '')::numeric), 0) from jsonb_array_elements(
          case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x) qty_total,
        (select coalesce(sum(least(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), coalesce(nullif(x.value->>'qty', '')::numeric, 0))), 0)
          from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x) qty_received
      from public.purchase_orders o left join public.projects pr on pr.id = o.project_id
      where o.archived_at is null and o.status <> 'cancelled'
    ),
    filtered as (
      select *, row_number() over (order by case when status = 'sent' and submitted_to_user_id = v_actor then 0 else 1 end,
        expected_date nulls last, created_at desc) rn
      from pos
      where (coalesce(v_filter->>'stage', 'all') = 'all' or stage = v_filter->>'stage')
        and (nullif(v_filter->>'projectId', '') is null or project_id = v_filter->>'projectId')
        and (coalesce(v_filter->>'mine', 'false') <> 'true' or created_by_id = v_actor or submitted_to_user_id = v_actor)
        and (nullif(v_filter->>'search', '') is null or lower(concat_ws(' ', po_number, vendor_name, project_code, project_name))
          like '%' || lower(v_filter->>'search') || '%')
    )
    select jsonb_build_object(
      'today', v_today,
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'id', f.id, 'poNumber', f.po_number, 'status', f.status, 'stage', f.stage, 'isHub', f.is_hub,
          'vendorName', f.vendor_name, 'projectId', f.project_id, 'projectCode', f.project_code, 'projectName', f.project_name,
          'constructionSiteId', f.construction_site_id, 'totalAmount', f.total_amount, 'vatRate', f.vat_rate,
          'orderDate', f.order_date, 'expectedDeliveryDate', f.expected_date,
          'late', f.stage in ('ordered', 'delivering') and f.expected_date < v_today,
          'lineCount', jsonb_array_length(case when jsonb_typeof(f.items) = 'array' then f.items else '[]'::jsonb end),
          'qtyTotal', f.qty_total, 'qtyReceived', f.qty_received,
          'createdById', f.created_by_id, 'createdByName', f.created_by_name,
          'submittedToUserId', f.submitted_to_user_id, 'submittedToName', f.submitted_to_name,
          'awaitingMe', f.status = 'sent' and f.submitted_to_user_id = v_actor,
          'sources', app_private.procurement_po_sources(f.id)) order by f.rn) from filtered f where f.rn <= 300), '[]'::jsonb),
      'awaitingMyApproval', (select count(*) from pos where status = 'sent' and submitted_to_user_id = v_actor)
    )
  );
end;
$$;

create function public.get_procurement_order_v1(p_po_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    'createdAt', v_po.created_at, 'submittedToUserId', v_po.submitted_to_user_id, 'submittedToName', v_po.submitted_to_name,
    'returnReason', v_po.metadata->>'returnReason', 'everSubmitted', v_po.ever_submitted,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
        'name', coalesce(x.value->>'name', x.value->>'itemNameSnapshot'), 'sku', x.value->>'sku', 'unit', x.value->>'unit',
        'qty', coalesce(nullif(x.value->>'qty', '')::numeric, 0), 'unitPrice', coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0),
        'receivedQty', coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), 'note', x.value->>'note',
        'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unit'),
        'factor', coalesce(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 1),
        'allocations', coalesce((select jsonb_agg(a) from (
            select jsonb_build_object('sourceType', 'material_request', 'sourceId', l.material_request_id,
              'code', coalesce(r.code, l.material_request_code), 'lineId', l.request_line_id, 'qty', l.ordered_qty, 'needQty', l.requested_qty) a
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
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', u.name, 'reason', e.reason, 'at', e.created_at)
        order by e.created_at) from public.procurement_hub_events e left join public.users u on u.id = e.actor_id
      where e.entity_type = 'purchase_order' and e.entity_id = v_po.id), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'canEdit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canSubmit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canApprove', v_hub and v_po.status = 'sent' and v_po.created_by_id is distinct from v_actor::text
        and (v_po.submitted_to_user_id = v_actor::text or public.is_admin()),
      'canDelete', v_hub and v_manage and v_po.status = 'draft' and not v_po.ever_submitted and v_po.created_by_id = v_actor::text),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
        and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))), '[]'::jsonb)
  );
end;
$$;

create function public.list_procurement_vendors_v1(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'taxCode', b.tax_code, 'recentOrders', b.n) order by b.n desc, b.name)
    from (select b.id, b.name, b.tax_code, (select count(*) from public.purchase_orders o where o.vendor_id = b.id) n
      from public.business_partners b
      where b.is_active and 'supplier' = any(b.classifications)
        and (nullif(btrim(p_search), '') is null or lower(concat_ws(' ', b.name, b.tax_code, b.code)) like '%' || lower(btrim(p_search)) || '%')
      order by n desc, b.name limit 30) b), '[]'::jsonb);
end;
$$;

revoke all on function app_private.procurement_hub_context_enabled(), app_private.procurement_po_line_received_ratio(jsonb, text),
  app_private.procurement_inbox_lines(), app_private.procurement_inbox_documents(), app_private.procurement_po_is_hub(jsonb),
  app_private.procurement_po_stage(text), app_private.procurement_date_or_null(text), app_private.procurement_po_approver_ok(uuid),
  app_private.procurement_notify(uuid, text, text, text, text), app_private.procurement_po_sources(text)
  from public, anon, authenticated;
revoke all on function public.list_procurement_inbox_v1(jsonb), public.get_procurement_inbox_document_v1(text, text),
  public.assign_procurement_inbox_v1(jsonb), public.close_procurement_need_v1(jsonb), public.save_procurement_hub_po_v1(jsonb),
  public.transition_procurement_hub_po_v1(jsonb), public.list_procurement_orders_v1(jsonb), public.get_procurement_order_v1(text),
  public.list_procurement_vendors_v1(text) from public, anon;
grant execute on function public.list_procurement_inbox_v1(jsonb), public.get_procurement_inbox_document_v1(text, text),
  public.assign_procurement_inbox_v1(jsonb), public.close_procurement_need_v1(jsonb), public.save_procurement_hub_po_v1(jsonb),
  public.transition_procurement_hub_po_v1(jsonb), public.list_procurement_orders_v1(jsonb), public.get_procurement_order_v1(text),
  public.list_procurement_vendors_v1(text) to authenticated;

-- ---------------------------------------------------------------------------
-- PO guard: honour the Mua hàng context; from_request POs are created only there.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.guard_project_purchase_order_room_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_is_admin boolean := public.is_admin();
  v_workflow_changed boolean;
begin
  if v_actor is null and session_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  -- Mua hàng (procurement hub) RPCs check their own permissions and approval rules.
  if app_private.procurement_hub_context_enabled() then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.source_mode = 'company_consolidated' or v_is_admin then return old; end if;
    if v_actor is null
      or nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'delete'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Xóa trong Room Đơn hàng PO.'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.source_mode = 'company_consolidated' then return new; end if;
    if v_is_admin then return new; end if;
    -- 01/10/2026: đơn hàng từ phiếu nhu cầu chỉ được lập tại Mua hàng.
    if new.source_mode in ('from_request', 'proactive_project') then
      raise exception using errcode = '42501', message = 'PURCHASE_ORDER_CREATE_MOVED_TO_PROCUREMENT';
    end if;
    if v_actor is null
      or new.status <> 'draft'
      or nullif(new.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, new.project_id, new.construction_site_id, 'material_po', 'edit'
      ) then
      raise exception 'Bạn cần quyền Sửa và phải là người tạo PO nháp.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.source_mode = 'company_consolidated' and new.source_mode = 'company_consolidated' then
    return new;
  end if;
  if v_is_admin then return new; end if;
  if v_actor is null then
    raise exception 'Không xác định được người thao tác PO.' using errcode = '42501';
  end if;
  if new.project_id is distinct from old.project_id
    or new.construction_site_id is distinct from old.construction_site_id
    or new.created_by_id is distinct from old.created_by_id
    or new.source_mode is distinct from old.source_mode then
    raise exception 'Không được thay đổi scope, nguồn hoặc người tạo PO.' using errcode = '42501';
  end if;

  if new.archived_at is distinct from old.archived_at then
    if nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'delete'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Xóa trong Room Đơn hàng PO.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_workflow_changed := new.status is distinct from old.status
    or new.submitted_to_user_id is distinct from old.submitted_to_user_id
    or new.submitted_to_name is distinct from old.submitted_to_name
    or new.submitted_to_permission is distinct from old.submitted_to_permission
    or new.submission_note is distinct from old.submission_note
    or new.received_transaction_ids is distinct from old.received_transaction_ids
    or new.actual_delivery_date is distinct from old.actual_delivery_date;

  if old.status in ('draft', 'returned') and new.status = 'sent' then
    if nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'submit'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Gửi.' using errcode = '42501';
    end if;
    if new.submitted_to_user_id is null
      or not app_private.project_user_has_room_action(
        new.submitted_to_user_id::uuid,
        old.project_id,
        old.construction_site_id,
        'material_po',
        'approve'
      ) then
      raise exception 'Người nhận phải có quyền Duyệt thuần trong Room Đơn hàng PO.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'sent' and new.status in ('confirmed', 'returned') then
    if old.submitted_to_user_id is null
      or old.submitted_to_user_id::text <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'approve'
      ) then
      raise exception 'Bạn cần quyền Duyệt và phải là người được giao xử lý PO.' using errcode = '42501';
    end if;
    if new.status = 'returned' and (
      new.submitted_to_user_id is not null
      or new.submitted_to_name is not null
      or new.submitted_to_permission is not null
    ) then
      raise exception 'PO Trả lại phải xóa assignment duyệt cũ.' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_workflow_changed then
    if new.status = 'cancelled' then
      if not (
        app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id)
      ) then
        raise exception 'Chỉ System Admin hoặc Thủ kho được hủy PO.' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status in ('confirmed', 'in_transit', 'partial', 'delivered', 'closed')
      or old.status in ('confirmed', 'in_transit', 'partial', 'delivered') then
      if not (
        app_private.project_actor_has_effective_room_action(
          v_actor, old.project_id, old.construction_site_id, 'material_po', 'confirm'
        )
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id)
      ) then
        raise exception 'Bạn cần quyền Xác nhận để quản lý giao nhận PO.' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'Transition PO không hợp lệ.' using errcode = '42501';
  end if;

  if app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id) then
    return new;
  end if;
  if current_setting('app.material_transition_context', true) = 'on'
    and (
      new.supplemental_approval_status is distinct from old.supplemental_approval_status
      or new.approved_total_amount is distinct from old.approved_total_amount
    )
    and app_private.project_actor_has_effective_room_action(
      v_actor, old.project_id, old.construction_site_id, 'material_po', 'approve'
    ) then
    return new;
  end if;
  if old.status not in ('draft', 'returned')
    or new.status not in ('draft', 'returned')
    or nullif(old.created_by_id, '') <> v_actor::text
    or not app_private.project_actor_has_effective_room_action(
      v_actor, old.project_id, old.construction_site_id, 'material_po', 'edit'
    ) then
    raise exception 'Chỉ người tạo có quyền Sửa mới được sửa PO draft/returned.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

notify pgrst, 'reload schema';
