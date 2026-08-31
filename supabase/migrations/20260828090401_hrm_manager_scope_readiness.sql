begin;

create table if not exists public.hrm_manager_scope_exclusions (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 10),
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

alter table public.hrm_manager_scope_exclusions enable row level security;
drop policy if exists hrm_manager_scope_exclusions_read on public.hrm_manager_scope_exclusions;
drop policy if exists hrm_manager_scope_exclusions_write on public.hrm_manager_scope_exclusions;
create policy hrm_manager_scope_exclusions_read
on public.hrm_manager_scope_exclusions for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.view')));
create policy hrm_manager_scope_exclusions_write
on public.hrm_manager_scope_exclusions for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.set_manager')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.set_manager')));
revoke all on table public.hrm_manager_scope_exclusions from anon;
grant select, insert, update, delete on table public.hrm_manager_scope_exclusions to authenticated;
grant all on table public.hrm_manager_scope_exclusions to service_role;

create table if not exists app_private.hrm_manager_scope_settings (
  singleton boolean primary key default true check (singleton),
  is_enabled boolean not null default false,
  enabled_by uuid references public.users(id) on delete set null,
  enabled_at timestamptz,
  reason text,
  updated_at timestamptz not null default now()
);
insert into app_private.hrm_manager_scope_settings(singleton, is_enabled)
values (true, false)
on conflict (singleton) do nothing;
revoke all on table app_private.hrm_manager_scope_settings from public, anon, authenticated;

create or replace function app_private.get_hrm_manager_scope_readiness()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with active_employees as (
    select employee.id, employee.user_id
    from public.employees employee
    where employee.status = 'Đang làm việc'
  ), active_exclusions as (
    select exclusion.employee_id
    from public.hrm_manager_scope_exclusions exclusion
    where exclusion.effective_from <= current_date
      and (exclusion.effective_to is null or exclusion.effective_to >= current_date)
  ), active_primary as (
    select assignment.employee_id, assignment.slot_id, slot.org_unit_id
    from public.hrm_employee_slot_assignments assignment
    join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
    where assignment.assignment_type = 'PRIMARY'
      and assignment.status = 'ACTIVE'
      and assignment.effective_from <= current_date
      and (assignment.effective_to is null or assignment.effective_to >= current_date)
      and slot.status = 'ACTIVE'
      and slot.effective_from <= current_date
      and (slot.effective_to is null or slot.effective_to >= current_date)
  ), overlapping_employees as (
    select distinct first_assignment.employee_id
    from public.hrm_employee_slot_assignments first_assignment
    join public.hrm_employee_slot_assignments second_assignment
      on second_assignment.employee_id = first_assignment.employee_id
     and second_assignment.id > first_assignment.id
     and second_assignment.assignment_type = 'PRIMARY'
     and first_assignment.assignment_type = 'PRIMARY'
     and daterange(first_assignment.effective_from, coalesce(first_assignment.effective_to, 'infinity'::date), '[)')
       && daterange(second_assignment.effective_from, coalesce(second_assignment.effective_to, 'infinity'::date), '[)')
  ), invalid_manager_units as (
    select unit.id
    from public.org_units unit
    left join public.hrm_org_position_slots manager_slot
      on manager_slot.id = unit.manager_slot_id
     and manager_slot.org_unit_id = unit.id
     and manager_slot.status = 'ACTIVE'
    where unit.is_active
      and (
        manager_slot.id is null
        or not exists (
          select 1
          from public.hrm_employee_slot_assignments manager_assignment
          join active_employees manager_employee
            on manager_employee.id = manager_assignment.employee_id
          where manager_assignment.slot_id = manager_slot.id
            and manager_assignment.assignment_type in ('PRIMARY', 'ACTING')
            and manager_assignment.status = 'ACTIVE'
            and manager_assignment.effective_from <= current_date
            and (manager_assignment.effective_to is null or manager_assignment.effective_to >= current_date)
        )
      )
  ), metrics as (
    select
      (select count(*) from active_employees)::integer as active_employee_count,
      (select count(*) from active_primary
       where employee_id in (select id from active_employees))::integer as primary_assigned_count,
      (select count(*) from active_exclusions
       where employee_id in (select id from active_employees))::integer as excluded_count,
      (select count(*) from active_employees employee
       where not exists (select 1 from active_primary assignment where assignment.employee_id = employee.id)
         and not exists (select 1 from active_exclusions exclusion where exclusion.employee_id = employee.id))::integer as missing_primary_count,
      (select count(*) from overlapping_employees)::integer as overlapping_assignment_count,
      (select count(*) from invalid_manager_units)::integer as units_without_manager_count,
      (select count(*)
       from active_employees employee
       where app_private.resolve_slot_direct_manager(employee.user_id) = employee.user_id)::integer as self_managed_count,
      (select is_enabled from app_private.hrm_manager_scope_settings where singleton) as is_enabled
  )
  select jsonb_build_object(
    'activeEmployeeCount', active_employee_count,
    'primaryAssignedCount', primary_assigned_count,
    'excludedCount', excluded_count,
    'missingPrimaryCount', missing_primary_count,
    'overlappingAssignmentCount', overlapping_assignment_count,
    'unitsWithoutManagerCount', units_without_manager_count,
    'selfManagedCount', self_managed_count,
    'isReady', missing_primary_count = 0
      and overlapping_assignment_count = 0
      and units_without_manager_count = 0
      and self_managed_count = 0,
    'isEnabled', coalesce(is_enabled, false)
  )
  from metrics;
$$;

create or replace function public.get_hrm_manager_scope_readiness()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.staffing.view') then
    raise exception using errcode = '42501', message = 'HRM_STAFFING_VIEW_REQUIRED';
  end if;
  return app_private.get_hrm_manager_scope_readiness();
end;
$$;

create or replace function app_private.resolve_strict_direct_manager(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((
      select setting.is_enabled
      from app_private.hrm_manager_scope_settings setting
      where setting.singleton
    ), false)
    then app_private.resolve_slot_direct_manager(p_user_id)
    else null::uuid
  end;
$$;

create or replace function app_private.resolve_manager_derived_permission_sources(
  p_target_user_id uuid
)
returns table(
  permission_code text,
  source_type text,
  source_id text,
  source_code text,
  source_label text,
  scope_type text,
  scope_id text,
  starts_at timestamptz,
  expires_at timestamptz,
  risk_level text,
  is_business_approval boolean,
  metadata jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with manager_state as (
    select exists (
      select 1
      from public.employees report_employee
      where report_employee.status = 'Đang làm việc'
        and report_employee.user_id is not null
        and app_private.resolve_strict_direct_manager(report_employee.user_id) = p_target_user_id
    ) as has_direct_reports
  ), manager_permissions(permission_code, risk_level) as (
    values
      ('hrm.employee.view_profile'::text, 'medium'::text),
      ('hrm.attendance.view'::text, 'medium'::text),
      ('hrm.attendance.approve'::text, 'high'::text),
      ('hrm.leave.view'::text, 'medium'::text),
      ('hrm.leave.approve'::text, 'high'::text)
  )
  select permission.permission_code,
    'ORGANIZATION'::text,
    'organization_manager'::text,
    'organization_manager'::text,
    'Quản lý trực tiếp'::text,
    'direct_reports'::text,
    '*'::text,
    null::timestamptz,
    null::timestamptz,
    permission.risk_level,
    true,
    jsonb_build_object('resolver', 'strict_slot', 'readinessGate', true)
  from manager_permissions permission
  cross join manager_state
  where manager_state.has_direct_reports;
$$;

create or replace function app_private.get_effective_permission_sources_authorized(
  p_target_user_id uuid default public.current_app_user_id()
)
returns table(
  permission_code text, source_type text, source_id text, source_code text,
  source_label text, scope_type text, scope_id text, starts_at timestamptz,
  expires_at timestamptz, risk_level text, is_business_approval boolean,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_target_is_admin boolean := false;
begin
  if v_actor_user_id is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;
  if p_target_user_id <> v_actor_user_id
    and not app_private.has_any_permission(
      v_actor_user_id,
      array['system.authorization.view','system.authorization.audit',
        'system.authorization.manage_roles','system.authorization.manage_grants'],
      'global', '*'
    )
  then
    raise exception 'Not allowed to view authorization sources' using errcode = '42501';
  end if;

  select target_row.role = 'ADMIN' into v_target_is_admin
  from public.users target_row where target_row.id = p_target_user_id;

  return query
  select source_row.*
  from app_private.resolve_effective_permission_sources(
    p_target_user_id, null, null, null, now()
  ) source_row
  where not (
      coalesce(v_target_is_admin, false)
      and source_row.permission_code like 'hrm.%'
      and source_row.source_type = 'LEGACY'
    )
    and (
      not app_private.is_hrm_template_only_permission(source_row.permission_code)
      or (source_row.source_type = 'ROLE' and source_row.source_code in ('HR', 'HR_MANAGE'))
    );

  return query
  select manager_source.*
  from app_private.resolve_manager_derived_permission_sources(p_target_user_id) manager_source;
end;
$$;

create or replace function public.set_hrm_manager_scope_enabled(
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_readiness jsonb;
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.staffing.set_manager') then
    raise exception using errcode = '42501', message = 'HRM_STAFFING_SET_MANAGER_REQUIRED';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception using errcode = '22023', message = 'HRM_MUTATION_REASON_TOO_SHORT';
  end if;
  v_readiness := app_private.get_hrm_manager_scope_readiness();
  if p_enabled and not coalesce((v_readiness ->> 'isReady')::boolean, false) then
    raise exception using errcode = '55000', message = 'HRM_MANAGER_SCOPE_NOT_READY';
  end if;

  update app_private.hrm_manager_scope_settings
  set is_enabled = p_enabled,
      enabled_by = case when p_enabled then v_actor_id else null end,
      enabled_at = case when p_enabled then now() else null end,
      reason = trim(p_reason),
      updated_at = now()
  where singleton;

  insert into public.audit_trail(
    table_name, record_id, action, old_data, new_data, user_id, module,
    description, record_label, entity_type, changed_fields, change_count,
    impact_level, context
  ) values (
    'hrm_manager_scope_settings', 'global', 'UPDATE',
    jsonb_build_object('readiness', v_readiness),
    jsonb_build_object('is_enabled', p_enabled),
    v_actor_id::text, 'HRM', 'Thay đổi cổng phân quyền quản lý trực tiếp',
    'Direct reports', 'HRM_MANAGER_SCOPE_GATE', array['is_enabled'], 1,
    'critical', jsonb_build_object('reason', trim(p_reason))
  );
  return app_private.get_hrm_manager_scope_readiness();
end;
$$;

revoke all on function app_private.get_hrm_manager_scope_readiness() from public, anon, authenticated;
revoke all on function app_private.resolve_strict_direct_manager(uuid) from public, anon, authenticated;
revoke all on function app_private.resolve_manager_derived_permission_sources(uuid) from public, anon, authenticated;
revoke all on function public.get_hrm_manager_scope_readiness() from public, anon;
revoke all on function public.set_hrm_manager_scope_enabled(boolean, text) from public, anon;
grant execute on function public.get_hrm_manager_scope_readiness() to authenticated, service_role;
grant execute on function public.set_hrm_manager_scope_enabled(boolean, text) to authenticated, service_role;

comment on function app_private.resolve_strict_direct_manager(uuid) is
  'Authorization-only manager resolver. Uses slot assignments and the readiness gate; never users.manager_id.';

notify pgrst, 'reload schema';
commit;
