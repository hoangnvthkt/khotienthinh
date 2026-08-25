-- MR -> PO -> delivery batch -> receipt v3 smoke test.
-- Always run in a transaction so seeded records can be rolled back.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_orders'
      and column_name = 'procurement_flow_version'
  ) then
    raise exception 'Missing purchase_orders.procurement_flow_version';
  end if;

  if to_regclass('public.purchase_order_master_estimates') is null
    or to_regclass('public.purchase_order_master_estimate_versions') is null
    or to_regclass('public.purchase_order_receipts') is null
    or to_regclass('public.purchase_order_receipt_lines') is null
  then
    raise exception 'MR PO flow v3 foundation tables are incomplete';
  end if;

  if to_regprocedure('public.save_purchase_order_master_estimate_v1(text,boolean,jsonb,text,text,uuid)') is null
    or to_regprocedure('public.issue_purchase_order_master_estimate_v1(text,uuid)') is null
    or to_regprocedure('public.save_purchase_order_delivery_batch_draft_v2(text,uuid,date,numeric,text,text,jsonb,uuid)') is null
    or to_regprocedure('public.delete_purchase_order_delivery_batch_draft_v2(uuid,uuid)') is null
    or to_regprocedure('public.submit_purchase_order_delivery_batch_approval_v2(uuid,uuid,uuid)') is null
    or to_regprocedure('public.decide_purchase_order_delivery_batch_approval_v2(uuid,text,text,uuid)') is null
    or to_regprocedure('public.approve_purchase_order_delivery_batch_v2(uuid,uuid)') is null
    or to_regprocedure('public.record_purchase_order_receipt_v3(uuid,uuid,text,boolean,text,jsonb,jsonb,uuid)') is null
    or to_regprocedure('public.confirm_purchase_order_receipt_variance_v1(uuid,text,uuid)') is null
  then
    raise exception 'MR PO flow v3 RPC surface is incomplete';
  end if;
end;
$$;

do $$
declare
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_actor uuid := gen_random_uuid();
  v_project_id text := 'mr-po-v3-project-' || v_suffix;
  v_site_id uuid := gen_random_uuid();
  v_warehouse_id text := 'mr-po-v3-wh-' || v_suffix;
  v_item_id text := 'mr-po-v3-item-' || v_suffix;
  v_supplier_id text := 'mr-po-v3-supplier-' || v_suffix;
  v_po_id text := 'mr-po-v3-po-' || v_suffix;
  v_request_id text := 'mr-po-v3-request-' || v_suffix;
  v_request_line_id text := 'mr-po-v3-request-line-' || v_suffix;
  v_request_code text := 'MR-2099-' || lpad((abs(hashtext(v_suffix)) % 10000)::text, 4, '0');
  v_po_no text := 'PO-' || (1000000000 + floor(random() * 899999999)::bigint)::text;
  v_line_id text := 'mr-po-v3-line-' || v_suffix;
  v_batch_id uuid;
  v_over_batch_id uuid;
  v_delivery_line_id uuid;
  v_over_delivery_line_id uuid;
  v_receipt_key_1 uuid := gen_random_uuid();
  v_receipt_key_2 uuid := gen_random_uuid();
  v_result jsonb;
  v_first_wms text;
  v_second_wms text;
  v_stock numeric;
  v_count integer;
  v_recognized numeric;
  v_committed numeric;
  v_boq_received numeric;
  v_over_receipt_id uuid;
begin
  insert into public.users (
    id, name, email, username, role, is_active, account_status,
    allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
  ) values (
    v_actor, 'MR PO V3 Smoke Admin', v_actor::text || '@vioo.local',
    'mr-po-v3-' || substring(v_suffix from 1 for 12), 'ADMIN'::public.user_role,
    true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
  );
  perform set_config('request.jwt.claim.email', v_actor::text || '@vioo.local', true);
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'email', v_actor::text || '@vioo.local')::text,
    true
  );

  insert into public.hrm_construction_sites (id, name, address)
  values (v_site_id, 'MR PO V3 Smoke Site', 'Smoke');
  insert into public.projects (id, code, name, source, construction_site_id)
  values (v_project_id, 'MR-PO-V3', 'MR PO V3 Smoke', 'manual', v_site_id);
  insert into public.warehouses (
    id, name, address, type, project_id, construction_site_id, is_default_for_site
  ) values (
    v_warehouse_id, 'MR PO V3 Smoke Warehouse', 'Smoke', 'SITE',
    v_project_id, v_site_id, true
  );
  insert into public.items (
    id, sku, name, category, unit, purchase_unit,
    purchase_conversion_factor, price_in, price_out, min_stock
  ) values (
    v_item_id, 'MR-PO-V3-' || substring(v_suffix from 1 for 8),
    'Thép smoke', 'Smoke', 'Cây', 'Kg', 2, 0, 0, 0
  );
  insert into public.suppliers (id, name, contact_person, phone)
  values (v_supplier_id, 'NCC MR PO V3 Smoke', 'Smoke', '0900000000');
  insert into app_private.purchase_order_number_registry(po_number) values (v_po_no);
  insert into app_private.material_request_code_registry(code)
  values (v_request_code);
  insert into public.requests (
    id, code, site_warehouse_id, requester_id, status, items,
    created_date, expected_date, project_id, construction_site_id,
    request_origin, workflow_step
  ) values (
    v_request_id, v_request_code, v_warehouse_id, v_actor,
    'APPROVED'::public.request_status,
    jsonb_build_array(jsonb_build_object(
      'id', v_request_line_id, 'itemId', v_item_id, 'skuSnapshot', 'MR-PO-V3',
      'itemNameSnapshot', 'Thép smoke', 'requestQty', 5, 'unitSnapshot', 'Cây'
    )), now(), now() + interval '1 day', v_project_id, v_site_id::text,
    'project', 'material_department_review'
  );
  insert into public.purchase_orders (
    id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
    total_amount, order_date, status, source_mode, purchase_mode,
    procurement_flow_version, target_warehouse_id, created_by_id
  ) values (
    v_po_id, v_project_id, v_site_id::text, v_supplier_id, 'NCC MR PO V3 Smoke', v_po_no,
    jsonb_build_array(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item_id, 'sku', 'MR-PO-V3',
      'name', 'Thép smoke', 'qty', 5, 'unit', 'Cây', 'unitPrice', 0,
      'requestedQtySnapshot', 5, 'requestedUnitSnapshot', 'Cây',
      'stockUnitSnapshot', 'Cây', 'purchaseUnitSnapshot', 'Kg',
      'purchaseConversionFactor', 2, 'receivedQty', 0
    )),
    0, current_date::text, 'draft', 'from_request', 'multiple', 3,
    v_warehouse_id, v_actor::text
  );
  insert into public.purchase_order_request_lines (
    project_id, construction_site_id, purchase_order_id, purchase_order_line_id,
    material_request_id, material_request_code, request_line_id, item_id,
    requested_qty, ordered_qty, unit, target_warehouse_id,
    requested_qty_snapshot, ordered_stock_qty_snapshot, actual_received_qty_snapshot
  ) values (
    v_project_id, v_site_id::text, v_po_id, v_line_id,
    v_request_id, v_request_code, v_request_line_id, v_item_id,
    5, 5, 'Cây', v_warehouse_id, 5, 0, 0
  );

  perform public.save_purchase_order_master_estimate_v1(
    v_po_id, true,
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_line_id, 'itemId', v_item_id,
      'requestQty', 5, 'requestUnit', 'Cây', 'purchaseQty', 10,
      'purchaseUnit', 'Kg', 'purchaseUnitPrice', 100, 'vatRate', 0
    )),
    'Tháng 8/2026', 'Chỉ để in', v_actor
  );
  v_result := public.issue_purchase_order_master_estimate_v1(v_po_id, v_actor);
  if coalesce((v_result ->> 'versionNo')::integer, 0) <> 1 then
    raise exception 'Master estimate did not issue immutable version 1';
  end if;
  if exists (select 1 from public.transactions where source_id = v_po_id) then
    raise exception 'Master estimate unexpectedly created WMS';
  end if;

  v_result := public.save_purchase_order_delivery_batch_draft_v2(
    v_po_id, null, null, 0, null, 'Đợt smoke',
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_line_id, 'itemId', v_item_id,
      'requestQty', 5, 'requestUnit', 'Cây',
      'purchaseQty', 10, 'purchaseUnit', 'Kg', 'purchaseUnitPrice', 100
    )),
    v_actor
  );
  v_batch_id := (v_result ->> 'deliveryBatchId')::uuid;
  select id into v_delivery_line_id
  from public.purchase_order_delivery_lines
  where delivery_batch_id = v_batch_id;

  perform public.submit_purchase_order_delivery_batch_approval_v2(v_batch_id, v_actor, v_actor);
  v_result := public.approve_purchase_order_delivery_batch_v2(v_batch_id, v_actor);
  if coalesce(v_result ->> 'qrToken', '') = '' then
    raise exception 'Batch approval did not create a stable QR';
  end if;
  if exists (
    select 1 from public.purchase_order_delivery_batches
    where id = v_batch_id and wms_transaction_id is not null
  ) then raise exception 'Flow v3 approval unexpectedly created WMS'; end if;

  v_result := public.record_purchase_order_receipt_v3(
    v_batch_id, v_receipt_key_1, 'passed', false, null,
    jsonb_build_array(jsonb_build_object(
      'deliveryLineId', v_delivery_line_id, 'itemId', v_item_id,
      'deliveredPurchaseQty', 6, 'acceptedPurchaseQty', 6,
      'deliveredStockQty', 3, 'acceptedStockQty', 3
    )), '[]'::jsonb, v_actor
  );
  v_first_wms := v_result ->> 'wmsTransactionId';
  if v_result ->> 'financeStatus' <> 'posted' then
    raise exception 'First eligible receipt was not posted to finance';
  end if;

  v_result := public.record_purchase_order_receipt_v3(
    v_batch_id, v_receipt_key_2, 'passed', true, null,
    jsonb_build_array(jsonb_build_object(
      'deliveryLineId', v_delivery_line_id, 'itemId', v_item_id,
      'deliveredPurchaseQty', 4, 'acceptedPurchaseQty', 4,
      'deliveredStockQty', 2, 'acceptedStockQty', 2
    )), '[]'::jsonb, v_actor
  );
  v_second_wms := v_result ->> 'wmsTransactionId';
  if v_first_wms is null or v_second_wms is null or v_first_wms = v_second_wms then
    raise exception 'Two receipts must create two distinct WMS transactions';
  end if;

  v_result := public.record_purchase_order_receipt_v3(
    v_batch_id, v_receipt_key_2, 'passed', true, null,
    jsonb_build_array(jsonb_build_object(
      'deliveryLineId', v_delivery_line_id, 'itemId', v_item_id,
      'deliveredPurchaseQty', 4, 'acceptedPurchaseQty', 4,
      'deliveredStockQty', 2, 'acceptedStockQty', 2
    )), '[]'::jsonb, v_actor
  );
  if coalesce((v_result ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'Receipt idempotency replay was not detected';
  end if;

  select count(*) into v_count
  from public.purchase_order_receipts where delivery_batch_id = v_batch_id;
  if v_count <> 2 then raise exception 'Receipt idempotency created duplicate rows'; end if;
  select coalesce((stock_by_warehouse ->> v_warehouse_id)::numeric, 0) into v_stock
  from public.items where id = v_item_id;
  if v_stock <> 5 then raise exception 'Flow v3 stock expected 5, got %', v_stock; end if;
  select recognized_amount, committed_amount into v_recognized, v_committed
  from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt' and source_id = v_batch_id::text;
  if v_recognized <> 1000 or v_committed <> 1000 then
    raise exception 'Flow v3 AP expected 1000/1000, got %/%', v_recognized, v_committed;
  end if;
  select request_po_receipt_qty into v_boq_received
  from public.get_project_material_boq_reconciliation(v_project_id, v_site_id::text, current_date, 0)
  where inventory_item_id = v_item_id;
  if coalesce(v_boq_received, 0) <> 5 then
    raise exception 'BOQ reconciliation expected request PO receipt 5, got %', v_boq_received;
  end if;

  v_result := public.save_purchase_order_delivery_batch_draft_v2(
    v_po_id, null, null, 0, 'Bù hao hụt smoke', 'Đợt vượt smoke',
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_line_id, 'itemId', v_item_id,
      'requestQty', 1, 'requestUnit', 'Cây',
      'purchaseQty', 2, 'purchaseUnit', 'Kg', 'purchaseUnitPrice', 100
    )), v_actor
  );
  v_over_batch_id := (v_result ->> 'deliveryBatchId')::uuid;
  select id into v_over_delivery_line_id from public.purchase_order_delivery_lines
  where delivery_batch_id = v_over_batch_id;
  perform public.submit_purchase_order_delivery_batch_approval_v2(v_over_batch_id, null, v_actor);
  perform public.approve_purchase_order_delivery_batch_v2(v_over_batch_id, v_actor);
  v_result := public.record_purchase_order_receipt_v3(
    v_over_batch_id, gen_random_uuid(), 'passed', true, 'NCC giao vượt smoke',
    jsonb_build_array(jsonb_build_object(
      'deliveryLineId', v_over_delivery_line_id, 'itemId', v_item_id,
      'deliveredPurchaseQty', 3, 'acceptedPurchaseQty', 3,
      'deliveredStockQty', 2, 'acceptedStockQty', 2
    )), '[]'::jsonb, v_actor
  );
  v_over_receipt_id := (v_result ->> 'receiptId')::uuid;
  if v_result ->> 'financeStatus' <> 'variance_pending' then
    raise exception 'Over receipt must wait for purchasing finance confirmation';
  end if;
  select recognized_amount, committed_amount into v_recognized, v_committed
  from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt' and source_id = v_over_batch_id::text;
  if v_recognized <> 0 or v_committed <> 200 then
    raise exception 'Pending over receipt AP expected 0/200, got %/%', v_recognized, v_committed;
  end if;
  perform public.confirm_purchase_order_receipt_variance_v1(v_over_receipt_id, 'Mua hàng xác nhận smoke', v_actor);
  select recognized_amount into v_recognized from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt' and source_id = v_over_batch_id::text;
  if v_recognized <> 300 then
    raise exception 'Confirmed over receipt AP expected 300, got %', v_recognized;
  end if;
end;
$$;

rollback;
