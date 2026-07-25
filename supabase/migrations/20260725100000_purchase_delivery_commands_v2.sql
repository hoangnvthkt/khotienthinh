create schema if not exists app_private;

create or replace function app_private.purchase_delivery_command_result_v2(
  p_delivery_batch_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'deliveryBatchId', batch.id::text,
    'deliveryNo', batch.delivery_no,
    'deliveryCode', po.po_number || '-' || lpad(batch.delivery_no::text, 2, '0'),
    'wmsTransactionId', coalesce(batch.wms_transaction_id, ''),
    'qrToken', coalesce(batch.qr_token, '')
  )
  from public.purchase_order_delivery_batches batch
  join public.purchase_orders po on po.id = batch.purchase_order_id
  where batch.id = p_delivery_batch_id;
$$;

revoke all on function app_private.purchase_delivery_command_result_v2(uuid)
  from public, anon;
grant execute on function app_private.purchase_delivery_command_result_v2(uuid)
  to authenticated;

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
  v_existing public.purchase_order_delivery_batches%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_delivery_no integer;
  v_qr_token text := 'pod_' || replace(gen_random_uuid()::text, '-', '');
  v_tx_id text := 'tx-po-delivery-' || replace(gen_random_uuid()::text, '-', '');
  v_wms_items jsonb := '[]'::jsonb;
  v_line jsonb;
  v_po_line jsonb;
  v_line_id uuid;
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

  perform app_private.assert_project_permission_room_action(
    v_po.project_id,
    v_po.construction_site_id,
    'material_po',
    'submit',
    p_actor_user_id
  );

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

    insert into public.purchase_order_delivery_lines (
      delivery_batch_id, purchase_order_id, purchase_order_line_id, item_id,
      planned_qty, unit, delivery_unit_price, stock_planned_qty, stock_unit
    ) values (
      v_batch_id, v_po.id, v_purchase_order_line_id, v_item_id,
      v_purchase_qty, v_purchase_unit, v_purchase_unit_price, v_stock_qty, v_stock_unit
    )
    returning id into v_line_id;

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

revoke all on function app_private.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from public, anon;
grant execute on function app_private.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) to authenticated;

create or replace function public.create_delivery_batch_with_wms_qr_v2(
  p_purchase_order_id text,
  p_idempotency_key uuid,
  p_supplier_id text,
  p_supplier_name text,
  p_fulfillment_mode text,
  p_vat_rate numeric,
  p_target_warehouse_id text,
  p_planned_delivery_date date default null,
  p_note text default null,
  p_actor_user_id uuid default null,
  p_lines jsonb default '[]'::jsonb
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

  return app_private.create_delivery_batch_with_wms_qr_v2(
    p_purchase_order_id, p_idempotency_key, p_supplier_id, p_supplier_name,
    p_fulfillment_mode, p_vat_rate, p_target_warehouse_id,
    p_planned_delivery_date, p_note, v_actor, p_lines
  );
end;
$$;

revoke all on function public.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from public, anon;
grant execute on function public.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) to authenticated;

create or replace function app_private.update_unreceived_delivery_batch_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
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
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_batch_purchase_order_id text;
  v_wms_items jsonb := '[]'::jsonb;
  v_line jsonb;
  v_existing_line public.purchase_order_delivery_lines%rowtype;
  v_seen_line_ids uuid[] := '{}'::uuid[];
  v_purchase_order_line_id text;
  v_item_id text;
  v_purchase_qty numeric;
  v_stock_qty numeric;
  v_purchase_unit text;
  v_stock_unit text;
  v_purchase_unit_price numeric;
  v_stock_unit_price numeric;
begin
  if p_actor_user_id is null then
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

  select purchase_order_id into v_batch_purchase_order_id
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_batch_purchase_order_id <> p_purchase_order_id then
    raise exception 'Dot giao khong thuoc Goi mua hang yeu cau.' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang %.', p_purchase_order_id using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_batch.status = 'quality_approved' then
    raise exception 'Dot da Duyet SL/CL va khong con duoc sua.';
  end if;
  if v_batch.status <> 'receiving' then
    raise exception 'Chi sua Dot giao chua nhan va dang cho WMS.' using errcode = '22023';
  end if;
  if v_batch.purchase_order_id <> p_purchase_order_id then
    raise exception 'Dot giao khong thuoc Goi mua hang yeu cau.' using errcode = '22023';
  end if;
  if v_batch.wms_transaction_id is distinct from p_wms_transaction_id then
    raise exception 'WMS transaction khong khop Dot giao.' using errcode = '22023';
  end if;
  if p_idempotency_key is not null and v_batch.idempotency_key is distinct from p_idempotency_key then
    raise exception 'Idempotency key khong khop Dot giao.' using errcode = '22023';
  end if;

  perform app_private.assert_project_permission_room_action(
    v_po.project_id,
    v_po.construction_site_id,
    'material_po',
    'submit',
    p_actor_user_id
  );

  select * into v_tx
  from public.transactions
  where id = p_wms_transaction_id
  for update;
  if not found then
    raise exception 'Khong tim thay WMS cua Dot giao.' using errcode = '22023';
  end if;
  if v_tx.source_type <> 'po_delivery_batch' or v_tx.source_id <> p_delivery_batch_id::text then
    raise exception 'WMS khong lien ket dung Dot giao.' using errcode = '22023';
  end if;
  if v_tx.status <> 'PENDING'::public.transaction_status then
    raise exception 'Chi sua Dot giao khi WMS con o trang thai cho duyet.' using errcode = '22023';
  end if;

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

    select * into v_existing_line
    from public.purchase_order_delivery_lines
    where delivery_batch_id = p_delivery_batch_id
      and purchase_order_line_id = v_purchase_order_line_id
      and item_id = v_item_id
    for update;
    if not found then
      raise exception 'Khong duoc doi vat tu hoac PO line cua Dot giao.' using errcode = '22023';
    end if;
    if v_existing_line.id = any(v_seen_line_ids) then
      raise exception 'Dong Dot giao bi lap trong lenh cap nhat.' using errcode = '22023';
    end if;

    update public.purchase_order_delivery_lines
    set planned_qty = v_purchase_qty,
        unit = v_purchase_unit,
        delivery_unit_price = v_purchase_unit_price,
        stock_planned_qty = v_stock_qty,
        stock_unit = v_stock_unit,
        updated_at = now()
    where id = v_existing_line.id;

    v_seen_line_ids := array_append(v_seen_line_ids, v_existing_line.id);
    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id,
      'quantity', v_stock_qty,
      'orderedQty', v_stock_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_purchase_qty,
      'accountingUnit', v_purchase_unit,
      'accountingPrice', v_purchase_unit_price,
      'purchaseOrderLineId', v_purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', p_delivery_batch_id,
      'purchaseOrderDeliveryLineId', v_existing_line.id,
      'fulfillmentMode', p_fulfillment_mode
    ));
  end loop;

  if exists (
    select 1
    from public.purchase_order_delivery_lines line
    where line.delivery_batch_id = p_delivery_batch_id
      and not (line.id = any(v_seen_line_ids))
  ) then
    raise exception 'Khong duoc them hoac xoa dong vat tu cua Dot giao.' using errcode = '22023';
  end if;

  update public.purchase_order_delivery_batches
  set supplier_id = nullif(p_supplier_id, ''),
      supplier_name_snapshot = nullif(p_supplier_name, ''),
      fulfillment_mode = p_fulfillment_mode,
      vat_rate = coalesce(p_vat_rate, 0),
      planned_delivery_date = p_planned_delivery_date,
      note = nullif(p_note, ''),
      updated_at = now()
  where id = p_delivery_batch_id;

  update public.transactions
  set items = v_wms_items,
      target_warehouse_id = p_target_warehouse_id,
      supplier_id = nullif(p_supplier_id, ''),
      business_partner_id = null,
      business_partner_name_snapshot = nullif(p_supplier_name, ''),
      note = coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0') || ' dang giao',
      updated_by = p_actor_user_id
  where id = p_wms_transaction_id;

  return app_private.purchase_delivery_command_result_v2(p_delivery_batch_id);
end;
$$;

revoke all on function app_private.update_unreceived_delivery_batch_v2(
  uuid, text, text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from public, anon;
grant execute on function app_private.update_unreceived_delivery_batch_v2(
  uuid, text, text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) to authenticated;

create or replace function public.update_unreceived_delivery_batch_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_purchase_order_id text,
  p_idempotency_key uuid,
  p_supplier_id text,
  p_supplier_name text,
  p_fulfillment_mode text,
  p_vat_rate numeric,
  p_target_warehouse_id text,
  p_planned_delivery_date date default null,
  p_note text default null,
  p_actor_user_id uuid default null,
  p_lines jsonb default '[]'::jsonb
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

  return app_private.update_unreceived_delivery_batch_v2(
    p_delivery_batch_id, p_wms_transaction_id, p_purchase_order_id,
    p_idempotency_key, p_supplier_id, p_supplier_name, p_fulfillment_mode,
    p_vat_rate, p_target_warehouse_id, p_planned_delivery_date, p_note,
    v_actor, p_lines
  );
end;
$$;

revoke all on function public.update_unreceived_delivery_batch_v2(
  uuid, text, text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from public, anon;
grant execute on function public.update_unreceived_delivery_batch_v2(
  uuid, text, text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) to authenticated;

create or replace function app_private.cancel_unreceived_delivery_batch_v2(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_batch_purchase_order_id text;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Ly do huy Dot giao la bat buoc.' using errcode = '22023';
  end if;

  select purchase_order_id into v_batch_purchase_order_id
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch_purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_batch.status = 'quality_approved' then
    raise exception 'Dot da Duyet SL/CL va khong con duoc sua.';
  end if;
  if v_batch.status <> 'receiving' then
    raise exception 'Chi huy Dot giao chua nhan va dang cho WMS.' using errcode = '22023';
  end if;
  if nullif(v_batch.wms_transaction_id, '') is null then
    raise exception 'Dot giao chua co WMS de huy.' using errcode = '22023';
  end if;

  perform app_private.assert_project_permission_room_action(
    v_po.project_id,
    v_po.construction_site_id,
    'material_po',
    'submit',
    p_actor_user_id
  );

  select * into v_tx
  from public.transactions
  where id = v_batch.wms_transaction_id
  for update;
  if not found then
    raise exception 'Khong tim thay WMS cua Dot giao.' using errcode = '22023';
  end if;
  if v_tx.source_type <> 'po_delivery_batch' or v_tx.source_id <> p_delivery_batch_id::text then
    raise exception 'WMS khong lien ket dung Dot giao.' using errcode = '22023';
  end if;
  if v_tx.status <> 'PENDING'::public.transaction_status then
    raise exception 'Chi huy Dot giao khi WMS con o trang thai cho duyet.' using errcode = '22023';
  end if;

  update public.purchase_order_delivery_batches
  set status = 'cancelled',
      note = concat_ws(E'\n', nullif(note, ''), 'Huy Dot giao: ' || p_reason),
      updated_at = now()
  where id = p_delivery_batch_id;

  update public.transactions
  set status = 'CANCELLED'::public.transaction_status,
      note = concat_ws(E'\n', nullif(note, ''), 'Huy Dot giao: ' || p_reason),
      updated_by = p_actor_user_id
  where id = v_batch.wms_transaction_id;
end;
$$;

revoke all on function app_private.cancel_unreceived_delivery_batch_v2(uuid, uuid, text)
  from public, anon;
grant execute on function app_private.cancel_unreceived_delivery_batch_v2(uuid, uuid, text)
  to authenticated;

create or replace function public.cancel_unreceived_delivery_batch_v2(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid default null,
  p_reason text default null
) returns void
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

  perform app_private.cancel_unreceived_delivery_batch_v2(
    p_delivery_batch_id,
    v_actor,
    p_reason
  );
end;
$$;

revoke all on function public.cancel_unreceived_delivery_batch_v2(uuid, uuid, text)
  from public, anon;
grant execute on function public.cancel_unreceived_delivery_batch_v2(uuid, uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
