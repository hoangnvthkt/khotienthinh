-- G6 rollback-only smoke. Run only on a disposable Supabase Cloud branch.
begin;

create temp table g6_fixture (
  actor_id uuid not null, other_actor_id uuid not null,
  actor_email text not null, other_email text not null,
  source_warehouse_id text not null, target_warehouse_id text not null,
  project_id text not null, item_id text not null, transfer_id text not null,
  legacy_transfer_id text not null, duplicate_transfer_id text not null, po_id text not null,
  receipt_batch_id uuid not null, receipt_line_id uuid not null,
  receipt_transaction_id text not null, issue_id uuid not null,
  issue_line_id uuid not null
) on commit drop;

insert into g6_fixture values (
  gen_random_uuid(), gen_random_uuid(),
  'g6-' || gen_random_uuid()::text || '@vioo.local',
  'g6-other-' || gen_random_uuid()::text || '@vioo.local',
  'g6-source-' || gen_random_uuid()::text,
  'g6-target-' || gen_random_uuid()::text,
  'g6-project-' || gen_random_uuid()::text,
  'g6-item-' || gen_random_uuid()::text,
  'g6-transfer-' || gen_random_uuid()::text,
  'g6-legacy-transfer-' || gen_random_uuid()::text,
  'g6-duplicate-transfer-' || gen_random_uuid()::text,
  'g6-po-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(),
  'g6-receipt-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid()
);
grant select on g6_fixture to authenticated;

insert into public.warehouse_types(code, name, description, is_system, is_active, sort_order)
values ('GENERAL', 'General', 'G6 smoke', true, true, 1)
on conflict (code) do nothing;

insert into public.warehouses(id, name, address, type)
select source_warehouse_id, 'G6 Source', 'Smoke', 'GENERAL' from g6_fixture
union all
select target_warehouse_id, 'G6 Target', 'Smoke', 'GENERAL' from g6_fixture;

insert into public.users(id, name, email, username, role, is_active, account_status, assigned_warehouse_id)
select actor_id, 'G6 Keeper', actor_email, actor_email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE', source_warehouse_id from g6_fixture
union all
select other_actor_id, 'G6 Disabled Other', other_email, other_email, 'EMPLOYEE'::public.user_role, false, 'DISABLED', null from g6_fixture;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, is_active, grant_reason)
select actor_id, permission_code, 'warehouse', warehouse_id, true, 'G6 smoke'
from g6_fixture
cross join lateral (values
  ('wms.transaction.approve', source_warehouse_id),
  ('wms.transaction.approve', target_warehouse_id),
  ('wms.transaction.complete', target_warehouse_id),
  ('wms.inventory.view', source_warehouse_id),
  ('wms.inventory.view', target_warehouse_id),
  ('wms.inventory.edit', source_warehouse_id),
  ('wms.inventory.edit', target_warehouse_id)
) permission(permission_code, warehouse_id);
select set_config('app.authorization_permission_command', '', true);

insert into public.items(id, sku, name, category, unit, price_in, price_out, min_stock, stock_by_warehouse)
select item_id, 'G6-' || right(item_id, 8), 'G6 Steel', 'Smoke', 'kg', 10, 10, 0,
  jsonb_build_object(source_warehouse_id, 100, target_warehouse_id, 0)
from g6_fixture;
insert into public.inventory_balances(material_id, warehouse_id, on_hand_qty, total_value, average_unit_cost)
select item_id, source_warehouse_id, 100, 1000, 10 from g6_fixture
union all
select item_id, target_warehouse_id, 0, 0, 0 from g6_fixture;

insert into public.transactions(
  id, type, date, items, source_warehouse_id, target_warehouse_id,
  requester_id, status, pending_items, business_event_type, business_event_reason
)
select transfer_id, 'TRANSFER'::public.transaction_type, now(),
  jsonb_build_array(jsonb_build_object('lineId', 'line-1', 'itemId', item_id, 'quantity', 10, 'unit', 'kg', 'price', 10)),
  source_warehouse_id, target_warehouse_id, actor_id,
  'PENDING'::public.transaction_status, '[]'::jsonb,
  'warehouse_transfer', 'G6 partial transfer'
from g6_fixture
union all
select legacy_transfer_id, 'TRANSFER'::public.transaction_type, now(),
  jsonb_build_array(jsonb_build_object('lineId', 'legacy-line', 'itemId', item_id, 'quantity', 1, 'unit', 'kg', 'price', 10)),
  source_warehouse_id, target_warehouse_id, actor_id,
  'PENDING'::public.transaction_status, '[]'::jsonb,
  'warehouse_transfer', 'G6 legacy guard'
from g6_fixture
union all
select duplicate_transfer_id, 'TRANSFER'::public.transaction_type, now(),
  jsonb_build_array(
    jsonb_build_object('lineId', 'duplicate-line-1', 'itemId', item_id, 'quantity', 1, 'unit', 'kg', 'price', 10),
    jsonb_build_object('lineId', 'duplicate-line-2', 'itemId', item_id, 'quantity', 2, 'unit', 'kg', 'price', 10)
  ),
  source_warehouse_id, target_warehouse_id, actor_id,
  'PENDING'::public.transaction_status, '[]'::jsonb,
  'warehouse_transfer', 'G6 same item multi-line'
from g6_fixture;

select set_config('request.jwt.claim.email', actor_email, true) from g6_fixture;
select set_config('request.jwt.claim.sub', actor_id::text, true) from g6_fixture;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('email', actor_email, 'sub', actor_id, 'role', 'authenticated')::text, true) from g6_fixture;
set local role authenticated;

do $$
declare f g6_fixture%rowtype; dispatched jsonb; part jsonb; replay jsonb; completed jsonb;
  duplicate_dispatched jsonb; duplicate_returned jsonb; transfer_line uuid;
begin
  select * into f from g6_fixture;
  dispatched := public.dispatch_wms_transfer_v1(f.transfer_id, 1, 'g6-dispatch');
  if dispatched ->> 'status' <> 'APPROVED' or (dispatched ->> 'inTransitQty')::numeric <> 10 then
    raise exception 'G6 dispatch result invalid: %', dispatched;
  end if;
  select id into transfer_line from public.wms_transfer_lines where transaction_id = f.transfer_id;
  part := public.receive_wms_transfer_v1(
    f.transfer_id, jsonb_build_array(jsonb_build_object('transferLineId', transfer_line, 'quantity', 6)), 2, 'g6-receive-6'
  );
  replay := public.receive_wms_transfer_v1(
    f.transfer_id, jsonb_build_array(jsonb_build_object('transferLineId', transfer_line, 'quantity', 6)), 2, 'g6-receive-6'
  );
  if (part ->> 'inTransitQty')::numeric <> 4 or replay ->> 'replayed' <> 'true'
     or (select received_qty from public.wms_transfer_lines where id = transfer_line) <> 6 then
    raise exception 'G6 partial/replay invalid: %, %', part, replay;
  end if;
  completed := public.receive_wms_transfer_v1(
    f.transfer_id, jsonb_build_array(jsonb_build_object('transferLineId', transfer_line, 'quantity', 4)), 3, 'g6-receive-4'
  );
  if completed ->> 'status' <> 'COMPLETED' or (completed ->> 'inTransitQty')::numeric <> 0 then
    raise exception 'G6 transfer completion invalid: %', completed;
  end if;
  if (select (stock_by_warehouse ->> f.source_warehouse_id)::numeric from public.items where id = f.item_id) <> 90
     or (select (stock_by_warehouse ->> f.target_warehouse_id)::numeric from public.items where id = f.item_id) <> 10
     or (select on_hand_qty from public.inventory_balances where material_id = f.item_id and warehouse_id = f.source_warehouse_id) <> 90
     or (select on_hand_qty from public.inventory_balances where material_id = f.item_id and warehouse_id = f.target_warehouse_id) <> 10 then
    raise exception 'G6 transfer stock/cache/ledger mismatch';
  end if;
  duplicate_dispatched := public.dispatch_wms_transfer_v1(f.duplicate_transfer_id, 1, 'g6-duplicate-dispatch');
  duplicate_returned := public.dispose_wms_transfer_v1(
    f.duplicate_transfer_id, 'returned', (
      select jsonb_agg(jsonb_build_object('transferLineId', line.id, 'quantity', line.dispatched_qty) order by line.line_key)
      from public.wms_transfer_lines line where line.transaction_id = f.duplicate_transfer_id
    ), 'Hoàn lại kiểm thử nhiều dòng cùng vật tư', 2, 'g6-duplicate-return'
  );
  if duplicate_dispatched ->> 'status' <> 'APPROVED'
     or duplicate_returned ->> 'status' <> 'COMPLETED'
     or (select on_hand_qty from public.inventory_balances where material_id = f.item_id and warehouse_id = f.source_warehouse_id) <> 90
     or (select (stock_by_warehouse ->> f.source_warehouse_id)::numeric from public.items where id = f.item_id) <> 90 then
    raise exception 'G6 same-item multi-line transfer invalid: %, %', duplicate_dispatched, duplicate_returned;
  end if;
  perform set_config('app.g6_fault_after_transfer_stock', 'on', true);
  begin
    perform public.dispatch_wms_transfer_v1(f.legacy_transfer_id, 1, 'g6-dispatch-fault');
    raise exception 'G6 transfer fault injection did not fail';
  exception when others then
    if sqlerrm not like '%G6_INJECTED_FAILURE_AFTER_TRANSFER_STOCK%' then raise; end if;
  end;
  perform set_config('app.g6_fault_after_transfer_stock', '', true);
  if (select status from public.transactions where id = f.legacy_transfer_id) <> 'PENDING'::public.transaction_status
     or exists (select 1 from public.wms_transfer_lines where transaction_id = f.legacy_transfer_id)
     or exists (select 1 from public.wms_transfer_events where transaction_id = f.legacy_transfer_id)
     or (select on_hand_qty from public.inventory_balances where material_id = f.item_id and warehouse_id = f.source_warehouse_id) <> 90
     or (select (stock_by_warehouse ->> f.source_warehouse_id)::numeric from public.items where id = f.item_id) <> 90 then
    raise exception 'G6 transfer fault did not roll back all effects';
  end if;
  begin
    perform public.process_transaction_status(f.legacy_transfer_id, 'APPROVED'::public.transaction_status, f.actor_id);
    raise exception 'G6 legacy transfer writer bypassed command guard';
  exception when others then
    if sqlerrm not like '%WMS_TRANSFER_COMMAND_REQUIRED%' then raise; end if;
  end;
end $$;

reset role;

insert into public.projects(id, code, name)
select project_id, 'G6-' || right(project_id, 8), 'G6 Smoke Project' from g6_fixture;
alter table public.purchase_orders disable trigger guard_project_purchase_order_room_write;
insert into public.purchase_orders(
  id, vendor_id, vendor_name, po_number, items, total_amount, order_date,
  status, source_mode, target_warehouse_id, created_by_id, project_id
)
select po_id, 'g6-vendor', 'G6 Vendor', public.next_purchase_order_number_v2(),
  jsonb_build_array(jsonb_build_object('lineId', 'po-line-1', 'itemId', item_id, 'name', 'G6 Steel', 'qty', 100, 'unit', 'kg', 'unitPrice', 10)),
  1000, current_date::text, 'confirmed', 'proactive_stock', target_warehouse_id, actor_id::text, project_id
from g6_fixture;
insert into public.transactions(
  id, type, date, items, target_warehouse_id, requester_id, status, pending_items,
  source_type, source_id, business_event_type, business_event_reason
)
select receipt_transaction_id, 'IMPORT'::public.transaction_type, now(),
  jsonb_build_array(jsonb_build_object('itemId', item_id, 'quantity', 100, 'unit', 'kg')),
  target_warehouse_id, actor_id, 'PENDING'::public.transaction_status, '[]'::jsonb,
  'po_delivery_batch', receipt_batch_id::text, 'proactive_po_receipt', 'G6 count/QC/custody'
from g6_fixture;
insert into public.purchase_order_delivery_batches(
  id, purchase_order_id, delivery_no, status, wms_transaction_id,
  supplier_id, supplier_name_snapshot, fulfillment_mode, vat_rate, created_by
)
select receipt_batch_id, po_id, 1, 'receiving', receipt_transaction_id,
  'g6-vendor', 'G6 Vendor', 'RECEIVE_TO_STOCK', 0, actor_id
from g6_fixture;
insert into public.purchase_order_delivery_lines(
  id, delivery_batch_id, purchase_order_id, purchase_order_line_id, item_id,
  planned_qty, unit, stock_planned_qty, stock_unit, delivery_unit_price
)
select receipt_line_id, receipt_batch_id, po_id, 'po-line-1', item_id,
  100, 'kg', 100, 'kg', 10
from g6_fixture;

insert into public.material_issue_orders(
  id, issue_no, source_warehouse_id, recipient_type, recipient_id, recipient_name,
  responsible_user_id, status, created_by
)
select issue_id, 'PX-G6-001', source_warehouse_id, 'work_group', 'team-g6', 'Đội G6',
  actor_id, 'settling', actor_id from g6_fixture;
insert into public.material_issue_lines(
  id, issue_order_id, item_id, item_name_snapshot, unit,
  requested_qty, approved_qty, issued_qty, received_qty, consumed_qty, returned_qty, lost_qty
)
select issue_line_id, issue_id, item_id, 'G6 Steel', 'kg', 60, 60, 60, 60, 40, 10, 0
from g6_fixture;

set local role authenticated;
do $$
declare f g6_fixture%rowtype; quality jsonb; finalized jsonb; custody jsonb; workspace jsonb;
begin
  select * into f from g6_fixture;
  workspace := public.get_wms_inventory_workspace_v1(f.target_warehouse_id, null, null, 50);
  if workspace #>> '{rows,0,receiptCustodyQty}' is not null
     or workspace #>> '{rows,0,authoritative}' <> 'false'
     or workspace #>> '{completeness,unknownReceiptCounts}' <> '1' then
    raise exception 'G6 legacy physical count was coerced to zero: %', workspace;
  end if;
  quality := public.approve_material_po_quality(
    f.receipt_batch_id, f.receipt_transaction_id, f.actor_id, 'partial',
    jsonb_build_array(jsonb_build_object(
      'deliveryLineId', f.receipt_line_id, 'itemId', f.item_id,
      'documentedPurchaseQty', 98.5, 'countedPurchaseQty', 98.2, 'acceptedPurchaseQty', 98,
      'documentedStockQty', 98.5, 'countedStockQty', 98.2, 'acceptedStockQty', 98,
      'varianceReason', 'Chứng từ, cân và QC chênh lệch'
    )), '[]'::jsonb
  );
  if (select custody_stock_qty from public.purchase_order_delivery_lines where id = f.receipt_line_id) <> 0.2 then
    raise exception 'G6 receipt custody is not 0.2';
  end if;
  finalized := public.finalize_material_po_receipt(f.receipt_batch_id, f.receipt_transaction_id, f.actor_id);
  if finalized ->> 'transactionStatus' <> 'COMPLETED'
     or (select on_hand_qty from public.inventory_balances where material_id = f.item_id and warehouse_id = f.target_warehouse_id) <> 108 then
    raise exception 'G6 receipt accepted quantity not posted exactly once: %', finalized;
  end if;
  custody := public.get_material_custody_v1(null, null, 'work_group', 'team-g6', 10);
  if custody #>> '{rows,0,custodyQty}' <> '10' then
    raise exception 'G6 team custody expected 10: %', custody;
  end if;
end $$;

create temp table g6_count_result on commit drop as
select public.start_wms_inventory_count_v1(source_warehouse_id, array[item_id], 'Kiểm kê G6', 'g6-count-start') result
from g6_fixture;
grant select on g6_count_result to authenticated;

reset role;
update public.items item set stock_by_warehouse = jsonb_set(item.stock_by_warehouse, array[f.source_warehouse_id], '89'::jsonb)
from g6_fixture f where item.id = f.item_id;
update public.inventory_balances balance set on_hand_qty = 89
from g6_fixture f where balance.material_id = f.item_id and balance.warehouse_id = f.source_warehouse_id;

set local role authenticated;
do $$
declare count_id uuid := ((select result from g6_count_result) ->> 'inventoryCountId')::uuid;
  count_version bigint := ((select result from g6_count_result) ->> 'rowVersion')::bigint;
  line_id uuid; posted jsonb; workspace jsonb; f g6_fixture%rowtype;
begin
  select * into f from g6_fixture;
  select id into line_id from public.wms_inventory_count_lines where inventory_count_id = count_id;
  posted := public.post_wms_inventory_count_v1(
    count_id, jsonb_build_array(jsonb_build_object('countLineId', line_id, 'countedQty', 88, 'evidence', '[]'::jsonb)),
    count_version, 'g6-count-post'
  );
  if posted ->> 'status' <> 'posted'
     or (select movement_qty from public.wms_inventory_count_lines where id = line_id) <> -1
     or (select expected_qty_at_post from public.wms_inventory_count_lines where id = line_id) <> 89
     or (select variance_qty from public.wms_inventory_count_lines where id = line_id) <> -1
     or (select on_hand_qty from public.inventory_balances where material_id = f.item_id and warehouse_id = f.source_warehouse_id) <> 88
     or (select (stock_by_warehouse ->> f.source_warehouse_id)::numeric from public.items where id = f.item_id) <> 88 then
    raise exception 'G6 snapshot count/post invalid: %', posted;
  end if;
  workspace := public.get_wms_inventory_workspace_v1(f.source_warehouse_id, null, null, 50);
  if workspace #>> '{rows,0,availableQty}' <> '87.0000' or workspace #>> '{rows,0,authoritative}' <> 'true' then
    raise exception 'G6 authoritative workspace invalid: %', workspace;
  end if;
end $$;

reset role;
insert into public.wms_inventory_reconciliation_issues(
  material_id, warehouse_id, classification, cache_qty, ledger_qty, difference_qty, disposition
)
select item_id, target_warehouse_id, 'quantity_mismatch', 108, 107, 1, 'Đang xác minh nguồn lịch sử'
from g6_fixture;
set local role authenticated;
do $$
declare workspace jsonb; f g6_fixture%rowtype;
begin
  select * into f from g6_fixture;
  workspace := public.get_wms_inventory_workspace_v1(f.target_warehouse_id, null, null, 50);
  if workspace #>> '{rows,0,availableQty}' is not null
     or workspace #>> '{rows,0,authoritative}' <> 'false' then
    raise exception 'G6 unresolved mismatch exposed available quantity: %', workspace;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.email', other_email, true) from g6_fixture;
select set_config('request.jwt.claim.sub', other_actor_id::text, true) from g6_fixture;
select set_config('request.jwt.claims', jsonb_build_object('email', other_email, 'sub', other_actor_id, 'role', 'authenticated')::text, true) from g6_fixture;
set local role authenticated;
do $$
declare f g6_fixture%rowtype;
begin
  select * into f from g6_fixture;
  begin
    perform public.get_wms_inventory_workspace_v1(f.source_warehouse_id, null, null, 50);
    raise exception 'G6 unauthorized inventory read succeeded';
  exception when insufficient_privilege then
    if sqlerrm not in ('WMS_INVENTORY_VIEW_DENIED', 'authentication required') then raise; end if;
  end;
end $$;

rollback;
