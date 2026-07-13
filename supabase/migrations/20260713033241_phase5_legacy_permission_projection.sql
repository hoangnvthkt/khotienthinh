-- Phase 5 cleanup and hardening prep.
-- Keeps legacy fallback enabled by default until the Phase 5 readiness gate passes.

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;

create table if not exists app_private.permission_hardening_settings (
  key text primary key,
  value jsonb not null default 'false'::jsonb,
  updated_at timestamptz not null default now()
);

revoke all privileges on table app_private.permission_hardening_settings from public, anon, authenticated;

insert into app_private.permission_hardening_settings (key, value)
values
  ('legacy_projection_enabled', 'false'::jsonb),
  ('legacy_fallback_disabled', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function app_private.permission_hardening_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case jsonb_typeof(s.value)
        when 'boolean' then (s.value #>> '{}')::boolean
        when 'string' then (s.value #>> '{}')::boolean
        else false
      end
      from app_private.permission_hardening_settings s
      where s.key = p_key
      limit 1
    ),
    false
  );
$$;

revoke all on function app_private.permission_hardening_flag(text) from public;
revoke all on function app_private.permission_hardening_flag(text) from anon;
grant execute on function app_private.permission_hardening_flag(text) to authenticated;

create or replace function app_private.sync_legacy_permission_projection(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_before jsonb;
  v_after jsonb;
  v_allowed_modules text[] := '{}'::text[];
  v_admin_modules text[] := '{}'::text[];
  v_allowed_sub_modules jsonb := '{}'::jsonb;
  v_admin_sub_modules jsonb := '{}'::jsonb;
begin
  select jsonb_build_object(
    'allowed_modules', coalesce(u.allowed_modules, '{}'::text[]),
    'admin_modules', coalesce(u.admin_modules, '{}'::text[]),
    'allowed_sub_modules', coalesce(u.allowed_sub_modules, '{}'::jsonb),
    'admin_sub_modules', coalesce(u.admin_sub_modules, '{}'::jsonb)
  )
  into v_before
  from public.users u
  where u.id = p_user_id
  for update;

  if v_before is null then
    raise exception 'Target user does not exist'
      using errcode = '23503';
  end if;

  with active_grants as (
    select
      coalesce(pa.legacy_module_key, pm.legacy_module_key) as legacy_module_key,
      pa.legacy_route,
      (coalesce(pa.legacy_admin_only, false) or pa.action = 'manage') as is_admin_like
    from public.user_permission_grants g
    join public.permission_actions pa
      on pa.permission_code = g.permission_code
      and coalesce(pa.is_active, true)
    join public.permission_modules pm
      on pm.code = pa.module_code
      and coalesce(pm.is_active, true)
    where g.user_id = p_user_id
      and coalesce(g.is_active, false)
      and (g.expires_at is null or g.expires_at > now())
      and coalesce(pa.legacy_module_key, pm.legacy_module_key) is not null
  )
  select
    coalesce(array_agg(distinct legacy_module_key order by legacy_module_key) filter (where not is_admin_like), '{}'::text[]),
    coalesce(array_agg(distinct legacy_module_key order by legacy_module_key) filter (where is_admin_like), '{}'::text[])
  into v_allowed_modules, v_admin_modules
  from active_grants;

  with active_routes as (
    select distinct
      coalesce(pa.legacy_module_key, pm.legacy_module_key) as legacy_module_key,
      pa.legacy_route,
      (coalesce(pa.legacy_admin_only, false) or pa.action = 'manage') as is_admin_like
    from public.user_permission_grants g
    join public.permission_actions pa
      on pa.permission_code = g.permission_code
      and coalesce(pa.is_active, true)
    join public.permission_modules pm
      on pm.code = pa.module_code
      and coalesce(pm.is_active, true)
    where g.user_id = p_user_id
      and coalesce(g.is_active, false)
      and (g.expires_at is null or g.expires_at > now())
      and coalesce(pa.legacy_module_key, pm.legacy_module_key) is not null
      and pa.legacy_route is not null
  ),
  grouped_routes as (
    select
      legacy_module_key,
      is_admin_like,
      jsonb_agg(legacy_route order by legacy_route) as routes
    from active_routes
    group by legacy_module_key, is_admin_like
  )
  select
    coalesce(jsonb_object_agg(legacy_module_key, routes) filter (where not is_admin_like), '{}'::jsonb),
    coalesce(jsonb_object_agg(legacy_module_key, routes) filter (where is_admin_like), '{}'::jsonb)
  into v_allowed_sub_modules, v_admin_sub_modules
  from grouped_routes;

  v_after := jsonb_build_object(
    'allowed_modules', v_allowed_modules,
    'admin_modules', v_admin_modules,
    'allowed_sub_modules', v_allowed_sub_modules,
    'admin_sub_modules', v_admin_sub_modules
  );

  if v_before is distinct from v_after then
    update public.users
    set allowed_modules = v_allowed_modules,
        admin_modules = v_admin_modules,
        allowed_sub_modules = v_allowed_sub_modules,
        admin_sub_modules = v_admin_sub_modules
    where id = p_user_id;

    insert into public.permission_audit_events (
      actor_user_id,
      target_user_id,
      event_type,
      before_grants,
      after_grants,
      metadata
    )
    values (
      v_actor_user_id,
      p_user_id,
      'legacy_projection_synced',
      v_before,
      v_after,
      jsonb_build_object(
        'source', 'phase5_legacy_permission_projection',
        'legacy_event_alias', 'legacy_permission_projection_sync'
      )
    );
  end if;
end;
$$;

revoke all on function app_private.sync_legacy_permission_projection(uuid) from public;
revoke all on function app_private.sync_legacy_permission_projection(uuid) from anon;
grant execute on function app_private.sync_legacy_permission_projection(uuid) to authenticated;

create or replace function app_private.has_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with app_user as (
    select *
    from public.users u
    where u.id = p_user_id
      and coalesce(u.is_active, true)
    limit 1
  ),
  requested_action as (
    select pa.*, pm.legacy_module_key as module_legacy_key
    from public.permission_actions pa
    join public.permission_modules pm on pm.code = pa.module_code
    where pa.permission_code = p_permission_code
      and coalesce(pa.is_active, true)
      and coalesce(pm.is_active, true)
    limit 1
  )
  select exists (
    select 1
    from app_user u
    where u.role = 'ADMIN'
  )
  or exists (
    select 1
    from public.user_permission_grants g
    join app_user u on u.id = g.user_id
    where g.permission_code = p_permission_code
      and coalesce(g.is_active, false)
      and (g.expires_at is null or g.expires_at > now())
      and (
        g.scope_type = 'global'
        or (
          g.scope_type = coalesce(p_scope_type, 'global')
          and (g.scope_id = '*' or g.scope_id = coalesce(p_scope_id, '*'))
        )
      )
  )
  or (
    not app_private.permission_hardening_flag('legacy_fallback_disabled')
    and exists (
      select 1
      from app_user u
      join requested_action a on true
      where coalesce(a.legacy_module_key, a.module_legacy_key) is not null
        and (
          case
            when coalesce(a.legacy_admin_only, false) or a.action = 'manage' then
              coalesce(a.legacy_module_key, a.module_legacy_key) = any(coalesce(u.admin_modules, '{}'::text[]))
              or (
                a.legacy_route is null
                and coalesce(u.admin_sub_modules, '{}'::jsonb) ? coalesce(a.legacy_module_key, a.module_legacy_key)
              )
              or (
                a.legacy_route is not null
                and coalesce(u.admin_sub_modules -> coalesce(a.legacy_module_key, a.module_legacy_key), '[]'::jsonb) ? a.legacy_route
              )
            else
              u.allowed_modules is null
              or coalesce(a.legacy_module_key, a.module_legacy_key) = any(coalesce(u.allowed_modules, '{}'::text[]))
              or coalesce(a.legacy_module_key, a.module_legacy_key) = any(coalesce(u.admin_modules, '{}'::text[]))
              or (
                a.legacy_route is null
                and (
                  coalesce(u.allowed_sub_modules, '{}'::jsonb) ? coalesce(a.legacy_module_key, a.module_legacy_key)
                  or coalesce(u.admin_sub_modules, '{}'::jsonb) ? coalesce(a.legacy_module_key, a.module_legacy_key)
                )
              )
              or (
                a.legacy_route is not null
                and (
                  coalesce(u.allowed_sub_modules -> coalesce(a.legacy_module_key, a.module_legacy_key), '[]'::jsonb) ? a.legacy_route
                  or coalesce(u.admin_sub_modules -> coalesce(a.legacy_module_key, a.module_legacy_key), '[]'::jsonb) ? a.legacy_route
                )
              )
          end
        )
    )
  );
$$;

revoke all on function app_private.has_permission(uuid, text, text, text) from public;
revoke all on function app_private.has_permission(uuid, text, text, text) from anon;
grant execute on function app_private.has_permission(uuid, text, text, text) to authenticated;

create or replace function public.replace_user_permission_grants(
  p_user_id uuid,
  p_grants jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_before jsonb;
  v_after jsonb := coalesce(p_grants, '[]'::jsonb);
begin
  if not app_private.can_manage_permissions() then
    raise exception 'Not allowed to manage permissions'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_after) <> 'array' then
    raise exception 'Permission grants payload must be an array'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = p_user_id
  ) then
    raise exception 'Target user does not exist'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_after) as grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    left join public.permission_actions pa
      on pa.permission_code = grant_row.permission_code
      and coalesce(pa.is_active, true)
    where coalesce(grant_row.is_active, true)
      and (
        pa.permission_code is null
        or not coalesce(nullif(grant_row.scope_type, ''), 'global') = any(pa.scope_modes)
      )
  ) then
    raise exception 'Permission grant payload contains unknown permission code or unsupported scope'
      using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.permission_code, g.scope_type, g.scope_id), '[]'::jsonb)
  into v_before
  from public.user_permission_grants g
  where g.user_id = p_user_id;

  delete from public.user_permission_grants
  where user_id = p_user_id;

  insert into public.user_permission_grants (
    user_id,
    permission_code,
    scope_type,
    scope_id,
    is_active,
    granted_by,
    granted_at,
    expires_at
  )
  select
    p_user_id,
    grant_row.permission_code,
    coalesce(nullif(grant_row.scope_type, ''), 'global'),
    coalesce(nullif(grant_row.scope_id, ''), '*'),
    coalesce(grant_row.is_active, true),
    v_actor_user_id,
    now(),
    grant_row.expires_at
  from jsonb_to_recordset(v_after) as grant_row(
    permission_code text,
    scope_type text,
    scope_id text,
    is_active boolean,
    expires_at timestamptz
  )
  where coalesce(grant_row.is_active, true)
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = excluded.is_active,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      updated_at = now();

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    p_user_id,
    'replace_user_permission_grants',
    v_before,
    (
      select coalesce(jsonb_agg(to_jsonb(g) order by g.permission_code, g.scope_type, g.scope_id), '[]'::jsonb)
      from public.user_permission_grants g
      where g.user_id = p_user_id
    ),
    jsonb_build_object('source', 'phase5_legacy_permission_projection')
  );

  if app_private.permission_hardening_flag('legacy_projection_enabled') then
    perform app_private.sync_legacy_permission_projection(p_user_id);
  end if;
end;
$$;

revoke all on function public.replace_user_permission_grants(uuid, jsonb) from public;
revoke all on function public.replace_user_permission_grants(uuid, jsonb) from anon;
grant execute on function public.replace_user_permission_grants(uuid, jsonb) to authenticated;

create or replace function public.get_permission_health_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_broad_policies jsonb := '[]'::jsonb;
  v_anon_crud jsonb := '[]'::jsonb;
  v_sensitive_without_rls jsonb := '[]'::jsonb;
  v_non_namespaced_actions jsonb := '[]'::jsonb;
  v_legacy_admin_consumers jsonb := '[]'::jsonb;
  v_tables_with_legacy_columns jsonb := '[]'::jsonb;
  v_projects_without_scoped_grants jsonb := '[]'::jsonb;
  v_warehouses_without_scoped_grants jsonb := '[]'::jsonb;
  v_status text := 'ok';
begin
  if not app_private.can_manage_permissions() then
    raise exception 'Not allowed to view permission health'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'schema', p.schemaname,
      'table', p.tablename,
      'policy', p.policyname,
      'command', p.cmd,
      'qual', p.qual,
      'withCheck', p.with_check,
      'severity', 'high'
    )
    order by p.schemaname, p.tablename, p.policyname
  ), '[]'::jsonb)
  into v_broad_policies
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename <> all(array[
      'app_release_notices',
      'permission_applications',
      'permission_modules',
      'permission_actions'
    ])
    and (
      lower(trim(coalesce(p.qual, ''))) in ('true', '(true)')
      or lower(trim(coalesce(p.with_check, ''))) in ('true', '(true)')
    );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'schema', g.table_schema,
      'table', g.table_name,
      'privilege', g.privilege_type,
      'severity', 'critical'
    )
    order by g.table_schema, g.table_name, g.privilege_type
  ), '[]'::jsonb)
  into v_anon_crud
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.grantee = 'anon'
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'severity', 'critical'
    )
    order by n.nspname, c.relname
  ), '[]'::jsonb)
  into v_sensitive_without_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
    and c.relname <> all(array[
      'schema_migrations',
      'spatial_ref_sys'
    ])
    and (
      c.relname ~ '(user|permission|employee|payroll|attendance|transaction|request|asset|contract|payment|expense|workflow|warehouse)'
    );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'permissionCode', pa.permission_code,
      'moduleCode', pa.module_code,
      'severity', 'medium'
    )
    order by pa.permission_code
  ), '[]'::jsonb)
  into v_non_namespaced_actions
  from public.permission_actions pa
  where coalesce(pa.is_active, true)
    and (
      pa.permission_code = any(array['view','edit','delete','approve','verify','confirm','submit','manage'])
      or pa.permission_code !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
    );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'schema', n.nspname,
      'function', p.proname,
      'identityArguments', pg_get_function_identity_arguments(p.oid),
      'severity', 'medium'
    )
    order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  ), '[]'::jsonb)
  into v_legacy_admin_consumers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private')
    and p.prokind in ('f', 'p')
    and p.proname <> 'is_module_admin'
    and pg_get_functiondef(p.oid) ilike '%is_module_admin%';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'schema', c.table_schema,
      'table', c.table_name,
      'columns', c.columns,
      'severity', 'info'
    )
    order by c.table_schema, c.table_name
  ), '[]'::jsonb)
  into v_tables_with_legacy_columns
  from (
    select
      table_schema,
      table_name,
      jsonb_agg(column_name order by column_name) as columns
    from information_schema.columns
    where table_schema = 'public'
      and column_name in ('allowed_modules','admin_modules','allowed_sub_modules','admin_sub_modules')
    group by table_schema, table_name
  ) c;

  if to_regclass('public.projects') is not null then
    execute $q$
      select coalesce(jsonb_agg(
        jsonb_build_object('projectId', p.id, 'severity', 'low')
        order by p.id
      ), '[]'::jsonb)
      from (
        select p.id
        from public.projects p
        where not exists (
          select 1
          from public.user_permission_grants g
          where g.scope_type = 'project'
            and g.scope_id = p.id::text
            and g.permission_code like 'project.%'
            and coalesce(g.is_active, false)
            and (g.expires_at is null or g.expires_at > now())
        )
        order by p.id
        limit 50
      ) p
    $q$
    into v_projects_without_scoped_grants;
  end if;

  if to_regclass('public.warehouses') is not null then
    execute $q$
      select coalesce(jsonb_agg(
        jsonb_build_object('warehouseId', w.id, 'severity', 'low')
        order by w.id
      ), '[]'::jsonb)
      from (
        select w.id
        from public.warehouses w
        where not exists (
          select 1
          from public.user_permission_grants g
          where g.scope_type = 'warehouse'
            and g.scope_id = w.id::text
            and coalesce(g.is_active, false)
            and (g.expires_at is null or g.expires_at > now())
        )
        order by w.id
        limit 50
      ) w
    $q$
    into v_warehouses_without_scoped_grants;
  end if;

  if jsonb_array_length(v_anon_crud) > 0 or jsonb_array_length(v_sensitive_without_rls) > 0 then
    v_status := 'critical';
  elsif jsonb_array_length(v_broad_policies) > 0
    or jsonb_array_length(v_non_namespaced_actions) > 0
    or jsonb_array_length(v_legacy_admin_consumers) > 0 then
    v_status := 'warning';
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'status', v_status,
    'legacyProjectionEnabled', app_private.permission_hardening_flag('legacy_projection_enabled'),
    'legacyFallbackDisabled', app_private.permission_hardening_flag('legacy_fallback_disabled'),
    'checks', jsonb_build_object(
      'unmappedRoutes', '[]'::jsonb,
      'broadPolicies', v_broad_policies,
      'anonCrudGrants', v_anon_crud,
      'sensitiveTablesWithoutRls', v_sensitive_without_rls,
      'nonNamespacedPermissionActions', v_non_namespaced_actions,
      'legacyAdminFunctionConsumers', v_legacy_admin_consumers,
      'legacyProjectionColumns', v_tables_with_legacy_columns,
      'projectsWithoutScopedGrants', v_projects_without_scoped_grants,
      'warehousesWithoutScopedGrants', v_warehouses_without_scoped_grants,
      'departmentsWithoutScopedGrants', '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.get_permission_health_summary() from public;
revoke all on function public.get_permission_health_summary() from anon;
grant execute on function public.get_permission_health_summary() to authenticated;

comment on function public.is_module_admin(text) is
  'Deprecated Phase 5 compatibility helper. New permission decisions must use namespace grants; remaining consumers are reported by public.get_permission_health_summary().';

notify pgrst, 'reload schema';
