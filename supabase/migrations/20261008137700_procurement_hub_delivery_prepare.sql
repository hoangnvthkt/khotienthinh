-- Mua hàng: đơn chủ động (lập ở màn Mua hàng, không đi từ phiếu đề xuất) tạo được phiếu nhập kho cho đợt giao thêm / giao bù.
-- Trước đây hàm chuẩn bị đợt giao chỉ nhận đơn tạo từ phiếu đề xuất → "Giao bù phần thiếu" của đơn chủ động bị chặn (PO-143, 08/10/2026).
-- Thân hàm không dùng liên kết phiếu đề xuất nên chỉ cần nới điều kiện cho đơn do màn Mua hàng quản lý.

CREATE OR REPLACE FUNCTION app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(p_delivery_batch_id uuid, p_actor_user_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_qr_token text := 'pod_' || replace(gen_random_uuid()::text, '-', '');
  v_tx_id text := 'tx-po-delivery-' || replace(gen_random_uuid()::text, '-', '');
  v_wms_items jsonb := '[]'::jsonb;
  v_purchase_unit_price numeric;
  v_stock_unit_price numeric;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if coalesce(v_po.source_mode, '') <> 'from_request' and not exists(select 1 from app_private.request_purchase_po_links where purchase_order_id=v_po.id)
     and not app_private.procurement_po_is_hub(v_po.metadata) then -- 08/10/2026: đơn do màn Mua hàng quản lý
    raise exception 'Chi chuan bi Dot giao cho Goi mua hang V2 tao tu MR.' using errcode = '22023';
  end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception 'Chi chuan bi Dot giao sau khi Goi da duyet.' using errcode = '22023';
  end if;
  if coalesce(v_batch.status, 'planned') not in ('planned', 'waiting_delivery', 'receiving', 'wms_pending') then
    raise exception 'Trang thai Dot giao khong cho phep tao WMS/QR: %', v_batch.status using errcode = '22023';
  end if;
  if coalesce(v_batch.wms_transaction_id, '') <> '' and coalesce(v_batch.qr_token, '') <> '' then
    return app_private.purchase_delivery_command_result_v2(v_batch.id);
  end if;
  if nullif(trim(coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id, '')), '') is null then
    raise exception 'Kho nhan hang la bat buoc de tao WMS/QR Dot giao.' using errcode = '22023';
  end if;

  for v_line in
    select *
    from public.purchase_order_delivery_lines
    where delivery_batch_id = v_batch.id
    order by id
  loop
    if coalesce(v_line.planned_qty, 0) <= 0 or coalesce(v_line.stock_planned_qty, 0) <= 0 then
      raise exception 'So luong Dot giao phai lon hon 0.' using errcode = '22023';
    end if;
    v_purchase_unit_price := coalesce(v_line.delivery_unit_price, 0);
    if v_purchase_unit_price < 0 then
      raise exception 'Don gia Dot giao khong duoc am.' using errcode = '22023';
    end if;
    v_stock_unit_price := case
      when coalesce(v_line.stock_planned_qty, 0) > 0
        then v_purchase_unit_price * coalesce(v_line.planned_qty, 0) / coalesce(v_line.stock_planned_qty, 1)
      else 0
    end;

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id,
      'quantity', v_line.stock_planned_qty,
      'orderedQty', v_line.stock_planned_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_line.planned_qty,
      'accountingUnit', coalesce(v_line.unit, 'DV mua'),
      'accountingPrice', v_purchase_unit_price,
      'purchaseOrderLineId', v_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch.id,
      'purchaseOrderDeliveryLineId', v_line.id,
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode)
    ));
  end loop;

  if jsonb_array_length(v_wms_items) = 0 then
    raise exception 'Dot giao phai co it nhat mot dong vat tu.' using errcode = '22023';
  end if;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, approver_id, status, note,
    business_partner_id, business_partner_name_snapshot, source_type, source_id
  ) values (
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items, coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id), nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
    p_actor_user_id, p_actor_user_id, p_actor_user_id, 'PENDING'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0') || ' dang giao',
    null, nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''), 'po_delivery_batch', v_batch.id::text
  );

  update public.purchase_order_delivery_batches
  set supplier_id = nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
      supplier_name_snapshot = nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''),
      fulfillment_mode = coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode),
      vat_rate = coalesce(v_batch.vat_rate, v_po.vat_rate, 0),
      qr_token = coalesce(v_batch.qr_token, v_qr_token),
      idempotency_key = coalesce(v_batch.idempotency_key, p_idempotency_key),
      wms_transaction_id = v_tx_id,
      status = 'receiving',
      updated_at = now()
  where id = v_batch.id;

  return app_private.purchase_delivery_command_result_v2(v_batch.id);
end;
$function$;

notify pgrst, 'reload schema';
