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
  if to_regprocedure('public.approve_purchase_package_and_prepare_single_batch_v2(text,uuid,uuid)') is null then
    raise exception 'Missing approve_purchase_package_and_prepare_single_batch_v2 RPC';
  end if;
  if to_regprocedure('public.approve_receipt_quality_v2(uuid,text,uuid,text,jsonb,jsonb)') is null then
    raise exception 'Missing approve_receipt_quality_v2 RPC';
  end if;
  if to_regprocedure('public.finalize_purchase_receipt_v2(uuid,text,uuid)') is null then
    raise exception 'Missing finalize_purchase_receipt_v2 RPC';
  end if;
end $$;

create temp table purchase_package_v2_smoke_ids (
  project_id text not null,
  site_id text not null,
  warehouse_id text not null,
  item_id text not null,
  supplier_id text not null,
  actor_id uuid not null,
  approver_id uuid not null,
  position_id uuid not null,
  staff_id uuid not null,
  approver_staff_id uuid not null,
  room_member_id uuid not null,
  approver_room_member_id uuid not null,
  po_id text not null,
  po_number text not null,
  po_line_id text not null,
  approve_single_po_id text not null,
  approve_single_po_number text not null,
  approve_single_line_id text not null,
  approve_multiple_po_id text not null,
  approve_multiple_po_number text not null,
  approve_multiple_line_id text not null,
  idempotency_key uuid not null,
  cancel_key uuid not null,
  mislink_key uuid not null,
  bad_key uuid not null,
  impersonation_key uuid not null,
  approve_single_key uuid not null,
  approve_multiple_key uuid not null,
  approve_over_key uuid not null,
  created_batch_id uuid,
  created_wms_transaction_id text,
  cancel_batch_id uuid,
  cancel_wms_transaction_id text,
  mislink_batch_id uuid,
  mislink_original_wms_transaction_id text,
  mislink_wrong_wms_transaction_id text,
  approve_single_batch_id uuid,
  approve_single_wms_transaction_id text,
  approve_over_batch_id uuid
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
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'purchase-package-v2-po-' || gen_random_uuid()::text,
  'PO-' || (1000000000 + floor(random() * 899999999)::bigint)::text,
  'purchase-package-v2-line-' || gen_random_uuid()::text,
  'purchase-package-v2-approve-single-po-' || gen_random_uuid()::text,
  'PO-' || (1000000000 + floor(random() * 899999999)::bigint)::text,
  'purchase-package-v2-approve-single-line-' || gen_random_uuid()::text,
  'purchase-package-v2-approve-multiple-po-' || gen_random_uuid()::text,
  'PO-' || (1000000000 + floor(random() * 899999999)::bigint)::text,
  'purchase-package-v2-approve-multiple-line-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
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
  null,
  null,
  null,
  null
);

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  assigned_warehouse_id, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select actor_id, 'Purchase Package Smoke Actor', actor_id::text || '@vioo.local',
       'purchase-package-v2-actor', 'WAREHOUSE_KEEPER'::public.user_role, true, 'ACTIVE',
       warehouse_id,
       '{}'::text[], '{DA}'::text[], '{}'::jsonb, '{}'::jsonb
from purchase_package_v2_smoke_ids;

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select approver_id, 'Purchase Package Smoke Approver', approver_id::text || '@vioo.local',
       'purchase-package-v2-approver', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
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

insert into public.project_staff (id, project_id, construction_site_id, user_id, position_id, start_date, note)
select approver_staff_id, project_id, site_id, approver_id::text, position_id, current_date, 'purchase package v2 smoke approver'
from purchase_package_v2_smoke_ids;

insert into public.project_permission_room_members (
  id, project_id, construction_site_id, room_code, project_staff_id, is_active, created_by
)
select room_member_id, project_id, site_id, 'material_po', staff_id, true, actor_id
from purchase_package_v2_smoke_ids;

insert into public.project_permission_room_members (
  id, project_id, construction_site_id, room_code, project_staff_id, is_active, created_by
)
select approver_room_member_id, project_id, site_id, 'material_po', approver_staff_id, true, actor_id
from purchase_package_v2_smoke_ids;

insert into public.project_permission_room_member_actions (room_member_id, action_code, is_active, granted_by)
select room_member_id, 'submit', true, actor_id
from purchase_package_v2_smoke_ids;

insert into public.project_permission_room_member_actions (room_member_id, action_code, is_active, granted_by)
select approver_room_member_id, 'approve', true, actor_id
from purchase_package_v2_smoke_ids;

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
select actor_id, 'project.material_po.create', 'project', project_id, true
from purchase_package_v2_smoke_ids;

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
select approver_id, 'project.material_po.approve', 'project', project_id, true
from purchase_package_v2_smoke_ids;

insert into app_private.purchase_order_number_registry(po_number)
select po_number
from purchase_package_v2_smoke_ids
on conflict (po_number) do nothing;

insert into app_private.purchase_order_number_registry(po_number)
select approve_single_po_number
from purchase_package_v2_smoke_ids
on conflict (po_number) do nothing;

insert into app_private.purchase_order_number_registry(po_number)
select approve_multiple_po_number
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

insert into public.purchase_orders (
  id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
  total_amount, approved_total_amount, vat_rate, purchase_mode, fulfillment_mode, reference_gross_amount,
  order_date, status, source_mode, target_warehouse_id, created_by_id, created_at,
  submitted_to_user_id, submitted_to_permission
)
select
  approve_single_po_id, project_id, site_id, supplier_id, 'NCC Smoke', approve_single_po_number,
  jsonb_build_array(jsonb_build_object(
    'lineId', approve_single_line_id,
    'itemId', item_id,
    'sku', 'PP-V2-SMOKE',
    'name', 'Purchase Package V2 Item',
    'unit', 'Kg',
    'unitSnapshot', 'Kg',
    'purchaseUnitSnapshot', 'Kg',
    'stockUnitSnapshot', 'Kg',
    'purchaseConversionFactor', 1,
    'qty', 100,
    'unitPrice', 10000
  )),
  1000000, 1000000, 10, 'single', 'RECEIVE_TO_STOCK', 1100000,
  current_date::text, 'sent', 'from_request', warehouse_id, actor_id::text, now(),
  approver_id::text, 'project.material_po.approve'
from purchase_package_v2_smoke_ids;

insert into public.purchase_orders (
  id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
  total_amount, approved_total_amount, vat_rate, purchase_mode, fulfillment_mode, reference_gross_amount,
  order_date, status, source_mode, target_warehouse_id, created_by_id, created_at,
  submitted_to_user_id, submitted_to_permission
)
select
  approve_multiple_po_id, project_id, site_id, supplier_id, 'NCC Smoke', approve_multiple_po_number,
  jsonb_build_array(jsonb_build_object(
    'lineId', approve_multiple_line_id,
    'itemId', item_id,
    'sku', 'PP-V2-SMOKE',
    'name', 'Purchase Package V2 Item',
    'unit', 'Kg',
    'unitSnapshot', 'Kg',
    'purchaseUnitSnapshot', 'Kg',
    'stockUnitSnapshot', 'Kg',
    'purchaseConversionFactor', 1,
    'qty', 1000,
    'unitPrice', 10000
  )),
  10000000, 10000000, 10, 'multiple', 'RECEIVE_TO_STOCK', 11000000,
  current_date::text, 'sent', 'from_request', warehouse_id, actor_id::text, now(),
  approver_id::text, 'project.material_po.approve'
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

select set_config('request.jwt.claim.email', 'purchase-package-v2-intruder@vioo.local', true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', 'purchase-package-v2-intruder@vioo.local', 'sub', gen_random_uuid()::text)::text,
  true
);

do $$
declare
  v_ids purchase_package_v2_smoke_ids%rowtype := (select ids from purchase_package_v2_smoke_ids ids);
begin
  begin
    perform app_private.create_delivery_batch_with_wms_qr_v2(
      p_purchase_order_id := v_ids.po_id,
      p_idempotency_key := v_ids.impersonation_key,
      p_supplier_id := v_ids.supplier_id,
      p_supplier_name := 'NCC Smoke',
      p_fulfillment_mode := 'RECEIVE_TO_STOCK',
      p_vat_rate := 10,
      p_target_warehouse_id := v_ids.warehouse_id,
      p_planned_delivery_date := current_date,
      p_note := 'private helper impersonation should fail',
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
    raise exception 'Private delivery helper impersonation unexpectedly succeeded.';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform app_private.approve_purchase_package_and_prepare_single_batch_v2(
      v_ids.approve_single_po_id,
      v_ids.actor_id,
      gen_random_uuid()
    );
    raise exception 'Private approval helper impersonation unexpectedly succeeded.';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

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
  v_single_approval jsonb;
  v_single_retry jsonb;
  v_multiple_approval jsonb;
  v_over_result jsonb;
  v_receipt_line_id uuid;
  v_quality_result jsonb;
  v_finalize_result jsonb;
  v_finalize_retry jsonb;
  v_stock_qty numeric;
  v_received_qty numeric;
  v_inventory_header_count integer;
  v_inventory_entry_count integer;
  v_cost_count integer;
  v_ap_count integer;
  v_supplier_return public.purchase_order_supplier_returns%rowtype;
  v_returned_qty numeric;
  v_return_reversal_count integer;
  v_return_credit_amount numeric;
  v_direct_result jsonb;
  v_direct_line_id uuid;
  v_direct_quality_result jsonb;
  v_direct_finalize_result jsonb;
  v_direct_stock_before numeric;
  v_direct_inventory_count integer;
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

  perform pg_temp.purchase_package_v2_set_user(v_ids.approver_id);

  v_single_approval := public.approve_purchase_package_and_prepare_single_batch_v2(
    v_ids.approve_single_po_id,
    v_ids.approver_id,
    v_ids.approve_single_key
  );
  if v_single_approval ->> 'status' <> 'confirmed'
     or v_single_approval ->> 'purchaseMode' <> 'single'
     or nullif(v_single_approval #>> '{delivery,deliveryBatchId}', '') is null
     or nullif(v_single_approval #>> '{delivery,wmsTransactionId}', '') is null
     or nullif(v_single_approval #>> '{delivery,qrToken}', '') is null then
    raise exception 'Single approval did not return confirmed package and delivery: %', v_single_approval;
  end if;

  v_single_retry := public.approve_purchase_package_and_prepare_single_batch_v2(
    v_ids.approve_single_po_id,
    v_ids.approver_id,
    v_ids.approve_single_key
  );
  if v_single_retry #>> '{delivery,deliveryBatchId}' is distinct from v_single_approval #>> '{delivery,deliveryBatchId}' then
    raise exception 'Single approval retry returned a different delivery.';
  end if;

  v_multiple_approval := public.approve_purchase_package_and_prepare_single_batch_v2(
    v_ids.approve_multiple_po_id,
    v_ids.approver_id,
    v_ids.approve_multiple_key
  );
  if v_multiple_approval ->> 'status' <> 'confirmed'
     or v_multiple_approval ->> 'purchaseMode' <> 'multiple'
     or v_multiple_approval ? 'delivery' then
    raise exception 'Multiple approval unexpectedly returned delivery: %', v_multiple_approval;
  end if;

  perform pg_temp.purchase_package_v2_set_user(v_ids.actor_id);

  select line.id into v_receipt_line_id
  from public.purchase_order_delivery_lines line
  where line.delivery_batch_id = (v_single_approval #>> '{delivery,deliveryBatchId}')::uuid
  order by line.id
  limit 1;
  if v_receipt_line_id is null then
    raise exception 'Single approval delivery line missing for receipt smoke.';
  end if;

  v_quality_result := public.approve_receipt_quality_v2(
    p_delivery_batch_id := (v_single_approval #>> '{delivery,deliveryBatchId}')::uuid,
    p_wms_transaction_id := v_single_approval #>> '{delivery,wmsTransactionId}',
    p_actor_user_id := v_ids.actor_id,
    p_quality_result := 'partial',
    p_lines := jsonb_build_array(jsonb_build_object(
      'deliveryLineId', v_receipt_line_id,
      'itemId', v_ids.item_id,
      'acceptedPurchaseQty', 90,
      'acceptedStockQty', 90,
      'varianceReason', 'NCC giao thiếu 10 Kg'
    )),
    p_attachments := '[]'::jsonb
  );

  if v_quality_result ->> 'deliveryStatus' <> 'quality_approved'
     or v_quality_result ->> 'transactionStatus' <> 'APPROVED'
     or (v_quality_result ->> 'acceptedGrossAmount')::numeric <> 990000 then
    raise exception 'Approve quality result invalid: %', v_quality_result;
  end if;

  if not exists (
    select 1
    from public.purchase_order_delivery_lines line
    join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
    join public.transactions tx on tx.id = batch.wms_transaction_id
    where line.id = v_receipt_line_id
      and batch.status = 'quality_approved'
      and batch.quality_result = 'partial'
      and batch.accepted_gross_amount = 990000
      and line.accepted_qty = 90
      and line.accepted_stock_qty = 90
      and tx.status::text = 'APPROVED'
      and (tx.items -> 0 ->> 'quantity')::numeric = 90
      and (tx.items -> 0 ->> 'accountingQty')::numeric = 90
      and (tx.items -> 0 ->> 'varianceQty')::numeric = -10
      and tx.items -> 0 ->> 'varianceReason' = 'NCC giao thiếu 10 Kg'
  ) then
    raise exception 'Approve quality did not update delivery line and WMS snapshots.';
  end if;

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_stock_qty
  from public.items item
  where item.id = v_ids.item_id;
  if v_stock_qty <> 0 then
    raise exception 'Approve quality posted stock before finalize: %', v_stock_qty;
  end if;

  select coalesce(nullif(po.items -> 0 ->> 'receivedQty', '')::numeric, 0)
  into v_received_qty
  from public.purchase_orders po
  where po.id = v_ids.approve_single_po_id;
  if v_received_qty <> 0 then
    raise exception 'Approve quality updated PO receipt before finalize: %', v_received_qty;
  end if;

  begin
    perform public.approve_receipt_quality_v2(
      (v_single_approval #>> '{delivery,deliveryBatchId}')::uuid,
      v_single_approval #>> '{delivery,wmsTransactionId}',
      v_ids.actor_id,
      'passed',
      jsonb_build_array(jsonb_build_object(
        'deliveryLineId', v_receipt_line_id,
        'itemId', v_ids.item_id,
        'acceptedPurchaseQty', 100,
        'acceptedStockQty', 100
      )),
      '[]'::jsonb
    );
    raise exception 'Re-approve quality with changed payload unexpectedly succeeded.';
  exception
    when invalid_parameter_value or raise_exception then
      null;
  end;

  v_finalize_result := public.finalize_purchase_receipt_v2(
    (v_single_approval #>> '{delivery,deliveryBatchId}')::uuid,
    v_single_approval #>> '{delivery,wmsTransactionId}',
    v_ids.actor_id
  );

  if v_finalize_result ->> 'deliveryStatus' <> 'received_short'
     or v_finalize_result ->> 'transactionStatus' <> 'COMPLETED'
     or (v_finalize_result ->> 'acceptedGrossAmount')::numeric <> 990000 then
    raise exception 'Finalize receipt result invalid: %', v_finalize_result;
  end if;

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_stock_qty
  from public.items item
  where item.id = v_ids.item_id;
  if v_stock_qty <> 90 then
    raise exception 'Finalize did not post exactly 90 stock qty: %', v_stock_qty;
  end if;

  select coalesce(nullif(po.items -> 0 ->> 'receivedQty', '')::numeric, 0)
  into v_received_qty
  from public.purchase_orders po
  where po.id = v_ids.approve_single_po_id;
  if v_received_qty <> 90 then
    raise exception 'Finalize did not update PO receivedQty in purchase units: %', v_received_qty;
  end if;

  v_finalize_retry := public.finalize_purchase_receipt_v2(
    (v_single_approval #>> '{delivery,deliveryBatchId}')::uuid,
    v_single_approval #>> '{delivery,wmsTransactionId}',
    v_ids.actor_id
  );
  if coalesce((v_finalize_retry ->> 'alreadyFinalized')::boolean, false) is not true then
    raise exception 'Finalize retry did not return idempotent result: %', v_finalize_retry;
  end if;

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_stock_qty
  from public.items item
  where item.id = v_ids.item_id;
  if v_stock_qty <> 90 then
    raise exception 'Finalize retry posted stock twice: %', v_stock_qty;
  end if;

  select count(*) into v_inventory_header_count
  from public.inventory_transactions
  where source_type = 'wms_transaction'
    and source_id = v_single_approval #>> '{delivery,wmsTransactionId}';
  if v_inventory_header_count <> 1 then
    raise exception 'Finalize should create exactly one inventory transaction, got %.', v_inventory_header_count;
  end if;

  select count(*) into v_inventory_entry_count
  from public.inventory_ledger_entries
  where source_type = 'wms_transaction'
    and source_id = v_single_approval #>> '{delivery,wmsTransactionId}';
  if v_inventory_entry_count <> 1 then
    raise exception 'Finalize should create exactly one inventory ledger entry, got %.', v_inventory_entry_count;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.supplier_payable_documents'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%source_type%source_id%'
  ) then
    raise exception 'Missing supplier payable source unique constraint.';
  end if;

  select count(*) into v_cost_count
  from public.project_transactions
  where source_ref = 'purchase_receipt:' || (v_single_approval #>> '{delivery,deliveryBatchId}');
  if v_cost_count <> 1 then
    raise exception 'Finalize should create exactly one receipt cost transaction, got %.', v_cost_count;
  end if;
  if not exists (
    select 1
    from public.project_transactions
    where source_ref = 'purchase_receipt:' || (v_single_approval #>> '{delivery,deliveryBatchId}')
      and amount = 990000
  ) then
    raise exception 'Receipt cost transaction amount is not 990000.';
  end if;

  select count(*) into v_ap_count
  from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt'
    and source_id = v_single_approval #>> '{delivery,deliveryBatchId}';
  if v_ap_count <> 1 then
    raise exception 'Finalize should create exactly one receipt AP document, got %.', v_ap_count;
  end if;
  if not exists (
    select 1
    from public.supplier_payable_documents
    where source_type = 'purchase_delivery_receipt'
      and source_id = v_single_approval #>> '{delivery,deliveryBatchId}'
      and recognized_amount = 990000
      and committed_amount = 1100000
  ) then
    raise exception 'Receipt AP document did not record committed 1100000 and recognized 990000.';
  end if;

  select * into v_supplier_return
  from public.create_purchase_order_supplier_return(
    v_ids.approve_single_po_id,
    v_ids.warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_ids.approve_single_line_id,
      'quantity', 10
    )),
    'Tra lai 10 Kg sau nghiem thu',
    'Purchase package v2 return smoke'
  );
  if v_supplier_return.status <> 'pending' then
    raise exception 'Supplier return should start pending: %', v_supplier_return;
  end if;

  perform public.process_transaction_status(
    v_supplier_return.transaction_id,
    'COMPLETED'::public.transaction_status,
    v_ids.actor_id
  );

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_stock_qty
  from public.items item
  where item.id = v_ids.item_id;
  if v_stock_qty <> 80 then
    raise exception 'Supplier return did not leave net stock 80 after receipt 90 and return 10: %', v_stock_qty;
  end if;

  select coalesce(nullif(po.items -> 0 ->> 'returnedQty', '')::numeric, 0)
  into v_returned_qty
  from public.purchase_orders po
  where po.id = v_ids.approve_single_po_id;
  if v_returned_qty <> 10 then
    raise exception 'Supplier return did not update PO returnedQty to 10: %', v_returned_qty;
  end if;

  if not exists (
    select 1
    from public.purchase_order_delivery_lines line
    where line.id = v_receipt_line_id
      and line.accepted_qty = 90
      and line.returned_qty = 10
      and line.accepted_qty - line.returned_qty = 80
  ) then
    raise exception 'Supplier return did not update delivery-line net receipt to 80.';
  end if;

  if not exists (
    select 1
    from public.project_transactions
    where source_ref = 'purchase_receipt_return:' || v_supplier_return.id::text
      and amount = -110000
  ) then
    raise exception 'Supplier return did not create -110000 cost reversal.';
  end if;

  select coalesce(sum(credit_amount), 0)
  into v_return_credit_amount
  from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt'
    and source_id = v_single_approval #>> '{delivery,deliveryBatchId}';
  if v_return_credit_amount <> 110000 then
    raise exception 'Supplier return did not credit receipt AP by 110000: %', v_return_credit_amount;
  end if;

  if not exists (
    select 1
    from public.supplier_payable_balances balance
    where balance.project_id = v_ids.project_id
      and balance.construction_site_id = v_ids.site_id
      and balance.supplier_id = v_ids.supplier_id
      and balance.recognized_amount >= 990000
      and balance.credit_amount >= 110000
      and balance.outstanding_amount >= 880000
  ) then
    raise exception 'Supplier return credit was not reflected in AP balances.';
  end if;

  perform public.process_transaction_status(
    v_supplier_return.transaction_id,
    'COMPLETED'::public.transaction_status,
    v_ids.actor_id
  );
  select count(*) into v_return_reversal_count
  from public.project_transactions
  where source_ref = 'purchase_receipt_return:' || v_supplier_return.id::text;
  if v_return_reversal_count <> 1 then
    raise exception 'Supplier return retry created duplicate cost reversal: %', v_return_reversal_count;
  end if;

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_direct_stock_before
  from public.items item
  where item.id = v_ids.item_id;

  v_direct_result := public.create_delivery_batch_with_wms_qr_v2(
    p_purchase_order_id := v_ids.approve_multiple_po_id,
    p_idempotency_key := gen_random_uuid(),
    p_supplier_id := v_ids.supplier_id,
    p_supplier_name := 'NCC Smoke',
    p_fulfillment_mode := 'DIRECT_CONSUMPTION',
    p_vat_rate := 10,
    p_target_warehouse_id := v_ids.warehouse_id,
    p_planned_delivery_date := current_date,
    p_note := 'direct consumption receipt',
    p_actor_user_id := v_ids.actor_id,
    p_lines := jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_ids.approve_multiple_line_id,
      'itemId', v_ids.item_id,
      'purchaseQty', 90,
      'purchaseUnit', 'Kg',
      'stockQty', 90,
      'stockUnit', 'Kg',
      'purchaseUnitPrice', 10000,
      'stockUnitPrice', 10000
    ))
  );

  select line.id into v_direct_line_id
  from public.purchase_order_delivery_lines line
  where line.delivery_batch_id = (v_direct_result ->> 'deliveryBatchId')::uuid
  order by line.id
  limit 1;

  v_direct_quality_result := public.approve_receipt_quality_v2(
    (v_direct_result ->> 'deliveryBatchId')::uuid,
    v_direct_result ->> 'wmsTransactionId',
    v_ids.actor_id,
    'passed',
    jsonb_build_array(jsonb_build_object(
      'deliveryLineId', v_direct_line_id,
      'itemId', v_ids.item_id,
      'acceptedPurchaseQty', 90,
      'acceptedStockQty', 90
    )),
    '[]'::jsonb
  );
  if v_direct_quality_result ->> 'transactionStatus' <> 'APPROVED' then
    raise exception 'Direct consumption approve quality failed: %', v_direct_quality_result;
  end if;

  v_direct_finalize_result := public.finalize_purchase_receipt_v2(
    (v_direct_result ->> 'deliveryBatchId')::uuid,
    v_direct_result ->> 'wmsTransactionId',
    v_ids.actor_id
  );
  if v_direct_finalize_result ->> 'transactionStatus' <> 'COMPLETED' then
    raise exception 'Direct consumption finalize failed: %', v_direct_finalize_result;
  end if;

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_stock_qty
  from public.items item
  where item.id = v_ids.item_id;
  if v_stock_qty <> v_direct_stock_before then
    raise exception 'Direct consumption receipt changed stock from % to %.', v_direct_stock_before, v_stock_qty;
  end if;

  select count(*) into v_direct_inventory_count
  from public.inventory_transactions
  where source_type = 'wms_transaction'
    and source_id = v_direct_result ->> 'wmsTransactionId';
  if v_direct_inventory_count <> 0 then
    raise exception 'Direct consumption receipt created inventory transaction.';
  end if;

  if not exists (
    select 1
    from public.project_transactions
    where source_ref = 'purchase_receipt:' || (v_direct_result ->> 'deliveryBatchId')
      and amount = 990000
  ) then
    raise exception 'Direct consumption receipt did not create 990000 cost.';
  end if;

  if not exists (
    select 1
    from public.supplier_payable_documents
    where source_type = 'purchase_delivery_receipt'
      and source_id = v_direct_result ->> 'deliveryBatchId'
      and recognized_amount = 990000
  ) then
    raise exception 'Direct consumption receipt did not create 990000 AP.';
  end if;

  v_over_result := public.create_delivery_batch_with_wms_qr_v2(
    p_purchase_order_id := v_ids.approve_multiple_po_id,
    p_idempotency_key := v_ids.approve_over_key,
    p_supplier_id := v_ids.supplier_id,
    p_supplier_name := 'NCC Smoke',
    p_fulfillment_mode := 'RECEIVE_TO_STOCK',
    p_vat_rate := 10,
    p_target_warehouse_id := v_ids.warehouse_id,
    p_planned_delivery_date := current_date,
    p_note := 'multiple delivery over baseline',
    p_actor_user_id := v_ids.actor_id,
    p_lines := jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_ids.approve_multiple_line_id,
      'itemId', v_ids.item_id,
      'purchaseQty', 1010,
      'purchaseUnit', 'Kg',
      'stockQty', 1010,
      'stockUnit', 'Kg',
      'purchaseUnitPrice', 10000,
      'stockUnitPrice', 10000
    ))
  );
  if nullif(v_over_result ->> 'deliveryBatchId', '') is null then
    raise exception 'Over-baseline multiple delivery did not return a batch: %', v_over_result;
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
    mislink_original_wms_transaction_id = v_mislink_result ->> 'wmsTransactionId',
    approve_single_batch_id = (v_single_approval #>> '{delivery,deliveryBatchId}')::uuid,
    approve_single_wms_transaction_id = v_single_approval #>> '{delivery,wmsTransactionId}',
    approve_over_batch_id = (v_over_result ->> 'deliveryBatchId')::uuid;
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

  if not exists (
    select 1
    from public.purchase_orders po
    join public.purchase_order_delivery_batches batch on batch.purchase_order_id = po.id
    join public.purchase_order_delivery_lines line on line.delivery_batch_id = batch.id
    join public.transactions tx on tx.id = batch.wms_transaction_id
    where po.id = v_ids.approve_single_po_id
      and po.status = 'partial'
      and po.last_action_by = v_ids.approver_id::text
      and po.last_action_at is not null
      and batch.id = v_ids.approve_single_batch_id
      and batch.idempotency_key = v_ids.approve_single_key
      and batch.delivery_no = 1
      and batch.qr_token is not null
      and batch.wms_transaction_id = v_ids.approve_single_wms_transaction_id
      and line.planned_qty = 100
      and tx.source_type = 'po_delivery_batch'
      and tx.source_id = batch.id::text
  ) then
    raise exception 'Single approval did not create exactly the expected default delivery.';
  end if;

  if (
    select count(*)
    from public.purchase_order_delivery_batches
    where purchase_order_id = v_ids.approve_single_po_id
      and status <> 'cancelled'
  ) <> 1 then
    raise exception 'Single approval retry created duplicate deliveries.';
  end if;

  if exists (
    select 1
    from public.purchase_order_delivery_batches
    where purchase_order_id = v_ids.approve_multiple_po_id
      and idempotency_key = v_ids.approve_multiple_key
  ) then
    raise exception 'Multiple approval unexpectedly created default delivery.';
  end if;

  if not exists (
    select 1
    from public.purchase_orders
    where id = v_ids.approve_multiple_po_id
      and status in ('confirmed', 'partial')
      and last_action_by = v_ids.approver_id::text
      and last_action_at is not null
  ) then
    raise exception 'Multiple approval did not record approval action metadata.';
  end if;

  if not exists (
    select 1
    from public.purchase_order_delivery_batches batch
    join public.purchase_order_delivery_lines line on line.delivery_batch_id = batch.id
    where batch.id = v_ids.approve_over_batch_id
      and batch.purchase_order_id = v_ids.approve_multiple_po_id
      and batch.idempotency_key = v_ids.approve_over_key
      and line.planned_qty = 1010
  ) then
    raise exception 'Multiple package did not allow over-baseline delivery quantity.';
  end if;

  if exists (
    select 1
    from public.purchase_order_supplemental_approvals
    where purchase_order_id in (v_ids.approve_single_po_id, v_ids.approve_multiple_po_id)
  ) then
    raise exception 'Purchase package v2 approval created supplemental approval rows.';
  end if;
end $$;

create temp table purchase_package_close_short_smoke_ids (
  request_id text not null,
  request_code text not null,
  request_line_id text not null,
  po_id text not null,
  po_number text not null,
  po_line_id text not null
) on commit drop;

grant select on table purchase_package_close_short_smoke_ids to authenticated;

insert into purchase_package_close_short_smoke_ids
select
  'purchase-package-v2-close-request-' || gen_random_uuid()::text,
  'MR-2026-' || lpad((1000 + floor(random() * 8999)::integer)::text, 4, '0'),
  'purchase-package-v2-close-request-line-' || gen_random_uuid()::text,
  'purchase-package-v2-close-po-' || gen_random_uuid()::text,
  'PO-' || (1000000000 + floor(random() * 899999999)::bigint)::text,
  'purchase-package-v2-close-po-line-' || gen_random_uuid()::text;

do $$
declare
  v_ids purchase_package_v2_smoke_ids%rowtype := (select ids from purchase_package_v2_smoke_ids ids);
  v_close purchase_package_close_short_smoke_ids%rowtype := (select ids from purchase_package_close_short_smoke_ids ids);
begin
  insert into app_private.material_request_code_registry(code)
  values (v_close.request_code)
  on conflict (code) do nothing;

  insert into app_private.purchase_order_number_registry(po_number)
  values (v_close.po_number)
  on conflict (po_number) do nothing;

  insert into public.requests(
    id, code, site_warehouse_id, requester_id, status, items,
    created_date, expected_date, project_id, construction_site_id,
    request_origin, workflow_step, title
  )
  values (
    v_close.request_id,
    v_close.request_code,
    v_ids.warehouse_id,
    v_ids.actor_id,
    'APPROVED'::public.request_status,
    jsonb_build_array(jsonb_build_object(
      'lineId', v_close.request_line_id,
      'itemId', v_ids.item_id,
      'itemNameSnapshot', 'Purchase Package V2 Close Item',
      'skuSnapshot', 'PP-V2-CLOSE',
      'unitSnapshot', 'Kg',
      'requestQty', 100,
      'approvedQty', 100
    )),
    now(),
    now() + interval '7 days',
    v_ids.project_id,
    v_ids.site_id,
    'project',
    'site_quality_check',
    'Close short smoke request'
  );

  insert into public.purchase_orders (
    id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
    total_amount, approved_total_amount, vat_rate, purchase_mode, fulfillment_mode, reference_gross_amount,
    order_date, status, source_mode, target_warehouse_id, created_by_id, created_at
  )
  values (
    v_close.po_id,
    v_ids.project_id,
    v_ids.site_id,
    v_ids.supplier_id,
    'NCC Smoke',
    v_close.po_number,
    jsonb_build_array(jsonb_build_object(
      'lineId', v_close.po_line_id,
      'itemId', v_ids.item_id,
      'sku', 'PP-V2-CLOSE',
      'name', 'Purchase Package V2 Close Item',
      'unit', 'Kg',
      'unitSnapshot', 'Kg',
      'purchaseUnitSnapshot', 'Kg',
      'stockUnitSnapshot', 'Kg',
      'purchaseConversionFactor', 1,
      'qty', 100,
      'receivedQty', 70,
      'returnedQty', 0,
      'unitPrice', 10000,
      'requestId', v_close.request_id,
      'requestLineId', v_close.request_line_id
    )),
    1000000,
    1000000,
    10,
    'multiple',
    'RECEIVE_TO_STOCK',
    1100000,
    current_date::text,
    'partial',
    'from_request',
    v_ids.warehouse_id,
    v_ids.actor_id::text,
    now()
  );
end $$;

set role authenticated;

select pg_temp.purchase_package_v2_set_user(actor_id)
from purchase_package_v2_smoke_ids;

do $$
declare
  v_ids purchase_package_v2_smoke_ids%rowtype := (select ids from purchase_package_v2_smoke_ids ids);
  v_close purchase_package_close_short_smoke_ids%rowtype := (select ids from purchase_package_close_short_smoke_ids ids);
begin
  perform public.close_purchase_package_short_v2(
    v_close.po_id,
    v_ids.actor_id,
    'Cong truong khong con nhu cau',
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_close.po_line_id,
      'closeQty', 30
    ))
  );
end $$;

reset role;

do $$
declare
  v_close purchase_package_close_short_smoke_ids%rowtype := (select ids from purchase_package_close_short_smoke_ids ids);
begin
  if not exists (
    select 1
    from public.purchase_orders
    where id = v_close.po_id
      and status = 'closed'
      and closed_need_qty = 30
  ) then
    raise exception 'Close-short RPC did not close package and update closed need qty.';
  end if;

  if not exists (
    select 1
    from public.material_request_line_need_closures closure
    where closure.material_request_id = v_close.request_id
      and closure.request_line_id = v_close.request_line_id
      and closure.closed_qty = 30
      and closure.actual_received_qty_snapshot = 70
      and closure.status = 'active'
      and closure.reason = 'Cong truong khong con nhu cau'
  ) then
    raise exception 'Close-short RPC did not write expected MR need closure.';
  end if;
end $$;
rollback;
