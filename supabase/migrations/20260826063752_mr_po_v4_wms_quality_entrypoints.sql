-- Restore the two operational entry points for simplified MR PO receipts:
-- a stable PO QR and one WMS quality document visible in Material Operations.
-- Both entry points finalize the same prepared WMS through receipt V4.

create or replace function app_private.ensure_purchase_order_delivery_wms_v4(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_tx_id text := 'tx-po-quality-' || replace(gen_random_uuid()::text, '-', '');
  v_wms_items jsonb;
  v_related_request_id text;
begin
  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then raise exception 'Không tìm thấy đợt đặt hàng.' using errcode = '22023'; end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found or v_po.procurement_flow_version <> 4 then
    raise exception 'Phiếu WMS V4 chỉ áp dụng cho PO MR tối giản.' using errcode = '22023';
  end if;
  if v_batch.approval_status <> 'approved'
    or v_batch.status in ('received', 'received_short', 'received_over', 'cancelled')
  then raise exception 'Chỉ tạo phiếu SL/CL cho đợt V4 đã duyệt và chưa nhận.' using errcode = '22023'; end if;

  if v_batch.wms_transaction_id is not null then
    select * into v_tx from public.transactions where id = v_batch.wms_transaction_id;
    if not found
      or v_tx.source_type <> 'po_delivery_batch'
      or v_tx.source_id <> v_batch.id::text
    then raise exception 'Đợt V4 đang liên kết phiếu WMS không hợp lệ.' using errcode = 'P0001'; end if;
    return v_batch.wms_transaction_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', line.item_id,
    'quantity', line.stock_planned_qty,
    'orderedQty', line.stock_planned_qty,
    'price', line.delivery_unit_price,
    'accountingQty', line.planned_qty,
    'accountingUnit', line.unit,
    'accountingPrice', line.delivery_unit_price,
    'purchaseOrderLineId', line.purchase_order_line_id,
    'purchaseOrderDeliveryBatchId', v_batch.id,
    'purchaseOrderDeliveryLineId', line.id,
    'materialRequestId', request_link.material_request_id,
    'requestLineId', request_link.request_line_id,
    'fulfillmentMode', coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK'),
    'purchaseOrderFlowVersion', 4
  ) order by line.id), '[]'::jsonb), min(request_link.material_request_id)
  into v_wms_items, v_related_request_id
  from public.purchase_order_delivery_lines line
  left join lateral (
    select link.material_request_id, link.request_line_id
    from public.purchase_order_request_lines link
    where link.purchase_order_id = v_po.id
      and link.purchase_order_line_id = line.purchase_order_line_id
      and link.allocation_status <> 'cancelled'
    order by link.created_at
    limit 1
  ) request_link on true
  where line.delivery_batch_id = v_batch.id;

  if jsonb_array_length(v_wms_items) = 0 then
    raise exception 'Đợt V4 không có dòng hàng để tạo phiếu SL/CL.' using errcode = '22023';
  end if;
  if p_actor_user_id is null then
    raise exception 'Thiếu người lập phiếu SL/CL.' using errcode = '22023';
  end if;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, status, note, related_request_id,
    business_partner_name_snapshot, source_type, source_id, attachments
  ) values (
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items,
    v_po.target_warehouse_id, v_po.vendor_id,
    p_actor_user_id, p_actor_user_id, 'PENDING'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || ' / Đợt ' || v_batch.delivery_no || ' / Chờ duyệt SL/CL',
    v_related_request_id, v_po.vendor_name, 'po_delivery_batch', v_batch.id::text, '[]'::jsonb
  );

  update public.purchase_order_delivery_batches
  set wms_transaction_id = v_tx_id, updated_at = now()
  where id = v_batch.id and wms_transaction_id is null;

  return v_tx_id;
end;
$$;

alter function app_private.approve_purchase_order_delivery_batch_v4(uuid, uuid)
  rename to approve_purchase_order_delivery_batch_without_wms_v4_legacy;

revoke all on function app_private.approve_purchase_order_delivery_batch_without_wms_v4_legacy(uuid, uuid)
  from public, anon, authenticated;

create or replace function app_private.approve_purchase_order_delivery_batch_v4(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_wms_transaction_id text;
begin
  v_result := app_private.approve_purchase_order_delivery_batch_without_wms_v4_legacy(
    p_delivery_batch_id,
    p_actor_user_id
  );
  v_wms_transaction_id := app_private.ensure_purchase_order_delivery_wms_v4(
    p_delivery_batch_id,
    p_actor_user_id
  );
  return v_result || jsonb_build_object('wmsTransactionId', v_wms_transaction_id);
end;
$$;

revoke all on function app_private.ensure_purchase_order_delivery_wms_v4(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.approve_purchase_order_delivery_batch_v4(uuid, uuid)
  from public, anon;
grant execute on function app_private.approve_purchase_order_delivery_batch_v4(uuid, uuid)
  to authenticated;

create or replace function app_private.record_purchase_order_receipt_v4(
  p_delivery_batch_id uuid,
  p_idempotency_key uuid,
  p_quality_result text,
  p_variance_reason text,
  p_lines jsonb,
  p_attachments jsonb,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id text;
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_existing public.purchase_order_receipts%rowtype;
  v_receipt_id uuid := gen_random_uuid();
  v_tx_id text;
  v_line jsonb;
  v_delivery_line public.purchase_order_delivery_lines%rowtype;
  v_delivery_line_id uuid;
  v_item_id text;
  v_delivered_purchase numeric;
  v_accepted_purchase numeric;
  v_delivered_stock numeric;
  v_accepted_stock numeric;
  v_line_reason text;
  v_seen uuid[] := '{}';
  v_expected_count integer;
  v_wms_items jsonb := '[]'::jsonb;
  v_gross numeric := 0;
  v_batch_status text;
  v_total_planned numeric;
  v_total_accepted numeric;
  v_next_items jsonb;
  v_previous_guard text;
  v_material_request_id text;
  v_request_line_id text;
  v_related_request_id text;
  v_has_variance boolean := false;
begin
  if p_idempotency_key is null then raise exception 'Thiếu idempotency key.' using errcode = '22023'; end if;
  if p_quality_result not in ('passed', 'partial', 'rejected') then
    raise exception 'Kết quả SL/CL không hợp lệ.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array'
  then raise exception 'Payload lần nhập không hợp lệ.' using errcode = '22023'; end if;

  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id;
  if not found then raise exception 'Không tìm thấy đợt đặt hàng.' using errcode = '22023'; end if;
  v_po := app_private.assert_mr_po_flow_v4_actor_v1(v_po_id, 'confirm', p_actor_user_id);
  select * into v_batch
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;

  select * into v_existing
  from public.purchase_order_receipts
  where delivery_batch_id = v_batch.id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'receiptId', v_existing.id, 'deliveryBatchId', v_existing.delivery_batch_id,
      'receiptNo', v_existing.receipt_no, 'wmsTransactionId', v_existing.wms_transaction_id,
      'financeStatus', v_existing.finance_status, 'batchStatus', v_batch.status,
      'idempotentReplay', true
    );
  end if;
  if exists (
    select 1 from public.purchase_order_receipts receipt
    where receipt.delivery_batch_id = v_batch.id
  ) then raise exception 'Đợt V4 đã được nhận một lần; mua bù phải tạo đợt mới.' using errcode = '22023'; end if;
  if v_batch.approval_status <> 'approved'
    or v_batch.status in ('received', 'received_short', 'received_over', 'cancelled')
  then raise exception 'Đợt chưa duyệt hoặc đã kết thúc nhận hàng.' using errcode = '22023'; end if;
  if v_batch.wms_transaction_id is null then
    raise exception 'Đợt V4 chưa có phiếu WMS chờ duyệt SL/CL.' using errcode = 'P0001';
  end if;
  if not app_private.current_user_can_receive_purchase_batch_v2(p_actor_user_id, v_po.target_warehouse_id) then
    raise exception 'Không có quyền nhận hàng tại kho này.' using errcode = '42501';
  end if;

  v_tx_id := v_batch.wms_transaction_id;
  select * into v_tx from public.transactions where id = v_tx_id for update;
  if not found
    or v_tx.source_type <> 'po_delivery_batch'
    or v_tx.source_id <> v_batch.id::text
  then raise exception 'Phiếu WMS không liên kết đúng đợt V4.' using errcode = 'P0001'; end if;
  if v_tx.status <> 'PENDING'::public.transaction_status then
    raise exception 'Phiếu WMS V4 đã xử lý hoặc không còn chờ duyệt SL/CL.' using errcode = '22023';
  end if;

  select count(*) into v_expected_count
  from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id;
  if v_expected_count = 0 or jsonb_array_length(p_lines) <> v_expected_count then
    raise exception 'Payload phải khớp 1-1 với dòng đợt đặt hàng.' using errcode = '22023';
  end if;
  perform 1 from public.purchase_order_delivery_lines
  where delivery_batch_id = v_batch.id order by id for update;

  for v_line in select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_delivery_line_id := nullif(coalesce(v_line ->> 'deliveryLineId', v_line ->> 'delivery_line_id'), '')::uuid;
    v_item_id := nullif(coalesce(v_line ->> 'itemId', v_line ->> 'item_id'), '');
    v_delivered_purchase := coalesce(nullif(coalesce(v_line ->> 'deliveredPurchaseQty', v_line ->> 'delivered_purchase_qty'), '')::numeric, 0);
    v_accepted_purchase := coalesce(nullif(coalesce(v_line ->> 'acceptedPurchaseQty', v_line ->> 'accepted_purchase_qty'), '')::numeric, 0);
    v_delivered_stock := coalesce(nullif(coalesce(v_line ->> 'deliveredStockQty', v_line ->> 'delivered_stock_qty'), '')::numeric, 0);
    v_accepted_stock := coalesce(nullif(coalesce(v_line ->> 'acceptedStockQty', v_line ->> 'accepted_stock_qty'), '')::numeric, 0);
    v_line_reason := nullif(trim(coalesce(v_line ->> 'varianceReason', v_line ->> 'variance_reason', '')), '');
    if v_delivery_line_id is null or v_item_id is null or v_delivery_line_id = any(v_seen)
      or v_delivered_purchase < 0 or v_accepted_purchase < 0
      or v_delivered_stock < 0 or v_accepted_stock < 0
      or v_accepted_purchase > v_delivered_purchase or v_accepted_stock > v_delivered_stock
    then raise exception 'Dòng nhận hàng không hợp lệ.' using errcode = '22023'; end if;
    select * into v_delivery_line
    from public.purchase_order_delivery_lines
    where id = v_delivery_line_id and delivery_batch_id = v_batch.id;
    if not found or v_delivery_line.item_id <> v_item_id then
      raise exception 'Dòng nhận hàng không thuộc đợt.' using errcode = '22023';
    end if;

    v_has_variance := abs(v_delivered_purchase - v_delivery_line.planned_qty) > 0.000001
      or abs(v_accepted_purchase - v_delivery_line.planned_qty) > 0.000001
      or abs(v_accepted_stock - v_delivery_line.stock_planned_qty) > 0.000001;
    if v_has_variance
      and v_line_reason is null
      and nullif(trim(coalesce(p_variance_reason, '')), '') is null
    then raise exception 'Dòng giao, đạt hoặc nhập kho lệch số đã duyệt; phải nhập lý do.' using errcode = '22023'; end if;

    v_material_request_id := null;
    v_request_line_id := null;
    select porl.material_request_id, porl.request_line_id
    into v_material_request_id, v_request_line_id
    from public.purchase_order_request_lines porl
    where porl.purchase_order_id = v_po.id
      and porl.purchase_order_line_id = v_delivery_line.purchase_order_line_id
      and porl.allocation_status <> 'cancelled'
    order by porl.created_at
    limit 1;
    if v_related_request_id is null then v_related_request_id := v_material_request_id; end if;
    v_seen := array_append(v_seen, v_delivery_line_id);
    v_gross := v_gross + v_accepted_purchase * v_delivery_line.delivery_unit_price
      * (1 + coalesce(v_batch.vat_rate, 0) / 100);
    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id, 'quantity', v_accepted_stock,
      'orderedQty', v_delivery_line.stock_planned_qty,
      'price', v_delivery_line.delivery_unit_price,
      'accountingQty', v_accepted_purchase, 'accountingUnit', v_delivery_line.unit,
      'accountingPrice', v_delivery_line.delivery_unit_price,
      'purchaseOrderLineId', v_delivery_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch.id,
      'purchaseOrderDeliveryLineId', v_delivery_line.id,
      'purchaseOrderReceiptId', v_receipt_id,
      'materialRequestId', v_material_request_id, 'requestLineId', v_request_line_id,
      'varianceReason', coalesce(v_line_reason, nullif(trim(coalesce(p_variance_reason, '')), '')),
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK'),
      'purchaseOrderFlowVersion', 4
    ));
  end loop;
  if coalesce(array_length(v_seen, 1), 0) <> v_expected_count then
    raise exception 'Payload nhận hàng thiếu dòng.' using errcode = '22023';
  end if;

  update public.transactions set
    date = now(), items = v_wms_items,
    target_warehouse_id = v_po.target_warehouse_id,
    supplier_id = v_po.vendor_id,
    approver_id = p_actor_user_id,
    status = 'COMPLETED'::public.transaction_status,
    note = coalesce(v_po.po_number, v_po.id) || ' / Đợt ' || v_batch.delivery_no,
    related_request_id = v_related_request_id,
    business_partner_name_snapshot = v_po.vendor_name,
    attachments = coalesce(p_attachments, '[]'::jsonb),
    approved_at = now()
  where id = v_tx_id;

  insert into public.purchase_order_receipts (
    id, delivery_batch_id, purchase_order_id, project_id, construction_site_id,
    receipt_no, finance_status, quality_result, is_final, variance_reason,
    attachments, accepted_gross_amount, wms_transaction_id, idempotency_key, received_by
  ) values (
    v_receipt_id, v_batch.id, v_po.id, v_po.project_id, v_po.construction_site_id,
    1, 'ready', p_quality_result, true,
    nullif(trim(coalesce(p_variance_reason, '')), ''), coalesce(p_attachments, '[]'::jsonb),
    round(v_gross, 2), v_tx_id, p_idempotency_key, p_actor_user_id
  );

  for v_line in select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_delivery_line_id := nullif(coalesce(v_line ->> 'deliveryLineId', v_line ->> 'delivery_line_id'), '')::uuid;
    select * into v_delivery_line from public.purchase_order_delivery_lines where id = v_delivery_line_id;
    v_delivered_purchase := coalesce(nullif(coalesce(v_line ->> 'deliveredPurchaseQty', v_line ->> 'delivered_purchase_qty'), '')::numeric, 0);
    v_accepted_purchase := coalesce(nullif(coalesce(v_line ->> 'acceptedPurchaseQty', v_line ->> 'accepted_purchase_qty'), '')::numeric, 0);
    v_delivered_stock := coalesce(nullif(coalesce(v_line ->> 'deliveredStockQty', v_line ->> 'delivered_stock_qty'), '')::numeric, 0);
    v_accepted_stock := coalesce(nullif(coalesce(v_line ->> 'acceptedStockQty', v_line ->> 'accepted_stock_qty'), '')::numeric, 0);
    v_line_reason := nullif(trim(coalesce(v_line ->> 'varianceReason', v_line ->> 'variance_reason', '')), '');
    insert into public.purchase_order_receipt_lines (
      receipt_id, delivery_batch_id, delivery_line_id, purchase_order_id,
      purchase_order_line_id, item_id, purchase_unit, stock_unit,
      delivered_purchase_qty, accepted_purchase_qty, delivered_stock_qty,
      accepted_stock_qty, purchase_unit_price, variance_reason
    ) values (
      v_receipt_id, v_batch.id, v_delivery_line.id, v_po.id,
      v_delivery_line.purchase_order_line_id, v_delivery_line.item_id,
      v_delivery_line.unit, v_delivery_line.stock_unit,
      v_delivered_purchase, v_accepted_purchase, v_delivered_stock,
      v_accepted_stock, v_delivery_line.delivery_unit_price,
      coalesce(v_line_reason, nullif(trim(coalesce(p_variance_reason, '')), ''))
    );
    update public.purchase_order_delivery_lines set
      accepted_qty = v_accepted_purchase, accepted_stock_qty = v_accepted_stock,
      updated_at = now()
    where id = v_delivery_line.id;
    if coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK') = 'RECEIVE_TO_STOCK'
      and v_accepted_stock > 0
    then perform public.apply_stock_change(v_delivery_line.item_id, v_po.target_warehouse_id, v_accepted_stock); end if;
  end loop;

  select sum(planned_qty), sum(accepted_qty)
  into v_total_planned, v_total_accepted
  from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id;
  v_batch_status := case
    when v_total_accepted > v_total_planned + 0.000001 then 'received_over'
    when v_total_accepted < v_total_planned - 0.000001 then 'received_short'
    else 'received'
  end;
  update public.purchase_order_delivery_batches set
    status = v_batch_status, quality_result = p_quality_result,
    variance_reason = coalesce(nullif(trim(coalesce(p_variance_reason, '')), ''), variance_reason),
    received_by = p_actor_user_id, received_at = now(),
    accepted_gross_amount = round(v_gross, 2), updated_at = now()
  where id = v_batch.id;

  with received_by_line as (
    select delivery_line.purchase_order_line_id, sum(receipt_line.accepted_stock_qty) as qty
    from public.purchase_order_receipt_lines receipt_line
    join public.purchase_order_delivery_lines delivery_line on delivery_line.id = receipt_line.delivery_line_id
    where receipt_line.receipt_id = v_receipt_id
    group by delivery_line.purchase_order_line_id
  ), item_rows as (
    select item.value, item.ordinality,
      coalesce(item.value ->> 'lineId', item.value ->> 'itemId') as line_key
    from jsonb_array_elements(v_po.items) with ordinality item(value, ordinality)
  )
  select jsonb_agg(
    case when received.qty is null then item_rows.value else jsonb_set(
      item_rows.value, '{receivedQty}', to_jsonb(
        coalesce(nullif(item_rows.value ->> 'receivedQty', '')::numeric, 0) + received.qty
      ), true
    ) end order by item_rows.ordinality
  ) into v_next_items
  from item_rows left join received_by_line received on received.purchase_order_line_id = item_rows.line_key;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_orders set
    items = coalesce(v_next_items, items), status = 'partial',
    received_transaction_ids = coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx_id)
  where id = v_po.id;
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);

  update public.material_request_fulfillment_lines mfl set
    received_qty = receipt_line.accepted_stock_qty
      * case when allocation.total_committed > 0
        then mfl.committed_qty_snapshot / allocation.total_committed else 1 end,
    variance_reason = coalesce(receipt_line.variance_reason, mfl.variance_reason), updated_at = now()
  from public.purchase_order_receipt_lines receipt_line
  join lateral (
    select coalesce(sum(peer.committed_qty_snapshot), 0) total_committed
    from public.material_request_fulfillment_lines peer
    where peer.po_delivery_line_id = receipt_line.delivery_line_id
  ) allocation on true
  where receipt_line.receipt_id = v_receipt_id
    and mfl.po_delivery_line_id = receipt_line.delivery_line_id;
  update public.purchase_order_request_lines porl set
    actual_received_qty_snapshot = coalesce(summary.received_qty, 0)
  from (
    select line.purchase_order_request_line_id, sum(line.received_qty) received_qty
    from public.material_request_fulfillment_lines line
    where line.purchase_order_request_line_id is not null
    group by line.purchase_order_request_line_id
  ) summary
  where porl.id = summary.purchase_order_request_line_id and porl.purchase_order_id = v_po.id;
  update public.material_request_fulfillment_batches set
    status = 'received', received_by = p_actor_user_id, received_at = now(), updated_at = now()
  where po_delivery_batch_id = v_batch.id and status = 'issued';

  return jsonb_build_object(
    'receiptId', v_receipt_id, 'deliveryBatchId', v_batch.id,
    'receiptNo', 1, 'wmsTransactionId', v_tx_id,
    'financeStatus', 'ready', 'batchStatus', v_batch_status,
    'idempotentReplay', false
  );
exception when others then
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  raise;
end;
$$;

revoke all on function app_private.record_purchase_order_receipt_v4(uuid, uuid, text, text, jsonb, jsonb, uuid)
  from public, anon;
grant execute on function app_private.record_purchase_order_receipt_v4(uuid, uuid, text, text, jsonb, jsonb, uuid)
  to authenticated;

-- Backfill approved, unfinished V4 batches such as PO-414. The helper is
-- idempotent and refuses terminal batches, so no historical receipt is changed.
do $$
declare
  v_row record;
begin
  for v_row in
    select batch.id,
      coalesce(
        batch.approval_decided_by,
        batch.approval_requested_by,
        case when po.created_by_id ~* '^[0-9a-f-]{36}$' then po.created_by_id::uuid else null end
      ) as actor_user_id
    from public.purchase_order_delivery_batches batch
    join public.purchase_orders po on po.id = batch.purchase_order_id
    where po.procurement_flow_version = 4
      and batch.approval_status = 'approved'
      and batch.status not in ('received', 'received_short', 'received_over', 'cancelled')
      and batch.wms_transaction_id is null
      and not exists (
        select 1 from public.purchase_order_receipts receipt
        where receipt.delivery_batch_id = batch.id
      )
    order by batch.id
    for update of batch
  loop
    if v_row.actor_user_id is null then
      raise exception 'Đợt V4 % thiếu người lập để backfill phiếu SL/CL.', v_row.id;
    end if;
    perform app_private.ensure_purchase_order_delivery_wms_v4(v_row.id, v_row.actor_user_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
