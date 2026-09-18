-- Read-only, aggregate inventory. No names, emails, credentials or business rows.
-- CLI returns the final SELECT; keep all sections in one JSON object.
with accounts as (
  select account_status, count(*) as total from public.users group by account_status
), grants as (
  select g.permission_code, g.scope_type, g.is_active,
    (g.expires_at is not null and g.expires_at <= now()) as expired,
    u.account_status, count(*) as total
  from public.user_permission_grants g join public.users u on u.id = g.user_id
  where g.permission_code like 'system.%'
  group by 1,2,3,4,5
), assignments as (
  select t.code, a.status, a.scope_type,
    (a.expires_at is not null and a.expires_at <= now()) as expired,
    count(*) as total
  from public.principal_role_assignments a
  join public.role_permission_templates t on t.id = a.role_template_id
  group by 1,2,3,4
), settings_policies as (
  select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies where schemaname = 'public' and tablename = any(array[
    'app_settings','warehouses','warehouse_types','items','categories','units',
    'suppliers','loss_norms','users','hrm_work_groups','hrm_construction_sites'
  ])
), runtime_legacy_functions as (
  select n.nspname as schema, p.proname as name,
    pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.prokind='f'
    and p.prosrc ~ '\m(allowed_modules|admin_modules|allowed_sub_modules|admin_sub_modules)\M'
)
select jsonb_build_object(
  'capturedAt', now(),
  'accounts', (select jsonb_agg(to_jsonb(a) order by account_status) from accounts a),
  'grants', (select jsonb_agg(to_jsonb(g) order by permission_code,scope_type,account_status,is_active,expired) from grants g),
  'roleAssignments', (select jsonb_agg(to_jsonb(a) order by code,scope_type,status,expired) from assignments a),
  'settingsPolicies', (select jsonb_agg(to_jsonb(p) order by tablename,policyname) from settings_policies p),
  'legacyFunctions', (select jsonb_agg(to_jsonb(f) order by schema,name,arguments) from runtime_legacy_functions f),
  'applications', (select jsonb_agg(jsonb_build_object('code',code,'active',is_active,'assignable',member_assignable) order by code) from public.permission_applications),
  'settingsActions', (select jsonb_agg(jsonb_build_object('code',permission_code,'module',module_code,'scopes',scope_modes,'active',is_active,'directAllowed',direct_grant_allowed,'expiryRequired',direct_grant_requires_expiry) order by permission_code) from public.permission_actions where access_application_code='settings'),
  'notificationLedger', (select jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'bodyMd5',md5(array_to_string(statements,E'\n'))) order by version) from supabase_migrations.schema_migrations where version like '20260912%')
) as inventory;
