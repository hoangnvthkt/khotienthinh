-- Run inside a rollback-only transaction after the G2 migrations and G3 migration.
do $$
begin
  if to_regprocedure('public.list_boq_material_planning_v1(text,text,text,text,integer,text,timestamp with time zone)') is null then
    raise exception 'G3_BOQ_READER_MISSING';
  end if;
end $$;

create temporary table g3_boq_ids(
  viewer_id uuid not null,
  price_id uuid not null,
  inactive_id uuid not null,
  position_id uuid not null
) on commit drop;
insert into g3_boq_ids values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into public.users(id, name, email, username, role, is_active)
select viewer_id, 'G3 Viewer', 'g3-viewer@example.invalid', viewer_id::text, 'EMPLOYEE'::public.user_role, true from g3_boq_ids
union all
select price_id, 'G3 Price', 'g3-price@example.invalid', price_id::text, 'ADMIN'::public.user_role, true from g3_boq_ids
union all
select inactive_id, 'G3 Inactive', 'g3-inactive@example.invalid', inactive_id::text, 'EMPLOYEE'::public.user_role, false from g3_boq_ids;

insert into public.hrm_positions(id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'G3 BOQ position', 1, 'G3-BOQ', true, 0, 'smoke', '{}'::jsonb from g3_boq_ids;
insert into public.projects(id, code, name, project_type, status)
values ('g3-project', 'G3', 'G3 BOQ project', 'construction', 'active');

insert into public.project_permission_rooms(code, group_code, name, allowed_actions, required_actions, sort_order)
values
  ('material_planning', 'material', 'Material planning', array['view','edit','delete'], array['view'], 1),
  ('material_po', 'material', 'Material PO', array['view','edit','delete'], array['view'], 2)
on conflict (code) do nothing;
insert into app_private.project_permission_room_action_bindings(
  room_code, action_code, enforcement_status, relationship_description,
  verified_at, verified_source, pbac_fallback_enabled, prerequisite_action_codes
) values
  ('material_planning', 'view', 'enforced', 'G3 smoke planning read', now(), 'g3_smoke', false, '{}'),
  ('material_po', 'view', 'enforced', 'G3 smoke price read', now(), 'g3_smoke', false, '{}')
on conflict (room_code, action_code) do update set enforcement_status = excluded.enforcement_status;

insert into public.project_staff(id, project_id, construction_site_id, user_id, position_id, start_date)
select gen_random_uuid(), 'g3-project', null, viewer_id::text, position_id, current_date from g3_boq_ids;
insert into public.project_permission_room_members(project_id, construction_site_id, room_code, project_staff_id, is_active)
select 'g3-project', null, 'material_planning', staff.id, true
from public.project_staff staff join g3_boq_ids ids on staff.user_id = ids.viewer_id::text;
insert into public.project_permission_room_member_actions(room_member_id, action_code, is_active)
select id, 'view', true from public.project_permission_room_members
where project_id = 'g3-project' and room_code = 'material_planning';

insert into public.items(id, sku, name, category, unit, price_in, price_out, min_stock)
values
  ('g3-steel', 'STEEL', 'Steel', 'Metal', 'kg', 10, 10, 0),
  ('g3-cement', 'CEMENT', 'Cement', 'Cement', 'bag', 20, 20, 0),
  ('g3-sand', 'SAND', 'Sand', 'Aggregate', 'm3', 30, 30, 0);
insert into public.warehouse_types(code, name, description, is_system, is_active, sort_order)
values ('G3_TEST', 'G3 test warehouse', 'Rollback-only G3 smoke fixture', false, true, 0);
insert into public.warehouses(id, name, address, type, project_id)
values ('g3-warehouse', 'G3 warehouse', 'Smoke', 'G3_TEST', 'g3-project');

insert into public.project_tasks(id, project_id, name, start_date, end_date, duration, progress, sort_order, wbs_code)
values
  ('g3-task-a', 'g3-project', 'Task A', '2026-09-22', '2026-09-30', 9, 0, 1, '1'),
  ('g3-task-b', 'g3-project', 'Task B', '2026-10-01', '2026-10-10', 10, 0, 2, '2'),
  ('g3-task-child', 'g3-project', 'Task A child', '2026-09-24', '2026-09-28', 5, 0, 1, '1.1');
insert into public.project_work_boq_items(
  id, project_id, source_task_id, parent_id, wbs_code, name, unit, planned_qty, unit_price, sort_order
) values
  ('g3-work-a', 'g3-project', 'g3-task-a', null, '1', 'Work A', 'job', 1, 0, 1),
  ('g3-work-b', 'g3-project', 'g3-task-b', null, '2', 'Work B', 'job', 1, 0, 2),
  ('g3-work-child', 'g3-project', 'g3-task-child', 'g3-work-a', '1.1', 'Work A child', 'job', 1, 0, 1);
insert into public.material_budget_items(
  id, project_id, work_boq_item_id, inventory_item_id, material_code, category,
  item_name, unit, budget_qty, budget_unit_price, actual_qty, waste_threshold, sort_order
) values
  ('g3-budget-a', 'g3-project', 'g3-work-a', 'g3-steel', 'STEEL', 'Metal', 'Steel A', 'kg', 100, 10, 0, 5, 1),
  ('g3-budget-b', 'g3-project', 'g3-work-b', 'g3-steel', 'STEEL', 'Metal', 'Steel B', 'kg', 100, 10, 0, 5, 1),
  ('g3-budget-child', 'g3-project', 'g3-work-child', 'g3-cement', 'CEMENT', 'Cement', 'Cement', 'bag', 50, 20, 0, 5, 1),
  ('g3-budget-unallocated', 'g3-project', null, 'g3-sand', 'SAND', 'Aggregate', 'Sand', 'm3', 20, 30, 0, 5, 1);

insert into public.material_issue_orders(
  id, issue_no, project_id, source_warehouse_id, recipient_type, recipient_name,
  status, created_by, issued_by, issued_at
) select '31000000-0000-4000-8000-000000000001', 'G3-ISSUE-1', 'g3-project', 'g3-warehouse',
  'manual', 'G3 recipient', 'issued', price_id, price_id, now() from g3_boq_ids;
insert into public.material_issue_lines(
  issue_order_id, item_id, sku_snapshot, item_name_snapshot, unit,
  requested_qty, approved_qty, issued_qty, received_qty, returned_qty,
  consumed_qty, lost_qty, unit_price, material_budget_item_id, work_boq_item_id
) values
  ('31000000-0000-4000-8000-000000000001', 'g3-steel', 'STEEL', 'Steel', 'kg',
    70, 70, 70, 70, 10, 0, 0, 10, 'g3-budget-a', 'g3-work-a'),
  ('31000000-0000-4000-8000-000000000001', 'g3-cement', 'CEMENT', 'Cement', 'bag',
    5, 5, 5, 5, 0, 0, 0, 20, null, null);

insert into app_private.material_request_code_registry(code)
values ('MR-2026-9001'), ('MR-2026-9002'), ('MR-2026-9003'), ('MR-2026-9004');
insert into public.requests(
  id, code, title, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, request_origin, fulfillment_mode
)
select request_id, request_code, request_code, 'g3-warehouse', ids.price_id, request_status::public.request_status,
  jsonb_build_array(jsonb_build_object(
    'lineId', line_id, 'itemId', item_id, 'requestQty', quantity,
    'approvedQty', quantity, 'unitSnapshot', unit_name,
    'workBoqItemId', work_id, 'materialBudgetItemId', budget_id
  )), now(), now() + interval '7 days', 'g3-project', 'project', 'RECEIVE_TO_STOCK'
from g3_boq_ids ids
cross join (values
  ('g3-mr-pending', 'MR-2026-9001', 'PENDING', 'g3-line-pending', 'g3-steel', 'kg', 10::numeric, 'g3-work-a', 'g3-budget-a'),
  ('g3-mr-approved', 'MR-2026-9002', 'APPROVED', 'g3-line-approved', 'g3-steel', 'kg', 15::numeric, 'g3-work-b', 'g3-budget-b'),
  ('g3-mr-transit', 'MR-2026-9003', 'IN_TRANSIT', 'g3-line-transit', 'g3-steel', 'kg', 5::numeric, 'g3-work-b', 'g3-budget-b'),
  ('g3-mr-legacy', 'MR-2026-9004', 'PENDING', 'g3-line-legacy', 'g3-cement', 'bag', 4::numeric, null, null)
) fixture(request_id, request_code, request_status, line_id, item_id, unit_name, quantity, work_id, budget_id);

insert into public.procurement_demands(
  owner_context_id, source_document_id, current_source_revision_id,
  project_id, source_code_snapshot, intake_state, health_state, created_by, updated_by
)
select document.owner_context_id, document.id, revision.id, 'g3-project', request.code,
  case when request.status::text = 'PENDING' then 'preliminary' else 'ready' end,
  'healthy', ids.price_id, ids.price_id
from public.procurement_source_documents document
join public.requests request on request.id = document.source_document_id
join public.procurement_source_revisions revision
  on revision.source_document_id = document.id and revision.revision = document.current_revision
cross join g3_boq_ids ids
where document.source_adapter = 'project_material_request' and request.id like 'g3-mr-%';
insert into public.procurement_demand_lines(
  demand_id, source_line_registry_id, current_source_revision_id, item_id, unit,
  requested_qty, approved_qty, work_boq_item_id, material_budget_item_id,
  intake_state, health_state
)
select demand.id, registry.id, demand.current_source_revision_id, registry.item_id, registry.unit,
  (line.value ->> 'requestQty')::numeric,
  case when request.status::text = 'PENDING' then null else (line.value ->> 'requestQty')::numeric end,
  registry.work_boq_item_id, registry.material_budget_item_id,
  demand.intake_state, 'healthy'
from public.procurement_demands demand
join public.procurement_source_documents document on document.id = demand.source_document_id
join public.requests request on request.id = document.source_document_id
cross join lateral jsonb_array_elements(request.items) line(value)
join public.procurement_source_line_registry registry
  on registry.source_document_id = document.id and registry.source_line_id = line.value ->> 'lineId'
where request.id like 'g3-mr-%';

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', viewer_id, 'email', 'g3-viewer@example.invalid', 'role', 'authenticated'
)::text, true) from g3_boq_ids;

do $$
declare
  v_root jsonb;
  v_next jsonb;
  v_unallocated jsonb;
  v_child jsonb;
  v_line jsonb;
begin
  v_root := public.list_boq_material_planning_v1('g3-project', null, null, null, 1, null, null);
  if jsonb_array_length(v_root -> 'nodes') <> 1
     or v_root #>> '{totals,workNodeCount}' <> '3'
     or v_root #>> '{totals,materialLineCount}' <> '4'
     or v_root #>> '{totals,unallocatedEffectCount}' <> '2'
     or v_root ->> 'nextCursor' is null
     or (v_root #>> '{capabilities,canViewPrice}')::boolean then
    raise exception 'G3_ROOT_PAGE_INVALID: %', v_root;
  end if;
  v_line := v_root #> '{nodes,0,materials,0}';
  if v_line ->> 'id' <> 'g3-budget-a'
     or v_line #>> '{balance,budget}' <> '100.000000'
     or v_line #>> '{balance,issuedNet}' <> '60.000000'
     or v_line #>> '{balance,open,awaitingApproval}' <> '10.000000'
     or v_line #>> '{balance,uncovered}' <> '30.000000'
     or v_line ->> 'unitPrice' is not null
     or not (v_line #>> '{balance,selectable}')::boolean then
    raise exception 'G3_BALANCE_INVALID: %', v_line;
  end if;

  v_next := public.list_boq_material_planning_v1(
    'g3-project', null, null, null, 1, v_root ->> 'nextCursor', (v_root ->> 'asOf')::timestamptz
  );
  if v_next ->> 'metricVersion' <> v_root ->> 'metricVersion'
     or v_next -> 'totals' <> v_root -> 'totals'
     or v_next #>> '{nodes,0,id}' <> 'g3-work-b' then
    raise exception 'G3_PAGE_PARITY_INVALID: % / %', v_root, v_next;
  end if;
  v_line := v_next #> '{nodes,0,materials,0}';
  if v_line #>> '{balance,open,awaitingArrangement}' <> '15.000000'
     or v_line #>> '{balance,open,executing}' <> '5.000000'
     or v_line #>> '{balance,uncovered}' <> '80.000000' then
    raise exception 'G3_OPEN_BUCKET_INVALID: %', v_line;
  end if;

  v_child := public.list_boq_material_planning_v1(
    'g3-project', null, 'g3-work-a', null, 50, null, (v_root ->> 'asOf')::timestamptz
  );
  v_line := v_child #> '{nodes,0,materials,0}';
  if v_child #>> '{nodes,0,id}' <> 'g3-work-child'
     or (v_line #>> '{balance,selectable}')::boolean
     or not (v_line #> '{balance,blockingIssues}') ? 'boq_issue_allocation_missing'
     or not (v_line #> '{balance,blockingIssues}') ? 'boq_request_allocation_missing' then
    raise exception 'G3_UNKNOWN_ATTRIBUTION_INVALID: %', v_child;
  end if;

  v_unallocated := public.list_boq_material_planning_v1(
    'g3-project', null, '__unallocated__', null, 50, null, (v_root ->> 'asOf')::timestamptz
  );
  if v_unallocated #>> '{nodes,0,materials,0,id}' <> 'g3-budget-unallocated' then
    raise exception 'G3_UNALLOCATED_BRANCH_INVALID: %', v_unallocated;
  end if;

  begin
    perform public.list_boq_material_planning_v1('g3-other-project', null, null, null, 50, null, null);
    raise exception 'G3_CROSS_SCOPE_NOT_DENIED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'BOQ_MATERIAL_PLANNING_READ_DENIED' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', price_id, 'email', 'g3-price@example.invalid', 'role', 'authenticated'
)::text, true) from g3_boq_ids;
do $$
declare v_result jsonb;
begin
  v_result := public.list_boq_material_planning_v1('g3-project', null, null, null, 50, null, null);
  if not (v_result #>> '{capabilities,canViewPrice}')::boolean
     or v_result #>> '{nodes,0,materials,0,unitPrice}' <> '10' then
    raise exception 'G3_PRICE_CAPABILITY_INVALID: %', v_result;
  end if;
end $$;

do $$
declare ids g3_boq_ids%rowtype;
begin
  select * into strict ids from g3_boq_ids;
  begin
    perform app_private.list_boq_material_planning_v1(
      ids.inactive_id, 'g3-project', null, null, null, 50, null, null
    );
    raise exception 'G3_INACTIVE_ACTOR_NOT_DENIED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'BOQ_MATERIAL_PLANNING_READ_DENIED' then raise; end if;
  end;
end $$;
