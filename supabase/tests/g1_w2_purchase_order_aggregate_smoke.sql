begin;

insert into public.users (id, name, email, username, role, is_active, account_status)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'G1 W2 Buyer',
    'g1-w2-buyer@example.test',
    'g1-w2-buyer',
    'EMPLOYEE',
    true,
    'ACTIVE'
  ),
  (
    '11111111-1111-4111-8111-111111111119',
    'G1 W2 Unscoped User',
    'g1-w2-unscoped@example.test',
    'g1-w2-unscoped',
    'EMPLOYEE',
    true,
    'ACTIVE'
  );

insert into public.hrm_positions (id, name, code)
values ('11111111-1111-4111-8111-111111111112', 'G1 W2 Buyer', 'G1_W2_BUYER');

insert into public.projects (id, code, name, status)
values ('g1-w2-project', 'G1-W2', 'G1 W2 project', 'active');

insert into public.warehouse_types (code, name, is_system, is_active)
values ('CENTRAL', 'Central warehouse', true, true)
on conflict (code) do nothing;

insert into public.warehouses (id, name, address, type)
values ('g1-w2-warehouse', 'G1 W2 warehouse', 'test', 'CENTRAL');

insert into public.items (id, sku, name, category, unit, price_in, price_out, min_stock)
values ('g1-w2-item', 'G1-W2-ITEM', 'G1 W2 item', 'test', 'kg', 0, 0, 0);

insert into public.requests (
  id, code, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, construction_site_id,
  request_origin, workflow_step, title
) values (
  'g1-w2-request',
  public.next_material_request_code_v1(2026),
  'g1-w2-warehouse',
  '11111111-1111-4111-8111-111111111111',
  'APPROVED',
  '[{"lineId":"g1-w2-request-line","itemId":"g1-w2-item","requestQty":50,"approvedQty":50,"unitSnapshot":"kg"}]'::jsonb,
  now(),
  now() + interval '7 days',
  'g1-w2-project',
  null,
  'project',
  'batch_planning',
  'G1 W2 request'
);

insert into public.project_staff (
  id, project_id, construction_site_id, user_id, position_id
) values (
  '11111111-1111-4111-8111-111111111113',
  'g1-w2-project',
  null,
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111112'
);

insert into public.project_permission_room_members (
  id, project_id, construction_site_id, room_code, project_staff_id, is_active
) values (
  '11111111-1111-4111-8111-111111111114',
  'g1-w2-project',
  null,
  'material_po',
  '11111111-1111-4111-8111-111111111113',
  true
);

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, grant_source
) values
  ('11111111-1111-4111-8111-111111111114', 'view', true, 'manual_room'),
  ('11111111-1111-4111-8111-111111111114', 'edit', true, 'manual_room');

create function public.g1_w2_fail_delivery_line_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('g1_w2.fail_delivery_line_insert', true) = 'on' then
    raise exception 'G1_W2_INJECTED_LINE_FAILURE';
  end if;
  return new;
end;
$$;

create trigger g1_w2_fail_delivery_line_insert
before insert on public.purchase_order_delivery_lines
for each row execute function public.g1_w2_fail_delivery_line_insert();

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '11111111-1111-4111-8111-111111111111',
    'email', 'g1-w2-buyer@example.test',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
declare
  v_po_number text := public.next_purchase_order_number_v2();
  v_po jsonb := jsonb_build_object(
    'id', 'g1-w2-po',
    'project_id', 'g1-w2-project',
    'construction_site_id', null,
    'vendor_id', 'g1-w2-vendor',
    'vendor_name', 'G1 W2 vendor',
    'po_number', v_po_number,
    'items', jsonb_build_array(jsonb_build_object(
      'line_id', 'g1-w2-po-line',
      'item_id', 'g1-w2-item',
      'sku', 'G1-W2-ITEM',
      'name', 'G1 W2 item',
      'unit', 'bao',
      'qty', 2,
      'unit_price', 100
    )),
    'total_amount', 200,
    'approved_total_amount', 200,
    'vat_rate', 0,
    'order_date', current_date::text,
    'status', 'draft',
    'source_mode', 'from_request',
    'purchase_mode', 'multiple',
    'fulfillment_mode', 'RECEIVE_TO_STOCK',
    'created_by_id', '11111111-1111-4111-8111-111111111111',
    'created_at', now()
  );
  v_links jsonb := jsonb_build_array(jsonb_build_object(
    'project_id', 'g1-w2-project',
    'construction_site_id', null,
    'purchase_order_id', 'g1-w2-po',
    'purchase_order_line_id', 'g1-w2-po-line',
    'material_request_id', 'g1-w2-request',
    'material_request_code', 'MR-2026-0001',
    'request_line_id', 'g1-w2-request-line',
    'item_id', 'g1-w2-item',
    'requested_qty', 50,
    'ordered_qty', 50,
    'requested_qty_snapshot', 50,
    'ordered_stock_qty_snapshot', 50,
    'actual_received_qty_snapshot', 0,
    'unit', 'kg'
  ));
  v_batches jsonb := jsonb_build_array(jsonb_build_object(
    'id', '22222222-2222-4222-8222-222222222222',
    'purchase_order_id', 'g1-w2-po',
    'project_id', 'g1-w2-project',
    'construction_site_id', null,
    'delivery_no', 1,
    'planned_delivery_date', current_date + 5,
    'status', 'planned',
    'approval_status', 'draft',
    'fulfillment_mode', 'RECEIVE_TO_STOCK',
    'vat_rate', 0,
    'lines', jsonb_build_array(jsonb_build_object(
      'id', '33333333-3333-4333-8333-333333333333',
      'purchase_order_line_id', 'g1-w2-po-line',
      'item_id', 'g1-w2-item',
      'planned_qty', 2,
      'stock_planned_qty', 50,
      'unit', 'bao',
      'stock_unit', 'kg',
      'delivery_unit_price', 100
    ))
  ));
  v_result jsonb;
begin
  begin
    perform public.save_purchase_order_aggregate_v1(
      v_po, v_links, v_batches, null, '[]', '[]',
      '11111111-1111-4111-8111-111111111118',
      '44444444-4444-4444-8444-444444444440'
    );
    raise exception 'G1_W2_ACTOR_SPOOF_ACCEPTED';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '11111111-1111-4111-8111-111111111119',
      'email', 'g1-w2-unscoped@example.test',
      'role', 'authenticated'
    )::text,
    true
  );
  begin
    perform public.save_purchase_order_aggregate_v1(
      v_po || jsonb_build_object(
        'id', 'g1-w2-unscoped-po',
        'created_by_id', '11111111-1111-4111-8111-111111111119'
      ),
      '[]', '[]', null, '[]', '[]',
      '11111111-1111-4111-8111-111111111119',
      '44444444-4444-4444-8444-444444444449'
    );
    raise exception 'G1_W2_PROJECT_SCOPE_DENIED_MISSING';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '11111111-1111-4111-8111-111111111111',
      'email', 'g1-w2-buyer@example.test',
      'role', 'authenticated'
    )::text,
    true
  );

  v_result := public.save_purchase_order_aggregate_v1(
    v_po, v_links, v_batches, null, '[]', '[]',
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444441'
  );
  if v_result ->> 'purchaseOrderId' <> 'g1-w2-po'
     or (v_result ->> 'rowVersion')::bigint <> 1
     or (v_result ->> 'requestLineCount')::integer <> 1
     or (v_result ->> 'deliveryBatchCount')::integer <> 1
     or (v_result ->> 'replayed')::boolean then
    raise exception 'G1_W2_CREATE_RESULT_INVALID: %', v_result;
  end if;

  v_result := public.save_purchase_order_aggregate_v1(
    v_po, v_links, v_batches, null, '[]', '[]',
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444441'
  );
  if not (v_result ->> 'replayed')::boolean then
    raise exception 'G1_W2_REPLAY_NOT_REPORTED: %', v_result;
  end if;
  if (select count(*) from public.purchase_orders where id = 'g1-w2-po') <> 1
     or (select count(*) from public.purchase_order_request_lines where purchase_order_id = 'g1-w2-po') <> 1
     or (select count(*) from public.purchase_order_delivery_batches where purchase_order_id = 'g1-w2-po') <> 1
     or (select count(*) from public.purchase_order_delivery_lines where purchase_order_id = 'g1-w2-po') <> 1 then
    raise exception 'G1_W2_REPLAY_DUPLICATED_ROWS';
  end if;

  begin
    perform public.save_purchase_order_aggregate_v1(
      v_po || jsonb_build_object('total_amount', 201),
      v_links, v_batches, 0, '[]', '[]',
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444442'
    );
    raise exception 'G1_W2_STALE_PO_ACCEPTED';
  exception when serialization_failure then
    null;
  end;
end;
$$;

do $$
declare
  v_links_version jsonb;
  v_batches_version jsonb;
  v_po jsonb;
  v_links jsonb;
  v_batches jsonb;
  v_result jsonb;
  v_po_number text;
begin
  select po_number into v_po_number from public.purchase_orders where id = 'g1-w2-po';
  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_links_version
  from public.purchase_order_request_lines
  where purchase_order_id = 'g1-w2-po';

  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_batches_version
  from public.purchase_order_delivery_batches
  where purchase_order_id = 'g1-w2-po';

  v_po := jsonb_build_object(
    'id', 'g1-w2-po',
    'project_id', 'g1-w2-project',
    'construction_site_id', null,
    'vendor_id', 'g1-w2-vendor',
    'vendor_name', 'G1 W2 vendor',
    'po_number', v_po_number,
    'items', jsonb_build_array(jsonb_build_object(
      'line_id', 'g1-w2-po-line', 'item_id', 'g1-w2-item',
      'sku', 'G1-W2-ITEM', 'name', 'G1 W2 item',
      'unit', 'bao', 'qty', 2.5, 'unit_price', 100
    )),
    'total_amount', 250,
    'approved_total_amount', 250,
    'vat_rate', 0,
    'order_date', current_date::text,
    'status', 'draft',
    'source_mode', 'from_request',
    'purchase_mode', 'multiple',
    'fulfillment_mode', 'RECEIVE_TO_STOCK',
    'created_by_id', '11111111-1111-4111-8111-111111111111'
  );
  v_links := jsonb_build_array(jsonb_build_object(
    'project_id', 'g1-w2-project', 'construction_site_id', null,
    'purchase_order_id', 'g1-w2-po', 'purchase_order_line_id', 'g1-w2-po-line',
    'material_request_id', 'g1-w2-request', 'material_request_code', 'MR-2026-0001',
    'request_line_id', 'g1-w2-request-line', 'item_id', 'g1-w2-item',
    'requested_qty', 50, 'ordered_qty', 50,
    'requested_qty_snapshot', 50, 'ordered_stock_qty_snapshot', 50,
    'actual_received_qty_snapshot', 0, 'unit', 'kg'
  ));
  v_batches := jsonb_build_array(jsonb_build_object(
    'id', '22222222-2222-4222-8222-222222222222',
    'purchase_order_id', 'g1-w2-po', 'project_id', 'g1-w2-project',
    'construction_site_id', null, 'delivery_no', 1,
    'planned_delivery_date', current_date + 6, 'status', 'planned',
    'approval_status', 'draft', 'fulfillment_mode', 'RECEIVE_TO_STOCK', 'vat_rate', 0,
    'lines', jsonb_build_array(jsonb_build_object(
      'id', '33333333-3333-4333-8333-333333333333',
      'purchase_order_line_id', 'g1-w2-po-line', 'item_id', 'g1-w2-item',
      'planned_qty', 2.5, 'stock_planned_qty', 50,
      'unit', 'bao', 'stock_unit', 'kg', 'delivery_unit_price', 100
    ))
  ));

  v_result := public.save_purchase_order_aggregate_v1(
    v_po, v_links, v_batches, 1, v_links_version, v_batches_version,
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444443'
  );
  if (v_result ->> 'rowVersion')::bigint <> 2
     or (select total_amount from public.purchase_orders where id = 'g1-w2-po') <> 250 then
    raise exception 'G1_W2_UPDATE_INVALID: %', v_result;
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_links_version from public.purchase_order_request_lines where purchase_order_id = 'g1-w2-po';
  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_batches_version from public.purchase_order_delivery_batches where purchase_order_id = 'g1-w2-po';

  perform set_config('g1_w2.fail_delivery_line_insert', 'on', true);
  begin
    perform public.save_purchase_order_aggregate_v1(
      v_po || jsonb_build_object('total_amount', 300),
      v_links, v_batches, 2, v_links_version, v_batches_version,
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444'
    );
    raise exception 'G1_W2_INJECTED_FAILURE_NOT_RAISED';
  exception when raise_exception then
    if sqlerrm <> 'G1_W2_INJECTED_LINE_FAILURE' then raise; end if;
  end;
  perform set_config('g1_w2.fail_delivery_line_insert', 'off', true);

  if (select total_amount from public.purchase_orders where id = 'g1-w2-po') <> 250
     or (select row_version from public.purchase_orders where id = 'g1-w2-po') <> 2
     or (select count(*) from public.purchase_order_request_lines where purchase_order_id = 'g1-w2-po') <> 1
     or (select count(*) from public.purchase_order_delivery_batches where purchase_order_id = 'g1-w2-po') <> 1
     or (select count(*) from public.purchase_order_delivery_lines where purchase_order_id = 'g1-w2-po') <> 1 then
    raise exception 'G1_W2_FAULT_DID_NOT_ROLL_BACK';
  end if;
end;
$$;

update public.purchase_order_delivery_batches
set idempotency_key = '55555555-5555-4555-8555-555555555555'
where purchase_order_id = 'g1-w2-po';

do $$
declare
  v_links_version jsonb;
  v_batches_version jsonb;
  v_po jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_links_version from public.purchase_order_request_lines where purchase_order_id = 'g1-w2-po';
  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_batches_version from public.purchase_order_delivery_batches where purchase_order_id = 'g1-w2-po';
  select to_jsonb(po) - 'row_version' into v_po from public.purchase_orders po where id = 'g1-w2-po';

  begin
    perform public.save_purchase_order_aggregate_v1(
      v_po, '[]', '[]', 2, v_links_version, v_batches_version,
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444445'
    );
    raise exception 'G1_W2_POSTED_SCHEDULE_MUTATED';
  exception when invalid_parameter_value then
    if sqlerrm <> 'PURCHASE_ORDER_POSTED_SCHEDULE_IMMUTABLE' then raise; end if;
  end;
end;
$$;

update public.purchase_order_delivery_batches
set idempotency_key = null,
    approval_status = 'revision_requested',
    approval_decided_by = '11111111-1111-4111-8111-111111111111',
    approval_decided_at = now(),
    approval_decision_note = 'revise'
where purchase_order_id = 'g1-w2-po';

do $$
declare
  v_result jsonb;
begin
  v_result := public.save_material_po_batch_draft(
    'g1-w2-po',
    '22222222-2222-4222-8222-222222222222',
    current_date + 8,
    0,
    null,
    'V2 owner parity',
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', 'g1-w2-po-line',
      'itemId', 'g1-w2-item',
      'purchaseQty', 2.5,
      'stockQty', 50,
      'purchaseUnit', 'bao',
      'stockUnit', 'kg',
      'purchaseUnitPrice', 100
    )),
    '11111111-1111-4111-8111-111111111111'
  );
  if v_result ->> 'deliveryBatchId' <> '22222222-2222-4222-8222-222222222222'
     or (v_result ->> 'lineCount')::integer <> 1
     or exists (
       select 1
       from public.purchase_order_delivery_batches
       where id = '22222222-2222-4222-8222-222222222222'
         and (
           approval_status <> 'draft'
           or approval_decided_by is not null
           or approval_decided_at is not null
           or approval_decision_note is not null
         )
     ) then
    raise exception 'G1_W2_V2_OWNER_REGRESSION: %', v_result;
  end if;
end;
$$;

do $$
declare
  v_stale_links_version jsonb;
  v_current_links_version jsonb;
  v_batches_version jsonb;
  v_po jsonb;
  v_bad_link jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_stale_links_version
  from public.purchase_order_request_lines
  where purchase_order_id = 'g1-w2-po';

  update public.purchase_order_request_lines
  set note = 'concurrent child edit'
  where purchase_order_id = 'g1-w2-po';

  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_batches_version
  from public.purchase_order_delivery_batches
  where purchase_order_id = 'g1-w2-po';
  select to_jsonb(po) - 'row_version'
  into v_po
  from public.purchase_orders po
  where id = 'g1-w2-po';

  begin
    perform public.save_purchase_order_aggregate_v1(
      v_po, '[]', '[]', 2, v_stale_links_version, v_batches_version,
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444446'
    );
    raise exception 'G1_W2_STALE_CHILD_ACCEPTED';
  exception when serialization_failure then
    if sqlerrm <> 'PURCHASE_ORDER_LINK_VERSION_CONFLICT' then raise; end if;
  end;

  select jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) order by id)
  into v_current_links_version
  from public.purchase_order_request_lines
  where purchase_order_id = 'g1-w2-po';
  select jsonb_build_array(
    jsonb_build_object(
      'project_id', 'wrong-project',
      'construction_site_id', null,
      'purchase_order_id', 'g1-w2-po',
      'purchase_order_line_id', 'g1-w2-po-line',
      'material_request_id', 'g1-w2-request',
      'request_line_id', 'g1-w2-request-line',
      'item_id', 'g1-w2-item',
      'requested_qty', 50,
      'ordered_qty', 50
    )
  ) into v_bad_link;

  begin
    perform public.save_purchase_order_aggregate_v1(
      v_po, v_bad_link, '[]', 2, v_current_links_version, v_batches_version,
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444447'
    );
    raise exception 'G1_W2_CHILD_SCOPE_ACCEPTED';
  exception when insufficient_privilege then
    if sqlerrm <> 'PURCHASE_ORDER_LINK_SCOPE_CHANGED' then raise; end if;
  end;

  if (select row_version from public.purchase_orders where id = 'g1-w2-po') <> 2
     or (select note from public.purchase_order_request_lines where purchase_order_id = 'g1-w2-po') <> 'concurrent child edit' then
    raise exception 'G1_W2_CHILD_CONFLICT_DID_NOT_ROLL_BACK';
  end if;
end;
$$;

rollback;
