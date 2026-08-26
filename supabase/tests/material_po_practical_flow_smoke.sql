-- Practical material PO flow. Rollback-only: no fixture survives the test.
begin;

do $$
begin
  if to_regprocedure('public.submit_material_po_batch(uuid,uuid,uuid)') is null then
    raise exception 'Missing submit_material_po_batch RPC';
  end if;
  if to_regprocedure('public.decide_material_po_batch(uuid,text,text,uuid)') is null then
    raise exception 'Missing decide_material_po_batch RPC';
  end if;
  if to_regprocedure('public.approve_material_po_batch(uuid,uuid)') is null then
    raise exception 'Missing approve_material_po_batch RPC';
  end if;
  if to_regprocedure('public.approve_single_material_po(text,uuid,uuid)') is null then
    raise exception 'Missing approve_single_material_po RPC';
  end if;
  if to_regprocedure('public.approve_material_po_quality(uuid,text,uuid,text,jsonb,jsonb)') is null then
    raise exception 'Missing approve_material_po_quality RPC';
  end if;
  if to_regprocedure('public.finalize_material_po_receipt(uuid,text,uuid)') is null then
    raise exception 'Missing finalize_material_po_receipt RPC';
  end if;
end $$;

create temp table practical_po_smoke_ids (
  project_id text not null,
  site_id text not null,
  warehouse_id text not null,
  item_id text not null,
  supplier_id text not null,
  actor_id uuid not null,
  approver_id uuid not null,
  position_id uuid not null,
  actor_staff_id uuid not null,
  approver_staff_id uuid not null,
  actor_room_member_id uuid not null,
  approver_room_member_id uuid not null,
  po_id text not null,
  po_number text not null,
  po_line_id text not null,
  batch_id uuid not null,
  delivery_line_id uuid not null
) on commit drop;

grant select on table practical_po_smoke_ids to authenticated;

insert into practical_po_smoke_ids
values (
  'practical-po-project-' || gen_random_uuid()::text,
  gen_random_uuid()::text,
  'practical-po-wh-' || gen_random_uuid()::text,
  'practical-po-item-' || gen_random_uuid()::text,
  'practical-po-supplier-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'practical-po-' || gen_random_uuid()::text,
  'PO-' || (1000000000 + floor(random() * 899999999)::bigint)::text,
  'practical-po-line-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid()
);

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  assigned_warehouse_id, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select actor_id, 'Practical PO Keeper', actor_id::text || '@vioo.local',
       'practical-po-keeper-' || actor_id::text, 'ADMIN'::public.user_role,
       true, 'ACTIVE', warehouse_id,
       '{}'::text[], '{DA}'::text[], '{}'::jsonb, '{}'::jsonb
from practical_po_smoke_ids;

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select approver_id, 'Practical PO Approver', approver_id::text || '@vioo.local',
       'practical-po-approver-' || approver_id::text, 'ADMIN'::public.user_role,
       true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from practical_po_smoke_ids;

insert into public.hrm_construction_sites (id, name)
select site_id::uuid, 'Practical PO Site'
from practical_po_smoke_ids;

insert into public.projects (id, code, name, source, construction_site_id)
select project_id, 'PPO-' || substring(md5(project_id), 1, 12),
       'Practical PO Smoke', 'manual', site_id::uuid
from practical_po_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Practical PO Position', 1,
       'PPO-' || substring(md5(position_id::text), 1, 12), true, 0, 'smoke', '{}'::jsonb
from practical_po_smoke_ids;

insert into public.warehouses (
  id, name, address, type, project_id, construction_site_id
)
select warehouse_id, 'Practical PO Warehouse', 'Smoke address', 'SITE',
       project_id, site_id::uuid
from practical_po_smoke_ids;

insert into public.items (
  id, sku, name, category, unit, purchase_unit, purchase_conversion_factor,
  price_in, price_out, min_stock
)
select item_id, 'PPO-' || substring(md5(item_id), 1, 12), 'Practical PO Item',
       'Smoke', 'Kg', 'Kg', 1, 10000, 10000, 0
from practical_po_smoke_ids;

insert into public.suppliers (id, name, contact_person, phone)
select supplier_id, 'Practical PO Supplier', 'Smoke Contact', '0900000000'
from practical_po_smoke_ids;

insert into public.project_staff (
  id, project_id, construction_site_id, user_id, position_id, start_date, note
)
select actor_staff_id, project_id, site_id, actor_id::text, position_id,
       current_date, 'practical PO smoke actor'
from practical_po_smoke_ids;

insert into public.project_staff (
  id, project_id, construction_site_id, user_id, position_id, start_date, note
)
select approver_staff_id, project_id, site_id, approver_id::text, position_id,
       current_date, 'practical PO smoke approver'
from practical_po_smoke_ids;

insert into public.project_permission_room_members (
  id, project_id, construction_site_id, room_code, project_staff_id, is_active, created_by
)
select actor_room_member_id, project_id, site_id, 'material_po', actor_staff_id, true, actor_id
from practical_po_smoke_ids;

insert into public.project_permission_room_members (
  id, project_id, construction_site_id, room_code, project_staff_id, is_active, created_by
)
select approver_room_member_id, project_id, site_id, 'material_po', approver_staff_id, true, actor_id
from practical_po_smoke_ids;

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by
)
select actor_room_member_id, 'submit', true, actor_id
from practical_po_smoke_ids;

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by
)
select approver_room_member_id, 'approve', true, actor_id
from practical_po_smoke_ids;

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active
)
select actor_id, 'project.material_po.create', 'project', project_id, true
from practical_po_smoke_ids;

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active
)
select approver_id, 'project.material_po.approve', 'project', project_id, true
from practical_po_smoke_ids;

insert into app_private.purchase_order_number_registry(po_number)
select po_number from practical_po_smoke_ids
on conflict (po_number) do nothing;

insert into public.purchase_orders (
  id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
  total_amount, approved_total_amount, vat_rate, purchase_mode, fulfillment_mode,
  reference_gross_amount, order_date, status, source_mode, target_warehouse_id,
  created_by_id, created_at
)
select
  po_id, project_id, site_id, supplier_id, 'Practical PO Supplier', po_number,
  jsonb_build_array(jsonb_build_object(
    'lineId', po_line_id,
    'itemId', item_id,
    'sku', 'PPO-SMOKE',
    'name', 'Practical PO Item',
    'unit', 'Kg',
    'unitSnapshot', 'Kg',
    'purchaseUnitSnapshot', 'Kg',
    'stockUnitSnapshot', 'Kg',
    'purchaseConversionFactor', 1,
    'requestedQtySnapshot', 100,
    'qty', 100,
    'unitPrice', 10000,
    'receivedQty', 0
  )),
  1000000, 1000000, 10, 'multiple', 'RECEIVE_TO_STOCK', 1100000,
  current_date::text, 'confirmed', 'from_request', warehouse_id, actor_id::text, now()
from practical_po_smoke_ids;

insert into public.purchase_order_delivery_batches (
  id, purchase_order_id, project_id, construction_site_id, supplier_id,
  supplier_name_snapshot, delivery_no, planned_delivery_date, status,
  fulfillment_mode, vat_rate, approval_status, created_by, note
)
select batch_id, po_id, project_id, site_id, supplier_id,
       'Practical PO Supplier', 1, current_date, 'planned',
       'RECEIVE_TO_STOCK', 10, 'draft', actor_id, 'Practical PO smoke batch'
from practical_po_smoke_ids;

insert into public.purchase_order_delivery_lines (
  id, delivery_batch_id, purchase_order_id, purchase_order_line_id, item_id,
  planned_qty, unit, delivery_unit_price, stock_planned_qty, stock_unit
)
select delivery_line_id, batch_id, po_id, po_line_id, item_id,
       100, 'Kg', 10000, 100, 'Kg'
from practical_po_smoke_ids;

set role authenticated;

create or replace function pg_temp.practical_po_set_user(p_user_id uuid)
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

select pg_temp.practical_po_set_user(actor_id)
from practical_po_smoke_ids;

do $$
declare
  v_ids practical_po_smoke_ids%rowtype := (select ids from practical_po_smoke_ids ids);
  v_submit_result jsonb;
begin
  v_submit_result := public.submit_material_po_batch(
    v_ids.batch_id,
    v_ids.approver_id,
    v_ids.actor_id
  );
  if v_submit_result ->> 'approvalStatus' <> 'pending_approval' then
    raise exception 'Batch submit failed: %', v_submit_result;
  end if;
end $$;

select pg_temp.practical_po_set_user(approver_id)
from practical_po_smoke_ids;

do $$
declare
  v_ids practical_po_smoke_ids%rowtype := (select ids from practical_po_smoke_ids ids);
  v_first_result jsonb;
  v_replayed_result jsonb;
  v_first_wms_id text;
  v_replayed_wms_id text;
begin
  v_first_result := public.approve_material_po_batch(v_ids.batch_id, v_ids.approver_id);
  v_replayed_result := public.approve_material_po_batch(v_ids.batch_id, v_ids.approver_id);
  v_first_wms_id := nullif(v_first_result ->> 'wmsTransactionId', '');
  v_replayed_wms_id := nullif(v_replayed_result ->> 'wmsTransactionId', '');

  if v_first_wms_id is null or v_first_wms_id <> v_replayed_wms_id then
    raise exception 'Batch approval is not idempotent: %, %', v_first_result, v_replayed_result;
  end if;
end $$;

select pg_temp.practical_po_set_user(actor_id)
from practical_po_smoke_ids;

do $$
declare
  v_ids practical_po_smoke_ids%rowtype := (select ids from practical_po_smoke_ids ids);
  v_wms_id text;
  v_stock_qty numeric;
  v_finalize_result jsonb;
  v_finalize_replay jsonb;
begin
  select wms_transaction_id into v_wms_id
  from public.purchase_order_delivery_batches
  where id = v_ids.batch_id;

  perform public.approve_material_po_quality(
    v_ids.batch_id,
    v_wms_id,
    v_ids.actor_id,
    'partial',
    jsonb_build_array(jsonb_build_object(
      'deliveryLineId', v_ids.delivery_line_id,
      'itemId', v_ids.item_id,
      'deliveredPurchaseQty', 103,
      'acceptedPurchaseQty', 101,
      'deliveredStockQty', 103,
      'acceptedStockQty', 101,
      'varianceReason', 'Can thuc te va loai 2 don vi khong dat'
    )),
    '[]'::jsonb
  );

  if not exists (
    select 1
    from public.purchase_order_delivery_lines line
    join public.transactions tx on tx.id = v_wms_id
    where line.id = v_ids.delivery_line_id
      and line.delivered_qty = 103
      and line.accepted_qty = 101
      and line.delivered_stock_qty = 103
      and line.accepted_stock_qty = 101
      and tx.status::text = 'APPROVED'
  ) then
    raise exception 'Quality approval did not persist actual delivered and accepted quantities.';
  end if;

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_stock_qty
  from public.items item
  where item.id = v_ids.item_id;
  if v_stock_qty <> 0 then
    raise exception 'Quality approval changed stock: %', v_stock_qty;
  end if;

  v_finalize_result := public.finalize_material_po_receipt(
    v_ids.batch_id,
    v_wms_id,
    v_ids.actor_id
  );
  if v_finalize_result ->> 'transactionStatus' <> 'COMPLETED' then
    raise exception 'Receipt finalization failed: %', v_finalize_result;
  end if;

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_stock_qty
  from public.items item
  where item.id = v_ids.item_id;
  if v_stock_qty <> 101 then
    raise exception 'Receipt finalization did not add exactly 101 stock units: %', v_stock_qty;
  end if;

  v_finalize_replay := public.finalize_material_po_receipt(
    v_ids.batch_id,
    v_wms_id,
    v_ids.actor_id
  );
  if coalesce((v_finalize_replay ->> 'alreadyFinalized')::boolean, false) is not true then
    raise exception 'Receipt replay was not reported as idempotent: %', v_finalize_replay;
  end if;

  select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb) ->> v_ids.warehouse_id)::numeric, 0)
  into v_stock_qty
  from public.items item
  where item.id = v_ids.item_id;
  if v_stock_qty <> 101 then
    raise exception 'Receipt replay changed stock a second time: %', v_stock_qty;
  end if;
end $$;

rollback;
