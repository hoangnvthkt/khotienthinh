-- Authorization V2 / Phase 5
-- Deterministically convert legacy module/submodule configuration to
-- canonical DIRECT, ROLE, or ROOM-owned authorization evidence.

create extension if not exists pgcrypto with schema extensions;

create table if not exists app_private.authorization_legacy_user_snapshots (
  cutover_id uuid not null,
  user_id uuid not null references public.users(id) on delete restrict,
  legacy_payload jsonb not null,
  captured_at timestamptz not null default now(),
  checksum text not null,
  primary key (cutover_id, user_id)
);

create table if not exists app_private.authorization_legacy_migration_dispositions (
  id uuid primary key default gen_random_uuid(),
  cutover_id uuid not null,
  user_id uuid not null references public.users(id) on delete restrict,
  legacy_source text not null,
  legacy_key text,
  legacy_route text,
  permission_code text,
  role_code text,
  disposition text not null check (disposition in (
    'mapped_view', 'mapped_manage', 'room_owned', 'role_owned', 'manual_review', 'retired'
  )),
  reason text not null check (char_length(btrim(reason)) >= 10),
  created_at timestamptz not null default now()
);

create unique index if not exists authorization_legacy_migration_dispositions_tuple_idx
  on app_private.authorization_legacy_migration_dispositions (
    cutover_id, user_id, legacy_source,
    coalesce(legacy_key, ''), coalesce(legacy_route, ''),
    coalesce(permission_code, ''), coalesce(role_code, '')
  );

revoke all on table app_private.authorization_legacy_user_snapshots from public, anon, authenticated;
revoke all on table app_private.authorization_legacy_migration_dispositions from public, anon, authenticated;
grant select on table app_private.authorization_legacy_user_snapshots to service_role;
grant select on table app_private.authorization_legacy_migration_dispositions to service_role;

do $$
declare
  v_cutover_id constant uuid := '6aa37d8c-1d58-4eb4-a5a9-709100333020';
begin
  insert into app_private.authorization_legacy_user_snapshots (
    cutover_id, user_id, legacy_payload, checksum
  )
  select v_cutover_id, user_row.id, payload.value,
         encode(extensions.digest(payload.value::text, 'sha256'), 'hex')
  from public.users user_row
  cross join lateral (select jsonb_build_object(
    'allowed_modules', user_row.allowed_modules,
    'admin_modules', user_row.admin_modules,
    'allowed_sub_modules', user_row.allowed_sub_modules,
    'admin_sub_modules', user_row.admin_sub_modules
  ) value) payload
  where user_row.is_active and user_row.account_status = 'ACTIVE'
  on conflict (cutover_id, user_id) do nothing;
end $$;

create or replace function public.get_authorization_legacy_migration_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutover_id constant uuid := '6aa37d8c-1d58-4eb4-a5a9-709100333020';
begin
  perform app_private.assert_project_permission_room_admin();
  return jsonb_build_object(
    'cutoverId', v_cutover_id,
    'snapshots', (select count(*) from app_private.authorization_legacy_user_snapshots where cutover_id = v_cutover_id),
    'manualReview', (select count(*) from app_private.authorization_legacy_migration_dispositions where cutover_id = v_cutover_id and disposition = 'manual_review'),
    'legacyOnlyUsers', (
      select count(*)
      from public.users user_row
      where user_row.is_active and user_row.account_status = 'ACTIVE' and user_row.role <> 'ADMIN'
        and (user_row.allowed_modules is not null or user_row.admin_modules is not null
          or user_row.allowed_sub_modules is not null or user_row.admin_sub_modules is not null)
        and not exists (select 1 from public.user_permission_grants grant_row where grant_row.user_id = user_row.id and grant_row.is_active and (grant_row.expires_at is null or grant_row.expires_at > now()))
        and not exists (select 1 from public.principal_role_assignments assignment where assignment.principal_id = user_row.id and assignment.status = 'ACTIVE' and assignment.starts_at <= now() and (assignment.expires_at is null or assignment.expires_at > now()))
        and not exists (
          select 1 from public.project_staff staff
          join public.project_permission_room_members member on member.project_staff_id = staff.id and member.is_active
          where staff.user_id = user_row.id::text and staff.end_date is null
        )
    ),
    'dispositions', (
      select coalesce(jsonb_object_agg(disposition, item_count), '{}'::jsonb)
      from (
        select disposition, count(*) item_count
        from app_private.authorization_legacy_migration_dispositions
        where cutover_id = v_cutover_id
        group by disposition order by disposition
      ) counts
    ),
    'generatedAt', now()
  );
end;
$$;

revoke all on function public.get_authorization_legacy_migration_summary() from public, anon;
grant execute on function public.get_authorization_legacy_migration_summary() to authenticated, service_role;

create temp table authorization_v2_effective_legacy on commit drop as
select distinct user_row.id user_id,
       source.permission_code,
       action_row.action,
       module_row.legacy_module_key legacy_key,
       action_row.legacy_route
from public.users user_row
cross join lateral app_private.resolve_effective_permission_sources(
  user_row.id, null, null, null, now()
) source
join public.permission_actions action_row on action_row.permission_code = source.permission_code
join public.permission_modules module_row on module_row.code = action_row.module_code
where user_row.is_active
  and user_row.account_status = 'ACTIVE'
  and source.source_type = 'LEGACY';

create temp table authorization_v2_legacy_classified on commit drop as
select source.*,
  case
    when source.legacy_key = 'HRM' then 'role_owned'
    when exists (
      select 1
      from app_private.project_permission_room_action_bindings binding
      join public.project_permission_rooms room on room.code = binding.room_code and room.is_active
      where source.permission_code = any(binding.legacy_permission_codes)
    ) then 'room_owned'
    when source.action in ('view', 'view_own', 'view_related', 'access') then 'mapped_view'
    when source.action = 'manage' then 'mapped_manage'
    else 'retired'
  end disposition
from authorization_v2_effective_legacy source;

-- HR permissions are template-only. A deterministic template is created for
-- each distinct legacy HR permission set, avoiding a broad HR/HR_MANAGE role
-- assignment that would silently escalate narrower legacy profiles.
create temp table authorization_v2_hr_profiles on commit drop as
select user_id,
       array_agg(permission_code order by permission_code) permission_codes,
       'LEGACY_HR_' || upper(substr(md5(string_agg(permission_code, ',' order by permission_code)), 1, 16)) role_code
from authorization_v2_effective_legacy
where legacy_key = 'HRM'
group by user_id;

insert into public.role_permission_templates (
  code, name, description, is_active, is_system, version, created_at, updated_at
)
select distinct profile.role_code,
       'Legacy HR profile ' || substr(profile.role_code, 11),
       'Authorization V2 deterministic HR role generated from pre-cutover effective legacy permissions.',
       true, true, 1, now(), now()
from authorization_v2_hr_profiles profile
on conflict (code) do update
set is_active = true, updated_at = now();

insert into public.role_permission_template_items (
  template_id, permission_code, scope_type, scope_id, sort_order, created_at
)
select template.id, permission.permission_code, 'global', '*', permission.ordinality::integer, now()
from (
  select distinct role_code, permission_codes from authorization_v2_hr_profiles
) profile
join public.role_permission_templates template on template.code = profile.role_code
cross join lateral unnest(profile.permission_codes) with ordinality permission(permission_code, ordinality)
on conflict (template_id, permission_code, scope_type, scope_id) do nothing;

insert into public.principal_role_assignments (
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  starts_at, status, assigned_by, assigned_reason, created_at, updated_at
)
select 'user', profile.user_id, template.id, 'global', '*',
       now(), 'ACTIVE', null,
       'Authorization V2 deterministic migration of legacy HR permission profile.',
       now(), now()
from authorization_v2_hr_profiles profile
join public.role_permission_templates template on template.code = profile.role_code
where not exists (
  select 1 from public.principal_role_assignments assignment
  where assignment.principal_type = 'user'
    and assignment.principal_id = profile.user_id
    and assignment.role_template_id = template.id
    and assignment.scope_type = 'global' and assignment.scope_id = '*'
    and assignment.status = 'ACTIVE'
);

insert into app_private.authorization_legacy_migration_dispositions (
  cutover_id, user_id, legacy_source, legacy_key, legacy_route,
  permission_code, role_code, disposition, reason
)
select '6aa37d8c-1d58-4eb4-a5a9-709100333020'::uuid, classified.user_id,
       'effective_permission', classified.legacy_key, classified.legacy_route,
       classified.permission_code, profile.role_code, classified.disposition,
       case classified.disposition
         when 'mapped_view' then 'Legacy view access mapped to canonical global view grant.'
         when 'mapped_manage' then 'Legacy admin access mapped to canonical global manage grant.'
         when 'room_owned' then 'Project workflow authorization is already owned by an enforced Room action.'
         when 'role_owned' then 'HR authorization migrated to a deterministic role template with the exact legacy permission set.'
         else 'Legacy non-view/non-manage capability retired; no workflow approval was inferred.'
       end
from authorization_v2_legacy_classified classified
left join authorization_v2_hr_profiles profile on profile.user_id = classified.user_id
on conflict do nothing;

-- Explicit route aliases cover legacy navigation routes that predate canonical
-- action metadata. Only view/manage can be produced by these aliases.
create temp table authorization_v2_legacy_route_aliases (
  legacy_key text not null,
  legacy_route text not null,
  view_permission_code text,
  manage_permission_code text,
  disposition text not null default 'mapped_view',
  primary key (legacy_key, legacy_route)
) on commit drop;

insert into authorization_v2_legacy_route_aliases values
  ('DA','/da/portfolio','project.overview.view','project.overview.manage','mapped_view'),
  ('DA','/da/tabs/finance','project.cashflow.view','project.cashflow.manage','mapped_view'),
  ('DA','/da/tabs/material/dashboard','project.material_request.view',null,'room_owned'),
  ('DA','/da/tabs/material/request','project.material_request.view',null,'room_owned'),
  ('DA','/da/tabs/material/summary','project.material_request.view',null,'room_owned'),
  ('DA','/da/tabs/permissions','project.org.view','project.org.manage','mapped_view'),
  ('HD','/hd/catalogs','contract.cost_library.view','contract.cost_library.manage','mapped_view'),
  ('HD','/hd/overview','system.hd.view','system.hd.manage','mapped_view'),
  ('HD','/hd/subcontractor','contract.partner.view','contract.partner.manage','mapped_view'),
  ('RQ','/rq/dashboard','system.rq.view','system.rq.manage','mapped_view'),
  ('RQ','/rq/templates','request.template.view','request.template.manage','mapped_view'),
  ('SETTINGS','/settings/general','system.settings.view','system.settings.manage','mapped_view'),
  ('SETTINGS','/settings/master-data','system.settings.view','system.settings.manage','mapped_view'),
  ('TS','/ts/dashboard','system.ts.view','system.ts.manage','mapped_view'),
  ('VEHICLE_BOOKING','/booking/vehicle/approvals','booking.vehicle.view_own',null,'mapped_view'),
  ('VEHICLE_BOOKING','/booking/vehicle/handover','booking.vehicle.view_own',null,'mapped_view'),
  ('VEHICLE_BOOKING','/booking/vehicle/my','booking.vehicle.view_own',null,'mapped_view'),
  ('VEHICLE_BOOKING','/booking/vehicle/trips','booking.vehicle.view_own',null,'mapped_view'),
  ('WF','/wf/dashboard','system.wf.view','system.wf.manage','mapped_view'),
  ('WMS','/audit','system.wms.view','system.wms.manage','mapped_view'),
  ('WMS','/dashboard','system.wms.view','system.wms.manage','mapped_view'),
  ('WMS','/material-code-requests','wms.request.view',null,'mapped_view'),
  ('WMS','/misa-export','system.wms.view','system.wms.manage','mapped_view'),
  ('WMS','/reports','system.wms.view','system.wms.manage','mapped_view');

create temp table authorization_v2_raw_routes on commit drop as
select user_row.id user_id, 'allowed_submodule' legacy_source,
       item.key legacy_key, route.legacy_route
from public.users user_row
cross join lateral jsonb_each(coalesce(user_row.allowed_sub_modules, '{}')) item
cross join lateral jsonb_array_elements_text(item.value) route(legacy_route)
where user_row.is_active and user_row.account_status = 'ACTIVE'
union all
select user_row.id, 'admin_submodule', item.key, route.legacy_route
from public.users user_row
cross join lateral jsonb_each(coalesce(user_row.admin_sub_modules, '{}')) item
cross join lateral jsonb_array_elements_text(item.value) route(legacy_route)
where user_row.is_active and user_row.account_status = 'ACTIVE';

insert into app_private.authorization_legacy_migration_dispositions (
  cutover_id, user_id, legacy_source, legacy_key, legacy_route,
  permission_code, disposition, reason
)
select '6aa37d8c-1d58-4eb4-a5a9-709100333020'::uuid, route.user_id,
       route.legacy_source, route.legacy_key, route.legacy_route,
       case when route.legacy_source = 'admin_submodule'
         then coalesce(alias.manage_permission_code, alias.view_permission_code)
         else alias.view_permission_code end,
       case
         when alias.disposition = 'room_owned' then 'room_owned'
         when route.legacy_source = 'admin_submodule' and alias.manage_permission_code is not null then 'mapped_manage'
         else 'mapped_view'
       end,
       'Explicit canonical alias for a legacy route without action metadata.'
from authorization_v2_raw_routes route
join authorization_v2_legacy_route_aliases alias using (legacy_key, legacy_route)
on conflict do nothing;

-- Every unknown raw key/route is persisted as manual_review and blocks this
-- migration. CHIBIBOT is an explicitly retired legacy module.
insert into app_private.authorization_legacy_migration_dispositions (
  cutover_id, user_id, legacy_source, legacy_key, disposition, reason
)
select distinct '6aa37d8c-1d58-4eb4-a5a9-709100333020'::uuid, user_row.id,
       'legacy_module', legacy_key, 'manual_review',
       'Legacy module key has no active canonical module mapping.'
from public.users user_row
cross join lateral unnest(coalesce(user_row.allowed_modules, '{}') || coalesce(user_row.admin_modules, '{}')) legacy_key
where user_row.is_active and user_row.account_status = 'ACTIVE'
  and legacy_key <> 'CHIBIBOT'
  and not exists (
    select 1 from public.permission_modules module
    where module.is_active and module.legacy_module_key = legacy_key
  )
on conflict do nothing;

insert into app_private.authorization_legacy_migration_dispositions (
  cutover_id, user_id, legacy_source, legacy_key, disposition, reason
)
select distinct '6aa37d8c-1d58-4eb4-a5a9-709100333020'::uuid, user_row.id,
       'legacy_module', 'CHIBIBOT', 'retired',
       'CHIBIBOT legacy module is retired and has no active authorization consumer.'
from public.users user_row
where user_row.is_active and user_row.account_status = 'ACTIVE'
  and ('CHIBIBOT' = any(coalesce(user_row.allowed_modules, '{}'))
    or 'CHIBIBOT' = any(coalesce(user_row.admin_modules, '{}')))
on conflict do nothing;

insert into app_private.authorization_legacy_migration_dispositions (
  cutover_id, user_id, legacy_source, legacy_key, legacy_route,
  disposition, reason
)
select distinct '6aa37d8c-1d58-4eb4-a5a9-709100333020'::uuid, route.user_id,
       route.legacy_source, route.legacy_key, route.legacy_route,
       'manual_review', 'Legacy route has neither canonical action metadata nor an explicit alias.'
from authorization_v2_raw_routes route
where route.legacy_key <> 'HRM'
  and not exists (
    select 1 from public.permission_actions action_row
    where action_row.is_active
      and action_row.legacy_module_key = route.legacy_key
      and action_row.legacy_route = route.legacy_route
  )
  and not exists (
    select 1 from authorization_v2_legacy_route_aliases alias
    where alias.legacy_key = route.legacy_key and alias.legacy_route = route.legacy_route
  )
on conflict do nothing;

do $$
begin
  if exists (
    select 1 from app_private.authorization_legacy_migration_dispositions
    where cutover_id = '6aa37d8c-1d58-4eb4-a5a9-709100333020'
      and disposition = 'manual_review'
  ) then
    raise exception 'Authorization V2 legacy migration blocked: manual_review is not zero';
  end if;
end $$;

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active,
  granted_by, granted_at, expires_at, grant_reason, created_at, updated_at
)
select distinct disposition.user_id, disposition.permission_code,
       'global', '*', true, null::uuid, now(),
       case when action_row.direct_grant_requires_expiry then now() + interval '90 days' else null end,
       'Authorization V2 deterministic legacy migration: ' || disposition.disposition,
       now(), now()
from app_private.authorization_legacy_migration_dispositions disposition
join public.permission_actions action_row on action_row.permission_code = disposition.permission_code and action_row.is_active
where disposition.cutover_id = '6aa37d8c-1d58-4eb4-a5a9-709100333020'
  and disposition.disposition in ('mapped_view', 'mapped_manage')
on conflict (user_id, permission_code, scope_type, scope_id) do update
set is_active = true,
    revoked_at = null,
    revoked_by = null,
    revoked_reason = null,
    expires_at = excluded.expires_at,
    grant_reason = coalesce(public.user_permission_grants.grant_reason, excluded.grant_reason),
    updated_at = now();

do $$
declare
  v_missing integer;
  v_missing_codes text;
begin
  select count(*), string_agg(distinct disposition.permission_code, ', ' order by disposition.permission_code)
    into v_missing, v_missing_codes
    from app_private.authorization_legacy_migration_dispositions disposition
    where disposition.cutover_id = '6aa37d8c-1d58-4eb4-a5a9-709100333020'
      and disposition.disposition in ('mapped_view', 'mapped_manage')
      and not exists (
        select 1 from public.user_permission_grants grant_row
        where grant_row.user_id = disposition.user_id
          and grant_row.permission_code = disposition.permission_code
          and grant_row.scope_type = 'global' and grant_row.scope_id = '*'
          and grant_row.is_active
          and (grant_row.expires_at is null or grant_row.expires_at > now())
      );
  if v_missing > 0 then
    raise exception 'Authorization V2 shadow comparison failed for % mapped canonical grants: %', v_missing, v_missing_codes;
  end if;

  if exists (
    select 1
    from public.users user_row
    where user_row.is_active and user_row.account_status = 'ACTIVE'
      and user_row.role <> 'ADMIN'
      and (
        user_row.allowed_modules is not null or user_row.admin_modules is not null
        or user_row.allowed_sub_modules is not null or user_row.admin_sub_modules is not null
      )
      and not exists (
        select 1 from public.user_permission_grants grant_row
        where grant_row.user_id = user_row.id and grant_row.is_active
          and (grant_row.expires_at is null or grant_row.expires_at > now())
      )
      and not exists (
        select 1 from public.principal_role_assignments assignment
        where assignment.principal_type = 'user' and assignment.principal_id = user_row.id
          and assignment.status = 'ACTIVE' and assignment.starts_at <= now()
          and (assignment.expires_at is null or assignment.expires_at > now())
      )
      and not exists (
        select 1
        from public.project_staff staff
        join public.project_permission_room_members member on member.project_staff_id = staff.id and member.is_active
        where staff.user_id = user_row.id::text and staff.end_date is null
      )
  ) then
    raise exception 'Authorization V2 legacy-only active user remains after migration';
  end if;
end $$;
