create schema if not exists app_private;

create or replace function app_private.purchase_receipt_command_result_v2(
  p_delivery_batch_id uuid,
  p_already_finalized boolean default false
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'deliveryBatchId', batch.id::text,
    'wmsTransactionId', coalesce(batch.wms_transaction_id, ''),
    'deliveryStatus', batch.status,
    'transactionStatus', tx.status::text,
    'acceptedGrossAmount', coalesce(batch.accepted_gross_amount, 0),
    'alreadyFinalized', p_already_finalized
  )
  from public.purchase_order_delivery_batches batch
  join public.transactions tx on tx.id = batch.wms_transaction_id
  where batch.id = p_delivery_batch_id;
$$;

revoke all on function app_private.purchase_receipt_command_result_v2(uuid, boolean)
  from public, anon;
grant execute on function app_private.purchase_receipt_command_result_v2(uuid, boolean)
  to authenticated;

create or replace function app_private.current_user_can_receive_purchase_batch_v2(
  p_actor_user_id uuid,
  p_target_warehouse_id text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_target_warehouse_id)
    or exists (
      select 1
      from public.users u
      where u.id = p_actor_user_id
        and u.is_active is not false
        and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
        and u.role::text in ('ADMIN', 'WAREHOUSE_KEEPER', 'KEEPER')
        and (
          u.assigned_warehouse_id is null
          or u.assigned_warehouse_id = p_target_warehouse_id
        )
    ),
    false
  );
$$;

revoke all on function app_private.current_user_can_receive_purchase_batch_v2(uuid, text)
  from public, anon;
grant execute on function app_private.current_user_can_receive_purchase_batch_v2(uuid, text)
  to authenticated;

create or replace function app_private.approve_receipt_quality_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid,
  p_quality_result text,
  p_lines jsonb,
  p_attachments jsonb
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
  v_line jsonb;
  v_delivery_line public.purchase_order_delivery_lines%rowtype;
  v_delivery_line_id uuid;
  v_item_id text;
  v_accepted_purchase_qty numeric;
  v_accepted_stock_qty numeric;
  v_expected_stock_qty numeric;
  v_stock_factor numeric;
  v_variance_reason text;
  v_seen_line_ids uuid[] := '{}'::uuid[];
  v_expected_line_count integer;
  v_wms_items jsonb := '[]'::jsonb;
  v_gross numeric := 0;
  v_combined_reason text;
  v_variance_qty numeric;
  v_stock_unit_price numeric;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if p_quality_result not in ('passed', 'partial', 'rejected') then
    raise exception 'Ket qua kiem tra SL/CL khong hop le.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Dong nhan hang khong hop le.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Dinh kem nhan hang khong hop le.' using errcode = '22023';
  end if;

  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_po_id
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
  if v_batch.wms_transaction_id is distinct from p_wms_transaction_id then
    raise exception 'WMS transaction khong khop Dot giao.' using errcode = '22023';
  end if;
  if v_batch.status <> 'receiving' then
    raise exception 'Dot giao da khoa hoac khong con cho duyet SL/CL.' using errcode = '22023';
  end if;

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
    raise exception 'Phieu WMS da khoa va khong con cho duyet SL/CL.' using errcode = '22023';
  end if;
  if not app_private.current_user_can_receive_purchase_batch_v2(p_actor_user_id, v_tx.target_warehouse_id) then
    raise exception 'Nguoi dung khong co quyen duyet SL/CL tai kho nhan.' using errcode = '42501';
  end if;

  select count(*) into v_expected_line_count
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id;
  if v_expected_line_count = 0 or jsonb_array_length(p_lines) <> v_expected_line_count then
    raise exception 'Payload nhan hang phai khop 1-1 voi dong Dot giao.' using errcode = '22023';
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines) as line(value)
  loop
    v_delivery_line_id := nullif(coalesce(v_line ->> 'deliveryLineId', v_line ->> 'delivery_line_id'), '')::uuid;
    v_item_id := nullif(coalesce(v_line ->> 'itemId', v_line ->> 'item_id'), '');
    v_accepted_purchase_qty := coalesce(
      nullif(coalesce(v_line ->> 'acceptedPurchaseQty', v_line ->> 'accepted_purchase_qty'), '')::numeric,
      0
    );
    v_accepted_stock_qty := coalesce(
      nullif(coalesce(v_line ->> 'acceptedStockQty', v_line ->> 'accepted_stock_qty'), '')::numeric,
      0
    );
    v_variance_reason := nullif(trim(coalesce(v_line ->> 'varianceReason', v_line ->> 'variance_reason', '')), '');

    if v_delivery_line_id is null or v_item_id is null then
      raise exception 'Dong nhan hang thieu deliveryLineId hoac itemId.' using errcode = '22023';
    end if;
    if v_delivery_line_id = any(v_seen_line_ids) then
      raise exception 'Dong nhan hang bi lap.' using errcode = '22023';
    end if;
    if v_accepted_purchase_qty < 0 or v_accepted_stock_qty < 0 then
      raise exception 'So luong thuc nhan khong duoc am.' using errcode = '22023';
    end if;

    select * into v_delivery_line
    from public.purchase_order_delivery_lines
    where id = v_delivery_line_id
      and delivery_batch_id = p_delivery_batch_id
    for update;
    if not found then
      raise exception 'Dong nhan hang khong thuoc Dot giao.' using errcode = '22023';
    end if;
    if v_delivery_line.item_id <> v_item_id then
      raise exception 'Vat tu nhan hang khong khop dong Dot giao.' using errcode = '22023';
    end if;

    v_stock_factor := case
      when coalesce(v_delivery_line.planned_qty, 0) > 0
        and coalesce(v_delivery_line.stock_planned_qty, 0) > 0
        then v_delivery_line.stock_planned_qty / v_delivery_line.planned_qty
      else 1
    end;
    v_expected_stock_qty := round(v_accepted_purchase_qty * v_stock_factor, 6);
    if abs(v_expected_stock_qty - round(v_accepted_stock_qty, 6)) > 0.000001 then
      raise exception 'So luong ton kho thuc nhan khong khop snapshot quy doi.' using errcode = '22023';
    end if;
    if v_accepted_purchase_qty is distinct from coalesce(v_delivery_line.planned_qty, 0)
       and v_variance_reason is null then
      raise exception 'Phai nhap ly do khi so luong thuc nhan lech Dot giao.' using errcode = '22023';
    end if;

    update public.purchase_order_delivery_lines
    set accepted_qty = v_accepted_purchase_qty,
        accepted_stock_qty = v_accepted_stock_qty,
        updated_at = now()
    where id = v_delivery_line.id;

    v_seen_line_ids := array_append(v_seen_line_ids, v_delivery_line.id);
    v_variance_qty := v_accepted_purchase_qty - coalesce(v_delivery_line.planned_qty, 0);
    if v_variance_reason is not null then
      v_combined_reason := concat_ws('; ', v_combined_reason, v_variance_reason);
    end if;
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
      'price', v_stock_unit_price,
      'accountingQty', v_accepted_purchase_qty,
      'accountingUnit', coalesce(v_delivery_line.unit, v_delivery_line.stock_unit, ''),
      'accountingPrice', coalesce(v_delivery_line.delivery_unit_price, 0),
      'varianceQty', v_variance_qty,
      'varianceReason', v_variance_reason,
      'purchaseOrderLineId', v_delivery_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', p_delivery_batch_id,
      'purchaseOrderDeliveryLineId', v_delivery_line.id,
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK')
    ));
  end loop;

  if coalesce(array_length(v_seen_line_ids, 1), 0) <> v_expected_line_count then
    raise exception 'Payload nhan hang thieu dong Dot giao.' using errcode = '22023';
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
$$;

revoke all on function app_private.approve_receipt_quality_v2(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon;
grant execute on function app_private.approve_receipt_quality_v2(uuid, text, uuid, text, jsonb, jsonb)
  to authenticated;

create or replace function public.approve_receipt_quality_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid default null,
  p_quality_result text default 'passed',
  p_lines jsonb default '[]'::jsonb,
  p_attachments jsonb default '[]'::jsonb
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

  return app_private.approve_receipt_quality_v2(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor,
    p_quality_result,
    p_lines,
    p_attachments
  );
end;
$$;

revoke all on function public.approve_receipt_quality_v2(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.approve_receipt_quality_v2(uuid, text, uuid, text, jsonb, jsonb)
  to authenticated;

create or replace function app_private.finalize_purchase_receipt_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
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
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_planned_purchase_qty numeric;
  v_accepted_purchase_qty numeric;
  v_delivery_status text;
  v_next_items jsonb;
  v_is_delivered boolean;
  v_already_recorded boolean;
  v_previous_guard text;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;

  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_po_id
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
  if v_batch.wms_transaction_id is distinct from p_wms_transaction_id then
    raise exception 'WMS transaction khong khop Dot giao.' using errcode = '22023';
  end if;

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
  if not app_private.current_user_can_receive_purchase_batch_v2(p_actor_user_id, v_tx.target_warehouse_id) then
    raise exception 'Nguoi dung khong co quyen xac nhan nhan hang tai kho nhan.' using errcode = '42501';
  end if;

  if v_batch.status in ('received', 'received_short', 'received_over')
     and v_tx.status = 'COMPLETED'::public.transaction_status then
    return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, true);
  end if;
  if v_batch.status in ('received', 'received_short', 'received_over')
     or v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'Anomaly: Dot giao va WMS khong dong bo trang thai finalize.' using errcode = 'P0001';
  end if;
  if v_batch.status <> 'quality_approved' or v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'Chi finalize Dot da duyet SL/CL va WMS APPROVED.' using errcode = '22023';
  end if;

  perform 1
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id
  order by id
  for update;

  perform 1
  from public.items item
  where item.id in (
    select distinct line.value ->> 'itemId'
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
    where nullif(line.value ->> 'itemId', '') is not null
  )
  order by item.id
  for update;

  if coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK') = 'RECEIVE_TO_STOCK' then
    for v_item in
      select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) as item(value)
    loop
      v_item_id := nullif(v_item ->> 'itemId', '');
      v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
      if v_item_id is null or v_qty < 0 then
        raise exception 'WMS item nhan hang khong hop le.' using errcode = '22023';
      end if;
      if v_qty > 0 then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  elsif coalesce(v_batch.fulfillment_mode, '') <> 'DIRECT_CONSUMPTION' then
    raise exception 'Fulfillment mode khong hop le: %', v_batch.fulfillment_mode using errcode = '22023';
  end if;

  update public.transactions
  set status = 'COMPLETED'::public.transaction_status,
      approver_id = p_actor_user_id,
      approved_at = coalesce(approved_at, now())
  where id = p_wms_transaction_id
  returning * into v_tx;

  select
    coalesce(sum(coalesce(planned_qty, 0)), 0),
    coalesce(sum(coalesce(accepted_qty, 0)), 0)
  into v_planned_purchase_qty, v_accepted_purchase_qty
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id;

  v_delivery_status := case
    when v_accepted_purchase_qty > v_planned_purchase_qty then 'received_over'
    when v_accepted_purchase_qty < v_planned_purchase_qty then 'received_short'
    else 'received'
  end;

  update public.purchase_order_delivery_batches
  set status = v_delivery_status,
      received_by = p_actor_user_id,
      received_at = now(),
      updated_at = now()
  where id = p_delivery_batch_id
  returning * into v_batch;

  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_po.received_transaction_ids, '[]'::jsonb)) existing(id)
    where existing.id = v_tx.id
  ) into v_already_recorded;

  with receipt_by_line as (
    select
      purchase_order_line_id,
      sum(coalesce(accepted_qty, 0)) as accepted_purchase_qty
    from public.purchase_order_delivery_lines
    where delivery_batch_id = p_delivery_batch_id
    group by purchase_order_line_id
  ),
  item_rows as (
    select
      item.value as item,
      item.ordinality,
      coalesce(item.value ->> 'lineId', item.value ->> 'line_id', item.value ->> 'itemId', item.value ->> 'item_id') as line_key,
      coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0) as current_received_qty
    from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality item(value, ordinality)
  ),
  next_rows as (
    select
      case
        when coalesce(r.accepted_purchase_qty, 0) > 0 then
          jsonb_set(
            ir.item,
            '{receivedQty}',
            to_jsonb(ir.current_received_qty + coalesce(r.accepted_purchase_qty, 0)),
            true
          )
        else ir.item
      end as item,
      ir.ordinality
    from item_rows ir
    left join receipt_by_line r on r.purchase_order_line_id = ir.line_key
  )
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
  into v_next_items
  from next_rows;

  select coalesce(bool_and(
    coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0)
      >= coalesce(nullif(item.value ->> 'qty', '')::numeric, 0)
  ), false)
  into v_is_delivered
  from jsonb_array_elements(coalesce(v_next_items, '[]'::jsonb)) item(value);

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_orders
  set items = v_next_items,
      status = case when v_is_delivered then 'delivered' else 'partial' end,
      actual_delivery_date = case when v_is_delivered then current_date::text else actual_delivery_date end,
      received_transaction_ids = case
        when v_already_recorded then coalesce(received_transaction_ids, '[]'::jsonb)
        else coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx.id)
      end
  where id = v_po.id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);

  update public.material_request_fulfillment_lines mfl
  set received_qty = coalesce(line.accepted_stock_qty, line.accepted_qty, 0),
      variance_reason = coalesce(v_batch.variance_reason, mfl.variance_reason),
      updated_at = now()
  from public.purchase_order_delivery_lines line
  where mfl.po_delivery_line_id = line.id
    and line.delivery_batch_id = p_delivery_batch_id;

  update public.material_request_fulfillment_batches
  set status = 'received',
      received_by = p_actor_user_id,
      received_at = now(),
      updated_at = now()
  where po_delivery_batch_id = p_delivery_batch_id
    and status = 'issued';

  return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, false);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function app_private.finalize_purchase_receipt_v2(uuid, text, uuid)
  from public, anon;
grant execute on function app_private.finalize_purchase_receipt_v2(uuid, text, uuid)
  to authenticated;

create or replace function public.finalize_purchase_receipt_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid default null
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

  return app_private.finalize_purchase_receipt_v2(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor
  );
end;
$$;

revoke all on function public.finalize_purchase_receipt_v2(uuid, text, uuid)
  from public, anon;
grant execute on function public.finalize_purchase_receipt_v2(uuid, text, uuid)
  to authenticated;

create or replace function app_private.trg_sync_wms_transaction_inventory_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not (
       new.source_type = 'po_delivery_batch'
       and exists (
         select 1
         from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) item(value)
         where item.value ->> 'fulfillmentMode' = 'DIRECT_CONSUMPTION'
       )
     ) then
    perform app_private.sync_wms_transaction_to_inventory_ledger(new.id);
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
