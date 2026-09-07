begin;

create temporary table work_permission_smoke_context (
  admin_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  pilot_id uuid not null,
  pilot_auth_id uuid not null,
  pilot_email text not null,
  shared_scope_id text not null
) on commit drop;

do $$
declare
  v_admin_id uuid := gen_random_uuid();
  v_pilot_id uuid := gen_random_uuid();
  v_admin_auth_id uuid := gen_random_uuid();
  v_pilot_auth_id uuid := gen_random_uuid();
  v_admin_email text := 'work-admin-' || replace(v_admin_id::text, '-', '') || '@invalid.local';
  v_pilot_email text := 'work-pilot-' || replace(v_pilot_id::text, '-', '') || '@invalid.local';
  v_shared_scope_id text := gen_random_uuid()::text;
begin
  insert into public.users (
    id, name, email, username, role, is_active, account_status
  ) values
    (
      v_admin_id, 'Work Technical Admin Smoke', v_admin_email,
      'work-admin-' || replace(v_admin_id::text, '-', ''),
      'ADMIN', true, 'ACTIVE'
    ),
    (
      v_pilot_id, 'Work Pilot Smoke', v_pilot_email,
      'work-pilot-' || replace(v_pilot_id::text, '-', ''),
      'EMPLOYEE', true, 'ACTIVE'
    );

  insert into public.user_permission_grants (
    user_id, permission_code, scope_type, scope_id,
    is_active, granted_at, grant_reason
  ) values
    (
      v_pilot_id, 'work.module.access', 'global', '*',
      true, now(), 'Work permission rollback smoke'
    ),
    (
      v_pilot_id, 'work.task.view_scope', 'department', v_shared_scope_id,
      true, now(), 'Work scope isolation rollback smoke'
    );

  insert into work_permission_smoke_context values (
    v_admin_id,
    v_admin_auth_id,
    v_admin_email,
    v_pilot_id,
    v_pilot_auth_id,
    v_pilot_email,
    v_shared_scope_id
  );
end;
$$;

do $$
declare
  v_context work_permission_smoke_context%rowtype;
  v_snapshot jsonb;
begin
  select * into v_context from work_permission_smoke_context;

  if (select count(*) from public.permission_applications where code = 'work' and is_active) <> 1 then
    raise exception 'WORK_PERMISSION_SMOKE_APPLICATION_INVALID';
  end if;
  if (select count(*) from public.permission_modules where application_code = 'work' and is_active) <> 2 then
    raise exception 'WORK_PERMISSION_SMOKE_MODULE_COUNT_INVALID';
  end if;
  if (select count(*) from public.permission_actions where permission_code like 'work.%' and is_active) <> 11 then
    raise exception 'WORK_PERMISSION_SMOKE_ACTION_COUNT_INVALID';
  end if;
  if exists (
    select 1
    from public.permission_modules
    where application_code = 'work' and legacy_module_key is not null
    union all
    select 1
    from public.permission_actions
    where permission_code like 'work.%'
      and (legacy_module_key is not null or legacy_route is not null)
  ) then
    raise exception 'WORK_PERMISSION_SMOKE_LEGACY_ALIAS_FOUND';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.admin_auth_id,
    'email', v_context.admin_email,
    'role', 'authenticated'
  )::text, true);

  if app_private.has_permission(v_context.admin_id, 'work.module.access', 'global', '*') then
    raise exception 'WORK_PERMISSION_SMOKE_TECHNICAL_ADMIN_BYPASS';
  end if;

  v_snapshot := public.get_my_authorization_snapshot();
  if exists (
    select 1
    from jsonb_array_elements(v_snapshot -> 'sources') source_row
    where source_row ->> 'permissionCode' like 'work.%'
      and upper(source_row ->> 'sourceType') = 'LEGACY'
  ) then
    raise exception 'WORK_PERMISSION_SMOKE_LEGACY_SNAPSHOT_SOURCE';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.pilot_auth_id,
    'email', v_context.pilot_email,
    'role', 'authenticated'
  )::text, true);

  if not app_private.has_permission(v_context.pilot_id, 'work.module.access', 'global', '*') then
    raise exception 'WORK_PERMISSION_SMOKE_CANONICAL_GRANT_MISSING';
  end if;
  if not app_private.has_permission(
    v_context.pilot_id,
    'work.task.view_scope',
    'department',
    v_context.shared_scope_id
  ) then
    raise exception 'WORK_PERMISSION_SMOKE_DEPARTMENT_GRANT_MISSING';
  end if;
  if app_private.has_permission(
    v_context.pilot_id,
    'work.task.view_scope',
    'project',
    v_context.shared_scope_id
  ) then
    raise exception 'WORK_PERMISSION_SMOKE_SCOPE_TYPE_LEAK';
  end if;

  v_snapshot := public.get_my_authorization_snapshot();
  if not exists (
    select 1
    from jsonb_array_elements(v_snapshot -> 'sources') source_row
    where source_row ->> 'permissionCode' = 'work.module.access'
      and source_row ->> 'sourceType' = 'DIRECT'
  ) then
    raise exception 'WORK_PERMISSION_SMOKE_DIRECT_SOURCE_MISSING';
  end if;
end;
$$;

select jsonb_build_object(
  'workPermissionRegistry', 'ok',
  'technicalAdminBypass', 'denied',
  'scopeIsolation', 'ok',
  'transaction', 'rollback'
) as work_permission_registry_smoke;

rollback;
