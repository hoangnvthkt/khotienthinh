with active_users as (
  select
    user_row.id,
    user_row.role,
    user_row.allowed_modules,
    user_row.allowed_sub_modules,
    user_row.admin_modules,
    user_row.admin_sub_modules
  from public.users user_row
  where user_row.is_active
    and user_row.account_status = 'ACTIVE'
),
active_grants as (
  select grant_row.*
  from public.user_permission_grants grant_row
  join active_users user_row on user_row.id = grant_row.user_id
  where grant_row.is_active
    and grant_row.granted_at <= now()
    and (grant_row.expires_at is null or grant_row.expires_at > now())
),
effective_sources as materialized (
  select
    user_row.id as user_id,
    source_row.permission_code,
    source_row.source_type
  from active_users user_row
  cross join lateral app_private.resolve_effective_permission_sources(
    user_row.id,
    null,
    null,
    null,
    now()
  ) source_row
),
collision_counts as (
  select
    count(*) filter (where source_types @> array['LEGACY', 'DIRECT']) as legacy_direct,
    count(*) filter (where source_types @> array['LEGACY', 'ROLE']) as legacy_role
  from (
    select user_id, permission_code, array_agg(distinct source_type) as source_types
    from effective_sources
    group by user_id, permission_code
  ) grouped_sources
),
room_summary as (
  select
    count(distinct binding.room_code) as room_count,
    count(*) filter (where binding.enforcement_status = 'audit_only') as audit_only_actions,
    count(*) filter (where binding.enforcement_status = 'pilot') as pilot_actions,
    count(*) filter (where binding.enforcement_status = 'enforced') as enforced_actions,
    count(*) filter (
      where binding.pbac_fallback_enabled
        and binding.enforcement_status = 'audit_only'
    ) as fallback_only
  from app_private.project_permission_room_action_bindings binding
),
stale_members as (
  select count(*) as total
  from public.project_permission_room_members member_row
  join public.project_staff staff_row on staff_row.id = member_row.project_staff_id
  where member_row.is_active
    and staff_row.end_date is not null
    and staff_row.end_date < current_date
),
flags as (
  select coalesce(jsonb_object_agg(setting_row.key, setting_row.value), '{}'::jsonb) as value
  from app_private.permission_hardening_settings setting_row
)
select jsonb_build_object(
  'users', jsonb_build_object(
    'active', (select count(*) from active_users),
    'withLegacyColumns', (
      select count(*)
      from active_users
      where allowed_modules is not null
         or allowed_sub_modules is not null
         or admin_modules is not null
         or admin_sub_modules is not null
    ),
    'legacyOnlyEmployees', (
      select count(*)
      from active_users user_row
      where user_row.role = 'EMPLOYEE'
        and not exists (
          select 1 from active_grants grant_row where grant_row.user_id = user_row.id
        )
    )
  ),
  'grants', jsonb_build_object(
    'active', (select count(*) from active_grants),
    'projectNamespace', (
      select count(*) from active_grants where permission_code like 'project.%'
    ),
    'otherNamespace', (
      select count(*) from active_grants where permission_code not like 'project.%'
    )
  ),
  'effectiveSources', coalesce((
    select jsonb_object_agg(source_type, source_count)
    from (
      select source_type, count(*) as source_count
      from effective_sources
      group by source_type
      order by source_type
    ) counts
  ), '{}'::jsonb),
  'collisions', jsonb_build_object(
    'legacyDirect', (select legacy_direct from collision_counts),
    'legacyRole', (select legacy_role from collision_counts)
  ),
  'rooms', jsonb_build_object(
    'count', (select room_count from room_summary),
    'auditOnlyActions', (select audit_only_actions from room_summary),
    'pilotActions', (select pilot_actions from room_summary),
    'enforcedActions', (select enforced_actions from room_summary)
  ),
  'fallbackOnly', (select fallback_only from room_summary),
  'staleMembers', (select total from stale_members),
  'flags', (select value from flags)
) as authorization_v2_reconciliation;
