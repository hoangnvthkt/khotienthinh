-- G4 material-plan save/convert smoke. Always run rollback-only on a temporary Cloud branch.
begin;

create temp table g4_plan_ids (
  project_id text not null,
  site_id uuid not null,
  warehouse_id text not null,
  item_id text not null,
  task_id text not null,
  work_id text not null,
  budget_id text not null,
  actor_id uuid not null,
  denied_actor_id uuid not null,
  position_id uuid not null,
  staff_id uuid not null,
  denied_staff_id uuid not null,
  planning_member_id uuid not null,
  request_member_id uuid not null,
  allocation_id uuid not null,
  line_id uuid not null
) on commit drop;

insert into g4_plan_ids values (
  'g4-plan-' || gen_random_uuid()::text,
  gen_random_uuid(),
  'g4-warehouse-' || gen_random_uuid()::text,
  'g4-item-' || gen_random_uuid()::text,
  'g4-task-' || gen_random_uuid()::text,
  'g4-work-' || gen_random_uuid()::text,
  'g4-budget-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select actor_id, 'G4 Planner', actor_id::text || '@vioo.local',
  'g4-planner-' || actor_id::text, 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from g4_plan_ids
union all
select denied_actor_id, 'G4 Viewer', denied_actor_id::text || '@vioo.local',
  'g4-viewer-' || denied_actor_id::text, 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from g4_plan_ids;

insert into public.project_permission_rooms(
  code, group_code, name, description, allowed_actions, required_actions, sort_order, is_active
) values
  ('material_planning', 'materials', 'Kế hoạch vật tư', 'G4 smoke', array['view','edit'], array['view'], 1, true),
  ('material_request', 'materials', 'Đề xuất vật tư', 'G4 smoke', array['view','edit'], array['view'], 2, true)
on conflict (code) do nothing;

insert into app_private.project_permission_room_action_bindings(
  room_code, action_code, enforcement_status, pbac_fallback_enabled,
  prerequisite_action_codes, relationship_description, verified_at, verified_source
) values
  ('material_planning', 'view', 'enforced', false, '{}', 'G4 smoke', now(), 'g4_smoke'),
  ('material_planning', 'edit', 'enforced', false, array['view'], 'G4 smoke', now(), 'g4_smoke'),
  ('material_request', 'view', 'enforced', false, '{}', 'G4 smoke', now(), 'g4_smoke'),
  ('material_request', 'edit', 'enforced', false, array['view'], 'G4 smoke', now(), 'g4_smoke')
on conflict (room_code, action_code) do update set
  enforcement_status = excluded.enforcement_status,
  pbac_fallback_enabled = excluded.pbac_fallback_enabled,
  prerequisite_action_codes = excluded.prerequisite_action_codes;

insert into public.hrm_construction_sites(id, name)
select site_id, 'G4 Plan Site' from g4_plan_ids;

insert into public.projects(id, code, name, source, construction_site_id)
select project_id, 'G4-' || substring(md5(project_id), 1, 12), 'G4 Plan Project', 'manual', site_id
from g4_plan_ids;

insert into public.hrm_positions(id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'G4 Planner', 1, 'G4-' || substring(md5(position_id::text), 1, 12),
  true, 0, 'smoke', '{}'::jsonb
from g4_plan_ids;

insert into public.project_staff(id, project_id, construction_site_id, user_id, position_id, start_date, note)
select staff_id, project_id, site_id::text, actor_id::text, position_id, current_date, 'G4 planner'
from g4_plan_ids
union all
select denied_staff_id, project_id, site_id::text, denied_actor_id::text, position_id, current_date, 'G4 denied actor'
from g4_plan_ids;

insert into public.project_permission_room_members(
  id, project_id, construction_site_id, room_code, project_staff_id, is_active, created_by
)
select planning_member_id, project_id, site_id::text, 'material_planning', staff_id, true, actor_id
from g4_plan_ids
union all
select request_member_id, project_id, site_id::text, 'material_request', staff_id, true, actor_id
from g4_plan_ids;

insert into public.project_permission_room_member_actions(room_member_id, action_code, is_active, granted_by)
select planning_member_id, action_code, true, actor_id
from g4_plan_ids cross join (values ('view'), ('edit')) action(action_code)
union all
select request_member_id, action_code, true, actor_id
from g4_plan_ids cross join (values ('view'), ('edit')) action(action_code);

insert into public.warehouse_types(code, name, description, is_system, is_active, sort_order)
values ('SITE', 'Kho công trường', 'G4 smoke', true, true, 1)
on conflict (code) do nothing;

insert into public.warehouses(id, name, address, type, project_id, construction_site_id)
select warehouse_id, 'G4 Site Warehouse', 'Smoke address', 'SITE', project_id, site_id
from g4_plan_ids;

insert into public.items(id, sku, name, category, unit, price_in, price_out, min_stock)
select item_id, 'G4-' || substring(md5(item_id), 1, 12), 'G4 Steel', 'Smoke', 'kg', 1, 1, 0
from g4_plan_ids;

insert into public.project_tasks(
  id, project_id, construction_site_id, name, start_date, end_date, duration, progress
)
select task_id, project_id, site_id::text, 'G4 Foundation', current_date::text,
  (current_date + 30)::text, 30, 0
from g4_plan_ids;

insert into public.project_work_boq_items(
  id, project_id, construction_site_id, source_task_id, wbs_code, name, unit, planned_qty
)
select work_id, project_id, site_id::text, task_id, '1.1', 'G4 Foundation', 'm3', 1
from g4_plan_ids;

insert into public.material_budget_items(
  id, project_id, construction_site_id, work_boq_item_id, inventory_item_id,
  material_code, item_name, category, unit, budget_qty, budget_unit_price
)
select budget_id, project_id, site_id::text, work_id, item_id,
  'G4-STEEL', 'G4 Steel', 'Smoke', 'kg', 10, 1
from g4_plan_ids;

grant select on table g4_plan_ids to authenticated;

set role authenticated;

create or replace function pg_temp.g4_set_actor(p_actor uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.email', p_actor::text || '@vioo.local', true);
  select set_config('request.jwt.claim.sub', p_actor::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
  select set_config('request.jwt.claims', jsonb_build_object(
    'email', p_actor::text || '@vioo.local', 'sub', p_actor, 'role', 'authenticated'
  )::text, true);
$$;

select pg_temp.g4_set_actor(actor_id) from g4_plan_ids;

create temp table g4_plan_result on commit drop as
select public.save_material_plan_v1(
  null,
  ids.project_id,
  ids.site_id::text,
  null,
  'Kế hoạch G4 tháng 10',
  date '2026-10-01', date '2026-10-31',
  'Rollback smoke', 'draft',
  jsonb_build_array(jsonb_build_object(
    'id', ids.line_id, 'itemId', ids.item_id, 'sku', 'G4-STEEL',
    'itemName', 'G4 Steel', 'unit', 'kg', 'quantity', '10.000000',
    'neededDate', '2026-10-10', 'destination', 'Kho công trường',
    'allocations', jsonb_build_array(jsonb_build_object(
      'id', ids.allocation_id, 'sourceBudgetLineId', ids.budget_id,
      'sourceWorkBoqItemId', ids.work_id, 'sourceTaskId', ids.task_id,
      'quantity', '10.000000', 'neededDate', '2026-10-10',
      'destination', 'Kho công trường'
    ))
  )),
  1, 'g4-save-1'
) result
from g4_plan_ids ids;

do $$
declare
  v_result jsonb := (select result from g4_plan_result);
  v_replay jsonb;
  v_ids g4_plan_ids%rowtype := (select ids from g4_plan_ids ids);
begin
  if v_result #>> '{command,outcome}' <> 'committed'
     or v_result #>> '{plan,version}' <> '1'
     or v_result #>> '{plan,lines,0,remainingQty}' <> '10.000000' then
    raise exception 'G4 save result invalid: %', v_result;
  end if;
  if (select count(*) from public.requests request_row
      where request_row.project_id = (select project_id from g4_plan_ids)) <> 0 then
    raise exception 'Saving a material plan must not create MR demand.';
  end if;
  if exists (select 1 from public.transactions transaction_row
      where transaction_row.note like '%Kế hoạch G4%') then
    raise exception 'Saving a material plan must not change stock.';
  end if;
  v_replay := public.save_material_plan_v1(
    null, v_ids.project_id, v_ids.site_id::text, null,
    'Kế hoạch G4 tháng 10', date '2026-10-01', date '2026-10-31',
    'Rollback smoke', 'draft',
    jsonb_build_array(jsonb_build_object(
      'id', v_ids.line_id, 'itemId', v_ids.item_id, 'sku', 'G4-STEEL',
      'itemName', 'G4 Steel', 'unit', 'kg', 'quantity', '10.000000',
      'neededDate', '2026-10-10', 'destination', 'Kho công trường',
      'allocations', jsonb_build_array(jsonb_build_object(
        'id', v_ids.allocation_id, 'sourceBudgetLineId', v_ids.budget_id,
        'sourceWorkBoqItemId', v_ids.work_id, 'sourceTaskId', v_ids.task_id,
        'quantity', '10.000000', 'neededDate', '2026-10-10',
        'destination', 'Kho công trường'
      ))
    )), 1, 'g4-save-1'
  );
  if v_replay #>> '{command,outcome}' <> 'replayed'
     or v_replay #>> '{plan,id}' <> v_result #>> '{plan,id}' then
    raise exception 'G4 save retry did not replay the original plan: %', v_replay;
  end if;
end $$;

create temp table g4_conversion_result on commit drop as
select public.convert_material_plan_to_request_v1(
  ((result #>> '{plan,id}')::uuid), 1, ids.warehouse_id, 'RECEIVE_TO_STOCK',
  jsonb_build_array(jsonb_build_object('allocationId', ids.allocation_id, 'quantity', '6.000000')),
  1, 'g4-convert-1'
) result
from g4_plan_result cross join g4_plan_ids ids;

do $$
declare
  v_result jsonb := (select result from g4_conversion_result);
  v_replay jsonb;
  v_plan_id uuid := ((select result from g4_plan_result) #>> '{plan,id}')::uuid;
  v_ids g4_plan_ids%rowtype := (select ids from g4_plan_ids ids);
begin
  if v_result ->> 'outcome' <> 'committed' or v_result ->> 'convertedQty' <> '6.000000' then
    raise exception 'G4 convert result invalid: %', v_result;
  end if;
  v_replay := public.convert_material_plan_to_request_v1(
    v_plan_id, 1, v_ids.warehouse_id, 'RECEIVE_TO_STOCK',
    jsonb_build_array(jsonb_build_object('allocationId', v_ids.allocation_id, 'quantity', '6.000000')),
    1, 'g4-convert-1'
  );
  if v_replay ->> 'outcome' <> 'replayed'
     or v_replay ->> 'requestId' <> v_result ->> 'requestId' then
    raise exception 'G4 replay did not return the original MR: %', v_replay;
  end if;
  if (select count(*) from public.requests where id = v_result ->> 'requestId') <> 1
     or jsonb_array_length(public.get_material_plan_v1(
       v_plan_id, v_ids.project_id, v_ids.site_id::text
     ) -> 'conversions') <> 1 then
    raise exception 'G4 retry duplicated MR or conversion.';
  end if;
  if (select status::text from public.requests where id = v_result ->> 'requestId') <> 'DRAFT' then
    raise exception 'Converted MR must remain in the normal draft workflow.';
  end if;
  if public.get_material_plan_v1(v_plan_id, v_ids.project_id, v_ids.site_id::text)
       #>> '{lines,0,remainingQty}' <> '4.000000' then
    raise exception 'G4 partial conversion remaining quantity is wrong.';
  end if;
end $$;

do $$
declare
  v_plan_id uuid := ((select result from g4_plan_result) #>> '{plan,id}')::uuid;
  v_ids g4_plan_ids%rowtype := (select ids from g4_plan_ids ids);
begin
  begin
    perform public.convert_material_plan_to_request_v1(
      v_plan_id, 1, v_ids.warehouse_id, 'RECEIVE_TO_STOCK',
      jsonb_build_array(jsonb_build_object('allocationId', v_ids.allocation_id, 'quantity', '6.000000')),
      1, 'g4-convert-over'
    );
    raise exception 'Expected partial conversion overflow to fail.';
  exception when serialization_failure then
    if sqlerrm <> 'MATERIAL_PLAN_CONVERSION_EXCEEDED' then raise; end if;
  end;

  begin
    perform set_config('app.material_plan_fail_after_request', 'on', true);
    perform public.convert_material_plan_to_request_v1(
      v_plan_id, 1, v_ids.warehouse_id, 'RECEIVE_TO_STOCK',
      jsonb_build_array(jsonb_build_object('allocationId', v_ids.allocation_id, 'quantity', '4.000000')),
      1, 'g4-convert-fault'
    );
    raise exception 'Expected late fault to fail.';
  exception when raise_exception then
    if sqlerrm <> 'MATERIAL_PLAN_FAULT_AFTER_REQUEST' then raise; end if;
  end;
  perform set_config('app.material_plan_fail_after_request', '', true);
  if (select count(*) from public.requests request_row
      where request_row.project_id = v_ids.project_id) <> 1 then
    raise exception 'Late conversion fault left an orphan MR.';
  end if;

  begin
    perform public.save_material_plan_v1(
      v_plan_id, v_ids.project_id, v_ids.site_id::text, 1,
      'Kế hoạch giảm sai', date '2026-10-01', date '2026-10-31', null, 'draft',
      jsonb_build_array(jsonb_build_object(
        'id', v_ids.line_id, 'itemId', v_ids.item_id, 'sku', 'G4-STEEL',
        'itemName', 'G4 Steel', 'unit', 'kg', 'quantity', '5.000000',
        'neededDate', '2026-10-10', 'destination', 'Kho công trường',
        'allocations', jsonb_build_array(jsonb_build_object(
          'id', v_ids.allocation_id, 'sourceBudgetLineId', v_ids.budget_id,
          'sourceWorkBoqItemId', v_ids.work_id, 'sourceTaskId', v_ids.task_id,
          'quantity', '5.000000', 'neededDate', '2026-10-10', 'destination', 'Kho công trường'
        ))
      )), 1, 'g4-revise-below'
    );
    raise exception 'Expected revision below converted quantity to fail.';
  exception when serialization_failure then
    if sqlerrm <> 'MATERIAL_PLAN_REVISION_BELOW_CONVERTED' then raise; end if;
  end;
end $$;

select pg_temp.g4_set_actor(denied_actor_id) from g4_plan_ids;

do $$
declare v_plan_id uuid := ((select result from g4_plan_result) #>> '{plan,id}')::uuid;
begin
  begin
    perform public.get_material_plan_v1(
      v_plan_id, (select project_id from g4_plan_ids), (select site_id::text from g4_plan_ids)
    );
    raise exception 'Expected denied actor read to fail.';
  exception when insufficient_privilege then
    if sqlerrm <> 'MATERIAL_PLAN_READ_DENIED' then raise; end if;
  end;
end $$;

reset role;
rollback;
