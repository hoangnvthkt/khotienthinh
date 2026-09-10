begin;

create temporary table authorization_v2_phase2_smoke_context (
  active_user_id uuid not null,
  active_auth_id uuid not null,
  active_email text not null,
  inactive_auth_id uuid not null,
  inactive_email text not null,
  project_a text not null,
  project_b text not null
) on commit drop;

do $$
declare
  v_active_user_id uuid := gen_random_uuid();
  v_active_auth_id uuid := gen_random_uuid();
  v_inactive_user_id uuid := gen_random_uuid();
  v_inactive_auth_id uuid := gen_random_uuid();
  v_staff_id uuid := gen_random_uuid();
  v_room_member_id uuid := gen_random_uuid();
  v_position_id uuid;
  v_project_a text := 'auth-v2-a-' || replace(gen_random_uuid()::text, '-', '');
  v_project_b text := 'auth-v2-b-' || replace(gen_random_uuid()::text, '-', '');
  v_active_email text := 'authorization-v2-active-' || replace(v_active_user_id::text, '-', '') || '@invalid.local';
  v_inactive_email text := 'authorization-v2-inactive-' || replace(v_inactive_user_id::text, '-', '') || '@invalid.local';
begin
  select position_row.id
    into v_position_id
  from public.hrm_positions position_row
  where position_row.is_active
  order by position_row.created_at
  limit 1;

  if v_position_id is null then
    raise exception 'AUTH_V2_SMOKE_ACTIVE_POSITION_REQUIRED';
  end if;

  insert into public.users (
    id, name, email, username, role, is_active, account_status
  ) values
    (
      v_active_user_id, 'Authorization V2 Active Smoke',
      v_active_email, 'auth-v2-active-' || replace(v_active_user_id::text, '-', ''),
      'EMPLOYEE', true, 'ACTIVE'
    ),
    (
      v_inactive_user_id, 'Authorization V2 Inactive Smoke',
      v_inactive_email, 'auth-v2-inactive-' || replace(v_inactive_user_id::text, '-', ''),
      'EMPLOYEE', false, 'DISABLED'
    );

  insert into public.projects (id, code, name, status)
  values
    (v_project_a, 'AUTH-V2-A-' || left(v_project_a, 12), 'Authorization V2 Project A', 'active'),
    (v_project_b, 'AUTH-V2-B-' || left(v_project_b, 12), 'Authorization V2 Project B', 'active');

  insert into public.project_staff (
    id, user_id, position_id, project_id, construction_site_id, start_date, end_date
  ) values (
    v_staff_id, v_active_user_id::text, v_position_id, v_project_a, null, current_date, null
  );

  insert into public.project_permission_room_members (
    id, project_id, construction_site_id, room_code, project_staff_id, is_active
  ) values (
    v_room_member_id, v_project_a, null, 'daily_log', v_staff_id, true
  );

  insert into public.project_permission_room_member_actions (
    room_member_id, action_code, is_active, grant_source
  ) values (
    v_room_member_id, 'view', true, 'manual_room'
  );

  insert into public.user_permission_grants (
    user_id, permission_code, scope_type, scope_id,
    is_active, granted_at, expires_at, grant_reason
  ) values
    (
      v_active_user_id, 'project.daily_log.view', 'project', v_project_a,
      true, now() - interval '1 hour', now() + interval '1 day', 'phase2 active smoke grant'
    ),
    (
      v_active_user_id, 'project.daily_log.view', 'project', v_project_b,
      true, now() - interval '2 days', now() - interval '1 day', 'phase2 expired smoke grant'
    );

  insert into authorization_v2_phase2_smoke_context values (
    v_active_user_id,
    v_active_auth_id,
    v_active_email,
    v_inactive_auth_id,
    v_inactive_email,
    v_project_a,
    v_project_b
  );
end;
$$;

do $$
declare
  v_context authorization_v2_phase2_smoke_context%rowtype;
  v_snapshot jsonb;
begin
  select * into v_context from authorization_v2_phase2_smoke_context;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_context.active_auth_id,
      'email', v_context.active_email,
      'role', 'authenticated'
    )::text,
    true
  );

  v_snapshot := public.get_my_authorization_snapshot();

  if not (v_snapshot ? 'generatedAt' and v_snapshot ? 'flags'
      and v_snapshot ? 'sources' and v_snapshot ? 'roomActions') then
    raise exception 'AUTH_V2_SMOKE_SNAPSHOT_SHAPE_INVALID';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_snapshot -> 'sources') source_row
    where source_row ->> 'permissionCode' = 'project.daily_log.view'
      and source_row ->> 'sourceType' = 'DIRECT'
      and source_row ->> 'scopeType' = 'project'
      and source_row ->> 'scopeId' = v_context.project_a
  ) then
    raise exception 'AUTH_V2_SMOKE_ACTIVE_SOURCE_MISSING';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_snapshot -> 'sources') source_row
    where source_row ->> 'permissionCode' = 'project.daily_log.view'
      and source_row ->> 'sourceType' = 'DIRECT'
      and source_row ->> 'scopeId' = v_context.project_b
  ) then
    raise exception 'AUTH_V2_SMOKE_EXPIRED_SOURCE_INCLUDED';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_snapshot -> 'roomActions') action_row
    where action_row ->> 'projectId' = v_context.project_a
      and action_row ->> 'roomCode' = 'daily_log'
      and action_row ->> 'actionCode' = 'view'
      and action_row ->> 'source' = 'room'
  ) then
    raise exception 'AUTH_V2_SMOKE_ROOM_ACTION_MISSING';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_snapshot -> 'roomActions') action_row
    where action_row ->> 'projectId' = v_context.project_b
  ) then
    raise exception 'AUTH_V2_SMOKE_ROOM_SCOPE_LEAK';
  end if;
end;
$$;

do $$
declare
  v_context authorization_v2_phase2_smoke_context%rowtype;
  v_blocked boolean := false;
begin
  select * into v_context from authorization_v2_phase2_smoke_context;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_context.inactive_auth_id,
      'email', v_context.inactive_email,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.get_my_authorization_snapshot();
  exception
    when insufficient_privilege then
      v_blocked := sqlerrm = 'Active application account required';
  end;

  if not v_blocked then
    raise exception 'AUTH_V2_SMOKE_INACTIVE_USER_NOT_BLOCKED';
  end if;
end;
$$;

select jsonb_build_object(
  'authorizationSnapshot', 'ok',
  'transaction', 'rollback'
) as authorization_v2_phase2_smoke;

rollback;
