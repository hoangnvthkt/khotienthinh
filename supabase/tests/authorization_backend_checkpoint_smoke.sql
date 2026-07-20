do $$
declare
  v_public_definers integer;
  v_public_actor_parameters integer;
  v_private_missing_search_path integer;
begin
  select count(*)
  into v_public_definers
  from pg_proc function_row
  join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.proname in (
      'preview_business_role_change',
      'save_business_role',
      'preview_business_role_assignment',
      'assign_business_role',
      'revoke_business_role_assignment',
      'list_authorization_principals',
      'set_authorization_rollout_flags',
      'preview_direct_grant_replacement',
      'replace_user_permission_grants_v2',
      'record_authorization_override'
    )
    and function_row.prosecdef;

  select count(*)
  into v_public_actor_parameters
  from pg_proc function_row
  join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.proname in (
      'preview_business_role_change',
      'save_business_role',
      'preview_business_role_assignment',
      'assign_business_role',
      'revoke_business_role_assignment',
      'list_authorization_principals',
      'set_authorization_rollout_flags',
      'preview_direct_grant_replacement',
      'replace_user_permission_grants_v2',
      'record_authorization_override'
    )
    and pg_get_function_arguments(function_row.oid) ilike '%p_actor%';

  select count(*)
  into v_private_missing_search_path
  from pg_proc function_row
  join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'app_private'
    and function_row.proname in (
      'assert_authorization_permission',
      'assert_and_record_sod_warnings',
      'save_business_role_impl',
      'assign_business_role_impl',
      'revoke_business_role_assignment_impl',
      'set_authorization_rollout_flags_impl',
      'replace_user_permission_grants_v2_impl',
      'revoke_business_roles_on_account_disable',
      'record_authorization_override_impl',
      'has_valid_authorization_override'
    )
    and function_row.prosecdef
    and not exists (
      select 1
      from unnest(coalesce(function_row.proconfig, '{}'::text[])) config(value)
      where config.value like 'search_path=%'
    );

  if v_public_definers <> 0
    or v_public_actor_parameters <> 0
    or v_private_missing_search_path <> 0
  then
    raise exception 'Authorization RPC boundary inventory failed';
  end if;

  if has_function_privilege(
    'authenticated',
    'app_private.assert_authorization_permission(text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'app_private.assert_and_record_sod_warnings(jsonb,jsonb,text,uuid,uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'app_private.assert_rollout_operator_continuity(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'app_private.has_valid_authorization_override(uuid,text,uuid,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated can execute an owner-only authorization helper';
  end if;

  if has_table_privilege('authenticated', 'public.principal_role_assignments', 'INSERT')
    or has_table_privilege('authenticated', 'public.principal_role_assignments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.principal_role_assignments', 'DELETE')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'INSERT')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'UPDATE')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'DELETE')
    or has_table_privilege('authenticated', 'public.permission_audit_events', 'INSERT')
    or has_table_privilege('authenticated', 'public.authorization_sod_warning_acceptances', 'INSERT')
    or has_table_privilege('authenticated', 'public.authorization_override_events', 'INSERT')
  then
    raise exception 'Authenticated retains a direct authorization mutation path';
  end if;
end;
$$;

create temporary table phase2_backend_checkpoint_ids (
  permission_admin_id uuid not null,
  target_id uuid not null,
  permission_admin_email text not null
) on commit drop;

grant select on phase2_backend_checkpoint_ids to authenticated;

insert into phase2_backend_checkpoint_ids
select
  gen_random_uuid(),
  gen_random_uuid(),
  'phase2-checkpoint-pa-' || gen_random_uuid()::text || '@vioo.local';

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select permission_admin_id, 'Phase 2 Checkpoint Admin', permission_admin_email,
       'phase2-checkpoint-pa', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_backend_checkpoint_ids
union all
select target_id, 'Phase 2 Checkpoint Target',
       'phase2-checkpoint-target-' || gen_random_uuid()::text || '@vioo.local',
       'phase2-checkpoint-target', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_backend_checkpoint_ids;

insert into public.principal_role_assignments (
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  starts_at, status, assigned_reason
)
select 'user', permission_admin_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Backend checkpoint Permission Admin fixture'
from phase2_backend_checkpoint_ids
join public.role_permission_templates role_row on role_row.code = 'PERMISSION_ADMIN';

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active,
  granted_at, expires_at, grant_reason
)
select target_id, 'project.material_po.create', 'project', 'project-expired', true,
       now() - interval '2 days', now() - interval '1 day',
       'Expired active row for backend checkpoint'
from phase2_backend_checkpoint_ids;

update app_private.permission_hardening_settings
set value = 'true'::jsonb,
    updated_at = now()
where key in (
  'business_role_resolver_enabled',
  'legacy_governance_fallback_disabled'
);

set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select permission_admin_email from phase2_backend_checkpoint_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.replace_user_permission_grants_v2(
      (select target_id from phase2_backend_checkpoint_ids),
      '[]'::jsonb,
      'short',
      '[]'::jsonb
    );
  exception
    when invalid_parameter_value then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Expired active direct grant was treated as a no-op';
  end if;

  perform public.replace_user_permission_grants_v2(
    (select target_id from phase2_backend_checkpoint_ids),
    '[]'::jsonb,
    'Revoke expired active direct grant with audit history',
    '[]'::jsonb
  );
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.user_id = (select target_id from phase2_backend_checkpoint_ids)
      and grant_row.permission_code = 'project.material_po.create'
      and not grant_row.is_active
      and grant_row.revoked_at is not null
      and grant_row.revoked_reason is not null
  ) then
    raise exception 'Expired active direct-grant history was not revoked';
  end if;
end;
$$;
