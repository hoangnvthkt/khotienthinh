-- Kho & Công nợ — K2: Trả hàng NCC (chủ sản phẩm duyệt 02/10/2026).
--
-- * Thủ kho lập phiếu trả NCC (lý do chuẩn: lỗi chất lượng, sai quy cách, giao thừa, hư hỏng…),
--   kho xuất trả; khi xuất trả xong công nợ tự giảm (luồng sẵn có).
-- * Mua hàng xác nhận với NCC và chọn:
--     - Đổi hàng: NCC giao lại — phần trả quay về "còn phải giao", Mua hàng lập đợt giao bù.
--     - Giảm trừ: không giao lại — phần trả trừ khỏi đơn và quay lại danh sách Cần mua.
-- * SL đã nhận theo nhu cầu = SL nhận trừ SL đã trả.

alter table public.purchase_order_supplier_returns
  add column reason_code text check (reason_code in ('quality', 'spec', 'excess', 'damaged', 'other')),
  add column resolution text check (resolution in ('replace', 'credit')),
  add column resolution_by uuid references public.users(id),
  add column resolution_at timestamptz,
  add column resolution_note text;

-- Completed returns of a PO line by resolution, in purchase and stock units.
create function app_private.procurement_po_line_returned(p_po_id text, p_line_id text, p_resolution text)
returns table (purchase_qty numeric, stock_qty numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.return_qty), 0), coalesce(sum(coalesce(nullif(l.stock_return_qty, 0), l.return_qty)), 0)
  from public.purchase_order_supplier_return_lines l
  join public.purchase_order_supplier_returns r on r.id = l.supplier_return_id
  where r.purchase_order_id = p_po_id and l.purchase_order_line_id = p_line_id and r.status = 'completed'
    and (p_resolution is null or r.resolution = p_resolution);
$$;

create or replace function app_private.procurement_link_received(p_po_id text, p_items jsonb, p_line_id text, p_ordered numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  with line as (
    select greatest(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) - coalesce(nullif(x.value->>'returnedQty', '')::numeric, 0), 0) received,
      nullif(nullif(x.value->>'qty', '')::numeric, 0) qty,
      nullif(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 0) factor
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
    where coalesce(x.value->>'lineId', x.value->>'itemId') = p_line_id limit 1
  ), total as (select nullif(app_private.procurement_po_line_link_total(p_po_id, p_line_id), 0) n)
  select coalesce((select least(p_ordered, greatest(
      case when line.factor is not null then line.received * line.factor
        else line.received / line.qty * total.n end, 0) * p_ordered / total.n)
    from line, total), 0);
$$;

-- Stock quantity of a need link cancelled by "giảm trừ" returns (shared by ordered quantity).
create function app_private.procurement_link_credited(p_po_id text, p_line_id text, p_ordered numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(least(p_ordered, (select r.stock_qty from app_private.procurement_po_line_returned(p_po_id, p_line_id, 'credit') r)
    * p_ordered / nullif(app_private.procurement_po_line_link_total(p_po_id, p_line_id), 0)), 0);
$$;

create or replace function app_private.procurement_po_line_undelivered(p_po_id text, p_items jsonb, p_line_id text)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(coalesce((select coalesce(nullif(x.value->>'qty', '')::numeric, 0) - coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0)
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
      where coalesce(x.value->>'lineId', x.value->>'itemId') = p_line_id limit 1), 0)
    + (select r.purchase_qty from app_private.procurement_po_line_returned(p_po_id, p_line_id, 'replace') r)
    - coalesce((select sum(l.planned_qty) from public.purchase_order_delivery_lines l
      join public.purchase_order_delivery_batches b on b.id = l.delivery_batch_id
      where b.purchase_order_id = p_po_id and l.purchase_order_line_id = p_line_id
        and b.status = any (app_private.procurement_po_open_delivery_statuses())), 0), 0);
$$;

-- A replacement brings a fully delivered order back to "giao một phần" so Mua hàng can schedule it.
create function app_private.procurement_reopen_for_replacement(p_po_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.purchase_orders o where o.id = p_po_id and o.status in ('delivered', 'returned')
      and exists (select 1 from jsonb_array_elements(o.items) x
        where app_private.procurement_po_line_undelivered(o.id, o.items, coalesce(x.value->>'lineId', x.value->>'itemId')) > 0)) then
    perform set_config('app.material_transition_context', 'on', true);
    perform set_config('app.procurement_hub_context', 'on', true);
    update public.purchase_orders set status = 'partial', last_action_at = now() where id = p_po_id;
    perform set_config('app.material_transition_context', 'off', true);
    perform set_config('app.procurement_hub_context', 'off', true);
  end if;
end;
$$;

create function app_private.trg_procurement_return_resolution()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and new.resolution = 'replace'
    and (old.status is distinct from new.status or old.resolution is distinct from new.resolution) then
    perform app_private.procurement_reopen_for_replacement(new.purchase_order_id);
  end if;
  return new;
end;
$$;
create trigger trg_procurement_return_resolution after update of status, resolution on public.purchase_order_supplier_returns
  for each row execute function app_private.trg_procurement_return_resolution();

-- ---------------------------------------------------------------------------
-- Thủ kho lập phiếu trả (lý do chuẩn); Mua hàng chọn đổi hàng / giảm trừ
-- ---------------------------------------------------------------------------
create function public.create_purchase_order_supplier_return_v2(p_purchase_order_id text, p_source_warehouse_id text, p_lines jsonb,
  p_reason text, p_note text default null, p_reason_code text default null)
returns public.purchase_order_supplier_returns language plpgsql security definer set search_path = '' as $$
declare v_return public.purchase_order_supplier_returns%rowtype; v_po public.purchase_orders%rowtype;
begin
  if p_reason_code is not null and p_reason_code not in ('quality', 'spec', 'excess', 'damaged', 'other') then
    raise exception using errcode = '22023', message = 'SUPPLIER_RETURN_REASON_INVALID'; end if;
  v_return := public.create_purchase_order_supplier_return(p_purchase_order_id, p_source_warehouse_id, p_lines, p_reason, p_note);
  update public.purchase_order_supplier_returns set reason_code = coalesce(p_reason_code, 'other') where id = v_return.id returning * into v_return;
  select * into v_po from public.purchase_orders where id = p_purchase_order_id;
  if app_private.procurement_po_is_hub(v_po.metadata) and v_po.created_by_id is not null then
    perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Trả hàng NCC chờ quyết định',
      v_return.return_no || ' · ' || v_po.po_number || ': ' || v_return.reason || ' — chọn Đổi hàng hoặc Giảm trừ.', v_po.id, 'responsible');
  end if;
  return v_return;
end;
$$;

create function public.decide_procurement_supplier_return_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_r public.purchase_order_supplier_returns%rowtype; v_po public.purchase_orders%rowtype;
  v_resolution text := p_input->>'resolution';
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_resolution not in ('replace', 'credit') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID'; end if;
  select * into v_r from public.purchase_order_supplier_returns where id = nullif(p_input->>'returnId', '')::uuid for update;
  if not found or v_r.status not in ('pending', 'completed') then
    raise exception using errcode = 'PT404', message = 'SUPPLIER_RETURN_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = v_r.purchase_order_id;
  if not app_private.procurement_po_is_hub(v_po.metadata) then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  -- Once the return is out of the warehouse the decision is final (it drives delivery and needs).
  if v_r.resolution is not null and v_r.status = 'completed' then
    raise exception using errcode = '22023', message = 'SUPPLIER_RETURN_ALREADY_DECIDED'; end if;
  update public.purchase_order_supplier_returns set resolution = v_resolution, resolution_by = v_actor, resolution_at = now(),
    resolution_note = nullif(btrim(p_input->>'note'), '')
  where id = v_r.id returning * into v_r;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'return_' || v_resolution, v_actor, nullif(btrim(p_input->>'note'), ''), jsonb_build_object('returnNo', v_r.return_no));
  return jsonb_build_object('returnId', v_r.id, 'resolution', v_r.resolution, 'status', v_r.status);
end;
$$;

create function app_private.procurement_po_returns(p_po_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'returnNo', r.return_no, 'status', r.status, 'reason', r.reason,
      'reasonCode', r.reason_code, 'note', r.note, 'resolution', r.resolution, 'resolutionNote', r.resolution_note,
      'resolutionByName', (select name from public.users where id = r.resolution_by), 'createdAt', r.created_at,
      'createdByName', (select name from public.users where id = r.created_by), 'completedAt', r.completed_at,
      'warehouseName', (select name from public.warehouses where id = r.source_warehouse_id),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('lineId', l.purchase_order_line_id, 'itemId', l.item_id,
          'name', coalesce(i.name, l.item_id), 'returnQty', l.return_qty, 'unit', l.unit, 'stockReturnQty', l.stock_return_qty,
          'stockUnit', l.stock_unit, 'unitPrice', l.unit_price)), '[]'::jsonb)
        from public.purchase_order_supplier_return_lines l left join public.items i on i.id = l.item_id where l.supplier_return_id = r.id))
    order by r.created_at desc), '[]'::jsonb)
  from public.purchase_order_supplier_returns r where r.purchase_order_id = p_po_id and r.status <> 'cancelled';
$$;

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
    select round(sum(l.ordered_qty - app_private.procurement_link_credited(o.id, l.purchase_order_line_id, l.ordered_qty)), 6) ordered_qty,
      sum(app_private.procurement_link_received(o.id, o.items, l.purchase_order_line_id, l.ordered_qty)) received_qty
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
    select round(sum(k.ordered_qty - app_private.procurement_link_credited(o.id, k.purchase_order_line_id, k.ordered_qty)), 6) ordered_qty,
      sum(app_private.procurement_link_received(o.id, o.items, k.purchase_order_line_id, k.ordered_qty)) received_qty
    from public.procurement_po_plan_links k
    join public.purchase_orders o on o.id = k.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
    where k.material_plan_line_id = l.id
  ) po on true
  where p.status = 'approved';
$$;

create or replace function public.list_procurement_orders_v1(p_filter jsonb default '{}'::jsonb)
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
        app_private.procurement_po_awaits_me(o.id, o.status, o.submitted_to_user_id, v_actor) awaits_me,
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
      select *, row_number() over (order by case when awaits_me then 0 else 1 end,
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
          'awaitingMe', f.awaits_me, 'purchaseMode', f.purchase_mode,
          'returnsPending', (select count(*) from public.purchase_order_supplier_returns r where r.purchase_order_id = f.id and r.status <> 'cancelled' and r.resolution is null),
          'sources', app_private.procurement_po_sources(f.id)) order by f.rn) from filtered f where f.rn <= 300), '[]'::jsonb),
      'awaitingMyApproval', (select count(*) from pos where awaits_me)
    )
  );
end;
$$;

create or replace function public.get_procurement_order_v1(p_po_id text)
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
    'purchaseMode', v_po.purchase_mode, 'approvedTotalAmount', v_po.approved_total_amount, 'shortClose', v_po.metadata->'shortClose',
    'deliveries', app_private.procurement_po_deliveries(v_po.id),
    'returns', app_private.procurement_po_returns(v_po.id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
        'name', coalesce(x.value->>'name', x.value->>'itemNameSnapshot'), 'sku', x.value->>'sku', 'unit', x.value->>'unit',
        'qty', coalesce(nullif(x.value->>'qty', '')::numeric, 0), 'unitPrice', coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0),
        'receivedQty', coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), 'note', x.value->>'note',
        'returnedQty', coalesce(nullif(x.value->>'returnedQty', '')::numeric, 0),
        'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unit'),
        'remainingToDeliver', app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')),
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
      'canDelete', v_hub and v_manage and v_po.status = 'draft' and not v_po.ever_submitted and v_po.created_by_id = v_actor::text,
      'canDecideReturn', v_hub and v_manage,
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
$$;

revoke all on function app_private.procurement_po_line_returned(text, text, text), app_private.procurement_link_credited(text, text, numeric),
  app_private.procurement_reopen_for_replacement(text), app_private.trg_procurement_return_resolution(), app_private.procurement_po_returns(text)
  from public, anon, authenticated;
revoke all on function public.create_purchase_order_supplier_return_v2(text, text, jsonb, text, text, text),
  public.decide_procurement_supplier_return_v1(jsonb) from public, anon;
grant execute on function public.create_purchase_order_supplier_return_v2(text, text, jsonb, text, text, text),
  public.decide_procurement_supplier_return_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
