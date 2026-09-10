-- Read-only preview for Authorization V2 Phase 5 legacy migration.
-- Returns aggregate counts only; no user identifiers or legacy payload values.

with active_users as (
  select * from public.users
  where is_active and account_status = 'ACTIVE'
), legacy_sources as materialized (
  select user_row.id user_id, source.permission_code
  from active_users user_row
  cross join lateral app_private.resolve_effective_permission_sources(
    user_row.id, null, null, null, now()
  ) source
  where source.source_type = 'LEGACY'
), classified as (
  select source.user_id, source.permission_code,
    case
      when module.legacy_module_key = 'HRM' then 'role_owned'
      when exists (
        select 1
        from app_private.project_permission_room_action_bindings binding
        join public.project_permission_rooms room on room.code = binding.room_code and room.is_active
        where source.permission_code = any(binding.legacy_permission_codes)
      ) then 'room_owned'
      when action.action in ('view', 'view_own', 'view_related', 'access') then 'mapped_view'
      when action.action = 'manage' then 'mapped_manage'
      else 'retired'
    end disposition
  from legacy_sources source
  join public.permission_actions action on action.permission_code = source.permission_code
  join public.permission_modules module on module.code = action.module_code
), raw_module_keys as (
  select distinct legacy_key
  from active_users user_row
  cross join lateral unnest(
    coalesce(user_row.allowed_modules, '{}') || coalesce(user_row.admin_modules, '{}')
  ) legacy_key
), raw_routes as (
  select distinct key legacy_key, jsonb_array_elements_text(value) legacy_route
  from active_users user_row
  cross join lateral jsonb_each(coalesce(user_row.allowed_sub_modules, '{}'))
  union
  select distinct key, jsonb_array_elements_text(value)
  from active_users user_row
  cross join lateral jsonb_each(coalesce(user_row.admin_sub_modules, '{}'))
), explicit_route_dispositions(legacy_key, legacy_route) as (
  values
    ('DA','/da/portfolio'), ('DA','/da/tabs/finance'),
    ('DA','/da/tabs/material/dashboard'), ('DA','/da/tabs/material/request'),
    ('DA','/da/tabs/material/summary'), ('DA','/da/tabs/permissions'),
    ('HD','/hd/catalogs'), ('HD','/hd/overview'), ('HD','/hd/subcontractor'),
    ('RQ','/rq/dashboard'), ('RQ','/rq/templates'),
    ('SETTINGS','/settings/general'), ('SETTINGS','/settings/master-data'),
    ('TS','/ts/dashboard'),
    ('VEHICLE_BOOKING','/booking/vehicle/approvals'),
    ('VEHICLE_BOOKING','/booking/vehicle/handover'),
    ('VEHICLE_BOOKING','/booking/vehicle/my'),
    ('VEHICLE_BOOKING','/booking/vehicle/trips'),
    ('WF','/wf/dashboard'),
    ('WMS','/audit'), ('WMS','/dashboard'),
    ('WMS','/material-code-requests'), ('WMS','/misa-export'), ('WMS','/reports')
), unknown_modules as (
  select key.legacy_key
  from raw_module_keys key
  where key.legacy_key <> 'CHIBIBOT'
    and not exists (
      select 1 from public.permission_modules module
      where module.is_active and module.legacy_module_key = key.legacy_key
    )
), unknown_routes as (
  select route.*
  from raw_routes route
  where route.legacy_key <> 'HRM'
    and not exists (
      select 1 from public.permission_actions action
      where action.is_active
        and action.legacy_module_key = route.legacy_key
        and action.legacy_route = route.legacy_route
    )
    and not exists (
      select 1 from explicit_route_dispositions explicit
      where explicit.legacy_key = route.legacy_key
        and explicit.legacy_route = route.legacy_route
    )
)
select jsonb_build_object(
  'activeUsers', (select count(*) from active_users),
  'legacySourceRows', (select count(*) from legacy_sources),
  'dispositions', (
    select coalesce(jsonb_object_agg(disposition, item_count), '{}'::jsonb)
    from (select disposition, count(*) item_count from classified group by disposition) counts
  ),
  'newDirectGrantTuples', (
    select count(*)
    from classified item
    where item.disposition in ('mapped_view', 'mapped_manage')
      and not exists (
        select 1 from public.user_permission_grants grant_row
        where grant_row.user_id = item.user_id
          and grant_row.permission_code = item.permission_code
          and grant_row.scope_type = 'global' and grant_row.scope_id = '*'
          and grant_row.is_active
      )
  ),
  'unknownModuleKeys', (select count(*) from unknown_modules),
  'unknownRoutes', (select count(*) from unknown_routes),
  'manualReview', (select count(*) from unknown_modules) + (select count(*) from unknown_routes)
) as authorization_v2_legacy_migration_preview;
