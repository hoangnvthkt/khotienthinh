-- ===========================================================================
-- M2d — Đơn chủ động tại Mua hàng (02/10/2026)
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 02/10):
-- * Mua hàng tự lập PO khi chưa có phiếu nhu cầu, cho MỘT dự án, nhận vào kho công trường của dự án đó.
--   source_mode = 'proactive_project', metadata.channel = 'procurement_hub',
--   metadata.proactive = {purpose:'project', reasonCode, reason, overBoqReason}.
--   Lý do bắt buộc: price_lock (chốt giá tốt), long_lead (hàng đặt dài ngày), min_stock (bù tồn tối thiểu), other (khác, phải ghi rõ).
-- * Dự trữ Kho Tổng (không gắn dự án) CHƯA mở: công nợ NCC hiện bắt buộc gắn dự án/công trường và chi phí dự án
--   được ghi ngay khi nhận hàng. Mở cùng K3a (công nợ cấp công ty, chi phí ghi khi xuất cho dự án).
-- * Vượt BOQ hoặc vật tư ngoài BOQ của dự án: vẫn lập được nhưng bắt buộc lý do. Mỗi dòng lưu ảnh chụp
--   {status, boqQty, orderedBefore} lúc lưu để truy vết vì sao đơn được lập.
-- * Duyệt như PO thường: gửi người có quyền Mua hàng — Quản trị/Admin, không tự duyệt; giao 1 lần/nhiều đợt như M3.
-- * Chống mua trùng: nhu cầu mới (đề xuất/KH vật tư) cùng dự án, cùng vật tư được GẮN vào phần chưa phân bổ của
--   đơn chủ động thay vì lập đơn mới. Gắn/gỡ ghi nhật ký cả hai phía (đơn, nhu cầu); gỡ bắt buộc lý do.
--   Hàng về chia cho nhu cầu đã gắn trước (procurement_link_received chia theo tổng SL đã gắn).
--   Giảm trừ do trả NCC trừ vào phần CHƯA phân bổ trước, rồi mới tới nhu cầu đã gắn.
-- * Đơn chủ động chỉ sửa bằng màn đơn chủ động, không đổi dự án, không giảm SL dòng xuống dưới phần đã gắn.
-- * Đơn bị trả lại/hủy thì nhu cầu đã gắn tự quay về "Cần mua" (như PO thường); xóa nháp thì xóa luôn liên kết.
-- ===========================================================================

-- SL theo đơn vị kho của một dòng PO (dòng cũ không có stockQty: qty × hệ số).
create function app_private.procurement_po_line_stock_qty(p_line jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce(nullif(p_line->>'stockQty', '')::numeric,
    coalesce(nullif(p_line->>'qty', '')::numeric, 0) * coalesce(nullif(nullif(p_line->>'purchaseConversionFactor', '')::numeric, 0), 1));
$$;

-- Giảm trừ (trả NCC) ăn vào phần chưa phân bổ của dòng trước, phần còn lại chia cho nhu cầu theo SL đã gắn.
create or replace function app_private.procurement_link_credited(p_po_id text, p_line_id text, p_ordered numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  with t as (select nullif(app_private.procurement_po_line_link_total(p_po_id, p_line_id), 0) n),
  c as (select r.stock_qty from app_private.procurement_po_line_returned(p_po_id, p_line_id, 'credit') r),
  line as (select app_private.procurement_po_line_stock_qty(x.value) stock_qty
    from public.purchase_orders o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
    where o.id = p_po_id and coalesce(x.value->>'lineId', x.value->>'itemId') = p_line_id limit 1)
  select coalesce((select least(p_ordered,
      greatest(c.stock_qty - greatest(coalesce(line.stock_qty, 0) - t.n, 0), 0) * p_ordered / t.n)
    from t cross join c left join line on true), 0);
$$;

-- BOQ vật tư của dự án và SL đã đặt ở các PO khác (đơn vị kho). Đơn đã kết thúc thiếu tính theo SL đã nhận.
create function app_private.procurement_project_item_boq(p_project_id text, p_item_id text, p_except_po text)
returns table (boq_qty numeric, ordered_qty numeric, in_boq boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(m.budget_qty) from public.material_budget_items m
      where m.project_id = p_project_id and m.inventory_item_id = p_item_id), 0),
    coalesce((select sum(case when o.status = 'closed'
        then least(app_private.procurement_po_line_stock_qty(x.value),
          coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0)
            * coalesce(nullif(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 0), 1))
        else app_private.procurement_po_line_stock_qty(x.value) end)
      from public.purchase_orders o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
      where o.project_id = p_project_id and o.archived_at is null and o.status not in ('cancelled', 'returned')
        and o.id is distinct from p_except_po and x.value->>'itemId' = p_item_id), 0),
    exists (select 1 from public.material_budget_items m where m.project_id = p_project_id and m.inventory_item_id = p_item_id);
$$;

create function app_private.procurement_proactive_linkable(p_status text)
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('draft', 'sent', 'confirmed', 'in_transit', 'partial', 'delivered');
$$;

-- ---------------------------------------------------------------------------
-- Dự án + kho công trường mà Mua hàng được lập đơn chủ động
-- ---------------------------------------------------------------------------
create function public.list_procurement_proactive_options_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  return jsonb_build_object('projects', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'code', p.code, 'name', p.name, 'status', p.status, 'warehouses', w.list)
      order by case when p.status = 'active' then 0 else 1 end, p.code nulls last, p.name)
    from public.projects p
    cross join lateral (select jsonb_agg(jsonb_build_object('id', wh.id, 'name', wh.name)
        order by coalesce(wh.is_default_for_site, false) desc, wh.name) list
      from public.warehouses wh
      where not coalesce(wh.is_archived, false) and wh.type = 'SITE'
        and (wh.project_id = p.id or (p.construction_site_id is not null and wh.construction_site_id = p.construction_site_id))) w
    where w.list is not null and coalesce(p.status, '') <> 'cancelled'), '[]'::jsonb));
end;
$$;

-- Tìm vật tư để lập đơn chủ động; không gõ gì thì gợi ý vật tư trong BOQ của dự án.
create function public.search_procurement_items_v1(p_project_id text, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_words text[] := array(select w from regexp_split_to_table(lower(btrim(coalesce(p_search, ''))), '\s+') w where w <> '');
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'sku', q.sku, 'unit', q.unit,
      'purchaseUnit', q.purchase_unit, 'purchaseFactor', q.factor,
      'inBoq', b.in_boq, 'boqQty', b.boq_qty, 'orderedQty', b.ordered_qty) order by b.in_boq desc, q.name)
    from (
      select i.id, i.name, i.sku, i.unit,
        case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
          and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
        nullif(i.purchase_conversion_factor, 0) factor,
        exists (select 1 from public.material_budget_items m where m.project_id = p_project_id and m.inventory_item_id = i.id) boq_hit
      from public.items i
      where case when cardinality(v_words) = 0
        then exists (select 1 from public.material_budget_items m where m.project_id = p_project_id and m.inventory_item_id = i.id)
        else not exists (select 1 from unnest(v_words) w where position(w in lower(concat_ws(' ', i.name, i.sku))) = 0) end
      order by 7 desc, i.name limit 40
    ) q cross join lateral app_private.procurement_project_item_boq(p_project_id, q.id, null) b), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lập / sửa đơn chủ động
-- ---------------------------------------------------------------------------
create function public.save_procurement_proactive_po_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  select * into v_project from public.projects where id = nullif(p_input->>'projectId', '');
  if not found or v_project.status = 'cancelled' then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_REQUIRED'; end if;
  select * into v_wh from public.warehouses w
  where w.id = nullif(p_input->>'targetWarehouseId', '') and not coalesce(w.is_archived, false) and w.type = 'SITE'
    and (w.project_id = v_project.id or (v_project.construction_site_id is not null and w.construction_site_id = v_project.construction_site_id));
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  if v_po_id is not null then
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null
      or v_po.source_mode <> 'proactive_project' then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_po.project_id is distinct from v_project.id then
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
    v_status := case when not v_boq.in_boq then 'outside'
      when v_boq.ordered_qty + v_stock > v_boq.boq_qty * 1.0001 + 0.0005 then 'over' else 'within' end;
    if v_status <> 'within' then v_over := v_over + 1; end if;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_stock / v_pqty, 12), 'stockQty', v_stock,
      'qty', v_pqty, 'unitPrice', v_price, 'note', nullif(btrim(it->>'note'), ''),
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

  v_meta := jsonb_strip_nulls(jsonb_build_object('purpose', 'project', 'reasonCode', v_reason_code, 'reason', v_reason,
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
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', 'proactive_project', v_mode, 'RECEIVE_TO_STOCK',
      v_wh.id, nullif(btrim(p_input->>'note'), ''), v_actor::text, 'Đơn chủ động lập tại Mua hàng',
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

-- ---------------------------------------------------------------------------
-- Gắn nhu cầu vào đơn chủ động (chống mua trùng)
-- ---------------------------------------------------------------------------
create function public.list_procurement_proactive_candidates_v1(p_source_type text, p_source_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_doc record;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select d.* into v_doc from app_private.procurement_inbox_documents() d
  where d.source_type = p_source_type and d.source_id = p_source_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  if v_doc.closed_at is not null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'needLineId', l.line_id, 'itemId', l.item_id, 'itemName', l.item_name, 'unit', l.unit,
      'remainingQty', round(greatest(l.need_qty - l.ordered_qty, 0), 6),
      'purchaseOrderId', o.id, 'poNumber', o.po_number, 'status', o.status, 'vendorName', o.vendor_name,
      'expectedDeliveryDate', app_private.procurement_date_or_null(o.expected_delivery_date),
      'poLineId', x.value->>'lineId',
      'lineStockQty', app_private.procurement_po_line_stock_qty(x.value),
      'unallocatedQty', round(app_private.procurement_po_line_stock_qty(x.value) - app_private.procurement_po_line_link_total(o.id, x.value->>'lineId'), 6),
      'reasonCode', o.metadata->'proactive'->>'reasonCode') order by l.item_name, o.po_number)
    from app_private.procurement_inbox_lines() l
    join public.purchase_orders o on o.source_mode = 'proactive_project' and app_private.procurement_po_is_hub(o.metadata)
      and o.archived_at is null and app_private.procurement_proactive_linkable(o.status)
      and o.project_id = v_doc.project_id
      and (v_doc.construction_site_id is null or o.construction_site_id is null or o.construction_site_id = v_doc.construction_site_id)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
    where l.source_type = p_source_type and l.source_id = p_source_id
      and x.value->>'itemId' = l.item_id and l.need_qty - l.ordered_qty > 0.0005
      and app_private.procurement_po_line_stock_qty(x.value) - app_private.procurement_po_line_link_total(o.id, x.value->>'lineId') > 0.0005
      and not exists (select 1 from public.purchase_order_request_lines k where p_source_type = 'material_request'
        and k.purchase_order_id = o.id and k.material_request_id = p_source_id and k.request_line_id = l.line_id)
      and not exists (select 1 from public.procurement_po_plan_links k where p_source_type = 'material_plan'
        and k.purchase_order_id = o.id and k.material_plan_line_id::text = l.line_id)), '[]'::jsonb);
end;
$$;

create function public.link_procurement_proactive_need_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := coalesce(nullif(p_input->>'action', ''), 'link');
  v_source_type text := p_input->>'sourceType';
  v_source_id text := p_input->>'sourceId';
  v_need_line text := p_input->>'lineId';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_qty numeric := nullif(p_input->>'qty', '')::numeric;
  v_po public.purchase_orders%rowtype; v_line jsonb; v_doc record; v_need record; v_unallocated numeric; v_removed numeric;
  v_payload jsonb;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_source_type not in ('material_request', 'material_plan') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null
    or v_po.source_mode <> 'proactive_project' then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if not app_private.procurement_proactive_linkable(v_po.status) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_LINK_STATE'; end if;
  select x.value into v_line from jsonb_array_elements(v_po.items) x where x.value->>'lineId' = p_input->>'poLineId';
  if v_line is null then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_LINE_INVALID'; end if;
  select d.* into v_doc from app_private.procurement_inbox_documents() d
  where d.source_type = v_source_type and d.source_id = v_source_id;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_action = 'link' then
    if v_doc.closed_at is not null then raise exception using errcode = '22023', message = 'PROCUREMENT_NEED_CLOSED'; end if;
    if v_doc.project_id is distinct from v_po.project_id or (v_doc.construction_site_id is not null
      and v_po.construction_site_id is not null and v_doc.construction_site_id <> v_po.construction_site_id) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;
    select l.* into v_need from app_private.procurement_inbox_lines() l
    where l.source_type = v_source_type and l.source_id = v_source_id and l.line_id = v_need_line;
    if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
    if v_need.item_id is distinct from v_line->>'itemId' then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_ITEM_MISMATCH'; end if;
    if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_qty > greatest(v_need.need_qty - v_need.ordered_qty, 0) + 0.0005 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_OVER_NEED'; end if;
    v_unallocated := app_private.procurement_po_line_stock_qty(v_line) - app_private.procurement_po_line_link_total(v_po.id, v_line->>'lineId');
    if v_qty > v_unallocated + 0.0005 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_OVER_UNALLOCATED'; end if;
    if exists (select 1 from public.purchase_order_request_lines k where v_source_type = 'material_request'
        and k.purchase_order_id = v_po.id and k.material_request_id = v_source_id and k.request_line_id = v_need_line)
      or exists (select 1 from public.procurement_po_plan_links k where v_source_type = 'material_plan'
        and k.purchase_order_id = v_po.id and k.material_plan_line_id::text = v_need_line) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
    if v_source_type = 'material_request' then
      insert into public.purchase_order_request_lines (project_id, construction_site_id, source_construction_site_id,
        target_warehouse_id, allocation_status, purchase_order_id, purchase_order_line_id, material_request_id,
        material_request_code, request_line_id, item_id, work_boq_item_id, material_budget_item_id, requested_qty,
        ordered_qty, requested_qty_snapshot, ordered_stock_qty_snapshot, actual_received_qty_snapshot, unit)
      select v_po.project_id, v_po.construction_site_id, v_doc.construction_site_id, v_po.target_warehouse_id, 'open', v_po.id,
        v_line->>'lineId', v_source_id, v_doc.code, v_need_line, v_need.item_id,
        (select b.id from public.project_work_boq_items b where b.id = x.value->>'workBoqItemId'),
        (select b.id from public.material_budget_items b where b.id = x.value->>'materialBudgetItemId'),
        v_need.need_qty, v_qty, v_need.need_qty, v_qty, 0, v_need.unit
      from public.requests r cross join lateral jsonb_array_elements(r.items) x
      where r.id = v_source_id and x.value->>'lineId' = v_need_line limit 1;
    else
      insert into public.procurement_po_plan_links (purchase_order_id, purchase_order_line_id, material_plan_id,
        material_plan_line_id, item_id, ordered_qty)
      values (v_po.id, v_line->>'lineId', v_source_id::uuid, v_need_line::uuid, v_need.item_id, v_qty);
    end if;
  elsif v_action = 'unlink' then
    if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_UNLINK_REASON_REQUIRED'; end if;
    if v_source_type = 'material_request' then
      delete from public.purchase_order_request_lines k
      where k.purchase_order_id = v_po.id and k.purchase_order_line_id = v_line->>'lineId'
        and k.material_request_id = v_source_id and k.request_line_id = v_need_line
      returning k.ordered_qty into v_removed;
    else
      delete from public.procurement_po_plan_links k
      where k.purchase_order_id = v_po.id and k.purchase_order_line_id = v_line->>'lineId' and k.material_plan_line_id::text = v_need_line
      returning k.ordered_qty into v_removed;
    end if;
    if v_removed is null then raise exception using errcode = '22023', message = 'PROCUREMENT_LINK_NOT_FOUND'; end if;
    v_qty := v_removed;
  else
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID';
  end if;
  v_payload := jsonb_build_object('sourceType', v_source_type, 'sourceId', v_source_id, 'sourceCode', v_doc.code,
    'needLineId', v_need_line, 'poLineId', v_line->>'lineId', 'itemId', v_line->>'itemId', 'qty', v_qty, 'poNumber', v_po.po_number);
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload) values
    ('purchase_order', v_po.id, v_action || '_need', v_actor, v_reason, v_payload),
    ('need', v_source_type || ':' || v_source_id, v_action || '_proactive_po', v_actor, v_reason, v_payload || jsonb_build_object('purchaseOrderId', v_po.id));
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'action', v_action, 'qty', v_qty);
end;
$$;

-- ---------------------------------------------------------------------------
-- Danh sách / chi tiết đơn: thêm loại đơn (nhu cầu / chủ động), SL kho, đã gắn, ảnh chụp BOQ, quyền gắn.
-- Lưu đơn từ nhu cầu: chặn sửa đơn chủ động bằng màn này.
-- ---------------------------------------------------------------------------
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
    -- Đơn chủ động (M2d) chỉ sửa bằng save_procurement_proactive_po_v1 để giữ liên kết nhu cầu đã gắn.
    if v_po.source_mode = 'proactive_project' then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PROACTIVE_USE_EDITOR'; end if;
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
          'kind', case when f.source_mode = 'proactive_project' then 'proactive' else 'need' end,
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
    'purchaseMode', v_po.purchase_mode,
    'kind', case when v_po.source_mode = 'proactive_project' then 'proactive' else 'need' end, 'proactive', v_po.metadata->'proactive', 'approvedTotalAmount', v_po.approved_total_amount, 'shortClose', v_po.metadata->'shortClose',
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

revoke all on function app_private.procurement_po_line_stock_qty(jsonb), app_private.procurement_project_item_boq(text, text, text),
  app_private.procurement_proactive_linkable(text) from public, anon, authenticated;
revoke all on function public.list_procurement_proactive_options_v1(), public.search_procurement_items_v1(text, text),
  public.save_procurement_proactive_po_v1(jsonb), public.list_procurement_proactive_candidates_v1(text, text),
  public.link_procurement_proactive_need_v1(jsonb) from public, anon;
grant execute on function public.list_procurement_proactive_options_v1(), public.search_procurement_items_v1(text, text),
  public.save_procurement_proactive_po_v1(jsonb), public.list_procurement_proactive_candidates_v1(text, text),
  public.link_procurement_proactive_need_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
