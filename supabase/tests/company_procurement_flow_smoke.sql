-- Company procurement lifecycle smoke test.
-- Runs against the linked database inside one transaction and leaves no data behind.

begin;

create or replace function pg_temp.smoke_stock(p_item_id text, p_warehouse_id text)
returns numeric
language sql
stable
as $$
  select coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> p_warehouse_id)::numeric, 0)
  from public.items i
  where i.id = p_item_id;
$$;

create or replace function pg_temp.smoke_active_ordered(
  p_request_id text,
  p_request_line_id text
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(coalesce(link.ordered_qty, link.ordered_stock_qty_snapshot, 0)), 0)
  from public.purchase_order_request_lines link
  join public.purchase_orders po on po.id = link.purchase_order_id
  where link.material_request_id = p_request_id
    and link.request_line_id = p_request_line_id
    and po.archived_at is null
    and po.status in ('draft', 'sent', 'confirmed', 'in_transit', 'partial');
$$;

create or replace function pg_temp.smoke_gross_received(
  p_request_id text,
  p_request_line_id text
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(line.received_qty), 0)
  from public.material_request_fulfillment_lines line
  join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
  where line.material_request_id = p_request_id
    and line.request_line_id = p_request_line_id
    and batch.status = 'received';
$$;

create or replace function pg_temp.smoke_closed_need(
  p_request_id text,
  p_request_line_id text
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(closure.closed_qty), 0)
  from public.material_request_line_need_closures closure
  where closure.material_request_id = p_request_id
    and closure.request_line_id = p_request_line_id
    and closure.status = 'active';
$$;

create or replace function pg_temp.smoke_open_need(
  p_request_id text,
  p_request_line_id text,
  p_requested_qty numeric
)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    p_requested_qty
      - pg_temp.smoke_gross_received(p_request_id, p_request_line_id)
      - pg_temp.smoke_closed_need(p_request_id, p_request_line_id)
  );
$$;

create or replace function pg_temp.smoke_remaining_need(
  p_request_id text,
  p_request_line_id text,
  p_requested_qty numeric
)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    pg_temp.smoke_open_need(p_request_id, p_request_line_id, p_requested_qty)
      - pg_temp.smoke_active_ordered(p_request_id, p_request_line_id)
  );
$$;

create or replace function pg_temp.smoke_seed_demand(
  p_request_id text,
  p_request_code text,
  p_request_line_id text,
  p_po_id text,
  p_po_number text,
  p_po_line_id text,
  p_po_status text,
  p_project_id text,
  p_warehouse_id text,
  p_actor_id uuid,
  p_item_id text,
  p_item_sku text,
  p_item_name text,
  p_unit text
)
returns void
language plpgsql
as $$
declare
  v_request_code text := 'MR-2999-' || substring(
    translate(md5(p_request_id), 'abcdef', '123456')
    from 1 for 16
  );
  v_po_number text := 'PO-' || substring(
    translate(md5(p_po_id), 'abcdef', '123456')
    from 1 for 16
  );
begin
  insert into app_private.material_request_code_registry(code)
  values (v_request_code);

  insert into app_private.purchase_order_number_registry(po_number)
  values (v_po_number);

  insert into public.requests(
    id, code, site_warehouse_id, requester_id, status, items,
    created_date, expected_date, project_id, request_origin, workflow_step, title
  )
  values (
    p_request_id,
    v_request_code,
    p_warehouse_id,
    p_actor_id,
    'APPROVED'::public.request_status,
    jsonb_build_array(jsonb_build_object(
      'lineId', p_request_line_id,
      'itemId', p_item_id,
      'itemNameSnapshot', p_item_name,
      'skuSnapshot', p_item_sku,
      'unitSnapshot', p_unit,
      'requestQty', 100,
      'approvedQty', 100,
      'budgetQtySnapshot', 120
    )),
    now(),
    now() + interval '7 days',
    p_project_id,
    'project',
    'procurement',
    'Smoke procurement flow'
  );

  insert into public.purchase_orders(
    id, project_id, vendor_id, vendor_name, po_number, items,
    total_amount, order_date, status, source_mode,
    procurement_group_id, procurement_group_no, target_warehouse_id, created_by_id, created_at
  )
  values (
    p_po_id,
    p_project_id,
    'smoke-vendor',
    'NCC Smoke Test',
    v_po_number,
    jsonb_build_array(jsonb_build_object(
      'lineId', p_po_line_id,
      'itemId', p_item_id,
      'sku', p_item_sku,
      'name', p_item_name,
      'unit', p_unit,
      'qty', 100,
      'unitPrice', 85000,
      'receivedQty', 0,
      'returnedQty', 0,
      'unitSnapshot', p_unit,
      'stockUnitSnapshot', p_unit,
      'purchaseUnitSnapshot', p_unit,
      'purchaseConversionFactor', 1
    )),
    8500000,
    current_date::text,
    p_po_status,
    'company_consolidated',
    p_po_id || '-group',
    'MUA-' || v_po_number,
    p_warehouse_id,
    p_actor_id::text,
    now()
  );

  insert into public.purchase_order_request_lines(
    project_id, target_warehouse_id, allocation_status,
    purchase_order_id, purchase_order_line_id,
    material_request_id, material_request_code, request_line_id,
    item_id, requested_qty, ordered_qty,
    requested_qty_snapshot, ordered_stock_qty_snapshot,
    actual_received_qty_snapshot, unit
  )
  values (
    p_project_id, p_warehouse_id, 'open',
    p_po_id, p_po_line_id,
    p_request_id, v_request_code, p_request_line_id,
    p_item_id, 100, 100,
    100, 100, 0, p_unit
  );
end;
$$;

create or replace function pg_temp.smoke_receive(
  p_transaction_id text,
  p_batch_id uuid,
  p_group_id uuid,
  p_delivery_no text,
  p_request_id text,
  p_request_line_id text,
  p_po_id text,
  p_po_line_id text,
  p_project_id text,
  p_warehouse_id text,
  p_actor_id uuid,
  p_item_id text,
  p_unit text,
  p_issued_qty numeric,
  p_received_qty numeric,
  p_variance_reason text default null
)
returns void
language plpgsql
as $$
declare
  v_link_id uuid;
begin
  select link.id into v_link_id
  from public.purchase_order_request_lines link
  where link.purchase_order_id = p_po_id
    and link.purchase_order_line_id = p_po_line_id
    and link.material_request_id = p_request_id
    and link.request_line_id = p_request_line_id
  limit 1;

  insert into public.purchase_order_delivery_groups(
    id, project_id, purchase_order_id, delivery_no,
    planned_date, status, created_by, note
  )
  values (
    p_group_id, p_project_id, p_po_id, p_delivery_no,
    now(), 'issued', p_actor_id, 'Smoke delivery'
  );

  insert into public.transactions(
    id, type, date, items, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id
  )
  values (
    p_transaction_id,
    'IMPORT'::public.transaction_type,
    now(),
    jsonb_build_array(jsonb_build_object(
      'itemId', p_item_id,
      'quantity', p_received_qty,
      'price', 85000,
      'fulfillmentBatchId', p_batch_id::text,
      'requestLineId', p_request_line_id,
      'varianceReason', p_variance_reason
    )),
    p_warehouse_id,
    p_actor_id,
    p_actor_id,
    'PENDING'::public.transaction_status,
    'Smoke PO receipt',
    p_request_id
  );

  insert into public.material_request_fulfillment_batches(
    id, project_id, material_request_id, batch_no, batch_date,
    target_warehouse_id, po_delivery_group_id,
    fulfillment_mode, source_type, status, transaction_id,
    created_by, issued_by, issued_at, note
  )
  values (
    p_batch_id, p_project_id, p_request_id,
    p_delivery_no, now(), p_warehouse_id, p_group_id,
    'RECEIVE_TO_STOCK', 'po_receipt', 'issued', p_transaction_id,
    p_actor_id, p_actor_id, now(), 'Smoke PO receipt batch'
  );

  insert into public.material_request_fulfillment_lines(
    batch_id, material_request_id, request_line_id, item_id,
    po_id, po_line_id, purchase_order_request_line_id,
    requested_qty_snapshot, committed_qty_snapshot,
    issued_qty, received_qty, unit, delivery_unit,
    delivery_unit_price, variance_reason
  )
  values (
    p_batch_id, p_request_id, p_request_line_id, p_item_id,
    p_po_id, p_po_line_id, v_link_id,
    100, 100, p_issued_qty, 0, p_unit, p_unit,
    85000, p_variance_reason
  );

  perform public.process_transaction_status(
    p_transaction_id,
    'COMPLETED'::public.transaction_status,
    p_actor_id
  );
  perform public.sync_fulfillment_receipt_for_transaction(p_transaction_id, p_actor_id);

  update public.purchase_order_delivery_groups delivery_group
  set status = case
    when not exists (
      select 1
      from public.material_request_fulfillment_batches batch
      where batch.po_delivery_group_id = delivery_group.id
        and batch.status not in ('received', 'returned', 'cancelled')
    ) then 'received'
    else 'issued'
  end
  where delivery_group.id = p_group_id;
end;
$$;

do $smoke$
declare
  v_admin_id uuid;
  v_admin_auth_id uuid;
  v_project_id text;
  v_warehouse_id text;
  v_prefix text := 'smoke-proc-' || replace(gen_random_uuid()::text, '-', '');
  v_item_id text;
  v_item_sku text;
  v_unit text := 'bao';
  v_request_normal text;
  v_request_supplement text;
  v_request_close text;
  v_request_return_before text;
  v_request_rejected_delete text;
  v_request_supplier_return text;
  v_line_normal text := 'line-normal';
  v_line_supplement text := 'line-supplement';
  v_line_close text := 'line-close';
  v_line_return_before text := 'line-return-before';
  v_line_rejected_delete text := 'line-rejected-delete';
  v_line_supplier_return text := 'line-supplier-return';
  v_po_normal text;
  v_po_supplement text;
  v_po_close text;
  v_po_return_before text;
  v_po_rejected_delete text;
  v_po_supplier_return text;
  v_po_line_normal text := 'po-line-normal';
  v_po_line_supplement text := 'po-line-supplement';
  v_po_line_close text := 'po-line-close';
  v_po_line_return_before text := 'po-line-return-before';
  v_po_line_rejected_delete text := 'po-line-rejected-delete';
  v_po_line_supplier_return text := 'po-line-supplier-return';
  v_batch_id uuid;
  v_group_id uuid;
  v_pending_tx text;
  v_pending_batch uuid;
  v_pending_group uuid;
  v_pending_line uuid;
  v_delivery_batch uuid;
  v_delivery_line uuid;
  v_stock_before numeric;
  v_stock_after numeric;
  v_return public.purchase_order_supplier_returns%rowtype;
  v_returned_qty numeric;
  v_status text;
  i integer;
begin
  select u.id, u.auth_id
  into v_admin_id, v_admin_auth_id
  from public.users u
  where u.auth_id is not null
    and coalesce(u.is_active, true)
    and u.role::text = 'ADMIN'
  order by u.created_at
  limit 1;

  select p.id::text into v_project_id
  from public.projects p
  where not coalesce(p.is_hidden, false)
  order by p.created_at
  limit 1;

  select w.id::text into v_warehouse_id
  from public.warehouses w
  where not coalesce(w.is_archived, false)
  order by w.created_at
  limit 1;

  if v_admin_id is null or v_admin_auth_id is null
     or v_project_id is null or v_warehouse_id is null then
    raise exception 'Smoke prerequisites missing: active admin, project, or warehouse.';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text,
    true
  );

  v_item_id := v_prefix || '-item';
  v_item_sku := upper(left(v_prefix, 24));
  insert into public.items(
    id, sku, name, category, unit, purchase_unit,
    purchase_conversion_factor, price_in, price_out,
    min_stock, stock_by_warehouse
  )
  values (
    v_item_id, v_item_sku, 'Xi mang smoke test', 'Smoke', v_unit, v_unit,
    1, 85000, 0, 0, jsonb_build_object(v_warehouse_id, 0)
  );

  v_request_normal := v_prefix || '-mr-normal';
  v_request_supplement := v_prefix || '-mr-supplement';
  v_request_close := v_prefix || '-mr-close';
  v_request_return_before := v_prefix || '-mr-return-before';
  v_request_rejected_delete := v_prefix || '-mr-rejected-delete';
  v_request_supplier_return := v_prefix || '-mr-supplier-return';
  v_po_normal := v_prefix || '-po-normal';
  v_po_supplement := v_prefix || '-po-supplement';
  v_po_close := v_prefix || '-po-close';
  v_po_return_before := v_prefix || '-po-return-before';
  v_po_rejected_delete := v_prefix || '-po-rejected-delete';
  v_po_supplier_return := v_prefix || '-po-supplier-return';

  perform pg_temp.smoke_seed_demand(
    v_request_normal, upper(left(v_request_normal, 48)), v_line_normal,
    v_po_normal, upper(left(v_po_normal, 48)), v_po_line_normal, 'confirmed',
    v_project_id, v_warehouse_id, v_admin_id,
    v_item_id, v_item_sku, 'Xi mang smoke test', v_unit
  );
  perform pg_temp.smoke_seed_demand(
    v_request_supplement, upper(left(v_request_supplement, 48)), v_line_supplement,
    v_po_supplement, upper(left(v_po_supplement, 48)), v_po_line_supplement, 'confirmed',
    v_project_id, v_warehouse_id, v_admin_id,
    v_item_id, v_item_sku, 'Xi mang smoke test', v_unit
  );
  perform pg_temp.smoke_seed_demand(
    v_request_close, upper(left(v_request_close, 48)), v_line_close,
    v_po_close, upper(left(v_po_close, 48)), v_po_line_close, 'confirmed',
    v_project_id, v_warehouse_id, v_admin_id,
    v_item_id, v_item_sku, 'Xi mang smoke test', v_unit
  );
  perform pg_temp.smoke_seed_demand(
    v_request_return_before, upper(left(v_request_return_before, 48)), v_line_return_before,
    v_po_return_before, upper(left(v_po_return_before, 48)), v_po_line_return_before, 'in_transit',
    v_project_id, v_warehouse_id, v_admin_id,
    v_item_id, v_item_sku, 'Xi mang smoke test', v_unit
  );
  perform pg_temp.smoke_seed_demand(
    v_request_rejected_delete, upper(left(v_request_rejected_delete, 48)), v_line_rejected_delete,
    v_po_rejected_delete, upper(left(v_po_rejected_delete, 48)), v_po_line_rejected_delete, 'in_transit',
    v_project_id, v_warehouse_id, v_admin_id,
    v_item_id, v_item_sku, 'Xi mang smoke test', v_unit
  );
  perform pg_temp.smoke_seed_demand(
    v_request_supplier_return, upper(left(v_request_supplier_return, 48)), v_line_supplier_return,
    v_po_supplier_return, upper(left(v_po_supplier_return, 48)), v_po_line_supplier_return, 'confirmed',
    v_project_id, v_warehouse_id, v_admin_id,
    v_item_id, v_item_sku, 'Xi mang smoke test', v_unit
  );

  if pg_temp.smoke_active_ordered(v_request_normal, v_line_normal) <> 100
     or pg_temp.smoke_remaining_need(v_request_normal, v_line_normal, 100) <> 0 then
    raise exception 'Initial PO coverage formula failed.';
  end if;
  raise notice 'PASS 1/7: approved demand is fully covered by an active company PO';

  -- Normal forward flow: receive 60, then receive the remaining 40.
  v_stock_before := pg_temp.smoke_stock(v_item_id, v_warehouse_id);
  v_batch_id := gen_random_uuid();
  v_group_id := gen_random_uuid();
  perform pg_temp.smoke_receive(
    v_prefix || '-tx-normal-1', v_batch_id, v_group_id, 'NORMAL-DOT-1',
    v_request_normal, v_line_normal, v_po_normal, v_po_line_normal,
    v_project_id, v_warehouse_id, v_admin_id, v_item_id, v_unit, 60, 60, null
  );

  if pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before + 60
     or pg_temp.smoke_gross_received(v_request_normal, v_line_normal) <> 60
     or pg_temp.smoke_open_need(v_request_normal, v_line_normal, 100) <> 40
     or pg_temp.smoke_remaining_need(v_request_normal, v_line_normal, 100) <> 0
     or (select po.status from public.purchase_orders po where po.id = v_po_normal) <> 'partial'
     or (select group_row.status from public.purchase_order_delivery_groups group_row where group_row.id = v_group_id) <> 'received' then
    raise exception 'Normal first delivery assertions failed.';
  end if;

  v_batch_id := gen_random_uuid();
  v_group_id := gen_random_uuid();
  perform pg_temp.smoke_receive(
    v_prefix || '-tx-normal-2', v_batch_id, v_group_id, 'NORMAL-DOT-2',
    v_request_normal, v_line_normal, v_po_normal, v_po_line_normal,
    v_project_id, v_warehouse_id, v_admin_id, v_item_id, v_unit, 40, 40, null
  );

  if pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before + 100
     or pg_temp.smoke_gross_received(v_request_normal, v_line_normal) <> 100
     or pg_temp.smoke_open_need(v_request_normal, v_line_normal, 100) <> 0
     or (select po.status from public.purchase_orders po where po.id = v_po_normal) <> 'delivered'
     or (select coalesce((po.items -> 0 ->> 'receivedQty')::numeric, 0) from public.purchase_orders po where po.id = v_po_normal) <> 100 then
    raise exception 'Normal completed delivery assertions failed.';
  end if;
  raise notice 'PASS 2/7: two delivery batches receive 60 + 40 and complete the PO';

  -- Short receipt with a later supplementary delivery.
  v_stock_before := pg_temp.smoke_stock(v_item_id, v_warehouse_id);
  v_batch_id := gen_random_uuid();
  v_group_id := gen_random_uuid();
  perform pg_temp.smoke_receive(
    v_prefix || '-tx-supplement-1', v_batch_id, v_group_id, 'SUPPLEMENT-DOT-1',
    v_request_supplement, v_line_supplement, v_po_supplement, v_po_line_supplement,
    v_project_id, v_warehouse_id, v_admin_id, v_item_id, v_unit,
    80, 80, 'NCC giao thieu 20 bao'
  );

  if pg_temp.smoke_gross_received(v_request_supplement, v_line_supplement) <> 80
     or pg_temp.smoke_open_need(v_request_supplement, v_line_supplement, 100) <> 20
     or pg_temp.smoke_remaining_need(v_request_supplement, v_line_supplement, 100) <> 0
     or (select po.status from public.purchase_orders po where po.id = v_po_supplement) <> 'partial' then
    raise exception 'Short receipt before supplement assertions failed.';
  end if;

  v_batch_id := gen_random_uuid();
  v_group_id := gen_random_uuid();
  perform pg_temp.smoke_receive(
    v_prefix || '-tx-supplement-2', v_batch_id, v_group_id, 'SUPPLEMENT-DOT-2',
    v_request_supplement, v_line_supplement, v_po_supplement, v_po_line_supplement,
    v_project_id, v_warehouse_id, v_admin_id, v_item_id, v_unit, 20, 20, null
  );

  if pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before + 100
     or pg_temp.smoke_gross_received(v_request_supplement, v_line_supplement) <> 100
     or (select po.status from public.purchase_orders po where po.id = v_po_supplement) <> 'delivered' then
    raise exception 'Supplementary delivery assertions failed.';
  end if;
  raise notice 'PASS 3/7: short receipt 80 keeps the PO partial, then a 20-unit supplement completes it';

  -- Short receipt closed by business decision, then close the remaining MR need.
  v_stock_before := pg_temp.smoke_stock(v_item_id, v_warehouse_id);
  v_batch_id := gen_random_uuid();
  v_group_id := gen_random_uuid();
  perform pg_temp.smoke_receive(
    v_prefix || '-tx-close-1', v_batch_id, v_group_id, 'CLOSE-DOT-1',
    v_request_close, v_line_close, v_po_close, v_po_line_close,
    v_project_id, v_warehouse_id, v_admin_id, v_item_id, v_unit,
    80, 80, 'NCC khong giao 20 bao con lai'
  );

  if pg_temp.smoke_remaining_need(v_request_close, v_line_close, 100) <> 0 then
    raise exception 'Active partial PO did not suppress duplicate purchasing.';
  end if;

  update public.purchase_orders
  set status = 'delivered',
      actual_delivery_date = current_date::text,
      delivery_note = 'Smoke: ket thuc PO sau khi nhan 80/100'
  where id = v_po_close;

  if pg_temp.smoke_active_ordered(v_request_close, v_line_close) <> 0
     or pg_temp.smoke_open_need(v_request_close, v_line_close, 100) <> 20
     or pg_temp.smoke_remaining_need(v_request_close, v_line_close, 100) <> 20 then
    raise exception 'Ending a short PO did not reopen the 20-unit demand.';
  end if;

  insert into public.material_request_line_need_closures(
    project_id, material_request_id, request_line_id, item_id,
    closed_qty, actual_received_qty_snapshot, reason, status, closed_by
  )
  values (
    v_project_id, v_request_close, v_line_close, v_item_id,
    20, 80, 'Cong truong xac nhan da du nhu cau', 'active', v_admin_id
  );

  if pg_temp.smoke_open_need(v_request_close, v_line_close, 100) <> 0
     or pg_temp.smoke_remaining_need(v_request_close, v_line_close, 100) <> 0
     or pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before + 80 then
    raise exception 'Need closure after short PO assertions failed.';
  end if;
  raise notice 'PASS 4/7: ending an 80/100 PO reopens 20, and need closure closes it without stock movement';

  -- Return the whole delivery before any warehouse receipt.
  v_stock_before := pg_temp.smoke_stock(v_item_id, v_warehouse_id);
  v_pending_tx := v_prefix || '-tx-return-before';
  v_pending_batch := gen_random_uuid();
  v_pending_group := gen_random_uuid();

  insert into public.purchase_order_delivery_groups(
    id, project_id, purchase_order_id, delivery_no,
    planned_date, status, created_by
  ) values (
    v_pending_group, v_project_id, v_po_return_before,
    'RETURN-BEFORE-DOT-1', now(), 'issued', v_admin_id
  );

  insert into public.transactions(
    id, type, date, items, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id
  ) values (
    v_pending_tx, 'IMPORT', now(),
    jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id,
      'quantity', 100,
      'price', 85000,
      'fulfillmentBatchId', v_pending_batch::text,
      'requestLineId', v_line_return_before
    )),
    v_warehouse_id, v_admin_id, v_admin_id, 'PENDING',
    'Smoke return before receipt', v_request_return_before
  );

  insert into public.material_request_fulfillment_batches(
    id, project_id, material_request_id, batch_no, target_warehouse_id,
    po_delivery_group_id, fulfillment_mode, source_type,
    status, transaction_id, created_by, issued_by, issued_at
  ) values (
    v_pending_batch, v_project_id, v_request_return_before,
    'RETURN-BEFORE-DOT-1', v_warehouse_id, v_pending_group,
    'RECEIVE_TO_STOCK', 'po_receipt', 'issued', v_pending_tx,
    v_admin_id, v_admin_id, now()
  );

  insert into public.material_request_fulfillment_lines(
    batch_id, material_request_id, request_line_id, item_id,
    po_id, po_line_id, requested_qty_snapshot,
    committed_qty_snapshot, issued_qty, received_qty, unit,
    delivery_unit, delivery_unit_price
  ) values (
    v_pending_batch, v_request_return_before, v_line_return_before, v_item_id,
    v_po_return_before, v_po_line_return_before, 100, 100, 100, 0, v_unit,
    v_unit, 85000
  )
  returning id into v_pending_line;

  perform public.update_purchase_order_delivery_group_v1(
    v_pending_group,
    current_date + 2,
    'Smoke edited delivery',
    jsonb_build_array(jsonb_build_object(
      'id', v_pending_line,
      'issuedQty', 75,
      'deliveryUnitPrice', 91000
    ))
  );

  if (select delivery_group.planned_date::date from public.purchase_order_delivery_groups delivery_group where delivery_group.id = v_pending_group) <> current_date + 2
     or (select delivery_group.note from public.purchase_order_delivery_groups delivery_group where delivery_group.id = v_pending_group) <> 'Smoke edited delivery'
     or (select line.issued_qty from public.material_request_fulfillment_lines line where line.id = v_pending_line) <> 75
     or (select line.delivery_unit_price from public.material_request_fulfillment_lines line where line.id = v_pending_line) <> 91000
     or (select (tx.items -> 0 ->> 'quantity')::numeric from public.transactions tx where tx.id = v_pending_tx) <> 75
     or (select (tx.items -> 0 ->> 'price')::numeric from public.transactions tx where tx.id = v_pending_tx) <> 91000 then
    raise exception 'Editable delivery group assertions failed.';
  end if;

  perform public.process_transaction_status(
    v_pending_tx,
    'CANCELLED'::public.transaction_status,
    v_admin_id
  );
  update public.purchase_orders
  set status = 'cancelled', delivery_note = 'Huy truoc khi nhap kho'
  where id = v_po_return_before;

  if pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before
     or pg_temp.smoke_gross_received(v_request_return_before, v_line_return_before) <> 0
     or pg_temp.smoke_active_ordered(v_request_return_before, v_line_return_before) <> 0
     or pg_temp.smoke_remaining_need(v_request_return_before, v_line_return_before, 100) <> 100
     or (select tx.status::text from public.transactions tx where tx.id = v_pending_tx) <> 'CANCELLED'
     or (select batch.status from public.material_request_fulfillment_batches batch where batch.id = v_pending_batch) <> 'cancelled'
     or (select delivery_group.status from public.purchase_order_delivery_groups delivery_group where delivery_group.id = v_pending_group) <> 'cancelled'
     or (select request.status::text from public.requests request where request.id = v_request_return_before) <> 'APPROVED'
     or (select request.workflow_step from public.requests request where request.id = v_request_return_before) <> 'batch_planning' then
    raise exception 'Cancel-before-receipt assertions failed.';
  end if;
  raise notice 'PASS 5/7: pending delivery edits stay synchronized with WMS, then cancellation keeps stock unchanged and reopens demand';

  -- Two rejected delivery batches with no receipt keep the PO in-transit but allow safe deletion.
  v_stock_before := pg_temp.smoke_stock(v_item_id, v_warehouse_id);

  for i in 1..2 loop
    v_pending_tx := v_prefix || '-tx-rejected-delete-' || i;
    v_pending_batch := gen_random_uuid();
    v_pending_group := gen_random_uuid();

    insert into public.purchase_order_delivery_groups(
      id, project_id, purchase_order_id, delivery_no,
      planned_date, status, created_by
    ) values (
      v_pending_group, v_project_id, v_po_rejected_delete,
      'REJECTED-DELETE-DOT-' || i, now(), 'received', v_admin_id
    );

    insert into public.transactions(
      id, type, date, items, target_warehouse_id,
      requester_id, approver_id, status, note, related_request_id
    ) values (
      v_pending_tx, 'IMPORT', now(),
      jsonb_build_array(jsonb_build_object(
        'itemId', v_item_id,
        'quantity', 50,
        'price', 85000,
        'fulfillmentBatchId', v_pending_batch::text,
        'requestLineId', v_line_rejected_delete
      )),
      v_warehouse_id, v_admin_id, v_admin_id, 'CANCELLED',
      'Smoke rejected delete batch', v_request_rejected_delete
    );

    insert into public.material_request_fulfillment_batches(
      id, project_id, material_request_id, batch_no, target_warehouse_id,
      po_delivery_group_id, fulfillment_mode, source_type,
      status, transaction_id, created_by, issued_by, issued_at,
      reason
    ) values (
      v_pending_batch, v_project_id, v_request_rejected_delete,
      'REJECTED-DELETE-DOT-' || i, v_warehouse_id, v_pending_group,
      'RECEIVE_TO_STOCK', 'po_receipt', 'returned', v_pending_tx,
      v_admin_id, v_admin_id, now(), 'Kho tu choi hang truoc khi nhap'
    );

    insert into public.material_request_fulfillment_lines(
      batch_id, material_request_id, request_line_id, item_id,
      po_id, po_line_id, requested_qty_snapshot,
      committed_qty_snapshot, issued_qty, received_qty, unit
    ) values (
      v_pending_batch, v_request_rejected_delete, v_line_rejected_delete, v_item_id,
      v_po_rejected_delete, v_po_line_rejected_delete, 100, 100, 50, 0, v_unit
    );
  end loop;

  v_delivery_batch := gen_random_uuid();
  v_delivery_line := gen_random_uuid();
  v_pending_tx := v_prefix || '-tx-rejected-schedule';
  v_pending_batch := gen_random_uuid();

  insert into public.purchase_order_delivery_batches(
    id, purchase_order_id, project_id, delivery_no,
    planned_delivery_date, status, fulfillment_batch_ids, created_by
  ) values (
    v_delivery_batch, v_po_rejected_delete, v_project_id, 10,
    current_date, 'wms_pending', array[v_pending_batch::text], v_admin_id
  );

  insert into public.purchase_order_delivery_lines(
    id, delivery_batch_id, purchase_order_id, purchase_order_line_id,
    item_id, planned_qty, unit, stock_planned_qty, stock_unit
  ) values (
    v_delivery_line, v_delivery_batch, v_po_rejected_delete, v_po_line_rejected_delete,
    v_item_id, 25, v_unit, 25, v_unit
  );

  insert into public.transactions(
    id, type, date, items, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id
  ) values (
    v_pending_tx, 'IMPORT', now(),
    jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id,
      'quantity', 25,
      'price', 85000,
      'fulfillmentBatchId', v_pending_batch::text,
      'requestLineId', v_line_rejected_delete,
      'purchaseOrderDeliveryBatchId', v_delivery_batch::text,
      'purchaseOrderDeliveryLineId', v_delivery_line::text
    )),
    v_warehouse_id, v_admin_id, v_admin_id, 'PENDING',
    'Smoke rejected scheduled batch', v_request_rejected_delete
  );

  insert into public.material_request_fulfillment_batches(
    id, project_id, material_request_id, batch_no, target_warehouse_id,
    po_delivery_batch_id, fulfillment_mode, source_type,
    status, transaction_id, created_by, issued_by, issued_at
  ) values (
    v_pending_batch, v_project_id, v_request_rejected_delete,
    'REJECTED-SCHEDULE-DOT', v_warehouse_id, v_delivery_batch,
    'RECEIVE_TO_STOCK', 'po_receipt', 'issued', v_pending_tx,
    v_admin_id, v_admin_id, now()
  );

  insert into public.material_request_fulfillment_lines(
    batch_id, material_request_id, request_line_id, item_id,
    po_id, po_line_id, po_delivery_line_id, requested_qty_snapshot,
    committed_qty_snapshot, issued_qty, received_qty, unit
  ) values (
    v_pending_batch, v_request_rejected_delete, v_line_rejected_delete, v_item_id,
    v_po_rejected_delete, v_po_line_rejected_delete, v_delivery_line, 100, 100, 25, 0, v_unit
  );

  perform public.process_transaction_status(
    v_pending_tx,
    'CANCELLED'::public.transaction_status,
    v_admin_id
  );

  if pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before
     or (select po.status from public.purchase_orders po where po.id = v_po_rejected_delete) <> 'in_transit'
     or (select batch.status from public.material_request_fulfillment_batches batch where batch.id = v_pending_batch) <> 'cancelled'
     or (select delivery.status from public.purchase_order_delivery_batches delivery where delivery.id = v_delivery_batch) <> 'cancelled'
     or (select request.status::text from public.requests request where request.id = v_request_rejected_delete) <> 'APPROVED'
     or (select request.workflow_step from public.requests request where request.id = v_request_rejected_delete) <> 'batch_planning'
     or exists (
       select 1
       from public.material_request_fulfillment_lines line
       join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
       where line.po_id = v_po_rejected_delete
         and batch.status not in ('returned', 'cancelled')
     ) then
    raise exception 'Rejected-delete setup assertions failed.';
  end if;

  begin
    perform 1 from public.remove_purchase_order_v1(v_po_rejected_delete);
    raise exception 'Rejected PO parent deletion should have been blocked before failed delivery cleanup.';
  exception
    when others then
      if sqlerrm not like '%chờ xử lý%' and sqlerrm not like '%đợt giao%' then
        raise;
      end if;
  end;

  perform 1 from public.remove_purchase_order_delivery_batch_v1(v_delivery_batch);

  for v_group_id in
    select delivery_group.id
    from public.purchase_order_delivery_groups delivery_group
    where delivery_group.purchase_order_id = v_po_rejected_delete
  loop
    perform 1 from public.remove_purchase_order_delivery_group_v1(v_group_id);
  end loop;

  perform 1 from public.remove_purchase_order_v1(v_po_rejected_delete);

  if exists (select 1 from public.purchase_orders po where po.id = v_po_rejected_delete)
     or exists (select 1 from public.purchase_order_request_lines link where link.purchase_order_id = v_po_rejected_delete)
     or exists (select 1 from public.purchase_order_delivery_batches delivery where delivery.purchase_order_id = v_po_rejected_delete)
     or exists (select 1 from public.purchase_order_delivery_groups delivery_group where delivery_group.purchase_order_id = v_po_rejected_delete)
     or exists (
       select 1
       from public.material_request_fulfillment_lines line
       where line.po_id = v_po_rejected_delete
     )
     or pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before then
    raise exception 'Rejected in-transit PO deletion assertions failed.';
  end if;
  raise notice 'PASS 6/7: rejected no-receipt delivery batches must be deleted before deleting the in-transit PO';

  -- Receive all, then return 10 and the remaining 90 to the supplier through WMS.
  v_stock_before := pg_temp.smoke_stock(v_item_id, v_warehouse_id);
  v_batch_id := gen_random_uuid();
  v_group_id := gen_random_uuid();
  perform pg_temp.smoke_receive(
    v_prefix || '-tx-supplier-receipt', v_batch_id, v_group_id, 'SUPPLIER-RETURN-DOT-1',
    v_request_supplier_return, v_line_supplier_return,
    v_po_supplier_return, v_po_line_supplier_return,
    v_project_id, v_warehouse_id, v_admin_id, v_item_id, v_unit, 100, 100, null
  );

  if pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before + 100 then
    raise exception 'Supplier-return setup receipt did not add 100 units to stock.';
  end if;

  select * into v_return
  from public.create_purchase_order_supplier_return(
    v_po_supplier_return,
    v_warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_po_line_supplier_return,
      'quantity', 10
    )),
    '10 bao bi hong',
    'Smoke partial supplier return'
  );

  if v_return.status <> 'pending'
     or pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before + 100 then
    raise exception 'Pending supplier return changed stock too early.';
  end if;

  perform public.process_transaction_status(
    v_return.transaction_id,
    'COMPLETED'::public.transaction_status,
    v_admin_id
  );

  select r.status into v_status
  from public.purchase_order_supplier_returns r
  where r.id = v_return.id;
  select coalesce((po.items -> 0 ->> 'returnedQty')::numeric, 0)
  into v_returned_qty
  from public.purchase_orders po
  where po.id = v_po_supplier_return;

  if v_status <> 'completed'
     or pg_temp.smoke_stock(v_item_id, v_warehouse_id) <> v_stock_before + 90
     or v_returned_qty <> 10
     or (select po.status from public.purchase_orders po where po.id = v_po_supplier_return) <> 'delivered'
     or pg_temp.smoke_gross_received(v_request_supplier_return, v_line_supplier_return) <> 100 then
    raise exception 'Partial supplier return assertions failed.';
  end if;

  select * into v_return
  from public.create_purchase_order_supplier_return(
    v_po_supplier_return,
    v_warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_po_line_supplier_return,
      'quantity', 90
    )),
    'Hoan het hang con lai',
    'Smoke full supplier return'
  );
  perform public.process_transaction_status(
    v_return.transaction_id,
    'COMPLETED'::public.transaction_status,
    v_admin_id
  );

  select coalesce((po.items -> 0 ->> 'returnedQty')::numeric, 0), po.status
  into v_returned_qty, v_status
  from public.purchase_orders po
  where po.id = v_po_supplier_return;
  v_stock_after := pg_temp.smoke_stock(v_item_id, v_warehouse_id);

  if v_stock_after <> v_stock_before
     or v_returned_qty <> 100
     or v_status <> 'returned'
     or pg_temp.smoke_gross_received(v_request_supplier_return, v_line_supplier_return) <> 100
     or pg_temp.smoke_open_need(v_request_supplier_return, v_line_supplier_return, 100) <> 0 then
    raise exception 'Full supplier return assertions failed.';
  end if;
  raise notice 'PASS 7/7: post-receipt supplier returns wait for WMS, reduce stock on completion, and preserve gross receipt history';

  raise notice 'COMPANY PROCUREMENT SMOKE TEST PASSED';
end;
$smoke$;

rollback;
