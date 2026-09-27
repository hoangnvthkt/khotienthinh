-- P0-C follow-up: only Room members who process payment or quantity-acceptance
-- documents (edit, submit, verify, approve or confirm) see the project
-- automatically. View-only Room members follow the Admin switch.

create or replace function app_private.sensitive_view_project_ids(p_domain text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct project_id), '{}'::text[])
  from (
    select grant_row.project_id
    from public.project_sensitive_view_grants grant_row
    where grant_row.user_id = public.current_app_user_id()
      and grant_row.domain = p_domain and grant_row.is_active and grant_row.project_id is not null
    union
    select member.project_id
    from public.project_permission_room_members member
    join public.project_permission_room_member_actions action
      on action.room_member_id = member.id and action.is_active
      and action.action_code in ('edit', 'submit', 'verify', 'approve', 'confirm')
    join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
    where member.is_active
      and member.room_code in ('payment', 'quantity_acceptance')
      and staff.user_id = public.current_app_user_id()::text
  ) visible;
$$;

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
      or 'HD' = any(coalesce(user_row.admin_modules, '{}'::text[]))
      or coalesce(user_row.admin_sub_modules, '{}'::jsonb) ? 'HD'
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
