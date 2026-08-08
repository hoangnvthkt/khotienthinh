-- Run after local reset:
-- npx supabase db query --local -f supabase/tests/project_room_permission_audit_pilots_smoke.sql

begin;

do $$
declare
  v_expected_actions integer;
begin
  select sum(cardinality(room.allowed_actions))::integer
  into v_expected_actions
  from public.project_permission_rooms room
  where room.is_active;

  if (select count(*) from app_private.project_permission_room_action_bindings) <> v_expected_actions then
    raise exception 'Every active Room/action must appear exactly once in the binding registry';
  end if;
  if (select count(*) from app_private.project_permission_room_action_bindings where enforcement_status = 'pilot') <> 25 then
    raise exception 'Expected 25 current Room pilot actions including three weekly_progress actions';
  end if;
  if exists (
    select 1 from app_private.project_permission_room_action_bindings
    where enforcement_status = 'pilot'
      and room_code not in ('daily_log', 'material_planning', 'material_po', 'material_request', 'weekly_progress')
  ) then
    raise exception 'A non-pilot Room was accidentally enabled';
  end if;
  if not app_private.permission_hardening_flag('project_room_pbac_fallback_enabled') then
    raise exception 'PBAC compatibility fallback must start enabled';
  end if;
  if to_regprocedure('public.get_my_project_room_actions(text,text)') is null
    or to_regprocedure('public.get_my_project_room_pbac_exceptions(text,text)') is null
    or to_regprocedure('public.get_project_permission_room_health_summary()') is null then
    raise exception 'Project Room audit RPC surface is incomplete';
  end if;
end $$;

create temp table project_room_pilot_smoke_ids (
  admin_id uuid not null,
  room_user_id uuid not null,
  fallback_user_id uuid not null,
  expired_user_id uuid not null,
  missing_user_id uuid not null,
  project_id text not null,
  position_id uuid not null,
  room_staff_id uuid not null,
  fallback_staff_id uuid not null,
  expired_staff_id uuid not null,
  missing_user_staff_id uuid not null
) on commit drop;

insert into project_room_pilot_smoke_ids values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'project-room-pilot-smoke-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);

grant select on project_room_pilot_smoke_ids to authenticated;

insert into public.users (
  id, name, email, username, role, is_active,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select admin_id, 'Room Pilot Admin', 'room-pilot-admin@vioo.local', 'room-pilot-admin', 'ADMIN'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from project_room_pilot_smoke_ids
union all
select room_user_id, 'Room Pilot User', 'room-pilot-user@vioo.local', 'room-pilot-user', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from project_room_pilot_smoke_ids
union all
select fallback_user_id, 'Room Fallback User', 'room-fallback-user@vioo.local', 'room-fallback-user', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from project_room_pilot_smoke_ids
union all
select expired_user_id, 'Expired Room User', 'room-expired-user@vioo.local', 'room-expired-user', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from project_room_pilot_smoke_ids
union all
select missing_user_id, 'Missing Room User', 'room-missing-user@vioo.local', 'room-missing-user', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from project_room_pilot_smoke_ids;

insert into public.projects (id, code, name, source)
select project_id, 'ROOM-PILOT-SMOKE', 'Room Pilot Smoke', 'manual'
from project_room_pilot_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Room Pilot Position', 1, 'ROOM-PILOT-SMOKE', true, 0, 'smoke', '{}'::jsonb
from project_room_pilot_smoke_ids;

insert into public.project_staff (id, project_id, user_id, position_id, start_date, end_date, note)
select room_staff_id, project_id, room_user_id::text, position_id, current_date, null::date, 'Room user'
from project_room_pilot_smoke_ids
union all
select fallback_staff_id, project_id, fallback_user_id::text, position_id, current_date, null::date, 'Fallback user'
from project_room_pilot_smoke_ids
union all
select expired_staff_id, project_id, expired_user_id::text, position_id, current_date - 2, current_date - 1, 'Expired user'
from project_room_pilot_smoke_ids
union all
select missing_user_staff_id, project_id, missing_user_id::text, position_id, current_date, null::date, 'Missing user'
from project_room_pilot_smoke_ids;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id, is_active
)
select project_id, null, 'material_planning', room_staff_id, true
from project_room_pilot_smoke_ids
union all
select project_id, null, 'daily_log', missing_user_staff_id, true
from project_room_pilot_smoke_ids;

insert into public.project_permission_room_member_actions (room_member_id, action_code, is_active)
select member.id, action_code, true
from public.project_permission_room_members member
cross join unnest(array['view', 'edit']::text[]) action_code
where member.project_staff_id = (select room_staff_id from project_room_pilot_smoke_ids)
  and member.room_code = 'material_planning';

delete from public.users
where id = (select missing_user_id from project_room_pilot_smoke_ids);

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active
)
select fallback_user_id, 'project.material_boq.delete', 'project', project_id, true
from project_room_pilot_smoke_ids
union all
select fallback_user_id, 'project.daily_log.edit_all', 'project', project_id, true
from project_room_pilot_smoke_ids
union all
select expired_user_id, 'project.material_boq.delete', 'project', project_id, true
from project_room_pilot_smoke_ids
union all
select expired_user_id, 'project.daily_log.edit_all', 'project', project_id, true
from project_room_pilot_smoke_ids;

insert into public.project_work_boq_items (
  id, project_id, name, unit, planned_qty, unit_price, sync_status
)
select 'room-edit-cannot-delete-' || project_id, project_id, 'Edit cannot delete', 'item', 1, 1, 'manual'
from project_room_pilot_smoke_ids
union all
select 'room-delete-can-delete-' || project_id, project_id, 'Delete can delete', 'item', 1, 1, 'manual'
from project_room_pilot_smoke_ids;

do $$
declare
  ids project_room_pilot_smoke_ids%rowtype;
begin
  select * into ids from project_room_pilot_smoke_ids;

  if not app_private.project_actor_has_effective_room_action(
    ids.room_user_id, ids.project_id, null, 'material_planning', 'edit'
  ) then
    raise exception 'Room edit action was not effective';
  end if;
  if app_private.project_actor_has_effective_room_action(
    ids.room_user_id, ids.project_id, null, 'material_planning', 'delete'
  ) then
    raise exception 'Room edit action leaked into BOQ delete';
  end if;
  if not app_private.project_actor_has_effective_room_action(
    ids.fallback_user_id, ids.project_id, null, 'material_planning', 'delete'
  ) then
    raise exception 'Exact BOQ delete PBAC fallback was not effective';
  end if;
  if app_private.project_actor_has_effective_room_action(
    ids.expired_user_id, ids.project_id, null, 'material_planning', 'delete'
  ) then
    raise exception 'Expired project staff bypassed the effective action helper';
  end if;
  if not app_private.daily_log_has_action(
    ids.project_id, null, 'project.daily_log.edit_all', ids.fallback_user_id
  ) then
    raise exception 'Active staff lost the Daily Log edit_all compatibility exception';
  end if;
  if app_private.daily_log_has_action(
    ids.project_id, null, 'project.daily_log.edit_all', ids.expired_user_id
  ) then
    raise exception 'Expired staff retained the Daily Log edit_all compatibility exception';
  end if;
  if public.project_user_has_room_action(
    ids.project_id, null, 'material_planning', 'delete', ids.admin_id
  ) then
    raise exception 'System Admin must not become a Room recipient';
  end if;
  if not app_private.project_actor_has_effective_room_action(
    ids.admin_id, ids.project_id, null, 'material_planning', 'delete'
  ) then
    raise exception 'System Admin actor override is missing';
  end if;

  if app_private.project_actor_has_effective_room_action(
    ids.room_user_id, 'wrong-project', null, 'material_planning', 'edit'
  ) then
    raise exception 'Room action leaked into the wrong project';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.email', 'room-pilot-admin@vioo.local', true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', 'room-pilot-admin@vioo.local',
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

do $$
begin
  begin
    perform public.replace_project_permission_room_members(
      (select project_id from project_room_pilot_smoke_ids),
      null,
      'material_request',
      jsonb_build_array(jsonb_build_object(
        'project_staff_id', (select room_staff_id from project_room_pilot_smoke_ids),
        'action_codes', jsonb_build_array('view')
      ))
    );
    raise exception 'An audit_only Room action was changed through the backend';
  exception when insufficient_privilege then
    null;
  end;

  if exists (
    select 1
    from public.get_project_permission_room_health(
      (select project_id from project_room_pilot_smoke_ids), null
    ) finding
    where finding.issue_group = 'user_only_pbac_fallback'
      and finding.user_id = (select admin_id from project_room_pilot_smoke_ids)
  ) then
    raise exception 'System Admin was incorrectly reported as fallback-only';
  end if;

  if not exists (
    select 1
    from public.get_project_permission_room_health(
      (select project_id from project_room_pilot_smoke_ids), null
    ) finding
    where finding.issue_group = 'invalid_scope_or_staff'
      and finding.issue_code = 'missing_user'
      and finding.detail ->> 'project_staff_id' = (
        select missing_user_staff_id::text from project_room_pilot_smoke_ids
      )
  ) then
    raise exception 'Scoped health report omitted a Room member whose staff user is missing';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(
      public.get_project_permission_room_health_summary()
        #> '{checks,roomInvalidScopeOrStaff}'
    ) finding
    where finding ->> 'projectStaffId' = (
      select missing_user_staff_id::text from project_room_pilot_smoke_ids
    )
      and finding ->> 'issueCode' = 'missing_user'
  ) then
    raise exception 'Global health summary omitted a Room member whose staff user is missing';
  end if;
end $$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.email', 'room-pilot-user@vioo.local', true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', 'room-pilot-user@vioo.local',
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

do $$
declare
  v_row_count integer;
begin
  begin
    perform app_private.project_actor_has_effective_room_action(
      (select fallback_user_id from project_room_pilot_smoke_ids),
      (select project_id from project_room_pilot_smoke_ids),
      null,
      'material_planning',
      'delete'
    );
    raise exception 'Authenticated actor could probe another user through the private helper';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform app_private.daily_log_has_action(
      (select project_id from project_room_pilot_smoke_ids),
      null,
      'project.daily_log.edit_all',
      (select fallback_user_id from project_room_pilot_smoke_ids)
    );
    raise exception 'Authenticated actor could probe another user through the Daily Log helper';
  exception when insufficient_privilege then
    null;
  end;

  delete from public.project_work_boq_items
  where id = 'room-edit-cannot-delete-' || (select project_id from project_room_pilot_smoke_ids);
  get diagnostics v_row_count = row_count;
  if v_row_count <> 0 then
    raise exception 'A user with only material_planning.edit bypassed BOQ delete RLS';
  end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.email', 'room-fallback-user@vioo.local', true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', 'room-fallback-user@vioo.local',
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

do $$
declare
  v_row_count integer;
begin
  if not exists (
    select 1
    from public.get_my_project_room_pbac_exceptions(
      (select project_id from project_room_pilot_smoke_ids), null
    ) exception
    where exception.room_code = 'daily_log'
      and exception.permission_code = 'project.daily_log.edit_all'
  ) then
    raise exception 'Current actor RPC omitted Daily Log edit_all compatibility';
  end if;

  delete from public.project_work_boq_items
  where id = 'room-delete-can-delete-' || (select project_id from project_room_pilot_smoke_ids);
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'A user with material_planning.delete could not pass BOQ delete RLS';
  end if;
end $$;

reset role;

do $$
declare
  ids project_room_pilot_smoke_ids%rowtype;
begin
  select * into ids from project_room_pilot_smoke_ids;

  update app_private.permission_hardening_settings
  set value = 'false'::jsonb
  where key = 'project_room_pbac_fallback_enabled';

  if app_private.project_actor_has_effective_room_action(
    ids.fallback_user_id, ids.project_id, null, 'material_planning', 'delete'
  ) then
    raise exception 'PBAC fallback remained effective after the flag was disabled';
  end if;
end $$;

rollback;
