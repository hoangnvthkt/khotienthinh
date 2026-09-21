-- G5 rollback-only smoke. Run only on a disposable Supabase Cloud branch after
-- G2, W2 and both G5 migrations have been applied.
begin;

create temp table g5_ids (
  actor_id uuid not null,
  position_id uuid not null,
  project_id text not null,
  site_id text not null,
  warehouse_id text not null,
  request_id text not null,
  item_id text not null,
  po_id text not null,
  po_line_id text not null,
  command_id uuid not null
) on commit drop;
insert into g5_ids values (
  gen_random_uuid(), gen_random_uuid(), 'g5-project-' || gen_random_uuid()::text,
  gen_random_uuid()::text, 'g5-wh-' || gen_random_uuid()::text,
  'g5-mr-' || gen_random_uuid()::text, 'g5-item-' || gen_random_uuid()::text,
  'g5-po-' || gen_random_uuid()::text, 'g5-po-line-' || gen_random_uuid()::text,
  gen_random_uuid()
);

insert into public.users(id, name, email, username, role, is_active, account_status)
select actor_id, 'G5 Buyer', actor_id::text || '@vioo.local',
  'g5-' || actor_id::text, 'ADMIN'::public.user_role, true, 'ACTIVE'
from g5_ids;
insert into public.hrm_positions(id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'G5 buyer position', 1,
  'G5-' || substring(md5(position_id::text), 1, 10), true, 0, 'smoke', '{}'::jsonb
from g5_ids;
insert into public.project_permission_rooms(
  code, group_code, name, allowed_actions, required_actions, sort_order
) values
  ('material_request', 'material', 'Material request', array['view','edit'], array['view'], 1),
  ('material_po', 'material', 'Material purchase order', array['view','edit'], array['view'], 2)
on conflict (code) do nothing;
insert into app_private.project_permission_room_action_bindings(
  room_code, action_code, enforcement_status, relationship_description,
  verified_at, verified_source, pbac_fallback_enabled, prerequisite_action_codes
) values
  ('material_request', 'view', 'enforced', 'G5 demand read', now(), 'g5_smoke', false, '{}'),
  ('material_po', 'view', 'enforced', 'G5 price read', now(), 'g5_smoke', false, '{}'),
  ('material_po', 'edit', 'enforced', 'G5 allocation command', now(), 'g5_smoke', false, array['view'])
on conflict (room_code, action_code) do update set
  enforcement_status = excluded.enforcement_status,
  prerequisite_action_codes = excluded.prerequisite_action_codes;
insert into public.projects(id, code, name)
select project_id, 'G5-' || substring(md5(project_id), 1, 10), 'G5 Workbench Project' from g5_ids;
insert into public.hrm_construction_sites(id, name)
select site_id::uuid, 'G5 Construction Site' from g5_ids;
update public.projects project set construction_site_id = ids.site_id::uuid
from g5_ids ids where project.id = ids.project_id;
insert into public.project_staff(
  id, project_id, construction_site_id, user_id, position_id, start_date, note
)
select gen_random_uuid(), project_id, site_id, actor_id::text, position_id,
  current_date, 'G5 workbench smoke buyer'
from g5_ids;
insert into public.project_permission_room_members(
  project_id, construction_site_id, room_code, project_staff_id, is_active
)
select ids.project_id, ids.site_id, room.code, staff.id, true
from g5_ids ids
join public.project_staff staff
  on staff.project_id = ids.project_id and staff.user_id = ids.actor_id::text
cross join (values ('material_request'), ('material_po')) room(code);
insert into public.project_permission_room_member_actions(room_member_id, action_code, is_active)
select member.id, action.code, true
from g5_ids ids
join public.project_permission_room_members member on member.project_id = ids.project_id
cross join lateral (
  select code from (values ('view'), ('edit')) actions(code)
  where code = 'view' or member.room_code = 'material_po'
) action;
insert into public.warehouse_types(code, name) values ('G5_TEST', 'G5 test warehouse')
on conflict (code) do nothing;
insert into public.warehouses(id, name, address, type, project_id, construction_site_id)
select warehouse_id, 'G5 Warehouse', 'Test', 'G5_TEST', project_id, site_id::uuid
from g5_ids;
insert into public.items(id, sku, name, category, unit, price_in, price_out, min_stock)
select item_id, 'G5-' || substring(md5(item_id), 1, 10), 'G5 Steel', 'Smoke', 'kg', 10, 10, 0
from g5_ids;

alter table public.requests disable trigger trg_enforce_material_request_code_v1;
insert into public.requests(
  id, code, title, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, construction_site_id,
  request_origin, workflow_step
)
select request_id, 'MR-G5-001', 'G5 demand', warehouse_id, actor_id, 'DRAFT',
  jsonb_build_array(jsonb_build_object(
    'lineId', 'need-a', 'itemId', item_id, 'requestQty', 100,
    'unitSnapshot', 'kg', 'itemNameSnapshot', 'G5 Steel',
    'neededDate', (current_date + 7)::text
  )), now(), now(), project_id, site_id, 'project', 'draft'
from g5_ids;
select set_config('app.material_transition_context', 'on', true);
update public.requests set status = 'APPROVED', workflow_step = 'batch_planning'
where id = (select request_id from g5_ids);
select set_config('app.material_transition_context', '', true);

alter table public.purchase_orders disable trigger trg_enforce_purchase_order_number_v2;
grant select on table g5_ids to authenticated;
set role authenticated;
select set_config('request.jwt.claim.email', actor_id::text || '@vioo.local', true) from g5_ids;
select set_config('request.jwt.claim.sub', actor_id::text, true) from g5_ids;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', actor_id::text || '@vioo.local', 'sub', actor_id, 'role', 'authenticated'
)::text, true) from g5_ids;

do $$
begin
  begin
    perform public.create_procurement_purchase_order_v1(
      '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, gen_random_uuid(), gen_random_uuid()
    );
    raise exception 'G5 actor spoof was not rejected';
  exception when insufficient_privilege then
    if sqlerrm <> 'PROCUREMENT_PURCHASE_ORDER_ACTOR_INVALID' then raise; end if;
  end;
end $$;

select public.sync_project_material_request_demand_v1(
  (select request_id from g5_ids), 1, 'g5-sync-1'
);

reset role;
create temp table g5_demand_line on commit drop as
select line.id, line.demand_id, line.current_source_revision_id, line.version
from public.procurement_demand_lines line
join public.procurement_demands demand on demand.id = line.demand_id
join g5_ids ids on demand.project_id = ids.project_id;
grant select on table g5_demand_line to authenticated;
set role authenticated;

create temp table g5_create_result on commit drop as
select public.create_procurement_purchase_order_v1(
  jsonb_build_object(
    'id', ids.po_id, 'project_id', ids.project_id,
    'construction_site_id', ids.site_id, 'vendor_id', 'vendor-g5',
    'vendor_name', 'G5 Vendor', 'po_number', 'PO-G5-001',
    'items', jsonb_build_array(jsonb_build_object(
      'lineId', ids.po_line_id, 'itemId', ids.item_id, 'sku', 'G5',
      'name', 'G5 Steel', 'unit', 'kg', 'unitSnapshot', 'kg',
      'stockUnitSnapshot', 'kg', 'purchaseUnitSnapshot', 'kg',
      'purchaseConversionFactor', 1, 'qty', 20, 'unitPrice', 10
    )),
    'total_amount', 200, 'order_date', current_date::text,
    'status', 'draft', 'source_mode', 'company_consolidated',
    'purchase_mode', 'single', 'created_by_id', ids.actor_id,
    'target_warehouse_id', ids.warehouse_id
  ),
  jsonb_build_array(jsonb_build_object(
    'project_id', ids.project_id, 'construction_site_id', ids.site_id,
    'source_construction_site_id', ids.site_id, 'target_warehouse_id', ids.warehouse_id,
    'allocation_status', 'open', 'purchase_order_id', ids.po_id,
    'purchase_order_line_id', ids.po_line_id, 'material_request_id', ids.request_id,
    'material_request_code', 'MR-G5-001', 'request_line_id', 'need-a',
    'item_id', ids.item_id, 'requested_qty', 100, 'ordered_qty', 20,
    'requested_qty_snapshot', 100, 'ordered_stock_qty_snapshot', 20,
    'actual_received_qty_snapshot', 0, 'unit', 'kg'
  )),
  jsonb_build_array(jsonb_build_object(
    'demandLineId', demand_line.id,
    'sourceRevisionId', demand_line.current_source_revision_id,
    'purchaseOrderLineId', ids.po_line_id, 'expectedVersion', demand_line.version,
    'needQty', '20', 'needUnit', 'kg', 'executionQty', '20',
    'executionUnit', 'kg', 'conversionNumerator', '1', 'conversionDenominator', '1',
    'reason', 'G5 atomic smoke'
  )),
  ids.actor_id, ids.command_id
) result
from g5_ids ids cross join g5_demand_line demand_line;

do $$
declare v_result jsonb := (select result from g5_create_result); v_replay jsonb;
  v_detail jsonb; v_ids g5_ids%rowtype := (select ids from g5_ids ids);
begin
  if v_result ->> 'outcome' <> 'committed'
     or jsonb_array_length(v_result -> 'allocationIds') <> 1 then
    raise exception 'G5 create result invalid: %', v_result;
  end if;
  if (select count(*) from public.purchase_orders where id = v_ids.po_id) <> 1
     or (select count(*) from public.purchase_order_request_lines where purchase_order_id = v_ids.po_id) <> 1
     then
    raise exception 'G5 PO/allocation aggregate incomplete';
  end if;
  select public.get_procurement_demand_v1(line.demand_id) into v_detail
  from g5_demand_line line;
  if jsonb_array_length(v_detail #> '{lines,0,allocations}') <> 1
     or v_detail #>> '{lines,0,allocations,0,needQty}' <> '20.000000' then
    raise exception 'G5 allocation read model incomplete: %', v_detail;
  end if;
  select public.create_procurement_purchase_order_v1(
    jsonb_build_object(
      'id', v_ids.po_id || '-retry', 'project_id', v_ids.project_id, 'construction_site_id', v_ids.site_id,
      'vendor_id', 'vendor-g5', 'vendor_name', 'G5 Vendor', 'po_number', 'PO-G5-RETRY',
      'items', jsonb_build_array(jsonb_build_object(
        'lineId', v_ids.po_line_id || '-retry', 'itemId', v_ids.item_id, 'sku', 'G5', 'name', 'G5 Steel',
        'unit', 'kg', 'unitSnapshot', 'kg', 'stockUnitSnapshot', 'kg',
        'purchaseUnitSnapshot', 'kg', 'purchaseConversionFactor', 1, 'qty', 20, 'unitPrice', 10
      )), 'total_amount', 200, 'order_date', current_date::text, 'status', 'draft',
      'source_mode', 'company_consolidated', 'purchase_mode', 'single',
      'created_by_id', v_ids.actor_id,
      'target_warehouse_id', v_ids.warehouse_id
    ),
    jsonb_build_array(jsonb_build_object(
      'project_id', v_ids.project_id, 'construction_site_id', v_ids.site_id,
      'source_construction_site_id', v_ids.site_id, 'target_warehouse_id', v_ids.warehouse_id,
      'allocation_status', 'open', 'purchase_order_id', v_ids.po_id || '-retry',
      'purchase_order_line_id', v_ids.po_line_id || '-retry', 'material_request_id', v_ids.request_id,
      'material_request_code', 'MR-G5-001', 'request_line_id', 'need-a',
      'item_id', v_ids.item_id, 'requested_qty', 100, 'ordered_qty', 20,
      'requested_qty_snapshot', 100, 'ordered_stock_qty_snapshot', 20,
      'actual_received_qty_snapshot', 0, 'unit', 'kg'
    )),
    jsonb_build_array(jsonb_build_object(
      'demandLineId', line.id, 'sourceRevisionId', line.current_source_revision_id,
      'purchaseOrderLineId', v_ids.po_line_id || '-retry', 'expectedVersion', 1,
      'needQty', '20', 'needUnit', 'kg', 'executionQty', '20', 'executionUnit', 'kg',
      'conversionNumerator', '1', 'conversionDenominator', '1', 'reason', 'G5 atomic smoke'
    )), v_ids.actor_id, v_ids.command_id
  ) into v_replay from g5_demand_line line;
  select public.get_procurement_demand_v1(line.demand_id) into v_detail
  from g5_demand_line line;
  if v_replay ->> 'outcome' <> 'replayed'
     or v_replay ->> 'purchaseOrderId' <> v_ids.po_id
     or jsonb_array_length(v_detail #> '{lines,0,allocations}') <> 1 then
    raise exception 'G5 retry did not replay: %', v_replay;
  end if;
end $$;

reset role;
update g5_demand_line fixture set
  version = current_line.version,
  current_source_revision_id = current_line.current_source_revision_id
from public.procurement_demand_lines current_line
where current_line.id = fixture.id;
set role authenticated;

do $$
declare v_ids g5_ids%rowtype := (select ids from g5_ids ids); v_line record;
begin
  select * into strict v_line from g5_demand_line;
  begin
    perform public.create_procurement_purchase_order_v1(
      jsonb_build_object(
        'id', v_ids.po_id || '-over', 'project_id', v_ids.project_id, 'construction_site_id', v_ids.site_id,
        'vendor_id', 'vendor-g5', 'po_number', 'PO-G5-OVER',
        'items', jsonb_build_array(jsonb_build_object(
          'lineId', v_ids.po_line_id || '-over', 'itemId', v_ids.item_id, 'name', 'G5 Steel',
          'unit', 'kg', 'purchaseUnitSnapshot', 'kg', 'qty', 90, 'unitPrice', 10
        )), 'total_amount', 900, 'order_date', current_date::text, 'status', 'draft',
        'source_mode', 'company_consolidated', 'created_by_id', v_ids.actor_id
      ),
      jsonb_build_array(jsonb_build_object(
        'project_id', v_ids.project_id, 'construction_site_id', v_ids.site_id,
        'purchase_order_id', v_ids.po_id || '-over', 'purchase_order_line_id', v_ids.po_line_id || '-over',
        'material_request_id', v_ids.request_id, 'request_line_id', 'need-a', 'item_id', v_ids.item_id,
        'requested_qty', 100, 'ordered_qty', 90, 'unit', 'kg'
      )),
      jsonb_build_array(jsonb_build_object(
        'demandLineId', v_line.id, 'sourceRevisionId', v_line.current_source_revision_id,
        'purchaseOrderLineId', v_ids.po_line_id || '-over', 'expectedVersion', v_line.version,
        'needQty', '90', 'needUnit', 'kg', 'executionQty', '90', 'executionUnit', 'kg',
        'conversionNumerator', '1', 'conversionDenominator', '1'
      )), v_ids.actor_id, gen_random_uuid()
    );
    raise exception 'G5 over-allocation was not rejected';
  exception when sqlstate '40001' then
    if sqlerrm <> 'PROCUREMENT_AVAILABLE_EXCEEDED' then raise; end if;
  end;
  if exists (select 1 from public.purchase_orders where id = v_ids.po_id || '-over') then
    raise exception 'G5 over-allocation left an orphan PO';
  end if;
end $$;

do $$
declare v_ids g5_ids%rowtype := (select ids from g5_ids ids);
begin
  begin
    perform public.save_purchase_order_aggregate_v1(
      jsonb_build_object(
        'id', v_ids.po_id || '-legacy', 'project_id', v_ids.project_id,
        'construction_site_id', v_ids.site_id, 'vendor_id', 'vendor-g5',
        'po_number', 'PO-G5-LEGACY', 'items', jsonb_build_array(jsonb_build_object(
          'lineId', v_ids.po_line_id || '-legacy', 'itemId', v_ids.item_id,
          'name', 'G5 Steel', 'unit', 'kg', 'qty', 10, 'unitPrice', 10
        )), 'total_amount', 100, 'order_date', current_date::text,
        'status', 'draft', 'source_mode', 'company_consolidated',
        'created_by_id', v_ids.actor_id
      ),
      jsonb_build_array(jsonb_build_object(
        'project_id', v_ids.project_id, 'construction_site_id', v_ids.site_id,
        'purchase_order_id', v_ids.po_id || '-legacy',
        'purchase_order_line_id', v_ids.po_line_id || '-legacy',
        'material_request_id', v_ids.request_id, 'request_line_id', 'need-a',
        'item_id', v_ids.item_id, 'requested_qty', 100, 'ordered_qty', 10, 'unit', 'kg'
      )),
      '[]'::jsonb, null, '[]'::jsonb, '[]'::jsonb,
      v_ids.actor_id, gen_random_uuid()
    );
    set constraints trg_procurement_company_link_requires_allocation immediate;
    raise exception 'G5 legacy company PO bypass was not rejected';
  exception when check_violation then
    if sqlerrm <> 'PROCUREMENT_COMPANY_LINK_REQUIRES_ALLOCATION' then raise; end if;
  end;
  if exists (select 1 from public.purchase_orders where id = v_ids.po_id || '-legacy') then
    raise exception 'G5 rejected legacy PO left an orphan';
  end if;
end $$;

do $$
declare v_page jsonb; v_filtered_page jsonb; v_detail jsonb; v_assignment jsonb;
  v_ids g5_ids%rowtype := (select ids from g5_ids ids); v_line record;
begin
  select public.list_procurement_work_v1(jsonb_build_object('projectId', v_ids.project_id), null, 50) into v_page;
  if jsonb_array_length(v_page -> 'items') <> 1
     or v_page #>> '{items,0,balance,availableToPlan}' <> '80.000000' then
    raise exception 'G5 workbench list invalid: %', v_page;
  end if;
  select public.list_procurement_work_v1(jsonb_build_object(
    'projectId', v_ids.project_id, 'source', 'project_material_request', 'method', 'po'
  ), null, 50) into v_filtered_page;
  if jsonb_array_length(v_filtered_page -> 'items') <> 1 then
    raise exception 'G5 source/method filter excluded the matching allocation: %', v_filtered_page;
  end if;
  select public.list_procurement_work_v1(jsonb_build_object(
    'projectId', v_ids.project_id, 'source', 'unsupported_source'
  ), null, 50) into v_filtered_page;
  if jsonb_array_length(v_filtered_page -> 'items') <> 0
     or v_filtered_page #>> '{counters,0,count}' <> '0' then
    raise exception 'G5 source filter was not applied before counters: %', v_filtered_page;
  end if;
  select * into strict v_line from g5_demand_line;
  select public.get_procurement_demand_v1(v_line.demand_id) into v_detail;
  if v_detail #>> '{lines,0,balance,availableToPlan}' <> '80.000000'
     or v_detail #>> '{lines,0,allocations,0,needQty}' <> '20.000000' then
    raise exception 'G5 demand detail invalid: %', v_detail;
  end if;
  select public.assign_procurement_demand_v1(
    v_line.demand_id, v_ids.actor_id, (v_detail ->> 'version')::bigint,
    'G5 smoke assignment', 'g5-assign-1'
  ) into v_assignment;
  select public.get_procurement_demand_v1(v_line.demand_id) into v_detail;
  if v_assignment ->> 'outcome' <> 'committed'
     or v_detail ->> 'assigneeUserId' <> v_ids.actor_id::text then
    raise exception 'G5 assignment invalid: %, %', v_assignment, v_detail;
  end if;

  begin
    perform public.assign_procurement_demand_v1(
      v_line.demand_id, v_ids.actor_id, 1,
      'G5 stale assignment', 'g5-assign-stale'
    );
    raise exception 'G5 stale assignment was not rejected';
  exception when sqlstate '40001' then
    if sqlerrm <> 'PROCUREMENT_VERSION_CONFLICT' then raise; end if;
  end;

  begin
    perform public.list_procurement_work_v1(
      jsonb_build_object('projectId', v_ids.project_id),
      '0:' || repeat('0', 64), 50
    );
    raise exception 'G5 stale list snapshot was not rejected';
  exception when sqlstate '40001' then
    if sqlerrm <> 'PROCUREMENT_SNAPSHOT_STALE' then raise; end if;
  end;
end $$;

do $$
begin
  begin
    insert into public.procurement_assignment_history(
      owner_context_id, demand_id, reason, actor_user_id, demand_version
    ) values (gen_random_uuid(), gen_random_uuid(), 'bypass', gen_random_uuid(), 1);
    raise exception 'G5 direct assignment-history DML was not rejected';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
declare v_line record;
begin
  select * into strict v_line from g5_demand_line;
  if (select count(*) from public.procurement_assignment_history
      where demand_id = v_line.demand_id) <> 1 then
    raise exception 'G5 assignment history invalid';
  end if;
end $$;

rollback;
