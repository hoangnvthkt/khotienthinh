-- Cloud-safe smoke: the migration and all fixtures are rolled back together.
begin;

create temp table gantt_smoke_scope on commit drop as
select
  admin.id as actor_user_id,
  admin.email,
  project.id as project_id,
  project.construction_site_id::text as construction_site_id,
  'gantt-smoke-parent-' || gen_random_uuid()::text as parent_task_id,
  'gantt-smoke-child-' || gen_random_uuid()::text as child_task_id,
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
end;
$$;

reset role;
rollback;
