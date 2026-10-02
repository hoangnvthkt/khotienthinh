-- ===========================================================================
-- Mua hàng — quy cách hiển thị trên dòng đơn chủ động + dữ liệu cho mẫu in "Đề nghị duyệt đơn hàng" (02/10/2026)
--
-- Luật nghiệp vụ (chủ sản phẩm 02/10):
-- * Khi lập đơn chủ động, cạnh tên chính thức của vật tư có ô "quy cách / cấu hình" (VD VT00035 "Gạch đặc Tuynel" + "KT 30x30").
--   Chỉ để hiển thị trên đơn gửi NCC và mẫu in; nhập kho, tồn kho, BOQ vẫn tính theo mã vật tư gốc.
-- * Chi tiết đơn trả thêm chức danh người lập (hồ sơ nhân sự) để in mục "Chức vụ" trên đề nghị duyệt.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.save_procurement_proactive_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_project public.projects%rowtype;
  v_wh public.warehouses%rowtype;
  v_vendor record; v_item record; v_boq record;
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
  v_reason_code text := nullif(p_input->>'reasonCode', '');
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_over_reason text := nullif(btrim(p_input->>'overBoqReason'), '');
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_over integer := 0; v_seen text[] := '{}';
  v_purpose text := case when p_input->>'purpose' = 'stock' then 'stock' else 'project' end;
  it jsonb; v_line_id text; v_stock numeric; v_pqty numeric; v_punit text; v_price numeric; v_status text; v_meta jsonb;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_reason_code is null or v_reason_code not in ('price_lock', 'long_lead', 'min_stock', 'other')
    or (v_reason_code = 'other' and v_reason is null) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_REASON_REQUIRED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;
  select b.id, b.name into v_vendor from public.business_partners b
  where b.id = nullif(p_input->>'vendorId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;
  if v_purpose = 'project' then
    select * into v_project from public.projects where id = nullif(p_input->>'projectId', '');
    if not found or v_project.status = 'cancelled' then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_REQUIRED'; end if;
    select * into v_wh from public.warehouses w
    where w.id = nullif(p_input->>'targetWarehouseId', '') and not coalesce(w.is_archived, false) and w.type = 'SITE'
      and (w.project_id = v_project.id or (v_project.construction_site_id is not null and w.construction_site_id = v_project.construction_site_id));
  else
    -- Dự trữ Kho Tổng: không gắn dự án; công nợ cấp công ty, chi phí vào dự án khi chuyển kho.
    select * into v_wh from public.warehouses w
    where w.id = nullif(p_input->>'targetWarehouseId', '') and not coalesce(w.is_archived, false) and w.type = 'GENERAL';
  end if;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  if v_po_id is not null then
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null
      or v_po.source_mode not in ('proactive_project', 'proactive_stock') then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_po.project_id is distinct from v_project.id
      or v_po.source_mode <> (case v_purpose when 'stock' then 'proactive_stock' else 'proactive_project' end) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_LOCKED'; end if;
  end if;

  for it in select value from jsonb_array_elements(p_input->'items') loop
    select i.id, i.name, i.sku, i.unit,
      case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
        and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
      coalesce(nullif(i.purchase_conversion_factor, 0), 1) factor
    into v_item from public.items i where i.id = it->>'itemId';
    if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_ITEM_NOT_FOUND'; end if;
    if v_item.id = any (v_seen) then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
    v_seen := v_seen || v_item.id;
    v_stock := nullif(it->>'stockQty', '')::numeric;
    v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
    if v_stock is null or v_stock <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    v_punit := coalesce(nullif(btrim(it->>'purchaseUnit'), ''), v_item.purchase_unit, v_item.unit);
    v_pqty := case when nullif(it->>'purchaseQty', '') is not null then (it->>'purchaseQty')::numeric
      when v_item.purchase_unit is not null and v_punit = v_item.purchase_unit then round(v_stock / v_item.factor, 6)
      else v_stock end;
    if v_pqty is null or v_pqty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    v_line_id := nullif(it->>'lineId', '');
    if v_line_id is not null and (v_po_id is null or not exists (select 1 from jsonb_array_elements(v_po.items) x
        where x.value->>'lineId' = v_line_id and x.value->>'itemId' = v_item.id)) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_LINE_INVALID'; end if;
    v_line_id := coalesce(v_line_id, 'mh-' || gen_random_uuid());
    select * into v_boq from app_private.procurement_project_item_boq(v_project.id, v_item.id, v_po_id);
    v_status := case when v_purpose = 'stock' then 'stock' when not v_boq.in_boq then 'outside'
      when v_boq.ordered_qty + v_stock > v_boq.boq_qty * 1.0001 + 0.0005 then 'over' else 'within' end;
    if v_status not in ('within', 'stock') then v_over := v_over + 1; end if;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_stock / v_pqty, 12), 'stockQty', v_stock,
      'qty', v_pqty, 'unitPrice', v_price, 'note', nullif(btrim(it->>'note'), ''),
      -- Quy cách / cấu hình hiển thị cạnh tên vật tư trên đơn và mẫu in; kho vẫn theo mã vật tư gốc.
      'specification', nullif(left(btrim(coalesce(it->>'specification', '')), 160), ''),
      'boq', jsonb_build_object('status', v_status, 'boqQty', v_boq.boq_qty, 'orderedBefore', v_boq.ordered_qty))));
    v_total := v_total + v_pqty * v_price;
  end loop;
  if v_over > 0 and v_over_reason is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_OVER_BOQ_REASON'; end if;

  -- Dòng đã gắn nhu cầu phải còn, cùng vật tư, và SL không nhỏ hơn phần đã gắn.
  if v_po_id is not null and exists (
    select 1 from (select s.purchase_order_line_id line_id, s.item_id, sum(s.ordered_qty) q from (
        select purchase_order_line_id, item_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po_id
        union all
        select purchase_order_line_id, item_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po_id) s
      group by 1, 2) a
    where not exists (select 1 from jsonb_array_elements(v_items) x
      where x.value->>'lineId' = a.line_id and x.value->>'itemId' = a.item_id and (x.value->>'stockQty')::numeric >= a.q - 0.0005)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_ALLOCATED'; end if;

  v_meta := jsonb_strip_nulls(jsonb_build_object('purpose', v_purpose, 'reasonCode', v_reason_code, 'reason', v_reason,
    'overBoqReason', case when v_over > 0 then v_over_reason end));
  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, note, created_by_id, approval_request_title, metadata)
    values (v_po_id, v_project.id, coalesce(v_wh.construction_site_id::text, v_project.construction_site_id::text),
      v_vendor.id, v_vendor.name, public.next_purchase_order_number_v2(), v_items,
      v_total, v_vat, to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', case v_purpose when 'stock' then 'proactive_stock' else 'proactive_project' end, v_mode, 'RECEIVE_TO_STOCK',
      v_wh.id, nullif(btrim(p_input->>'note'), ''), v_actor::text, case v_purpose when 'stock' then 'Đơn dự trữ Kho Tổng lập tại Mua hàng' else 'Đơn chủ động lập tại Mua hàng' end,
      jsonb_build_object('channel', 'procurement_hub', 'proactive', v_meta))
    returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
    values ('purchase_order', v_po_id, 'create', v_actor, v_reason,
      jsonb_build_object('kind', 'proactive', 'reasonCode', v_reason_code, 'overBoq', v_over, 'overBoqReason', v_over_reason));
  else
    update public.purchase_orders set vendor_id = v_vendor.id, vendor_name = v_vendor.name, items = v_items,
      total_amount = v_total, vat_rate = v_vat, purchase_mode = v_mode,
      expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''), target_warehouse_id = v_wh.id,
      note = nullif(btrim(p_input->>'note'), ''), metadata = (metadata - 'proactive') || jsonb_build_object('proactive', v_meta)
    where id = v_po_id returning * into v_po;
    update public.purchase_order_request_lines set target_warehouse_id = v_wh.id where purchase_order_id = v_po_id;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
    values ('purchase_order', v_po_id, 'update', v_actor, v_reason,
      jsonb_build_object('kind', 'proactive', 'reasonCode', v_reason_code, 'overBoq', v_over, 'overBoqReason', v_over_reason));
  end if;
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items), 'overBoq', v_over);
end;
$$;

CREATE OR REPLACE FUNCTION public.get_procurement_order_v1(p_po_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
    'kind', case when v_po.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end, 'proactive', v_po.metadata->'proactive', 'approvedTotalAmount', v_po.approved_total_amount, 'shortClose', v_po.metadata->'shortClose',
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
$$;

notify pgrst, 'reload schema';
