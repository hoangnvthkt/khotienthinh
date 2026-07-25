create schema if not exists app_private;

create or replace function app_private.create_delivery_batch_with_wms_qr_core_v2(
  p_purchase_order_id text,
  p_idempotency_key uuid,
  p_supplier_id text,
  p_supplier_name text,
  p_fulfillment_mode text,
  p_vat_rate numeric,
  p_target_warehouse_id text,
  p_planned_delivery_date date,
  p_note text,
  p_actor_user_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_existing public.purchase_order_delivery_batches%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_delivery_no integer;
  v_qr_token text := 'pod_' || replace(gen_random_uuid()::text, '-', '');
  v_tx_id text := 'tx-po-delivery-' || replace(gen_random_uuid()::text, '-', '');
  v_wms_items jsonb := '[]'::jsonb;
  v_delivery_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_po_line jsonb;
  v_line_id uuid;
  v_line_key text;
  v_seen_line_keys text[] := '{}'::text[];
  v_purchase_order_line_id text;
  v_item_id text;
  v_purchase_qty numeric;
  v_stock_qty numeric;
  v_purchase_unit text;
  v_stock_unit text;
  v_purchase_unit_price numeric;
  v_stock_unit_price numeric;
begin
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if p_fulfillment_mode not in ('RECEIVE_TO_STOCK', 'DIRECT_CONSUMPTION') then
    raise exception 'Fulfillment mode khong hop le: %', p_fulfillment_mode using errcode = '22023';
  end if;
  if coalesce(p_vat_rate, 0) < 0 then
    raise exception 'VAT khong duoc am.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_target_warehouse_id, '')), '') is null then
    raise exception 'Kho nhan hang la bat buoc.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Dot giao phai co it nhat mot dong vat tu.' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'Khong tim thay Goi mua hang %.', p_purchase_order_id using errcode = '22023';
  end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception 'Chi tao Dot giao cho Goi da duyet hoac dang giao.' using errcode = '22023';
  end if;

  select * into v_existing
  from public.purchase_order_delivery_batches
  where purchase_order_id = p_purchase_order_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    return app_private.purchase_delivery_command_result_v2(v_existing.id);
  end if;

  perform 1
  from public.purchase_order_delivery_batches
  where purchase_order_id = p_purchase_order_id
  order by id
  for update;

  select coalesce(max(delivery_no), 0) + 1
  into v_delivery_no
  from public.purchase_order_delivery_batches
  where purchase_order_id = p_purchase_order_id;

  insert into public.purchase_order_delivery_batches (
    id, purchase_order_id, project_id, construction_site_id, delivery_no,
    planned_delivery_date, status, fulfillment_batch_ids, note, created_by,
    supplier_id, supplier_name_snapshot, fulfillment_mode, vat_rate,
    qr_token, idempotency_key
  ) values (
    v_batch_id, v_po.id, v_po.project_id, v_po.construction_site_id, v_delivery_no,
    p_planned_delivery_date, 'waiting_delivery', '{}'::text[], nullif(p_note, ''), p_actor_user_id,
    nullif(p_supplier_id, ''), nullif(p_supplier_name, ''), p_fulfillment_mode, coalesce(p_vat_rate, 0),
    v_qr_token, p_idempotency_key
  );

  for v_line in
    select value from jsonb_array_elements(p_lines) as line(value)
  loop
    v_purchase_order_line_id := nullif(v_line ->> 'purchaseOrderLineId', '');
    v_item_id := nullif(v_line ->> 'itemId', '');
    v_purchase_qty := coalesce(nullif(v_line ->> 'purchaseQty', '')::numeric, 0);
    v_stock_qty := coalesce(nullif(v_line ->> 'stockQty', '')::numeric, 0);
    v_purchase_unit := coalesce(nullif(v_line ->> 'purchaseUnit', ''), 'DV mua');
    v_stock_unit := coalesce(nullif(v_line ->> 'stockUnit', ''), v_purchase_unit);
    v_purchase_unit_price := coalesce(nullif(v_line ->> 'purchaseUnitPrice', '')::numeric, 0);
    v_stock_unit_price := coalesce(nullif(v_line ->> 'stockUnitPrice', '')::numeric, 0);

    if v_purchase_order_line_id is null or v_item_id is null then
      raise exception 'Dong Dot giao thieu PO line hoac vat tu.' using errcode = '22023';
    end if;
    if v_purchase_qty <= 0 or v_stock_qty <= 0 then
      raise exception 'So luong Dot giao phai lon hon 0.' using errcode = '22023';
    end if;
    if v_purchase_unit_price < 0 or v_stock_unit_price < 0 then
      raise exception 'Don gia Dot giao khong duoc am.' using errcode = '22023';
    end if;

    select po_line.value into v_po_line
    from jsonb_array_elements(v_po.items) as po_line(value)
    where coalesce(po_line.value ->> 'lineId', po_line.value ->> 'itemId') = v_purchase_order_line_id
    limit 1;
    if v_po_line is null or coalesce(v_po_line ->> 'itemId', '') <> v_item_id then
      raise exception 'Dong Dot giao khong khop voi Goi mua hang.' using errcode = '22023';
    end if;

    v_line_key := v_purchase_order_line_id || ':' || v_item_id;
    if v_line_key = any(v_seen_line_keys) then
      raise exception 'Dong Dot giao bi lap trong lenh tao.' using errcode = '22023';
    end if;
    v_seen_line_keys := array_append(v_seen_line_keys, v_line_key);
    v_line_id := gen_random_uuid();

    v_delivery_lines := v_delivery_lines || jsonb_build_array(jsonb_build_object(
      'id', v_line_id,
      'purchaseOrderLineId', v_purchase_order_line_id,
      'itemId', v_item_id,
      'purchaseQty', v_purchase_qty,
      'purchaseUnit', v_purchase_unit,
      'stockQty', v_stock_qty,
      'stockUnit', v_stock_unit,
      'purchaseUnitPrice', v_purchase_unit_price
    ));

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id,
      'quantity', v_stock_qty,
      'orderedQty', v_stock_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_purchase_qty,
      'accountingUnit', v_purchase_unit,
      'accountingPrice', v_purchase_unit_price,
      'purchaseOrderLineId', v_purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch_id,
      'purchaseOrderDeliveryLineId', v_line_id,
      'fulfillmentMode', p_fulfillment_mode
    ));
  end loop;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, approver_id, status, note,
    business_partner_id, business_partner_name_snapshot, source_type, source_id
  ) values (
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items, p_target_warehouse_id, nullif(p_supplier_id, ''),
    p_actor_user_id, p_actor_user_id, p_actor_user_id, 'PENDING'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_delivery_no::text, 2, '0') || ' dang giao',
    null, nullif(p_supplier_name, ''), 'po_delivery_batch', v_batch_id::text
  );

  for v_line in
    select value from jsonb_array_elements(v_delivery_lines) as line(value)
  loop
    insert into public.purchase_order_delivery_lines (
      id, delivery_batch_id, purchase_order_id, purchase_order_line_id, item_id,
      planned_qty, unit, delivery_unit_price, stock_planned_qty, stock_unit
    ) values (
      (v_line ->> 'id')::uuid, v_batch_id, v_po.id, v_line ->> 'purchaseOrderLineId', v_line ->> 'itemId',
      (v_line ->> 'purchaseQty')::numeric, v_line ->> 'purchaseUnit', (v_line ->> 'purchaseUnitPrice')::numeric,
      (v_line ->> 'stockQty')::numeric, v_line ->> 'stockUnit'
    );
  end loop;

  update public.purchase_order_delivery_batches
  set wms_transaction_id = v_tx_id,
      status = 'receiving',
      updated_at = now()
  where id = v_batch_id;

  return app_private.purchase_delivery_command_result_v2(v_batch_id);
exception
  when unique_violation then
    select * into v_existing
    from public.purchase_order_delivery_batches
    where purchase_order_id = p_purchase_order_id
      and idempotency_key = p_idempotency_key;
    if found then
      return app_private.purchase_delivery_command_result_v2(v_existing.id);
    end if;
    raise;
end;
$$;

revoke all on function app_private.create_delivery_batch_with_wms_qr_core_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from public, anon, authenticated;

create or replace function app_private.create_delivery_batch_with_wms_qr_v2(
  p_purchase_order_id text,
  p_idempotency_key uuid,
  p_supplier_id text,
  p_supplier_name text,
  p_fulfillment_mode text,
  p_vat_rate numeric,
  p_target_warehouse_id text,
  p_planned_delivery_date date,
  p_note text,
  p_actor_user_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang %.', p_purchase_order_id using errcode = '22023';
  end if;

  perform app_private.assert_project_permission_room_action(
    v_po.project_id,
    v_po.construction_site_id,
    'material_po',
    'submit',
    p_actor_user_id
  );

  return app_private.create_delivery_batch_with_wms_qr_core_v2(
    p_purchase_order_id, p_idempotency_key, p_supplier_id, p_supplier_name,
    p_fulfillment_mode, p_vat_rate, p_target_warehouse_id,
    p_planned_delivery_date, p_note, p_actor_user_id, p_lines
  );
end;
$$;

revoke all on function app_private.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from public, anon;
grant execute on function app_private.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) to authenticated;

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

  if coalesce(v_po.purchase_mode, 'single') = 'single' then
    select * into v_existing_delivery
    from public.purchase_order_delivery_batches
    where purchase_order_id = p_purchase_order_id
      and idempotency_key = p_idempotency_key
    for update;

    if found then
      v_delivery_result := app_private.purchase_delivery_command_result_v2(v_existing_delivery.id);
    else
      select * into v_existing_delivery
      from public.purchase_order_delivery_batches
      where purchase_order_id = p_purchase_order_id
        and status <> 'cancelled'
      order by delivery_no, id
      limit 1
      for update;

      if found then
        v_delivery_result := app_private.purchase_delivery_command_result_v2(v_existing_delivery.id);
      else
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
    end if;
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
  from public, anon;
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
    p_idempotency_key
  );
end;
$$;

revoke all on function public.approve_purchase_package_and_prepare_single_batch_v2(text, uuid, uuid)
  from public, anon;
grant execute on function public.approve_purchase_package_and_prepare_single_batch_v2(text, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
