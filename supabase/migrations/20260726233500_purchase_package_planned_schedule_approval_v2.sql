create schema if not exists app_private;

create or replace function app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if coalesce(v_po.source_mode, '') <> 'from_request' then
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
  if nullif(trim(coalesce(v_po.target_warehouse_id, '')), '') is null then
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
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items, v_po.target_warehouse_id, nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
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
$$;

revoke all on function app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function app_private.approve_purchase_package_and_prepare_single_batch_v2(
  p_purchase_order_id text,
  p_actor_user_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_existing_delivery public.purchase_order_delivery_batches%rowtype;
  v_previous_guard text;
  v_item jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_line_id text;
  v_item_id text;
  v_purchase_qty numeric;
  v_purchase_unit text;
  v_stock_unit text;
  v_conversion_factor numeric;
  v_purchase_unit_price numeric;
  v_delivery_result jsonb;
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

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang %.', p_purchase_order_id using errcode = '22023';
  end if;
  if coalesce(v_po.source_mode, '') <> 'from_request' then
    raise exception 'Chi duyet Goi mua hang V2 tao tu MR.' using errcode = '22023';
  end if;
  if coalesce(v_po.purchase_mode, 'single') not in ('single', 'multiple') then
    raise exception 'Purchase mode khong hop le: %', v_po.purchase_mode using errcode = '22023';
  end if;
  if coalesce(v_po.fulfillment_mode, '') not in ('RECEIVE_TO_STOCK', 'DIRECT_CONSUMPTION') then
    raise exception 'Goi mua hang thieu snapshot hinh thuc nhan hang.' using errcode = '22023';
  end if;
  if v_po.status not in ('sent', 'confirmed') then
    raise exception 'Chi duyet Goi mua hang dang cho duyet.' using errcode = '22023';
  end if;

  perform app_private.assert_project_permission_room_action(
    v_po.project_id,
    v_po.construction_site_id,
    'material_po',
    'approve',
    p_actor_user_id
  );

  if v_po.status <> 'confirmed' then
    v_previous_guard := current_setting('app.material_transition_context', true);
    perform set_config('app.material_transition_context', 'on', true);

    update public.purchase_orders
    set status = 'confirmed',
        ever_submitted = true,
        last_action_by = p_actor_user_id::text,
        last_action_at = now()
    where id = p_purchase_order_id
    returning * into v_po;

    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  end if;

  if coalesce(v_po.purchase_mode, 'single') in ('single', 'multiple') then
    select * into v_existing_delivery
    from public.purchase_order_delivery_batches
    where purchase_order_id = p_purchase_order_id
      and idempotency_key = p_idempotency_key
    for update;

    if found then
      v_delivery_result := app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(
        v_existing_delivery.id,
        p_actor_user_id,
        p_idempotency_key
      );
    else
      select * into v_existing_delivery
      from public.purchase_order_delivery_batches
      where purchase_order_id = p_purchase_order_id
        and status <> 'cancelled'
      order by delivery_no, id
      limit 1
      for update;

      if found then
        v_delivery_result := app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(
          v_existing_delivery.id,
          p_actor_user_id,
          p_idempotency_key
        );
      end if;
    end if;
  end if;

  if coalesce(v_po.purchase_mode, 'single') = 'single' and v_delivery_result is null then
    for v_item in
      select value from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) as po_item(value)
    loop
      v_line_id := nullif(coalesce(v_item ->> 'lineId', v_item ->> 'itemId'), '');
      v_item_id := nullif(v_item ->> 'itemId', '');
      v_purchase_qty := coalesce(nullif(v_item ->> 'qty', '')::numeric, 0);
      v_purchase_unit := nullif(v_item ->> 'purchaseUnitSnapshot', '');
      v_stock_unit := nullif(coalesce(v_item ->> 'stockUnitSnapshot', v_item ->> 'unitSnapshot'), '');
      v_conversion_factor := coalesce(nullif(v_item ->> 'purchaseConversionFactor', '')::numeric, 0);
      v_purchase_unit_price := coalesce(nullif(v_item ->> 'unitPrice', '')::numeric, 0);

      if v_line_id is null or v_item_id is null then
        raise exception 'Dong Goi mua hang thieu PO line hoac vat tu.' using errcode = '22023';
      end if;
      if v_purchase_qty <= 0 then
        raise exception 'So luong Goi mua hang phai lon hon 0.' using errcode = '22023';
      end if;
      if v_purchase_unit is null or v_stock_unit is null or v_conversion_factor <= 0 then
        raise exception 'Goi mua hang thieu snapshot quy doi don vi.' using errcode = '22023';
      end if;
      if v_purchase_unit_price < 0 then
        raise exception 'Don gia Goi mua hang khong duoc am.' using errcode = '22023';
      end if;

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'purchaseOrderLineId', v_line_id,
        'itemId', v_item_id,
        'purchaseQty', v_purchase_qty,
        'purchaseUnit', v_purchase_unit,
        'stockQty', v_purchase_qty * v_conversion_factor,
        'stockUnit', v_stock_unit,
        'purchaseUnitPrice', v_purchase_unit_price,
        'stockUnitPrice', v_purchase_unit_price / v_conversion_factor
      ));
    end loop;

    v_delivery_result := app_private.create_delivery_batch_with_wms_qr_core_v2(
      v_po.id,
      p_idempotency_key,
      v_po.vendor_id,
      v_po.vendor_name,
      v_po.fulfillment_mode,
      coalesce(v_po.vat_rate, 0),
      v_po.target_warehouse_id,
      current_date,
      'Dot giao tu dong khi duyet Goi mua hang',
      p_actor_user_id,
      v_lines
    );
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'purchaseOrderId', v_po.id,
    'status', 'confirmed',
    'purchaseMode', coalesce(v_po.purchase_mode, 'single'),
    'delivery', v_delivery_result
  ));
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function app_private.approve_purchase_package_and_prepare_single_batch_v2(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.approve_purchase_package_and_prepare_single_batch_v2(text, uuid, uuid)
  to authenticated;

create or replace function public.approve_purchase_package_and_prepare_single_batch_v2(
  p_purchase_order_id text,
  p_actor_user_id uuid default null,
  p_idempotency_key uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_actor text := nullif(public.current_app_user_id()::text, '');
  v_actor uuid := coalesce(p_actor_user_id, v_current_actor::uuid);
begin
  if v_current_actor is null or v_actor::text <> v_current_actor then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;

  return app_private.approve_purchase_package_and_prepare_single_batch_v2(
    p_purchase_order_id,
    v_actor,
    coalesce(p_idempotency_key, gen_random_uuid())
  );
end;
$$;

revoke all on function public.approve_purchase_package_and_prepare_single_batch_v2(text, uuid, uuid)
  from public, anon;
grant execute on function public.approve_purchase_package_and_prepare_single_batch_v2(text, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
