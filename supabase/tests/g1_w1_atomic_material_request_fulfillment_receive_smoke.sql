-- W1 legacy fulfillment receipt command: actor binding, optimistic concurrency,
-- rollback after late failure, decimal stock, UOM snapshot conversion and replay.
-- All fixture writes roll back.
begin;

create temporary table g1_w1_receive_fixture (
  actor_id uuid not null,
  other_actor_id uuid not null,
  actor_email text not null,
  other_actor_email text not null,
  warehouse_id text not null,
  item_id text not null,
  request_id text not null,
  request_line_id text not null,
  po_id text not null,
  po_line_id text not null,
  transaction_id text not null,
  batch_id uuid not null,
  line_id uuid not null,
  batch_updated_at timestamptz,
  line_updated_at timestamptz,
  payable_count integer not null default 0
) on commit drop;

insert into g1_w1_receive_fixture (
  actor_id, other_actor_id, actor_email, other_actor_email,
  warehouse_id, item_id, request_id, request_line_id,
  po_id, po_line_id, transaction_id, batch_id, line_id
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  'g1-w1-receive-' || gen_random_uuid()::text || '@vioo.local',
  'g1-w1-receive-other-' || gen_random_uuid()::text || '@vioo.local',
  'g1-w1-warehouse-' || gen_random_uuid()::text,
  'g1-w1-item-' || gen_random_uuid()::text,
  'g1-w1-request-' || gen_random_uuid()::text,
  'g1-w1-request-line-' || gen_random_uuid()::text,
  'g1-w1-po-' || gen_random_uuid()::text,
  'g1-w1-po-line-' || gen_random_uuid()::text,
  'g1-w1-transaction-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid()
);

grant select, update on g1_w1_receive_fixture to authenticated;

insert into public.warehouse_types (code, name, description, is_system, is_active, sort_order)
values ('GENERAL', 'General', 'G1 W1 atomic receive smoke fixture', true, true, 1)
on conflict (code) do nothing;

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'G1 W1 receipt warehouse', 'Smoke', 'GENERAL'
from g1_w1_receive_fixture;

insert into public.users (
  id, name, email, username, role, is_active, account_status, assigned_warehouse_id
)
select actor_id, 'G1 W1 receipt actor', actor_email, actor_email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', warehouse_id
from g1_w1_receive_fixture
union all
select other_actor_id, 'G1 W1 other receipt actor', other_actor_email, other_actor_email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', warehouse_id
from g1_w1_receive_fixture;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor.user_id, permission.permission_code, permission.scope_type,
       permission.scope_id, true,
       'G1 W1 atomic receive smoke'
from g1_w1_receive_fixture fixture
cross join lateral (values (fixture.actor_id), (fixture.other_actor_id)) actor(user_id)
cross join lateral (values
  ('wms.transaction.complete', 'warehouse', fixture.warehouse_id),
  ('wms.request.export', 'global', '*')
) permission(permission_code, scope_type, scope_id);

insert into public.items (
  id, sku, name, category, unit, purchase_unit, purchase_conversion_factor,
  price_in, price_out, min_stock, stock_by_warehouse
)
select item_id, 'G1-W1-SKU-' || right(item_id, 8),
       'G1 W1 receipt item', 'Smoke', 'Kg', 'Bao', 25,
       4000, 5000, 0, jsonb_build_object(warehouse_id, 10)
from g1_w1_receive_fixture;

insert into public.requests (
  id, code, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, request_origin, workflow_step, title
)
select request_id, public.next_material_request_code_v1(), warehouse_id, actor_id,
       'APPROVED'::public.request_status,
       jsonb_build_array(jsonb_build_object(
         'lineId', request_line_id,
         'itemId', item_id,
         'itemNameSnapshot', 'G1 W1 receipt item',
         'skuSnapshot', 'G1-W1-SKU-' || right(item_id, 8),
         'unitSnapshot', 'Kg',
         'requestQty', 25,
         'approvedQty', 25
       )),
       now(), now() + interval '1 day', 'wms', 'site_quality_check',
       'G1 W1 atomic receive smoke'
from g1_w1_receive_fixture;

insert into public.purchase_orders (
  id, vendor_id, vendor_name, po_number, items, total_amount,
  order_date, status, source_mode, target_warehouse_id, created_by_id
)
select po_id, 'g1-w1-vendor', 'G1 W1 Vendor', public.next_purchase_order_number_v2(),
       jsonb_build_array(jsonb_build_object(
         'lineId', po_line_id,
         'itemId', item_id,
         'sku', 'G1-W1-SKU-' || right(item_id, 8),
         'name', 'G1 W1 receipt item',
         'unit', 'Bao',
         'unitSnapshot', 'Bao',
         'purchaseUnitSnapshot', 'Bao',
         'stockUnitSnapshot', 'Kg',
         'purchaseConversionFactor', 25,
         'qty', 'bad',
         'unitPrice', 100000,
         'receivedQty', 0
       )),
       200000, current_date::text, 'confirmed', 'company_consolidated',
       warehouse_id, actor_id::text
from g1_w1_receive_fixture;

insert into public.transactions (
  id, type, date, items, target_warehouse_id, requester_id, approver_id,
  status, related_request_id, pending_items, source_type, source_id,
  business_event_type, business_event_reason
)
select transaction_id, 'IMPORT'::public.transaction_type, now(),
       jsonb_build_array(jsonb_build_object(
         'itemId', item_id,
         'quantity', 50,
         'orderedQty', 50,
         'accountingQty', 2,
         'accountingUnit', 'Bao',
         'accountingPrice', 100000,
         'materialRequestId', request_id,
         'requestLineId', request_line_id,
         'fulfillmentBatchId', batch_id,
         'purchaseOrderLineId', po_line_id
       )),
       warehouse_id, actor_id, actor_id,
       'APPROVED'::public.transaction_status, request_id, '[]'::jsonb,
       'po_receipt', po_id, 'request_po_receipt', 'G1 W1 atomic receive smoke'
from g1_w1_receive_fixture;

insert into public.material_request_fulfillment_batches (
  id, material_request_id, batch_no, batch_date, target_warehouse_id,
  fulfillment_mode, source_type, status, transaction_id,
  created_by, issued_by, issued_at
)
select batch_id, request_id, 'G1-W1-BATCH', now(), warehouse_id,
       'RECEIVE_TO_STOCK', 'po_receipt', 'issued', transaction_id,
       actor_id, actor_id, now()
from g1_w1_receive_fixture;

insert into public.material_request_fulfillment_lines (
  id, batch_id, material_request_id, request_line_id, item_id,
  po_id, po_line_id, requested_qty_snapshot, committed_qty_snapshot,
  issued_qty, received_qty, unit, delivery_unit, delivery_unit_price
)
select line_id, batch_id, request_id, request_line_id, item_id,
       po_id, po_line_id, 50, 50, 50, 0, 'Kg', 'Kg', 4000
from g1_w1_receive_fixture;

update g1_w1_receive_fixture fixture
set batch_updated_at = batch.updated_at,
    line_updated_at = line.updated_at,
    payable_count = (
      select count(*)::integer
      from public.supplier_payable_documents payable
      where payable.source_type = 'purchase_order'
        and payable.source_id = fixture.po_id
    )
from public.material_request_fulfillment_batches batch,
     public.material_request_fulfillment_lines line
where batch.id = fixture.batch_id
  and line.id = fixture.line_id;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', actor_email,
    'sub', gen_random_uuid()::text,
    'role', 'authenticated'
  )::text,
  true
)
from g1_w1_receive_fixture;

set local role authenticated;

do $$
declare
  fixture g1_w1_receive_fixture%rowtype;
begin
  select * into fixture from g1_w1_receive_fixture;
  begin
    perform public.receive_material_request_fulfillment_batch_v1(
      fixture.batch_id,
      fixture.batch_updated_at,
      fixture.other_actor_id,
      fixture.batch_id,
      jsonb_build_array(jsonb_build_object(
        'lineId', fixture.line_id,
        'receivedQty', 25,
        'expectedUpdatedAt', fixture.line_updated_at
      )),
      null
    );
    raise exception 'W1 receive accepted a spoofed actor';
  exception when sqlstate '42501' then
    null;
  end;
end $$;

reset role;

update g1_w1_receive_fixture
set line_updated_at = line_updated_at - interval '1 second';

set local role authenticated;

do $$
declare
  fixture g1_w1_receive_fixture%rowtype;
begin
  select * into fixture from g1_w1_receive_fixture;
  begin
    perform public.receive_material_request_fulfillment_batch_v1(
      fixture.batch_id,
      fixture.batch_updated_at,
      fixture.actor_id,
      fixture.batch_id,
      jsonb_build_array(jsonb_build_object(
        'lineId', fixture.line_id,
        'receivedQty', 25,
        'expectedUpdatedAt', fixture.line_updated_at
      )),
      null
    );
    raise exception 'W1 receive accepted a stale line';
  exception when sqlstate '40001' then
    null;
  end;
end $$;

reset role;

update g1_w1_receive_fixture fixture
set line_updated_at = line.updated_at
from public.material_request_fulfillment_lines line
where line.id = fixture.line_id;

set local role authenticated;

do $$
declare
  fixture g1_w1_receive_fixture%rowtype;
begin
  select * into fixture from g1_w1_receive_fixture;
  begin
    perform public.receive_material_request_fulfillment_batch_v1(
      fixture.batch_id,
      fixture.batch_updated_at,
      fixture.actor_id,
      fixture.batch_id,
      jsonb_build_array(jsonb_build_object(
        'lineId', fixture.line_id,
        'receivedQty', 25,
        'varianceReason', 'Nhận thiếu theo cân thực tế',
        'expectedUpdatedAt', fixture.line_updated_at
      )),
      'Nhận thiếu theo cân thực tế'
    );
    raise exception 'W1 receive did not surface the late PO payload failure';
  exception when invalid_text_representation then
    null;
  end;
end $$;

reset role;

do $$
declare
  fixture g1_w1_receive_fixture%rowtype;
  stock_qty numeric;
begin
  select * into fixture from g1_w1_receive_fixture;
  select (stock_by_warehouse ->> fixture.warehouse_id)::numeric
  into stock_qty
  from public.items
  where id = fixture.item_id;

  if stock_qty is distinct from 10::numeric
     or (select status from public.transactions where id = fixture.transaction_id)
          is distinct from 'APPROVED'::public.transaction_status
     or (select status from public.material_request_fulfillment_batches where id = fixture.batch_id)
          is distinct from 'issued'
     or (select received_qty from public.material_request_fulfillment_lines where id = fixture.line_id)
          is distinct from 0::numeric
     or exists (
       select 1
       from app_private.material_request_receive_commands
       where actor_user_id = fixture.actor_id
         and idempotency_key = fixture.batch_id
     ) then
    raise exception 'W1 late failure did not roll back the aggregate';
  end if;
end $$;

update public.purchase_orders po
set items = jsonb_set(po.items, '{0,qty}', to_jsonb(2::numeric), false)
where po.id = (select po_id from g1_w1_receive_fixture);

set local role authenticated;

do $$
declare
  fixture g1_w1_receive_fixture%rowtype;
  first_result jsonb;
  replay_result jsonb;
begin
  select * into fixture from g1_w1_receive_fixture;
  first_result := public.receive_material_request_fulfillment_batch_v1(
    fixture.batch_id,
    fixture.batch_updated_at,
    fixture.actor_id,
    fixture.batch_id,
    jsonb_build_array(jsonb_build_object(
      'lineId', fixture.line_id,
      'receivedQty', 25,
      'varianceReason', 'Nhận thiếu theo cân thực tế',
      'expectedUpdatedAt', fixture.line_updated_at
    )),
    'Nhận thiếu theo cân thực tế'
  );
  if coalesce((first_result ->> 'idempotentReplay')::boolean, true) then
    raise exception 'W1 first receive was marked as replay: %', first_result;
  end if;

  replay_result := public.receive_material_request_fulfillment_batch_v1(
    fixture.batch_id,
    fixture.batch_updated_at,
    fixture.actor_id,
    fixture.batch_id,
    jsonb_build_array(jsonb_build_object(
      'lineId', fixture.line_id,
      'receivedQty', 25,
      'varianceReason', 'Nhận thiếu theo cân thực tế',
      'expectedUpdatedAt', fixture.line_updated_at
    )),
    'Nhận thiếu theo cân thực tế'
  );
  if coalesce((replay_result ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'W1 retry did not return the stored command result: %', replay_result;
  end if;
end $$;

reset role;

do $$
declare
  fixture g1_w1_receive_fixture%rowtype;
  stock_qty numeric;
  po_received_qty numeric;
  received_transaction_count integer;
begin
  select * into fixture from g1_w1_receive_fixture;
  select (stock_by_warehouse ->> fixture.warehouse_id)::numeric
  into stock_qty
  from public.items
  where id = fixture.item_id;
  select (items -> 0 ->> 'receivedQty')::numeric,
         jsonb_array_length(received_transaction_ids)
  into po_received_qty, received_transaction_count
  from public.purchase_orders
  where id = fixture.po_id;

  if stock_qty is distinct from 35::numeric
     or po_received_qty is distinct from 1::numeric
     or received_transaction_count <> 1
     or (select status from public.transactions where id = fixture.transaction_id)
          is distinct from 'COMPLETED'::public.transaction_status
     or (select status from public.material_request_fulfillment_batches where id = fixture.batch_id)
          is distinct from 'received'
     or (select received_qty from public.material_request_fulfillment_lines where id = fixture.line_id)
          is distinct from 25::numeric
     or (select count(*) from app_private.material_request_receive_commands
         where actor_user_id = fixture.actor_id and idempotency_key = fixture.batch_id) <> 1
     or (select count(*) from public.supplier_payable_documents payable
         where payable.source_type = 'purchase_order' and payable.source_id = fixture.po_id)
          <> fixture.payable_count then
    raise exception 'W1 receive/replay aggregate assertions failed';
  end if;
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', other_actor_email,
    'sub', gen_random_uuid()::text,
    'role', 'authenticated'
  )::text,
  true
)
from g1_w1_receive_fixture;

set local role authenticated;

do $$
declare
  fixture g1_w1_receive_fixture%rowtype;
begin
  select * into fixture from g1_w1_receive_fixture;
  begin
    perform public.receive_material_request_fulfillment_batch_v1(
      fixture.batch_id,
      fixture.batch_updated_at,
      fixture.other_actor_id,
      fixture.batch_id,
      jsonb_build_array(jsonb_build_object(
        'lineId', fixture.line_id,
        'receivedQty', 25,
        'expectedUpdatedAt', fixture.line_updated_at
      )),
      null
    );
    raise exception 'A second actor applied the received batch again';
  exception
    when sqlstate '40001' then
      null;
    when sqlstate '22023' then
      if sqlerrm <> 'FULFILLMENT_BATCH_NOT_RECEIVABLE' then
        raise;
      end if;
  end;
end $$;

reset role;

do $$
declare
  fixture g1_w1_receive_fixture%rowtype;
begin
  select * into fixture from g1_w1_receive_fixture;
  if (select (stock_by_warehouse ->> fixture.warehouse_id)::numeric
      from public.items where id = fixture.item_id) is distinct from 35::numeric
     or exists (
       select 1
       from app_private.material_request_receive_commands
       where actor_user_id = fixture.other_actor_id
         and idempotency_key = fixture.batch_id
     ) then
    raise exception 'A rejected second actor changed W1 receive state';
  end if;
end $$;

rollback;
