with policy_rows as (
  select
    'policy'::text as section,
    format('%I.%I.%I', schemaname, tablename, policyname) as entity,
    jsonb_build_object(
      'command', cmd,
      'permissive', permissive,
      'roles', roles,
      'qual', qual,
      'with_check', with_check
    ) as metadata
  from pg_policies
  where schemaname in ('public', 'storage')
    and 'authenticated' = any(roles)
),
function_rows as (
  select
    'security_definer'::text as section,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as entity,
    jsonb_build_object(
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'active_chain', lower(pg_get_functiondef(p.oid)) ~
        'current_app_user_id|is_admin\(|is_module_admin\(|has_permission|can_access_module'
    ) as metadata
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private')
    and p.prosecdef
),
setting_row as (
  select
    'postgrest_setting'::text as section,
    'authenticator.pgrst.db_pre_request'::text as entity,
    jsonb_build_object(
      'settings', coalesce(array_to_json(s.setconfig)::jsonb, '[]'::jsonb)
    ) as metadata
  from pg_db_role_setting s
  join pg_roles r on r.oid = s.setrole
  where r.rolname = 'authenticator'
)
select section, entity, metadata from policy_rows
union all
select section, entity, metadata from function_rows
union all
select section, entity, metadata from setting_row
order by section, entity;
