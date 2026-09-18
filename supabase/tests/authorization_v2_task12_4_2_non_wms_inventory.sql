-- E23 read-only inventory for active non-WMS system permission cohorts.
-- The result is aggregate evidence only: no user IDs, names, emails, secrets,
-- payroll rows, or business-document data are returned.
with active_accounts as (
  select role::text as persona, count(*)::integer as total
  from public.users
  where is_active and account_status = 'ACTIVE'
  group by role::text
), active_system_sources as (
  select
    grant_row.permission_code,
    grant_row.scope_type,
    grant_row.scope_id,
    user_row.role::text as persona
  from public.user_permission_grants grant_row
  join public.users user_row on user_row.id = grant_row.user_id
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
    and grant_row.permission_code like 'system.%'
    and grant_row.permission_code not like 'system.wms.%'
), system_source_personas as (
  select permission_code, scope_type, scope_id, persona, count(*)::integer as total
  from active_system_sources
  group by permission_code, scope_type, scope_id, persona
), system_source_summary as (
  select
    permission_code,
    scope_type,
    case when scope_id = '*' then '*' else '<scoped>' end as scope_id,
    sum(total)::integer as total,
    jsonb_object_agg(persona, total order by persona) as personas
  from system_source_personas
  group by permission_code, scope_type, scope_id
), active_assignment_personas as (
  select
    template.code,
    assignment.scope_type,
    user_row.role::text as persona,
    count(*)::integer as total
  from public.principal_role_assignments assignment
  join public.role_permission_templates template
    on template.id = assignment.role_template_id
  join public.users user_row
    on assignment.principal_type = 'user'
   and user_row.id = assignment.principal_id
  where assignment.status = 'ACTIVE'
    and (assignment.expires_at is null or assignment.expires_at > now())
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
  group by template.code, assignment.scope_type, user_row.role::text
), active_assignment_summary as (
  select
    code,
    scope_type,
    sum(total)::integer as total,
    jsonb_object_agg(persona, total order by persona) as personas
  from active_assignment_personas
  group by code, scope_type
), room_personas as (
  select
    user_row.role::text as persona,
    member.room_code,
    count(distinct member.id)::integer as memberships,
    count(action.action_code)::integer as active_actions
  from public.project_permission_room_members member
  join public.project_staff staff on staff.id = member.project_staff_id
  join public.users user_row on user_row.id::text = staff.user_id
  left join public.project_permission_room_member_actions action
    on action.room_member_id = member.id
   and action.is_active
  where member.is_active
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
  group by user_row.role::text, member.room_code
), workspace_personas as (
  select
    user_row.role::text as persona,
    member.role as workspace_role,
    count(*)::integer as memberships
  from public.work_workspace_members member
  join public.users user_row on user_row.id = member.user_id
  where upper(member.status) = 'ACTIVE'
    and (member.starts_at is null or member.starts_at <= now())
    and (member.expires_at is null or member.expires_at > now())
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
  group by user_row.role::text, member.role
), function_hits as (
  select distinct
    match_row[1] as module_key,
    namespace.nspname || '.' || procedure.proname || '('
      || pg_get_function_identity_arguments(procedure.oid) || ')' as object_name
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join lateral regexp_matches(
    pg_get_functiondef(procedure.oid),
    '(?:is_module_admin|can_access_module)\s*\(\s*''([^'']+)''',
    'gi'
  ) match_row
  where namespace.nspname in ('public', 'app_private')
    and procedure.prokind = 'f'
), policy_hits as (
  select distinct
    match_row[1] as module_key,
    policy.schemaname || '.' || policy.tablename || '.' || policy.policyname as object_name
  from pg_policies policy
  cross join lateral regexp_matches(
    coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, ''),
    '(?:is_module_admin|can_access_module)\s*\(\s*''([^'']+)''',
    'gi'
  ) match_row
  where policy.schemaname in ('public', 'storage')
), non_wms_module_keys as (
  select module_key from function_hits where module_key <> 'WMS'
  union
  select module_key from policy_hits where module_key <> 'WMS'
), runtime_consumer_summary as (
  select
    key_row.module_key,
    (select count(*)::integer from function_hits hit
      where hit.module_key = key_row.module_key) as functions,
    (select count(*)::integer from policy_hits hit
      where hit.module_key = key_row.module_key) as policies,
    coalesce((
      select jsonb_agg(hit.object_name order by hit.object_name)
      from function_hits hit where hit.module_key = key_row.module_key
    ), '[]'::jsonb) as function_names,
    coalesce((
      select jsonb_agg(hit.object_name order by hit.object_name)
      from policy_hits hit where hit.module_key = key_row.module_key
    ), '[]'::jsonb) as policy_names
  from non_wms_module_keys key_row
), catalog as (
  select
    action.permission_code,
    action.module_code,
    action.action,
    action.risk_level,
    action.grant_readiness,
    action.direct_grant_allowed,
    action.direct_grant_requires_expiry,
    action.legacy_module_key,
    action.access_application_code
  from public.permission_actions action
  where action.is_active
    and action.permission_code like 'system.%'
    and action.permission_code not like 'system.wms.%'
)
select jsonb_build_object(
  'capturedAt', now(),
  'activeAccounts', coalesce((
    select jsonb_agg(to_jsonb(row_value) order by persona)
    from active_accounts row_value
  ), '[]'::jsonb),
  'hardeningFlags', coalesce((
    select jsonb_object_agg(setting.key, setting.value order by setting.key)
    from app_private.permission_hardening_settings setting
    where setting.key in (
      'legacy_fallback_disabled',
      'legacy_governance_fallback_disabled',
      'legacy_projection_enabled',
      'legacy_permission_writes_disabled'
    )
  ), '{}'::jsonb),
  'transitionLedger', jsonb_build_object(
    'batches', (select count(*)::integer from app_private.authorization_transition_batches),
    'items', (select count(*)::integer from app_private.authorization_transition_items)
  ),
  'systemSources', coalesce((
    select jsonb_agg(to_jsonb(row_value) order by permission_code, scope_type, scope_id)
    from system_source_summary row_value
  ), '[]'::jsonb),
  'roleAssignments', coalesce((
    select jsonb_agg(to_jsonb(row_value) order by code, scope_type)
    from active_assignment_summary row_value
  ), '[]'::jsonb),
  'roomPersonas', coalesce((
    select jsonb_agg(to_jsonb(row_value) order by persona, room_code)
    from room_personas row_value
  ), '[]'::jsonb),
  'workspacePersonas', coalesce((
    select jsonb_agg(to_jsonb(row_value) order by persona, workspace_role)
    from workspace_personas row_value
  ), '[]'::jsonb),
  'runtimeConsumers', coalesce((
    select jsonb_agg(to_jsonb(row_value) order by module_key)
    from runtime_consumer_summary row_value
  ), '[]'::jsonb),
  'catalog', coalesce((
    select jsonb_agg(to_jsonb(row_value) order by permission_code)
    from catalog row_value
  ), '[]'::jsonb)
) as inventory;
