CREATE OR REPLACE FUNCTION app_private.approve_material_po_quality(p_delivery_batch_id uuid, p_wms_transaction_id text, p_actor_user_id uuid, p_quality_result text, p_lines jsonb, p_attachments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_po_id text;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_line jsonb;
  v_delivery_line public.purchase_order_delivery_lines%rowtype;
  v_delivery_line_id uuid;
  v_item_id text;
  v_delivered_purchase_qty numeric;
  v_accepted_purchase_qty numeric;
  v_delivered_stock_qty numeric;
  v_accepted_stock_qty numeric;
  v_variance_reason text;
  v_seen_line_ids uuid[] := '{}'::uuid[];
  v_expected_line_count integer;
  v_wms_items jsonb := '[]'::jsonb;
  v_gross numeric := 0;
  v_combined_reason text;
  v_stock_factor numeric;
  v_stock_unit_price numeric;
begin
  if p_actor_user_id is null
     or public.current_app_user_id() is null
     or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  if p_quality_result not in ('passed', 'partial', 'rejected') then
    raise exception 'Kết quả kiểm tra SL/CL không hợp lệ.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Dữ liệu nhận hàng không hợp lệ.' using errcode = '22023';
  end if;

  select batch.purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches batch
  where batch.id = p_delivery_batch_id;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;

  perform 1 from public.purchase_orders where id = v_po_id for update;
  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if v_batch.wms_transaction_id is distinct from p_wms_transaction_id
     or v_batch.status <> 'receiving' then
    raise exception 'Đợt giao không còn ở trạng thái chờ duyệt SL/CL.' using errcode = '22023';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_wms_transaction_id
  for update;
  if not found
     or v_tx.source_type <> 'po_delivery_batch'
     or v_tx.source_id <> p_delivery_batch_id::text then
    raise exception 'WMS không liên kết đúng đợt giao.' using errcode = '22023';
  end if;
  if v_tx.status <> 'PENDING'::public.transaction_status then
    raise exception 'Phiếu WMS không còn chờ duyệt SL/CL.' using errcode = '22023';
  end if;
  if not app_private.current_user_can_receive_purchase_batch_v2(
    p_actor_user_id,
    v_tx.target_warehouse_id
  ) then
    raise exception 'Người dùng không có quyền duyệt SL/CL tại kho nhận.' using errcode = '42501';
  end if;

  select count(*) into v_expected_line_count
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id;
  if v_expected_line_count = 0
     or jsonb_array_length(p_lines) <> v_expected_line_count then
    raise exception 'Payload nhận hàng phải khớp 1-1 với dòng đợt giao.' using errcode = '22023';
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_delivery_line_id := nullif(coalesce(
      v_line ->> 'deliveryLineId', v_line ->> 'delivery_line_id'
    ), '')::uuid;
    v_item_id := nullif(coalesce(v_line ->> 'itemId', v_line ->> 'item_id'), '');
    v_accepted_purchase_qty := coalesce(nullif(coalesce(
      v_line ->> 'acceptedPurchaseQty', v_line ->> 'accepted_purchase_qty'
    ), '')::numeric, 0);
    v_delivered_purchase_qty := coalesce(nullif(coalesce(
      v_line ->> 'deliveredPurchaseQty', v_line ->> 'delivered_purchase_qty'
    ), '')::numeric, v_accepted_purchase_qty);
    v_accepted_stock_qty := coalesce(nullif(coalesce(
      v_line ->> 'acceptedStockQty', v_line ->> 'accepted_stock_qty'
    ), '')::numeric, 0);
    v_delivered_stock_qty := coalesce(nullif(coalesce(
      v_line ->> 'deliveredStockQty', v_line ->> 'delivered_stock_qty'
    ), '')::numeric, v_accepted_stock_qty);
    v_variance_reason := nullif(trim(coalesce(
      v_line ->> 'varianceReason', v_line ->> 'variance_reason', ''
    )), '');

    if v_delivery_line_id is null or v_item_id is null then
      raise exception 'Dòng nhận hàng thiếu deliveryLineId hoặc itemId.' using errcode = '22023';
    end if;
    if v_delivery_line_id = any(v_seen_line_ids) then
      raise exception 'Dòng nhận hàng bị lặp.' using errcode = '22023';
    end if;
    if v_delivered_purchase_qty < 0
       or v_accepted_purchase_qty < 0
       or v_delivered_stock_qty < 0
       or v_accepted_stock_qty < 0 then
      raise exception 'Số lượng thực tế không được âm.' using errcode = '22023';
    end if;
    if v_accepted_purchase_qty > v_delivered_purchase_qty then
      raise exception 'Số chấp nhận không được lớn hơn số giao thực tế.' using errcode = '22023';
    end if;
    if v_accepted_stock_qty > v_delivered_stock_qty then
      raise exception 'Số nhập kho không được lớn hơn số giao theo đơn vị tồn kho.' using errcode = '22023';
    end if;

    select * into v_delivery_line
    from public.purchase_order_delivery_lines
    where id = v_delivery_line_id
      and delivery_batch_id = p_delivery_batch_id
    for update;
    if not found or v_delivery_line.item_id <> v_item_id then
      raise exception 'Dòng nhận hàng không thuộc đợt giao.' using errcode = '22023';
    end if;

    if (
      v_delivered_purchase_qty is distinct from coalesce(v_delivery_line.planned_qty, 0)
      or v_accepted_purchase_qty is distinct from v_delivered_purchase_qty
      or v_accepted_stock_qty is distinct from v_delivered_stock_qty
    ) and v_variance_reason is null then
      raise exception 'Phải nhập lý do khi số đặt, giao hoặc chấp nhận chênh lệch.' using errcode = '22023';
    end if;

    update public.purchase_order_delivery_lines
    set delivered_qty = v_delivered_purchase_qty,
        accepted_qty = v_accepted_purchase_qty,
        delivered_stock_qty = v_delivered_stock_qty,
        accepted_stock_qty = v_accepted_stock_qty,
        updated_at = now()
    where id = v_delivery_line.id;

    v_seen_line_ids := array_append(v_seen_line_ids, v_delivery_line.id);
    if v_variance_reason is not null then
      v_combined_reason := concat_ws('; ', v_combined_reason, v_variance_reason);
    end if;
    v_stock_factor := case
      when coalesce(v_delivery_line.planned_qty, 0) > 0
        and coalesce(v_delivery_line.stock_planned_qty, 0) > 0 then
          v_delivery_line.stock_planned_qty / v_delivery_line.planned_qty
      else 1
    end;
    v_stock_unit_price := case
      when v_stock_factor > 0 then coalesce(v_delivery_line.delivery_unit_price, 0) / v_stock_factor
      else coalesce(v_delivery_line.delivery_unit_price, 0)
    end;
    v_gross := v_gross
      + v_accepted_purchase_qty
      * coalesce(v_delivery_line.delivery_unit_price, 0)
      * (1 + coalesce(v_batch.vat_rate, 0) / 100);

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_delivery_line.item_id,
      'quantity', v_accepted_stock_qty,
      'orderedQty', coalesce(v_delivery_line.stock_planned_qty, v_delivery_line.planned_qty, 0),
      'deliveredStockQty', v_delivered_stock_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_accepted_purchase_qty,
      'orderedPurchaseQty', v_delivery_line.planned_qty,
      'deliveredPurchaseQty', v_delivered_purchase_qty,
      'accountingUnit', coalesce(v_delivery_line.unit, v_delivery_line.stock_unit, ''),
      'accountingPrice', coalesce(v_delivery_line.delivery_unit_price, 0),
      'varianceQty', v_accepted_purchase_qty - coalesce(v_delivery_line.planned_qty, 0),
      'varianceReason', v_variance_reason,
      'purchaseOrderLineId', v_delivery_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', p_delivery_batch_id,
      'purchaseOrderDeliveryLineId', v_delivery_line.id,
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK')
    ));
  end loop;

  if coalesce(array_length(v_seen_line_ids, 1), 0) <> v_expected_line_count then
    raise exception 'Payload nhận hàng thiếu dòng đợt giao.' using errcode = '22023';
  end if;

  update public.transactions
  set items = v_wms_items,
      attachments = coalesce(p_attachments, '[]'::jsonb),
      status = 'APPROVED'::public.transaction_status,
      approver_id = p_actor_user_id,
      approved_at = now()
  where id = p_wms_transaction_id;

  update public.purchase_order_delivery_batches
  set status = 'quality_approved',
      quality_result = p_quality_result,
      variance_reason = v_combined_reason,
      quality_approved_by = p_actor_user_id,
      quality_approved_at = now(),
      accepted_gross_amount = round(v_gross, 2),
      updated_at = now()
  where id = p_delivery_batch_id;

  return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, false);
end;
$function$
