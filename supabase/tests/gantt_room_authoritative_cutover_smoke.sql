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
rollback;
