-- Cloud-safe smoke: the migration and all fixtures are rolled back together.
begin;

create temp table gantt_smoke_completion_count on commit drop as
select count(*)::bigint as before_count
from public.project_task_completion_requests;

create temp table gantt_smoke_scope on commit drop as
select
  admin.id as actor_user_id,
  admin.email,
  project.id as project_id,
  project.construction_site_id::text as construction_site_id,
  'gantt-smoke-parent-' || gen_random_uuid()::text as parent_task_id,
  'gantt-smoke-child-' || gen_random_uuid()::text as child_task_id,
  'gantt-smoke-delay-' || gen_random_uuid()::text as delay_event_id,
  'gantt-smoke-revision-' || gen_random_uuid()::text as revision_id,
  gen_random_uuid() as save_request_id,
  gen_random_uuid() as delete_request_id
from public.users admin
cross join lateral (
  select candidate.id, candidate.construction_site_id
  from public.projects candidate
  where candidate.construction_site_id is not null
  order by candidate.created_at desc nulls last, candidate.id
  limit 1
) project
where admin.role = 'ADMIN'
  and coalesce(admin.is_active, true)
order by admin.id
limit 1;

grant select on gantt_smoke_scope to authenticated;

set local role authenticated;

select set_config('request.jwt.claim.sub', actor_user_id::text, true),
  set_config('request.jwt.claim.email', email, true),
  set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor_user_id::text, 'email', email
  )::text, true)
from gantt_smoke_scope;

do $$
declare
  scope gantt_smoke_scope%rowtype;
  v_changes jsonb;
  v_result jsonb;
  v_version bigint;
  v_event_updated_at timestamptz;
begin
  select * into scope from gantt_smoke_scope;
  if scope.actor_user_id is null then
    raise exception 'Gantt smoke needs one active System Admin and one project with a site';
  end if;

  v_changes := jsonb_build_array(
    jsonb_build_object(
      'id', scope.parent_task_id,
      'expected_row_version', 0,
      'name', 'Gantt smoke parent',
      'start_date', '2026-08-13',
      'end_date', '2026-08-14',
      'duration', 2,
      'progress', 10,
      'progress_mode', 'manual',
      'sort_order', 1,
      'dependencies', '[]'::jsonb,
      'watchers', '[]'::jsonb
    ),
    jsonb_build_object(
      'id', scope.child_task_id,
      'expected_row_version', 0,
      'parent_id', scope.parent_task_id,
      'name', 'Gantt smoke child',
      'start_date', '2026-08-14',
      'end_date', '2026-08-15',
      'duration', 2,
      'progress', 0,
      'progress_mode', 'manual',
      'sort_order', 2,
      'dependencies', jsonb_build_array(jsonb_build_object(
        'task_id', scope.parent_task_id, 'type', 'FS'
      )),
      'watchers', '[]'::jsonb
    )
  );

  v_result := public.save_project_gantt_tasks(
    scope.save_request_id, scope.project_id, scope.construction_site_id, v_changes
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or coalesce((v_result ->> 'replayed')::boolean, true)
    or jsonb_array_length(v_result -> 'tasks') <> 2 then
    raise exception 'Gantt batch save did not return two authoritative tasks: %', v_result;
  end if;

  v_result := public.save_project_gantt_tasks(
    scope.save_request_id, scope.project_id, scope.construction_site_id, v_changes
  );
  if not coalesce((v_result ->> 'replayed')::boolean, false) then
    raise exception 'Gantt idempotent replay was not recognized: %', v_result;
  end if;

  begin
    perform public.save_project_gantt_tasks(
      scope.save_request_id,
      scope.project_id,
      scope.construction_site_id,
      jsonb_set(v_changes, '{0,name}', '"reused request"'::jsonb)
    );
    raise exception 'Expected GANTT_REQUEST_ID_REUSED';
  exception when others then
    if sqlerrm not like '%GANTT_REQUEST_ID_REUSED%' then raise; end if;
  end;

  select task.row_version into v_version
  from public.project_tasks task where task.id = scope.parent_task_id;

  begin
    perform public.save_project_gantt_tasks(
      gen_random_uuid(),
      scope.project_id,
      scope.construction_site_id,
      jsonb_build_array(jsonb_build_object(
        'id', scope.parent_task_id,
        'expected_row_version', v_version - 1,
        'name', 'stale update',
        'start_date', '2026-08-13',
        'end_date', '2026-08-14',
        'duration', 2,
        'progress', 10,
        'progress_mode', 'manual'
      ))
    );
    raise exception 'Expected GANTT_STALE_VERSION';
  exception when others then
    if sqlerrm not like '%GANTT_STALE_VERSION%' then raise; end if;
  end;

  reset role;
  insert into public.project_task_completion_requests (
    id, project_id, construction_site_id, task_id, status,
    proposed_quantity, accepted_quantity, attachments
  ) values (
    gen_random_uuid()::text, scope.project_id, scope.construction_site_id,
    scope.child_task_id, 'approved', 1, 1, '[]'::jsonb
  );
  insert into public.project_delay_events (
    id, project_id, construction_site_id, task_id, task_name_snapshot,
    category, reason, impact_days, status, occurred_on
  ) values (
    scope.delay_event_id, scope.project_id, scope.construction_site_id,
    scope.parent_task_id, 'Gantt smoke parent', 'weather',
    'Cloud transaction smoke', 1, 'reported', current_date
  );
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', scope.actor_user_id::text, true);
  perform set_config('request.jwt.claim.email', scope.email, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', scope.actor_user_id::text, 'email', scope.email
  )::text, true);

  v_result := public.delete_project_gantt_task_tree(
    scope.delete_request_id,
    scope.project_id,
    scope.construction_site_id,
    scope.parent_task_id,
    v_version
  );
  if coalesce((v_result ->> 'ok')::boolean, true)
    or v_result ->> 'errorCode' <> 'GANTT_DELETE_BLOCKED'
    or not exists (
      select 1 from public.project_tasks task where task.id = scope.parent_task_id
    ) then
    raise exception 'Gantt blocked delete was not atomic/auditable: %', v_result;
  end if;

  begin
    update public.project_tasks
    set name = 'Direct writes must stay blocked'
    where id = scope.parent_task_id;
    raise exception 'Expected direct project_tasks update denial';
  exception when insufficient_privilege then
    null;
  end;

  v_result := public.create_project_gantt_baseline(
    gen_random_uuid(), scope.project_id, scope.construction_site_id,
    'Gantt Cloud smoke baseline'
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or not exists (
      select 1
      from jsonb_array_elements(v_result -> 'baseline' -> 'tasks_snapshot') item
      where item ->> 'id' = scope.parent_task_id
    )
    or not exists (
      select 1
      from jsonb_array_elements(v_result -> 'baseline' -> 'tasks_snapshot') item
      where item ->> 'id' = scope.child_task_id
    ) then
    raise exception 'Gantt baseline command did not snapshot both smoke tasks';
  end if;

  select task.row_version into v_version
  from public.project_tasks task where task.id = scope.child_task_id;
  v_result := public.replace_project_gantt_task_contract_items(
    gen_random_uuid(), scope.project_id, scope.construction_site_id,
    scope.child_task_id, v_version, '{}'::uuid[]
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or jsonb_array_length(v_result -> 'contractItemIds') <> 0 then
    raise exception 'Gantt link replacement command failed: %', v_result;
  end if;

  select event.updated_at into strict v_event_updated_at
  from public.project_delay_events event where event.id = scope.delay_event_id;
  v_result := public.transition_project_gantt_delay_event(
    gen_random_uuid(), scope.project_id, scope.construction_site_id,
    scope.delay_event_id, 'accepted', v_event_updated_at
  );
  if v_result -> 'delayEvent' ->> 'status' <> 'accepted' then
    raise exception 'Gantt delay transition failed: %', v_result;
  end if;

  select task.row_version into v_version
  from public.project_tasks task where task.id = scope.parent_task_id;
  v_result := public.apply_project_gantt_forecast(
    gen_random_uuid(), scope.project_id, scope.construction_site_id,
    jsonb_build_object(
      'id', scope.revision_id,
      'reason', 'Gantt Cloud smoke forecast',
      'source_delay_event_ids', jsonb_build_array(scope.delay_event_id)
    ),
    jsonb_build_array(jsonb_build_object(
      'task_id', scope.parent_task_id,
      'task_name_snapshot', 'Gantt smoke parent',
      'before_start', '2026-08-13',
      'before_end', '2026-08-14',
      'before_duration', 2,
      'after_start', '2026-08-14',
      'after_end', '2026-08-15',
      'after_duration', 2,
      'delta_days', 1,
      'was_critical', true,
      'float_before', 0
    )),
    jsonb_build_array(jsonb_build_object(
      'id', scope.parent_task_id,
      'expected_row_version', v_version,
      'start_date', '2026-08-14',
      'end_date', '2026-08-15',
      'duration', 2
    ))
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or v_result -> 'revision' ->> 'id' <> scope.revision_id
    or v_result -> 'delayEvents' -> 0 ->> 'status' <> 'applied'
    or (v_result -> 'tasks' -> 0 ->> 'row_version')::bigint <= v_version then
    raise exception 'Gantt forecast transaction failed: %', v_result;
  end if;

  v_result := public.get_project_gantt_catalog(
    scope.project_id, scope.construction_site_id, 'daily_log'
  );
  if not exists (
      select 1 from jsonb_array_elements(v_result) item
      where item ->> 'id' = scope.parent_task_id
        and item ? 'rowVersion'
        and not (item ?| array['notes', 'watchers', 'estimatedCostPerDay'])
    )
    or not exists (
      select 1 from jsonb_array_elements(v_result) item
      where item ->> 'id' = scope.child_task_id
    ) then
    raise exception 'Gantt catalog projection is not minimal/complete';
  end if;
end;
$$;

reset role;

-- Mandatory authorization matrix. Fixtures are created after the cutover so
-- PBAC-only/module-only actors cannot be swept into the migration backfill.
create temp table gantt_smoke_matrix (
  project_id text not null,
  other_project_id text not null,
  site_id uuid not null,
  other_site_id uuid not null,
  position_id uuid not null,
  matrix_system_admin uuid not null,
  matrix_viewer uuid not null,
  matrix_editor uuid not null,
  matrix_deleter uuid not null,
  matrix_pbac_only uuid not null,
  matrix_module_only uuid not null,
  matrix_assignee_only uuid not null,
  matrix_inactive_actor uuid not null,
  matrix_inactive_staff uuid not null,
  matrix_empty_room uuid not null,
  viewer_staff uuid not null,
  editor_staff uuid not null,
  deleter_staff uuid not null,
  pbac_staff uuid not null,
  module_staff uuid not null,
  assignee_staff uuid not null,
  inactive_actor_staff uuid not null,
  inactive_staff uuid not null,
  empty_room_staff uuid not null,
  delete_task_id text not null,
  assignee_task_id text not null,
  editor_task_id text not null,
  other_task_id text not null
) on commit drop;

insert into gantt_smoke_matrix values (
  'gantt-matrix-' || gen_random_uuid()::text,
  'gantt-matrix-other-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(),
  'gantt-matrix-delete-' || gen_random_uuid()::text,
  'gantt-matrix-assignee-' || gen_random_uuid()::text,
  'gantt-matrix-editor-' || gen_random_uuid()::text,
  'gantt-matrix-other-' || gen_random_uuid()::text
);

grant select on gantt_smoke_matrix to authenticated;

insert into public.hrm_construction_sites (id, name)
select site_id, 'Gantt matrix site' from gantt_smoke_matrix
union all
select other_site_id, 'Gantt matrix other site' from gantt_smoke_matrix;

insert into public.projects (id, code, name, construction_site_id, source)
select project_id, 'GANTT-MATRIX', 'Gantt matrix project', site_id, 'manual'
from gantt_smoke_matrix
union all
select other_project_id, 'GANTT-MATRIX-OTHER', 'Gantt matrix other project', other_site_id, 'manual'
from gantt_smoke_matrix;

insert into public.hrm_positions (
  id, name, level, code, is_active, sort_order, source, metadata
)
select position_id, 'Gantt matrix position', 1, 'GANTT-MATRIX', true, 0, 'smoke', '{}'::jsonb
from gantt_smoke_matrix;

insert into public.users (
  id, name, email, username, role, is_active,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select matrix_system_admin, 'matrix_system_admin', 'gantt-matrix-admin@vioo.local', 'gantt-matrix-admin', 'ADMIN'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_viewer, 'matrix_viewer', 'gantt-matrix-viewer@vioo.local', 'gantt-matrix-viewer', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_editor, 'matrix_editor', 'gantt-matrix-editor@vioo.local', 'gantt-matrix-editor', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_deleter, 'matrix_deleter', 'gantt-matrix-deleter@vioo.local', 'gantt-matrix-deleter', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_pbac_only, 'matrix_pbac_only', 'gantt-matrix-pbac@vioo.local', 'gantt-matrix-pbac', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_module_only, 'matrix_module_only', 'gantt-matrix-module@vioo.local', 'gantt-matrix-module', 'EMPLOYEE'::public.user_role, true,
  array['DA']::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_assignee_only, 'matrix_assignee_only', 'gantt-matrix-assignee@vioo.local', 'gantt-matrix-assignee', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_inactive_actor, 'matrix_inactive_actor', 'gantt-matrix-inactive-actor@vioo.local', 'gantt-matrix-inactive-actor', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_inactive_staff, 'matrix_inactive_staff', 'gantt-matrix-inactive-staff@vioo.local', 'gantt-matrix-inactive-staff', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix
union all select matrix_empty_room, 'matrix_empty_room', 'gantt-matrix-empty@vioo.local', 'gantt-matrix-empty', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from gantt_smoke_matrix;

insert into public.project_staff (
  id, project_id, construction_site_id, user_id, position_id,
  start_date, end_date, note
)
select viewer_staff, project_id, site_id::text, matrix_viewer::text, position_id, current_date, null::date, 'matrix_viewer' from gantt_smoke_matrix
union all select editor_staff, project_id, site_id::text, matrix_editor::text, position_id, current_date, null::date, 'matrix_editor' from gantt_smoke_matrix
union all select deleter_staff, project_id, site_id::text, matrix_deleter::text, position_id, current_date, null::date, 'matrix_deleter' from gantt_smoke_matrix
union all select pbac_staff, project_id, site_id::text, matrix_pbac_only::text, position_id, current_date, null::date, 'matrix_pbac_only' from gantt_smoke_matrix
union all select module_staff, project_id, site_id::text, matrix_module_only::text, position_id, current_date, null::date, 'matrix_module_only' from gantt_smoke_matrix
union all select assignee_staff, project_id, site_id::text, matrix_assignee_only::text, position_id, current_date, null::date, 'matrix_assignee_only' from gantt_smoke_matrix
union all select inactive_actor_staff, project_id, site_id::text, matrix_inactive_actor::text, position_id, current_date, null::date, 'matrix_inactive_actor' from gantt_smoke_matrix
union all select inactive_staff, project_id, site_id::text, matrix_inactive_staff::text, position_id, current_date - 10, current_date - 1, 'matrix_inactive_staff' from gantt_smoke_matrix
union all select empty_room_staff, project_id, site_id::text, matrix_empty_room::text, position_id, current_date, null::date, 'matrix_empty_room' from gantt_smoke_matrix;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id, is_active
)
select project_id, site_id::text, 'gantt', viewer_staff, true from gantt_smoke_matrix
union all select project_id, site_id::text, 'gantt', editor_staff, true from gantt_smoke_matrix
union all select project_id, site_id::text, 'gantt', deleter_staff, true from gantt_smoke_matrix
union all select project_id, site_id::text, 'gantt', inactive_actor_staff, true from gantt_smoke_matrix
union all select project_id, site_id::text, 'gantt', inactive_staff, true from gantt_smoke_matrix;

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, grant_source
)
select member.id, action.action_code, true, 'manual_room'
from public.project_permission_room_members member
join gantt_smoke_matrix matrix on member.project_id = matrix.project_id
cross join lateral unnest(
  case member.project_staff_id
    when matrix.viewer_staff then array['view']::text[]
    when matrix.editor_staff then array['view', 'edit']::text[]
    when matrix.deleter_staff then array['view', 'delete']::text[]
    when matrix.inactive_actor_staff then array['view', 'edit']::text[]
    when matrix.inactive_staff then array['view', 'edit']::text[]
    else '{}'::text[]
  end
) action(action_code)
where member.room_code = 'gantt';

select set_config('app.account_lifecycle_command', 'on', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.users actor
set is_active = false
from gantt_smoke_matrix matrix
where actor.id = matrix.matrix_inactive_actor;
select set_config('app.account_lifecycle_command', 'off', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '{}'::text, true);

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active
)
select matrix_pbac_only, 'project.gantt.edit', 'project', project_id, true
from gantt_smoke_matrix;

insert into public.project_tasks (
  id, project_id, construction_site_id, name, start_date, end_date,
  duration, progress, progress_mode, is_milestone, sort_order, assignee_user_id
)
select delete_task_id, project_id, site_id::text, 'Matrix delete task',
  date '2026-08-13', date '2026-08-14', 2, 0, 'manual', false, 1, null
from gantt_smoke_matrix
union all
select assignee_task_id, project_id, site_id::text, 'Matrix assignee task',
  date '2026-08-13', date '2026-08-14', 2, 0, 'manual', false, 2, matrix_assignee_only::text
from gantt_smoke_matrix
union all
select other_task_id, other_project_id, other_site_id::text, 'Matrix other task',
  date '2026-08-13', date '2026-08-14', 2, 0, 'manual', false, 1, null
from gantt_smoke_matrix;

create or replace function pg_temp.assert_no_gantt_access(
  p_label text, p_project_id text, p_site_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.project_tasks task
    where task.project_id = p_project_id
      and task.construction_site_id is not distinct from p_site_id
  ) then
    raise exception '% unexpectedly read Gantt tasks', p_label;
  end if;
  begin
    perform public.create_project_gantt_baseline(
      gen_random_uuid(), p_project_id, p_site_id, p_label
    );
    raise exception '% unexpectedly edited Gantt', p_label;
  exception when insufficient_privilege then
    if sqlerrm not like '%GANTT_PERMISSION_DENIED%' then raise; end if;
  end;
end;
$$;

grant execute on function pg_temp.assert_no_gantt_access(text, text, text) to authenticated;

-- matrix_viewer: view works; edit/delete do not.
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_viewer::text, true),
  set_config('request.jwt.claim.email', 'gantt-matrix-viewer@vioo.local', true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_viewer,
    'email', 'gantt-matrix-viewer@vioo.local', 'role', 'authenticated')::text, true)
from gantt_smoke_matrix;
do $$
declare matrix gantt_smoke_matrix%rowtype;
begin
  select * into matrix from gantt_smoke_matrix;
  if not exists (select 1 from public.project_tasks where id = matrix.delete_task_id) then
    raise exception 'matrix_viewer could not read Gantt';
  end if;
  begin
    perform public.create_project_gantt_baseline(gen_random_uuid(), matrix.project_id, matrix.site_id::text, 'viewer');
    raise exception 'matrix_viewer unexpectedly edited Gantt';
  exception when insufficient_privilege then
    if sqlerrm not like '%GANTT_PERMISSION_DENIED%' then raise; end if;
  end;
end $$;
reset role;

-- matrix_editor: edit without delete.
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_editor::text, true),
  set_config('request.jwt.claim.email', 'gantt-matrix-editor@vioo.local', true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_editor,
    'email', 'gantt-matrix-editor@vioo.local', 'role', 'authenticated')::text, true)
from gantt_smoke_matrix;
do $$
declare matrix gantt_smoke_matrix%rowtype; result jsonb;
begin
  select * into matrix from gantt_smoke_matrix;
  result := public.save_project_gantt_tasks(gen_random_uuid(), matrix.project_id, matrix.site_id::text,
    jsonb_build_array(jsonb_build_object(
      'id', matrix.editor_task_id, 'expected_row_version', 0,
      'name', 'Matrix editor task', 'start_date', '2026-08-13',
      'end_date', '2026-08-14', 'duration', 2, 'progress', 0,
      'progress_mode', 'manual', 'sort_order', 3
    )));
  if not coalesce((result ->> 'ok')::boolean, false) then raise exception 'matrix_editor could not edit'; end if;
  begin
    perform public.delete_project_gantt_task_tree(
      gen_random_uuid(), matrix.project_id, matrix.site_id::text, matrix.editor_task_id, 1
    );
    raise exception 'matrix_editor unexpectedly deleted Gantt';
  exception when insufficient_privilege then
    if sqlerrm not like '%GANTT_PERMISSION_DENIED%' then raise; end if;
  end;
end $$;
reset role;

-- matrix_deleter: delete without edit.
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_deleter::text, true),
  set_config('request.jwt.claim.email', 'gantt-matrix-deleter@vioo.local', true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_deleter,
    'email', 'gantt-matrix-deleter@vioo.local', 'role', 'authenticated')::text, true)
from gantt_smoke_matrix;
do $$
declare matrix gantt_smoke_matrix%rowtype; result jsonb;
begin
  select * into matrix from gantt_smoke_matrix;
  begin
    perform public.create_project_gantt_baseline(gen_random_uuid(), matrix.project_id, matrix.site_id::text, 'deleter');
    raise exception 'matrix_deleter unexpectedly edited Gantt';
  exception when insufficient_privilege then
    if sqlerrm not like '%GANTT_PERMISSION_DENIED%' then raise; end if;
  end;
  result := public.delete_project_gantt_task_tree(
    gen_random_uuid(), matrix.project_id, matrix.site_id::text, matrix.delete_task_id, 1
  );
  if not coalesce((result ->> 'ok')::boolean, false) then raise exception 'matrix_deleter could not delete'; end if;
end $$;
reset role;

-- PBAC-only, module-only, assignee/owner-only, inactive actor/staff and empty Room all deny.
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_pbac_only::text, true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_pbac_only,
    'email', 'gantt-matrix-pbac@vioo.local', 'role', 'authenticated')::text, true) from gantt_smoke_matrix;
select pg_temp.assert_no_gantt_access('matrix_pbac_only', project_id, site_id::text) from gantt_smoke_matrix;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_module_only::text, true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_module_only,
    'email', 'gantt-matrix-module@vioo.local', 'role', 'authenticated')::text, true) from gantt_smoke_matrix;
select pg_temp.assert_no_gantt_access('matrix_module_only', project_id, site_id::text) from gantt_smoke_matrix;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_assignee_only::text, true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_assignee_only,
    'email', 'gantt-matrix-assignee@vioo.local', 'role', 'authenticated')::text, true) from gantt_smoke_matrix;
select pg_temp.assert_no_gantt_access('matrix_assignee_only', project_id, site_id::text) from gantt_smoke_matrix;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_inactive_actor::text, true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_inactive_actor,
    'email', 'gantt-matrix-inactive-actor@vioo.local', 'role', 'authenticated')::text, true) from gantt_smoke_matrix;
select pg_temp.assert_no_gantt_access('matrix_inactive_actor', project_id, site_id::text) from gantt_smoke_matrix;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_inactive_staff::text, true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_inactive_staff,
    'email', 'gantt-matrix-inactive-staff@vioo.local', 'role', 'authenticated')::text, true) from gantt_smoke_matrix;
select pg_temp.assert_no_gantt_access('matrix_inactive_staff', project_id, site_id::text) from gantt_smoke_matrix;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_empty_room::text, true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_empty_room,
    'email', 'gantt-matrix-empty@vioo.local', 'role', 'authenticated')::text, true) from gantt_smoke_matrix;
select pg_temp.assert_no_gantt_access('matrix_empty_room', project_id, site_id::text) from gantt_smoke_matrix;
reset role;

-- matrix_system_admin is an operational override, never an implicit Room member.
do $$
declare matrix gantt_smoke_matrix%rowtype;
begin
  select * into matrix from gantt_smoke_matrix;
  if exists (
    select 1 from public.project_permission_room_members member
    join public.project_staff staff on staff.id = member.project_staff_id
    where member.room_code = 'gantt'
      and staff.user_id = matrix.matrix_system_admin::text
  ) then
    raise exception 'matrix_system_admin became a Room member';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', matrix_system_admin::text, true),
  set_config('request.jwt.claim.email', 'gantt-matrix-admin@vioo.local', true),
  set_config('request.jwt.claims', jsonb_build_object('sub', matrix_system_admin,
    'email', 'gantt-matrix-admin@vioo.local', 'role', 'authenticated')::text, true)
from gantt_smoke_matrix;
do $$
declare matrix gantt_smoke_matrix%rowtype; before_name text; before_version bigint; result jsonb;
begin
  select * into matrix from gantt_smoke_matrix;
  result := public.create_project_gantt_baseline(
    gen_random_uuid(), matrix.project_id, matrix.site_id::text, 'System Admin override'
  );
  if not coalesce((result ->> 'ok')::boolean, false) then raise exception 'matrix_system_admin override failed'; end if;

  -- wrong project / wrong site and mixed-scope batch must roll back every row.
  select name, row_version into before_name, before_version
  from public.project_tasks where id = matrix.assignee_task_id;
  begin
    perform public.save_project_gantt_tasks(gen_random_uuid(), matrix.project_id, matrix.site_id::text,
      jsonb_build_array(
        jsonb_build_object(
          'id', matrix.assignee_task_id, 'expected_row_version', before_version,
          'name', 'must roll back', 'start_date', '2026-08-13', 'end_date', '2026-08-14',
          'duration', 2, 'progress', 0, 'progress_mode', 'manual'
        ),
        jsonb_build_object(
          'id', matrix.other_task_id, 'expected_row_version', 1,
          'name', 'wrong project task', 'start_date', '2026-08-13', 'end_date', '2026-08-14',
          'duration', 2, 'progress', 0, 'progress_mode', 'manual'
        )
      ));
    raise exception 'wrong project batch unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm not like '%GANTT_SCOPE_MISMATCH%' then raise; end if;
  end;
  if (select name from public.project_tasks where id = matrix.assignee_task_id) is distinct from before_name
    or (select row_version from public.project_tasks where id = matrix.assignee_task_id) <> before_version then
    raise exception 'wrong project batch did not roll back';
  end if;
  begin
    perform public.save_project_gantt_tasks(gen_random_uuid(), matrix.project_id, matrix.other_site_id::text,
      jsonb_build_array(jsonb_build_object(
        'id', matrix.assignee_task_id, 'expected_row_version', before_version,
        'name', 'wrong site', 'start_date', '2026-08-13', 'end_date', '2026-08-14',
        'duration', 2, 'progress', 0, 'progress_mode', 'manual'
      )));
    raise exception 'wrong site unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm not like '%GANTT_SCOPE_MISMATCH%' then raise; end if;
  end;
end $$;
reset role;

do $$
declare before_count bigint; current_count bigint;
begin
  select count(*) into current_count from public.project_task_completion_requests;
  select snapshot.before_count into before_count from gantt_smoke_completion_count snapshot;
  if current_count <> before_count + 1 then
    raise exception 'completion count changed during Gantt commands: before %, after %', before_count, current_count;
  end if;
end $$;

rollback;
