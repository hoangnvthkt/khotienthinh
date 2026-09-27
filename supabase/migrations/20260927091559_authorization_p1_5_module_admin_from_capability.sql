-- P1.5 step 1: "module admin" is the capability system.<module>.manage, the
-- same rule the frontend uses (AppContext.isModuleAdmin). The legacy
-- admin_modules / admin_sub_modules columns are no longer read, so revoking
-- the capability in Settings now takes effect on the server too.
-- Holders were identical when this shipped (the capabilities were projected
-- from the legacy flags), so nobody gains or loses access in this step.
-- DA stays Admin-only (P1.1). Only modules that had a legacy admin flag use
-- the capability; others (e.g. PROCUREMENT, owned by the Procurement V2 track)
-- stay Admin-only as before.

create or replace function public.is_module_admin(p_module text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.users user_row
    where user_row.auth_id = (select auth.uid())
      and coalesce(user_row.is_active, true)
      and (
        user_row.role = 'ADMIN'
        or (
          p_module in ('HD', 'WMS', 'WF', 'TS', 'RQ', 'SETTINGS', 'TENDER_AI', 'EX', 'FEEDBACK')
          and app_private.has_permission(user_row.id, 'system.' || lower(p_module) || '.manage', 'global', '*')
        )
      )
  );
$function$;

-- WMS recipients: module admins are capability holders too.
create or replace function app_private.wms_user_has_action(
  p_user_id uuid,
  p_permission_code text,
  p_source_warehouse_id text default null,
  p_target_warehouse_id text default null,
  p_include_legacy_admin boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.wms_has_canonical_action(p_permission_code, p_source_warehouse_id, p_target_warehouse_id, null, null, p_user_id)
    or (
      p_permission_code <> 'wms.transaction.reverse'
      and exists (
        select 1 from public.permission_actions action_row
        where action_row.permission_code = p_permission_code and action_row.permission_code like 'wms.%' and action_row.is_active
      )
      and exists (
        select 1 from public.users user_row
        where user_row.id = p_user_id and coalesce(user_row.is_active, true)
          and (
            user_row.role = 'ADMIN'
            or (p_include_legacy_admin and app_private.has_permission(user_row.id, 'system.wms.manage', 'global', '*'))
            or (user_row.role::text = 'WAREHOUSE_KEEPER' and user_row.assigned_warehouse_id is null)
            or (user_row.role::text = 'WAREHOUSE_KEEPER' and user_row.assigned_warehouse_id is not null
                and user_row.assigned_warehouse_id in (p_source_warehouse_id, p_target_warehouse_id))
          )
      )
    ),
    false
  );
$$;

-- Contract managers shown in the view-switch panel: same capability rule.
create or replace function public.list_project_sensitive_view_access(p_project_id text default null)
returns table (
  user_id uuid,
  user_name text,
  user_email text,
  user_avatar text,
  is_system_admin boolean,
  in_project boolean,
  finance_project boolean,
  contract_project boolean,
  finance_all boolean,
  contract_all boolean,
  finance_room boolean,
  contract_manager boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'SENSITIVE_VIEW_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  with people as (
    select staff.user_id::uuid as person_id, true as in_project
    from public.project_staff staff
    where p_project_id is not null and staff.project_id = p_project_id and staff.end_date is null
      and staff.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select grant_row.user_id, false
    from public.project_sensitive_view_grants grant_row
    where grant_row.is_active
      and (grant_row.project_id is null or grant_row.project_id = p_project_id)
  ), person as (
    select person_id, bool_or(in_project) as in_project from people group by person_id
  ), room as (
    select staff.user_id::uuid as person_id
    from public.project_permission_room_members member
    join public.project_permission_room_member_actions action
      on action.room_member_id = member.id and action.is_active
      and action.action_code in ('edit', 'submit', 'verify', 'approve', 'confirm')
    join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
    where p_project_id is not null and member.project_id = p_project_id and member.is_active
      and member.room_code in ('payment', 'quantity_acceptance')
      and staff.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select
    user_row.id,
    user_row.name,
    user_row.email,
    user_row.avatar,
    user_row.role = 'ADMIN',
    person.in_project,
    exists (select 1 from public.project_sensitive_view_grants g where g.user_id = user_row.id and g.is_active and g.domain = 'finance' and g.project_id = p_project_id),
    exists (select 1 from public.project_sensitive_view_grants g where g.user_id = user_row.id and g.is_active and g.domain = 'contract' and g.project_id = p_project_id),
    exists (select 1 from public.project_sensitive_view_grants g where g.user_id = user_row.id and g.is_active and g.domain = 'finance' and g.project_id is null),
    exists (select 1 from public.project_sensitive_view_grants g where g.user_id = user_row.id and g.is_active and g.domain = 'contract' and g.project_id is null),
    exists (select 1 from room where room.person_id = user_row.id),
    user_row.role = 'ADMIN'
      or app_private.has_permission(user_row.id, 'system.hd.manage', 'global', '*')
      or exists (
        select 1 from unnest(array[
          'contract.customer.manage', 'contract.supplier.manage', 'contract.partner.manage',
          'contract.cost_library.manage', 'system.tender_ai.manage'
        ]) as code(permission_code)
        where app_private.has_permission(user_row.id, code.permission_code, 'global', '*')
      )
  from person
  join public.users user_row on user_row.id = person.person_id
  where user_row.is_active and user_row.account_status = 'ACTIVE'
  order by person.in_project desc, user_row.name;
end;
$$;
