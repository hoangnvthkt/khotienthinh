-- Một mã vật tư nhiều quy cách: đơn chủ động, gọi hàng theo HĐ, đơn từ phiếu nhu cầu. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261010090000_procurement_same_item_multi_spec.sql --smoke supabase/tests/procurement_same_item_multi_spec_smoke.sql
do $$
declare v_admin record; v_vendor text; v_wh record; v_item record; v_r jsonb; v_po public.purchase_orders%rowtype; v_failed text;
  v_c text := 'smoke-ctr-' || gen_random_uuid(); v_l1 uuid; v_l2 uuid; v_need record;
begin
  select u.id, u.auth_id into v_admin from public.users u where u.is_active and u.auth_id is not null
    and app_private.has_permission(u.id, 'system.procurement.manage') order by u.id limit 1;
  select b.id into v_vendor from public.business_partners b where b.is_active order by b.id limit 1;
  select w.id, w.project_id into v_wh from public.warehouses w join public.projects p on p.id = w.project_id
  where w.type = 'SITE' and not coalesce(w.is_archived, false) and p.status <> 'cancelled' order by w.id limit 1;
  select i.id, i.sku into v_item from public.items i where i.status = 'active' and nullif(btrim(i.purchase_unit), '') is null order by i.sku limit 1;
  if v_admin.id is null or v_vendor is null or v_wh.id is null or v_item.id is null then raise exception 'SMOKE_SETUP thiếu dữ liệu'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin.auth_id, 'role', 'authenticated')::text, true);

  -- 1. Đơn chủ động: cùng mã, hai quy cách, hai giá.
  v_r := public.save_procurement_proactive_po_v1(jsonb_build_object('projectId', v_wh.project_id, 'targetWarehouseId', v_wh.id,
    'vendorId', v_vendor, 'reasonCode', 'other', 'reason', 'smoke', 'overBoqReason', 'smoke', 'items', jsonb_build_array(
      jsonb_build_object('itemId', v_item.id, 'stockQty', 2, 'unitPrice', 100000, 'specification', 'Loại 1'),
      jsonb_build_object('itemId', v_item.id, 'stockQty', 3, 'unitPrice', 200000, 'specification', 'Loại 2'))));
  select * into v_po from public.purchase_orders where id = v_r->>'purchaseOrderId';
  if jsonb_array_length(v_po.items) <> 2 or v_po.total_amount <> 800000
    or v_po.items->1->>'specification' <> 'Loại 2' or (v_po.items->1->>'unitPrice')::numeric <> 200000 then
    raise exception 'FAIL proactive: %', v_po.items; end if;
  if (v_po.items->1->'boq'->>'orderedBefore')::numeric <> (v_po.items->0->'boq'->>'orderedBefore')::numeric + 2 then
    raise exception 'FAIL proactive BOQ cộng dồn: %', v_po.items; end if;
  v_failed := null;
  begin perform public.save_procurement_proactive_po_v1(jsonb_build_object('projectId', v_wh.project_id, 'targetWarehouseId', v_wh.id,
    'vendorId', v_vendor, 'reasonCode', 'other', 'reason', 'smoke', 'overBoqReason', 'smoke', 'items', jsonb_build_array(
      jsonb_build_object('itemId', v_item.id, 'stockQty', 2, 'unitPrice', 1, 'specification', 'loại 1'),
      jsonb_build_object('itemId', v_item.id, 'stockQty', 3, 'unitPrice', 2, 'specification', ' Loại 1 '))));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'PROCUREMENT_PO_DUPLICATE_SPEC' then raise exception 'FAIL proactive trùng quy cách: %', v_failed; end if;

  -- 2. Bảng giá HĐ: một mã hai dòng giá theo quy cách, cùng hiệu lực.
  insert into public.supplier_contracts (id, code, name, supplier_id, supplier_name, status)
  values (v_c, 'SMOKE-HD', 'Smoke HĐ nguyên tắc', v_vendor, 'Smoke', 'active');
  perform public.save_procurement_contract_lines_v1(jsonb_build_object('contractId', v_c, 'lines', jsonb_build_array(
    jsonb_build_object('itemId', v_item.id, 'unitPrice', 94000, 'vatRate', 8, 'specification', 'Tôn biên và tôn hồi 13 sóng'),
    jsonb_build_object('itemId', v_item.id, 'unitPrice', 90000, 'vatRate', 8, 'specification', 'Tôn mái'))));
  select id into v_l1 from public.supplier_contract_lines where supplier_contract_id = v_c and specification = 'Tôn biên và tôn hồi 13 sóng';
  select id into v_l2 from public.supplier_contract_lines where supplier_contract_id = v_c and specification = 'Tôn mái';
  if v_l1 is null or v_l2 is null then raise exception 'FAIL: chưa lưu quy cách dòng giá HĐ'; end if;
  v_failed := null;
  begin perform public.save_procurement_contract_lines_v1(jsonb_build_object('contractId', v_c, 'lines', jsonb_build_array(
    jsonb_build_object('itemId', v_item.id, 'unitPrice', 1, 'vatRate', 8, 'specification', 'tôn mái'))));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'PROCUREMENT_CONTRACT_PRICE_OVERLAP' then raise exception 'FAIL HĐ trùng quy cách cùng hiệu lực: %', v_failed; end if;
  if (select count(*) from jsonb_array_elements(public.get_procurement_contract_v1(v_c)->'priceLines') x where x->>'specification' is not null) <> 2 then
    raise exception 'FAIL: chi tiết HĐ chưa trả quy cách'; end if;

  -- 3. Gọi hàng theo HĐ: chọn đúng dòng giá từng quy cách.
  v_r := public.save_procurement_contract_order_v1(jsonb_build_object('contractId', v_c, 'targetWarehouseId', v_wh.id, 'items', jsonb_build_array(
    jsonb_build_object('itemId', v_item.id, 'qty', 10, 'contractLineId', v_l1),
    jsonb_build_object('itemId', v_item.id, 'qty', 5, 'contractLineId', v_l2))));
  select * into v_po from public.purchase_orders where id = v_r->>'purchaseOrderId';
  if jsonb_array_length(v_po.items) <> 2 or v_po.total_amount <> 940000 + 450000
    or v_po.items->0->>'specification' <> 'Tôn biên và tôn hồi 13 sóng' or v_po.items->1->>'contractLineId' <> v_l2::text then
    raise exception 'FAIL contract order: %', v_po.items; end if;
  v_failed := null;
  begin perform public.save_procurement_contract_order_v1(jsonb_build_object('contractId', v_c, 'targetWarehouseId', v_wh.id, 'items', jsonb_build_array(
    jsonb_build_object('itemId', v_item.id, 'qty', 1, 'contractLineId', v_l1),
    jsonb_build_object('itemId', v_item.id, 'qty', 1, 'contractLineId', v_l1))));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'PROCUREMENT_PO_DUPLICATE_SPEC' then raise exception 'FAIL contract trùng dòng giá: %', v_failed; end if;

  -- 4. Đơn từ phiếu nhu cầu: hai dòng nhu cầu cùng mã → hai dòng đơn, hai quy cách, hai giá.
  select l.item_id, min(l.source_id || '|' || l.line_id) a, max(l.source_id || '|' || l.line_id) b,
    min(least(l.need_qty - l.ordered_qty, 1)) q into v_need
  from app_private.procurement_inbox_lines() l join app_private.procurement_inbox_documents() d using (source_type, source_id)
  where l.source_type = 'material_request' and l.need_qty - l.ordered_qty > 0.01 and d.closed_at is null
  group by l.item_id, d.project_id having count(*) > 1 order by l.item_id limit 1;
  if v_need.item_id is null then raise notice 'Bỏ qua phần đơn từ nhu cầu: không có hai dòng nhu cầu cùng mã đang mở';
  else
    v_r := public.save_procurement_hub_po_v1(jsonb_build_object('vendorId', v_vendor, 'items', jsonb_build_array(
      jsonb_build_object('itemId', v_need.item_id, 'unitPrice', 100000, 'specification', 'Loại 1', 'allocations', jsonb_build_array(jsonb_build_object(
        'sourceType', 'material_request', 'sourceId', split_part(v_need.a, '|', 1), 'lineId', split_part(v_need.a, '|', 2), 'qty', v_need.q))),
      jsonb_build_object('itemId', v_need.item_id, 'unitPrice', 200000, 'specification', 'Loại 2', 'allocations', jsonb_build_array(jsonb_build_object(
        'sourceType', 'material_request', 'sourceId', split_part(v_need.b, '|', 1), 'lineId', split_part(v_need.b, '|', 2), 'qty', v_need.q))))));
    select * into v_po from public.purchase_orders where id = v_r->>'purchaseOrderId';
    if jsonb_array_length(v_po.items) <> 2 or v_po.items->1->>'specification' <> 'Loại 2' or (v_po.items->1->>'unitPrice')::numeric <> 200000 then
      raise exception 'FAIL from-request: %', v_po.items; end if;
    if (select count(distinct purchase_order_line_id) from public.purchase_order_request_lines where purchase_order_id = v_po.id) <> 2 then
      raise exception 'FAIL from-request: phân bổ chưa tách theo dòng đơn'; end if;
    v_failed := null;
    begin perform public.save_procurement_hub_po_v1(jsonb_build_object('vendorId', v_vendor, 'items', jsonb_build_array(
      jsonb_build_object('itemId', v_need.item_id, 'unitPrice', 1, 'allocations', jsonb_build_array(jsonb_build_object(
        'sourceType', 'material_request', 'sourceId', split_part(v_need.a, '|', 1), 'lineId', split_part(v_need.a, '|', 2), 'qty', v_need.q))),
      jsonb_build_object('itemId', v_need.item_id, 'unitPrice', 2, 'allocations', jsonb_build_array(jsonb_build_object(
        'sourceType', 'material_request', 'sourceId', split_part(v_need.b, '|', 1), 'lineId', split_part(v_need.b, '|', 2), 'qty', v_need.q))))));
    exception when others then v_failed := sqlerrm; end;
    if v_failed is distinct from 'PROCUREMENT_PO_DUPLICATE_SPEC' then raise exception 'FAIL from-request trùng quy cách: %', v_failed; end if;
    if not exists (select 1 from jsonb_array_elements(public.get_procurement_inbox_document_v1('material_request', split_part(v_need.a, '|', 1))->'lines') x
        where x ? 'specification') then raise exception 'FAIL: chi tiết phiếu chưa có khóa specification'; end if;
  end if;
  raise notice 'procurement same item multi spec smoke OK';
end $$;
