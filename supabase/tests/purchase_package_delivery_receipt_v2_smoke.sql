begin;

do $$
begin
  if to_regprocedure('public.create_delivery_batch_with_wms_qr_v2(text,uuid,text,text,text,numeric,text,date,text,uuid,jsonb)') is null then
    raise exception 'Missing create_delivery_batch_with_wms_qr_v2 RPC';
  end if;
  if to_regprocedure('public.update_unreceived_delivery_batch_v2(uuid,text,text,uuid,text,text,text,numeric,text,date,text,uuid,jsonb)') is null then
    raise exception 'Missing update_unreceived_delivery_batch_v2 RPC';
  end if;
  if to_regprocedure('public.cancel_unreceived_delivery_batch_v2(uuid,uuid,text)') is null then
    raise exception 'Missing cancel_unreceived_delivery_batch_v2 RPC';
  end if;
end $$;

create temp table purchase_package_v2_smoke_ids (
  project_id text not null,
  site_id text not null,
  warehouse_id text not null,
  item_id text not null,
  supplier_id text not null,
  actor_id uuid not null,
  position_id uuid not null,
  staff_id uuid not null,
  room_member_id uuid not null,
  po_id text not null,
  po_number text not null,
  po_line_id text not null,
  idempotency_key uuid not null,
  cancel_key uuid not null,
  mislink_key uuid not null,
  bad_key uuid not null,
  created_batch_id uuid,
  created_wms_transaction_id text,
  cancel_batch_id uuid,
  cancel_wms_transaction_id text,
  mislink_batch_id uuid,
  mislink_original_wms_transaction_id text,
  mislink_wrong_wms_transaction_id text
) on commit drop;

grant select, update on table purchase_package_v2_smoke_ids to authenticated;

insert into purchase_package_v2_smoke_ids
values (
  'purchase-package-v2-project-' || gen_random_uuid()::text,
  'purchase-package-v2-site-' || gen_random_uuid()::text,
  'purchase-package-v2-wh-' || gen_random_uuid()::text,
  'purchase-package-v2-item-' || gen_random_uuid()::text,
  'purchase-package-v2-supplier-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'purchase-package-v2-po-' || gen_random_uuid()::text,
  'PO-' || (1000000000 + floor(random() * 899999999)::bigint)::text,
  'purchase-package-v2-line-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  null,
  null,
  null,
  null,
  null,
  null,
  null
);

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select actor_id, 'Purchase Package Smoke Actor', actor_id::text || '@vioo.local',
       'purchase-package-v2-actor', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from purchase_package_v2_smoke_ids;

insert into public.projects (id, code, name, source)
select project_id, 'PP-V2-SMOKE', 'Purchase Package V2 Smoke', 'manual'
from purchase_package_v2_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Purchase Package V2 Position', 1, 'PP-V2', true, 0, 'smoke', '{"slice":"purchase_package_v2"}'::jsonb
from purchase_package_v2_smoke_ids;

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'Purchase Package V2 Warehouse', 'Smoke address', 'SITE'
from purchase_package_v2_smoke_ids;

insert into public.items (id, sku, name, category, unit, purchase_unit, purchase_conversion_factor, price_in, price_out, min_stock)
select item_id, 'PP-V2-SMOKE', 'Purchase Package V2 Item', 'Smoke', 'Kg', 'Kg', 1, 10000, 10000, 0
from purchase_package_v2_smoke_ids;

insert into public.suppliers (id, name, contact_person, phone)
select supplier_id, 'NCC Smoke', 'Smoke Contact', '0900000000'
from purchase_package_v2_smoke_ids;

insert into public.project_staff (id, project_id, construction_site_id, user_id, position_id, start_date, note)
select staff_id, project_id, site_id, actor_id::text, position_id, current_date, 'purchase package v2 smoke actor'
from purchase_package_v2_smoke_ids;

insert into public.project_permission_room_members (
  id, project_id, construction_site_id, room_code, project_staff_id, is_active, created_by
)
select room_member_id, project_id, site_id, 'material_po', staff_id, true, actor_id
from purchase_package_v2_smoke_ids;

insert into public.project_permission_room_member_actions (room_member_id, action_code, is_active, granted_by)
select room_member_id, 'submit', true, actor_id
from purchase_package_v2_smoke_ids;

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
select actor_id, 'project.material_po.create', 'project', project_id, true
from purchase_package_v2_smoke_ids;

insert into app_private.purchase_order_number_registry(po_number)
select po_number
from purchase_package_v2_smoke_ids
on conflict (po_number) do nothing;

insert into public.purchase_orders (
  id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
  total_amount, approved_total_amount, purchase_mode, fulfillment_mode, reference_gross_amount,
  order_date, status, source_mode, target_warehouse_id, created_by_id, created_at
)
select
  po_id, project_id, site_id, supplier_id, 'NCC Smoke', po_number,
  jsonb_build_array(jsonb_build_object(
    'lineId', po_line_id,
    'itemId', item_id,
    'sku', 'PP-V2-SMOKE',
    'name', 'Purchase Package V2 Item',
    'unit', 'Kg',
    'unitSnapshot', 'Kg',
    'purchaseUnitSnapshot', 'Kg',
    'stockUnitSnapshot', 'Kg',
    'qty', 10,
    'unitPrice', 10000
  )),
  100000, 100000, 'multiple', 'RECEIVE_TO_STOCK', 110000,
  current_date::text, 'confirmed', 'from_request', warehouse_id, actor_id::text, now()
from purchase_package_v2_smoke_ids;

set role authenticated;

create or replace function pg_temp.purchase_package_v2_set_user(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.email', p_user_id::text || '@vioo.local', true);
  select set_config('request.jwt.claim.sub', p_user_id::text, true);
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('email', p_user_id::text || '@vioo.local', 'sub', p_user_id::text)::text,
    true
  );
$$;

select pg_temp.purchase_package_v2_set_user(actor_id)
from purchase_package_v2_smoke_ids;

do $$
declare
  v_ids purchase_package_v2_smoke_ids%rowtype := (select ids from purchase_package_v2_smoke_ids ids);
  v_result jsonb;
  v_retry jsonb;
  v_batch_id uuid;
  v_cancel_result jsonb;
  v_cancel_batch_id uuid;
  v_mislink_result jsonb;
  v_mislink_batch_id uuid;
begin
  v_result := public.create_delivery_batch_with_wms_qr_v2(
    p_purchase_order_id := v_ids.po_id,
    p_idempotency_key := v_ids.idempotency_key,
    p_supplier_id := v_ids.supplier_id,
    p_supplier_name := 'NCC Smoke',
    p_fulfillment_mode := 'RECEIVE_TO_STOCK',
    p_vat_rate := 10,
    p_target_warehouse_id := v_ids.warehouse_id,
    p_planned_delivery_date := current_date,
    p_note := 'first delivery',
    p_actor_user_id := v_ids.actor_id,
    p_lines := jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_ids.po_line_id,
      'itemId', v_ids.item_id,
      'purchaseQty', 10,
      'purchaseUnit', 'Kg',
      'stockQty', 10,
      'stockUnit', 'Kg',
      'purchaseUnitPrice', 10000,
      'stockUnitPrice', 10000
    ))
  );

  v_batch_id := (v_result ->> 'deliveryBatchId')::uuid;
  if v_batch_id is null or nullif(v_result ->> 'wmsTransactionId', '') is null or nullif(v_result ->> 'qrToken', '') is null then
    raise exception 'Create command did not return delivery/WMS/QR result: %', v_result;
  end if;

  begin
    v_retry := public.create_delivery_batch_with_wms_qr_v2(
      p_purchase_order_id := v_ids.po_id,
      p_idempotency_key := v_ids.idempotency_key,
      p_supplier_id := v_ids.supplier_id,
      p_supplier_name := 'NCC Smoke',
      p_fulfillment_mode := 'RECEIVE_TO_STOCK',
      p_vat_rate := 10,
      p_target_warehouse_id := v_ids.warehouse_id,
      p_planned_delivery_date := current_date,
      p_note := 'first delivery retry',
      p_actor_user_id := v_ids.actor_id,
      p_lines := jsonb_build_array(jsonb_build_object(
        'purchaseOrderLineId', v_ids.po_line_id,
        'itemId', v_ids.item_id,
        'purchaseQty', 10,
        'purchaseUnit', 'Kg',
        'stockQty', 10,
        'stockUnit', 'Kg',
        'purchaseUnitPrice', 10000,
        'stockUnitPrice', 10000
      ))
    );
  exception when unique_violation then
    raise exception 'Idempotent double-submit leaked unique violation.';
  end;

  if v_retry ->> 'deliveryBatchId' is distinct from v_result ->> 'deliveryBatchId'
     or v_retry ->> 'wmsTransactionId' is distinct from v_result ->> 'wmsTransactionId'
     or v_retry ->> 'qrToken' is distinct from v_result ->> 'qrToken' then
    raise exception 'Idempotent retry returned a different result.';
  end if;

  perform public.update_unreceived_delivery_batch_v2(
    p_delivery_batch_id := v_batch_id,
    p_wms_transaction_id := v_result ->> 'wmsTransactionId',
    p_purchase_order_id := v_ids.po_id,
    p_idempotency_key := v_ids.idempotency_key,
    p_supplier_id := v_ids.supplier_id,
    p_supplier_name := 'NCC Smoke Updated',
    p_fulfillment_mode := 'RECEIVE_TO_STOCK',
    p_vat_rate := 8,
    p_target_warehouse_id := v_ids.warehouse_id,
    p_planned_delivery_date := current_date + 1,
    p_note := 'updated delivery',
    p_actor_user_id := v_ids.actor_id,
    p_lines := jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_ids.po_line_id,
      'itemId', v_ids.item_id,
      'purchaseQty', 12,
      'purchaseUnit', 'Kg',
      'stockQty', 12,
      'stockUnit', 'Kg',
      'purchaseUnitPrice', 9000,
      'stockUnitPrice', 9000
    ))
  );

  begin
    perform public.update_unreceived_delivery_batch_v2(
      p_delivery_batch_id := v_batch_id,
      p_wms_transaction_id := v_result ->> 'wmsTransactionId',
      p_purchase_order_id := v_ids.po_id,
      p_idempotency_key := v_ids.idempotency_key,
      p_supplier_id := v_ids.supplier_id,
      p_supplier_name := 'NCC Smoke Updated',
      p_fulfillment_mode := 'RECEIVE_TO_STOCK',
      p_vat_rate := 8,
      p_target_warehouse_id := v_ids.warehouse_id,
      p_planned_delivery_date := current_date + 1,
      p_note := 'duplicate update should fail',
      p_actor_user_id := v_ids.actor_id,
      p_lines := jsonb_build_array(
        jsonb_build_object(
          'purchaseOrderLineId', v_ids.po_line_id,
          'itemId', v_ids.item_id,
          'purchaseQty', 12,
          'purchaseUnit', 'Kg',
          'stockQty', 12,
          'stockUnit', 'Kg',
          'purchaseUnitPrice', 9000,
          'stockUnitPrice', 9000
        ),
        jsonb_build_object(
          'purchaseOrderLineId', v_ids.po_line_id,
          'itemId', v_ids.item_id,
          'purchaseQty', 12,
          'purchaseUnit', 'Kg',
          'stockQty', 12,
          'stockUnit', 'Kg',
          'purchaseUnitPrice', 9000,
          'stockUnitPrice', 9000
        )
      )
    );
    raise exception 'Duplicate update lines unexpectedly succeeded.';
  exception
    when invalid_parameter_value then
      null;
  end;

  v_cancel_result := public.create_delivery_batch_with_wms_qr_v2(
    p_purchase_order_id := v_ids.po_id,
    p_idempotency_key := v_ids.cancel_key,
    p_supplier_id := v_ids.supplier_id,
    p_supplier_name := 'NCC Smoke',
    p_fulfillment_mode := 'RECEIVE_TO_STOCK',
    p_vat_rate := 0,
    p_target_warehouse_id := v_ids.warehouse_id,
    p_planned_delivery_date := current_date,
    p_note := 'cancel delivery',
    p_actor_user_id := v_ids.actor_id,
    p_lines := jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_ids.po_line_id,
      'itemId', v_ids.item_id,
      'purchaseQty', 1,
      'purchaseUnit', 'Kg',
      'stockQty', 1,
      'stockUnit', 'Kg',
      'purchaseUnitPrice', 10000,
      'stockUnitPrice', 10000
    ))
  );
  v_cancel_batch_id := (v_cancel_result ->> 'deliveryBatchId')::uuid;
  if v_cancel_batch_id is null or nullif(v_cancel_result ->> 'wmsTransactionId', '') is null then
    raise exception 'Create command did not return cancellable delivery result: %', v_cancel_result;
  end if;

  perform public.cancel_unreceived_delivery_batch_v2(
    v_cancel_batch_id,
    v_ids.actor_id,
    'cancel smoke delivery'
  );

  v_mislink_result := public.create_delivery_batch_with_wms_qr_v2(
    p_purchase_order_id := v_ids.po_id,
    p_idempotency_key := v_ids.mislink_key,
    p_supplier_id := v_ids.supplier_id,
    p_supplier_name := 'NCC Smoke',
    p_fulfillment_mode := 'RECEIVE_TO_STOCK',
    p_vat_rate := 0,
    p_target_warehouse_id := v_ids.warehouse_id,
    p_planned_delivery_date := current_date,
    p_note := 'mislinked cancel delivery',
    p_actor_user_id := v_ids.actor_id,
    p_lines := jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_ids.po_line_id,
      'itemId', v_ids.item_id,
      'purchaseQty', 1,
      'purchaseUnit', 'Kg',
      'stockQty', 1,
      'stockUnit', 'Kg',
      'purchaseUnitPrice', 10000,
      'stockUnitPrice', 10000
    ))
  );
  v_mislink_batch_id := (v_mislink_result ->> 'deliveryBatchId')::uuid;
  if v_mislink_batch_id is null or nullif(v_mislink_result ->> 'wmsTransactionId', '') is null then
    raise exception 'Create command did not return mislink delivery result: %', v_mislink_result;
  end if;

  begin
    perform public.create_delivery_batch_with_wms_qr_v2(
      p_purchase_order_id := v_ids.po_id,
      p_idempotency_key := v_ids.bad_key,
      p_supplier_id := v_ids.supplier_id,
      p_supplier_name := 'NCC Smoke',
      p_fulfillment_mode := 'RECEIVE_TO_STOCK',
      p_vat_rate := 10,
      p_target_warehouse_id := v_ids.warehouse_id,
      p_planned_delivery_date := current_date,
      p_note := 'bad delivery',
      p_actor_user_id := v_ids.actor_id,
      p_lines := jsonb_build_array(jsonb_build_object(
        'purchaseOrderLineId', v_ids.po_line_id,
        'itemId', v_ids.item_id,
        'purchaseQty', -1,
        'purchaseUnit', 'Kg',
        'stockQty', -1,
        'stockUnit', 'Kg',
        'purchaseUnitPrice', 10000,
        'stockUnitPrice', 10000
      ))
    );
    raise exception 'Negative quantity delivery unexpectedly succeeded.';
  exception
    when invalid_parameter_value then
      null;
    when check_violation then
      null;
  end;

  update purchase_package_v2_smoke_ids
  set
    created_batch_id = v_batch_id,
    created_wms_transaction_id = v_result ->> 'wmsTransactionId',
    cancel_batch_id = v_cancel_batch_id,
    cancel_wms_transaction_id = v_cancel_result ->> 'wmsTransactionId',
    mislink_batch_id = v_mislink_batch_id,
    mislink_original_wms_transaction_id = v_mislink_result ->> 'wmsTransactionId';
end $$;

reset role;

do $$
declare
  v_ids purchase_package_v2_smoke_ids%rowtype := (select ids from purchase_package_v2_smoke_ids ids);
  v_wrong_tx_id text := 'tx-po-delivery-wrong-' || replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, approver_id, status, note,
    business_partner_id, business_partner_name_snapshot, source_type, source_id
  ) values (
    v_wrong_tx_id, 'IMPORT'::public.transaction_type, now(), '[]'::jsonb, v_ids.warehouse_id, v_ids.supplier_id,
    v_ids.actor_id, v_ids.actor_id, v_ids.actor_id, 'PENDING'::public.transaction_status,
    'wrong transaction for purchase package smoke',
    null, 'NCC Smoke Wrong', 'po_delivery_batch', 'wrong-' || v_ids.mislink_batch_id::text
  );

  update public.purchase_order_delivery_batches
  set wms_transaction_id = v_wrong_tx_id
  where id = v_ids.mislink_batch_id;

  update purchase_package_v2_smoke_ids
  set mislink_wrong_wms_transaction_id = v_wrong_tx_id;
end $$;

set role authenticated;

select pg_temp.purchase_package_v2_set_user(actor_id)
from purchase_package_v2_smoke_ids;

do $$
declare
  v_ids purchase_package_v2_smoke_ids%rowtype := (select ids from purchase_package_v2_smoke_ids ids);
begin
  begin
    perform public.cancel_unreceived_delivery_batch_v2(
      v_ids.mislink_batch_id,
      v_ids.actor_id,
      'mislinked WMS should fail'
    );
    raise exception 'Mislinked WMS cancel unexpectedly succeeded.';
  exception
    when invalid_parameter_value then
      null;
  end;
end $$;

reset role;

do $$
declare
  v_ids purchase_package_v2_smoke_ids%rowtype := (select ids from purchase_package_v2_smoke_ids ids);
  v_batch_count integer;
begin
  select count(*) into v_batch_count
  from public.purchase_order_delivery_batches
  where purchase_order_id = v_ids.po_id and idempotency_key = v_ids.idempotency_key;

  if v_batch_count <> 1 then
    raise exception 'Idempotent create produced unexpected delivery batch count: %.', v_batch_count;
  end if;

  if (
    select count(*) from public.transactions
    where source_type = 'po_delivery_batch' and source_id = v_ids.created_batch_id::text
  ) <> 1 then
    raise exception 'Create command did not create exactly one WMS source transaction.';
  end if;

  if not exists (
    select 1
    from public.purchase_order_delivery_batches batch
    join public.purchase_order_delivery_lines line on line.delivery_batch_id = batch.id
    join public.transactions tx on tx.id = batch.wms_transaction_id
    where batch.id = v_ids.created_batch_id
      and batch.vat_rate = 8
      and batch.supplier_name_snapshot = 'NCC Smoke Updated'
      and batch.wms_transaction_id = v_ids.created_wms_transaction_id
      and line.planned_qty = 12
      and line.delivery_unit_price = 9000
      and tx.target_warehouse_id = v_ids.warehouse_id
      and jsonb_array_length(tx.items) = 1
      and (tx.items -> 0 ->> 'quantity')::numeric = 12
  ) then
    raise exception 'Update command did not update delivery and WMS snapshots.';
  end if;

  if not exists (
    select 1
    from public.purchase_order_delivery_batches batch
    join public.transactions tx on tx.id = batch.wms_transaction_id
    where batch.id = v_ids.cancel_batch_id
      and batch.wms_transaction_id = v_ids.cancel_wms_transaction_id
      and batch.status = 'cancelled'
      and tx.status::text = 'CANCELLED'
  ) then
    raise exception 'Cancel command did not cancel both delivery and WMS.';
  end if;

  if exists (
    select 1
    from public.purchase_order_delivery_batches
    where purchase_order_id = v_ids.po_id and idempotency_key = v_ids.bad_key
  ) then
    raise exception 'Failed negative-quantity command left a delivery batch behind.';
  end if;

  if not exists (
    select 1
    from public.purchase_order_delivery_batches batch
    join public.transactions wrong_tx on wrong_tx.id = batch.wms_transaction_id
    join public.transactions original_tx on original_tx.id = v_ids.mislink_original_wms_transaction_id
    where batch.id = v_ids.mislink_batch_id
      and batch.wms_transaction_id = v_ids.mislink_wrong_wms_transaction_id
      and batch.status = 'receiving'
      and wrong_tx.status::text = 'PENDING'
      and wrong_tx.source_id <> batch.id::text
      and original_tx.status::text = 'PENDING'
  ) then
    raise exception 'Mislinked WMS cancel changed delivery or transaction state.';
  end if;
end $$;
rollback;
