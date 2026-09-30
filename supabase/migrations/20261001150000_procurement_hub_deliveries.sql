-- Mua hàng M3 — Giao hàng & nhận hàng (chủ sản phẩm duyệt 01/10/2026).
--
-- * Đơn "giao một lần": duyệt xong tự có đợt giao + phiếu nhập kho chờ (M2a).
-- * Đơn "giao nhiều đợt" (VD thép tấm): Mua hàng lập từng đợt giao với SL mua, SL kho
--   (nhập tay), đơn giá và VAT riêng của đợt. Đợt trong giá trị đơn đã duyệt tạo ngay
--   phiếu nhập kho + QR; đợt làm vượt giá trị phải được người khác duyệt bổ sung.
-- * Giao thiếu (VD 50/100 thùng sơn): thủ kho nhận đúng SL thực tế; Mua hàng chọn
--   "Giao bù phần thiếu" (đợt mới) hoặc "Kết thúc thiếu" — phần thiếu quay lại
--   danh sách Cần mua, hoặc bỏ nếu không cần nữa.
-- * SL đã nhận theo dòng nhu cầu = SL kho đã nhận của dòng PO chia theo tỷ lệ SL đặt.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function app_private.procurement_po_line_link_total(p_po_id text, p_line_id text)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(l.ordered_qty) from public.purchase_order_request_lines l
      where l.purchase_order_id = p_po_id and l.purchase_order_line_id = p_line_id), 0)
    + coalesce((select sum(k.ordered_qty) from public.procurement_po_plan_links k
      where k.purchase_order_id = p_po_id and k.purchase_order_line_id = p_line_id), 0);
$$;

-- Stock quantity received on a PO line shared across its need links by ordered quantity.
create function app_private.procurement_link_received(p_po_id text, p_items jsonb, p_line_id text, p_ordered numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  with line as (
    select coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) received,
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

create function app_private.procurement_po_open_delivery_statuses()
returns text[] language sql immutable set search_path = '' as $$
  select array['planned', 'waiting_delivery', 'wms_pending', 'receiving', 'quality_approved', 'supplemental_pending'];
$$;

create function app_private.procurement_po_has_open_delivery(p_po_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.purchase_order_delivery_batches b
    where b.purchase_order_id = p_po_id and b.status = any (app_private.procurement_po_open_delivery_statuses()));
$$;

-- Purchase-unit quantity of a PO line not yet received nor on an open delivery.
create function app_private.procurement_po_line_undelivered(p_po_id text, p_items jsonb, p_line_id text)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(coalesce((select coalesce(nullif(x.value->>'qty', '')::numeric, 0) - coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0)
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
      where coalesce(x.value->>'lineId', x.value->>'itemId') = p_line_id limit 1), 0)
    - coalesce((select sum(l.planned_qty) from public.purchase_order_delivery_lines l
      join public.purchase_order_delivery_batches b on b.id = l.delivery_batch_id
      where b.purchase_order_id = p_po_id and l.purchase_order_line_id = p_line_id
        and b.status = any (app_private.procurement_po_open_delivery_statuses())), 0), 0);
$$;

create function app_private.procurement_po_awaits_me(p_po_id text, p_status text, p_submitted_to text, p_actor text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor is not null and ((p_status = 'sent' and p_submitted_to = p_actor)
    or exists (select 1 from public.purchase_order_delivery_batches b where b.purchase_order_id = p_po_id
      and b.approval_status = 'pending_approval' and b.status = 'planned' and b.approval_assignee_user_id::text = p_actor));
$$;

-- Committed value (before VAT) of a PO's deliveries: received batches at accepted qty, open ones at planned qty.
create function app_private.procurement_po_committed_amount(p_po_id text, p_except uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when b.status in ('received', 'received_short', 'received_over')
      then coalesce(l.accepted_qty, 0) else coalesce(l.planned_qty, 0) end * coalesce(l.delivery_unit_price, 0)), 0)
  from public.purchase_order_delivery_batches b join public.purchase_order_delivery_lines l on l.delivery_batch_id = b.id
  where b.purchase_order_id = p_po_id and b.status <> 'cancelled' and b.id is distinct from p_except;
$$;

create function app_private.procurement_po_deliveries(p_po_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'deliveryNo', b.delivery_no, 'status', b.status, 'approvalStatus', b.approval_status,
      'plannedDate', b.planned_delivery_date, 'vatRate', b.vat_rate, 'note', b.note,
      'wmsTransactionId', b.wms_transaction_id, 'hasQr', b.qr_token is not null,
      'createdById', b.created_by, 'createdByName', (select u.name from public.users u where u.id = b.created_by),
      'approvalAssigneeId', b.approval_assignee_user_id,
      'approvalAssigneeName', (select u.name from public.users u where u.id = b.approval_assignee_user_id),
      'decisionNote', b.approval_decision_note, 'receivedAt', b.received_at,
      'receivedByName', (select u.name from public.users u where u.id = b.received_by),
      'amount', (select coalesce(sum(coalesce(l.planned_qty, 0) * coalesce(l.delivery_unit_price, 0)), 0) from public.purchase_order_delivery_lines l where l.delivery_batch_id = b.id),
      'acceptedAmount', (select coalesce(sum(coalesce(l.accepted_qty, 0) * coalesce(l.delivery_unit_price, 0)), 0) from public.purchase_order_delivery_lines l where l.delivery_batch_id = b.id),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('lineId', l.purchase_order_line_id, 'itemId', l.item_id,
          'name', coalesce(i.name, l.item_id), 'plannedQty', l.planned_qty, 'unit', l.unit,
          'stockPlannedQty', l.stock_planned_qty, 'stockUnit', l.stock_unit, 'unitPrice', l.delivery_unit_price,
          'acceptedQty', l.accepted_qty, 'acceptedStockQty', l.accepted_stock_qty) order by i.name), '[]'::jsonb)
        from public.purchase_order_delivery_lines l left join public.items i on i.id = l.item_id where l.delivery_batch_id = b.id))
    order by b.delivery_no), '[]'::jsonb)
  from public.purchase_order_delivery_batches b where b.purchase_order_id = p_po_id;
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
    select sum(l.ordered_qty) ordered_qty,
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
    select sum(k.ordered_qty) ordered_qty,
      sum(app_private.procurement_link_received(o.id, o.items, k.purchase_order_line_id, k.ordered_qty)) received_qty
    from public.procurement_po_plan_links k
    join public.purchase_orders o on o.id = k.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
    where k.material_plan_line_id = l.id
  ) po on true
  where p.status = 'approved';
$$;

create or replace function public.list_procurement_inbox_v1(p_filter jsonb default '{}'::jsonb)
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
$$;

create or replace function public.save_procurement_hub_po_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_vendor record;
  v_project text; v_site text; v_warehouse text := nullif(p_input->>'targetWarehouseId', '');
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_request_ids text[];
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
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
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', 'from_request', v_mode, 'RECEIVE_TO_STOCK',
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
      total_amount = v_total, vat_rate = v_vat, purchase_mode = v_mode, expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''),
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
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
        'name', coalesce(x.value->>'name', x.value->>'itemNameSnapshot'), 'sku', x.value->>'sku', 'unit', x.value->>'unit',
        'qty', coalesce(nullif(x.value->>'qty', '')::numeric, 0), 'unitPrice', coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0),
        'receivedQty', coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), 'note', x.value->>'note',
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

-- ---------------------------------------------------------------------------
-- Đợt giao: lập / sửa (Mua hàng), duyệt bổ sung, hủy
-- ---------------------------------------------------------------------------
create function public.save_procurement_delivery_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_batch_id uuid := nullif(p_input->>'deliveryId', '')::uuid;
  v_no integer;
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_lines jsonb := '[]'::jsonb; ln jsonb; v_item jsonb;
  v_pq numeric; v_sq numeric; v_price numeric; v_amount numeric := 0; v_budget numeric; v_over boolean;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_PO_STATE'; end if;
  if v_po.target_warehouse_id is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;

  if v_batch_id is not null then
    select * into v_batch from public.purchase_order_delivery_batches where id = v_batch_id and purchase_order_id = v_po.id for update;
    if not found or v_batch.status <> 'planned' or v_batch.wms_transaction_id is not null
      or coalesce(v_batch.approval_status, 'draft') not in ('draft', 'rejected', 'revision_requested') then
      raise exception using errcode = '42501', message = 'PROCUREMENT_DELIVERY_NOT_EDITABLE'; end if;
    v_no := v_batch.delivery_no;
  else
    v_batch_id := gen_random_uuid();
    select coalesce(max(delivery_no), 0) + 1 into v_no from public.purchase_order_delivery_batches where purchase_order_id = v_po.id;
  end if;

  for ln in select value from jsonb_array_elements(p_input->'lines') loop
    select x.value into v_item from jsonb_array_elements(v_po.items) x
    where coalesce(x.value->>'lineId', x.value->>'itemId') = ln->>'purchaseOrderLineId' limit 1;
    if v_item is null then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
    v_pq := nullif(ln->>'purchaseQty', '')::numeric; v_sq := nullif(ln->>'stockQty', '')::numeric;
    v_price := coalesce(nullif(ln->>'unitPrice', '')::numeric, 0);
    if v_pq is null or v_pq <= 0 or v_sq is null or v_sq <= 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if exists (select 1 from jsonb_array_elements(v_lines) e where e.value->>'purchaseOrderLineId' = ln->>'purchaseOrderLineId') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('purchaseOrderLineId', ln->>'purchaseOrderLineId',
      'itemId', v_item->>'itemId', 'purchaseQty', v_pq, 'purchaseUnit', coalesce(v_item->>'purchaseUnitSnapshot', v_item->>'unit'),
      'stockQty', v_sq, 'stockUnit', coalesce(v_item->>'stockUnitSnapshot', v_item->>'unitSnapshot', v_item->>'unit'),
      'purchaseUnitPrice', v_price));
    v_amount := v_amount + v_pq * v_price;
  end loop;

  v_budget := coalesce(nullif(v_po.approved_total_amount, 0), v_po.total_amount, 0);
  v_over := app_private.procurement_po_committed_amount(v_po.id, v_batch_id) + v_amount > v_budget * 1.0001 + 1;
  if v_over and (v_to is null or v_to = v_actor or not app_private.procurement_po_approver_ok(v_to)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_APPROVER_REQUIRED'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  perform app_private.write_purchase_order_draft_batch_v1(v_po, jsonb_build_object('id', v_batch_id, 'delivery_no', v_no,
    'planned_delivery_date', coalesce(nullif(p_input->>'plannedDate', '')::date, current_date), 'status', 'planned',
    'approval_status', 'draft', 'fulfillment_mode', v_po.fulfillment_mode, 'vat_rate', v_vat,
    'note', nullif(btrim(p_input->>'note'), ''), 'lines', v_lines), v_actor);
  update public.purchase_order_delivery_batches
  set approval_status = case when v_over then 'pending_approval' else 'approved' end,
      approval_requested_by = v_actor, approval_requested_at = now(),
      approval_assignee_user_id = case when v_over then v_to end,
      approval_decided_by = case when v_over then null else v_actor end,
      approval_decided_at = case when v_over then null else now() end
  where id = v_batch_id;
  if v_over then
    perform app_private.procurement_notify(v_to, 'Đợt giao cần duyệt bổ sung',
      v_po.po_number || ' — đợt ' || v_no || ' vượt giá trị đơn đã duyệt.', v_po.id, 'assigned');
  else
    perform app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(v_batch_id, v_actor, gen_random_uuid());
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_po.id, case when v_over then 'delivery_request' else 'delivery_create' end, v_actor,
    jsonb_build_object('deliveryNo', v_no, 'amount', v_amount, 'vatRate', v_vat));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('deliveryId', v_batch_id, 'deliveryNo', v_no, 'needsApproval', v_over, 'amount', v_amount);
end;
$$;

create function public.decide_procurement_delivery_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
begin
  select * into v_batch from public.purchase_order_delivery_batches where id = nullif(p_input->>'deliveryId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_DELIVERY_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id for update;
  if not app_private.procurement_po_is_hub(v_po.metadata) then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_batch.status <> 'planned' or v_batch.approval_status <> 'pending_approval' or v_batch.created_by = v_actor
    or not (v_batch.approval_assignee_user_id = v_actor or public.is_admin()) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_PO_APPROVE_DENIED'; end if;
  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  if v_action = 'approve' then
    update public.purchase_order_delivery_batches set approval_status = 'approved', approval_decided_by = v_actor,
      approval_decided_at = now(), approval_decision_note = v_reason where id = v_batch.id;
    update public.purchase_orders set approved_total_amount = greatest(coalesce(approved_total_amount, 0),
      app_private.procurement_po_committed_amount(id, null)) where id = v_po.id;
    perform app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(v_batch.id, v_actor, gen_random_uuid());
    perform app_private.procurement_notify(v_batch.created_by, 'Đợt giao đã được duyệt bổ sung',
      v_po.po_number || ' — đợt ' || v_batch.delivery_no || ' đã có phiếu nhập kho.', v_po.id, 'responsible');
  elsif v_action = 'return' then
    if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_RETURN_REASON_REQUIRED'; end if;
    update public.purchase_order_delivery_batches set approval_status = 'rejected', approval_decided_by = v_actor,
      approval_decided_at = now(), approval_decision_note = v_reason where id = v_batch.id;
    perform app_private.procurement_notify(v_batch.created_by, 'Đợt giao bị trả lại',
      v_po.po_number || ' — đợt ' || v_batch.delivery_no || ': ' || v_reason, v_po.id, 'responsible');
  else
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID';
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'delivery_' || v_action, v_actor, v_reason, jsonb_build_object('deliveryNo', v_batch.delivery_no));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('deliveryId', v_batch.id, 'action', v_action);
end;
$$;

create function public.cancel_procurement_delivery_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx_status text;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_CANCEL_REASON_REQUIRED'; end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = nullif(p_input->>'deliveryId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_DELIVERY_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id;
  if not app_private.procurement_po_is_hub(v_po.metadata) then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_batch.wms_transaction_id is not null then
    select status::text into v_tx_status from public.transactions where id = v_batch.wms_transaction_id for update;
  end if;
  -- Only deliveries the warehouse has not started receiving.
  if not (v_batch.status = 'planned' or (v_batch.status = 'receiving' and v_tx_status = 'PENDING')) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_NOT_CANCELLABLE'; end if;
  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_order_delivery_batches set status = 'cancelled',
    note = concat_ws(E'\n', nullif(note, ''), 'Hủy đợt giao: ' || v_reason) where id = v_batch.id;
  if v_batch.wms_transaction_id is not null then
    update public.transactions set status = 'CANCELLED'::public.transaction_status,
      note = concat_ws(E'\n', nullif(note, ''), 'Hủy đợt giao: ' || v_reason), updated_by = v_actor
    where id = v_batch.wms_transaction_id;
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'delivery_cancel', v_actor, v_reason, jsonb_build_object('deliveryNo', v_batch.delivery_no));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('deliveryId', v_batch.id, 'status', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- Kết thúc thiếu: phần chưa giao quay lại Cần mua (hoặc bỏ nếu không cần nữa)
-- ---------------------------------------------------------------------------
create function public.close_procurement_po_short_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_return boolean := coalesce((p_input->>'returnToNeed')::boolean, true);
  v_po public.purchase_orders%rowtype;
  v_short numeric;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_CLOSE_REASON_REQUIRED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_PO_STATE'; end if;
  if app_private.procurement_po_has_open_delivery(v_po.id) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_STILL_OPEN'; end if;

  -- Shortfall in stock units across need links, before shrinking them.
  select coalesce(sum(greatest(q.ordered_qty - app_private.procurement_link_received(v_po.id, v_po.items, q.line_id, q.ordered_qty), 0)), 0)
  into v_short from (
    select purchase_order_line_id line_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po.id
    union all select purchase_order_line_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po.id) q;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  if v_return then
    -- Each need keeps only what actually arrived, so the rest shows again under Cần mua.
    update public.purchase_order_request_lines l
    set ordered_qty = r.received, ordered_stock_qty_snapshot = r.received
    from (select id, round(app_private.procurement_link_received(v_po.id, v_po.items, purchase_order_line_id, ordered_qty), 6) received
          from public.purchase_order_request_lines where purchase_order_id = v_po.id) r
    where l.id = r.id;
    delete from public.procurement_po_plan_links k
    where k.purchase_order_id = v_po.id and app_private.procurement_link_received(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty) <= 0;
    update public.procurement_po_plan_links k
    set ordered_qty = round(app_private.procurement_link_received(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty), 6)
    where k.purchase_order_id = v_po.id;
  end if;
  update public.purchase_orders
  set status = 'closed', closed_need_qty = coalesce(closed_need_qty, 0) + v_short,
      last_action_by = v_actor::text, last_action_at = now(),
      metadata = metadata || jsonb_build_object('shortClose', jsonb_build_object('reason', v_reason, 'returnToNeed', v_return,
        'shortStockQty', round(v_short, 3), 'at', now(), 'by', (select name from public.users where id = v_actor)))
  where id = v_po.id returning * into v_po;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'close_short', v_actor, v_reason, jsonb_build_object('returnToNeed', v_return, 'shortStockQty', v_short));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'status', v_po.status, 'shortStockQty', v_short, 'returnToNeed', v_return);
end;
$$;

revoke all on function app_private.procurement_po_line_link_total(text, text), app_private.procurement_link_received(text, jsonb, text, numeric),
  app_private.procurement_po_open_delivery_statuses(), app_private.procurement_po_has_open_delivery(text),
  app_private.procurement_po_line_undelivered(text, jsonb, text), app_private.procurement_po_awaits_me(text, text, text, text),
  app_private.procurement_po_committed_amount(text, uuid), app_private.procurement_po_deliveries(text)
  from public, anon, authenticated;
revoke all on function public.save_procurement_delivery_v1(jsonb), public.decide_procurement_delivery_v1(jsonb),
  public.cancel_procurement_delivery_v1(jsonb), public.close_procurement_po_short_v1(jsonb) from public, anon;
grant execute on function public.save_procurement_delivery_v1(jsonb), public.decide_procurement_delivery_v1(jsonb),
  public.cancel_procurement_delivery_v1(jsonb), public.close_procurement_po_short_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
