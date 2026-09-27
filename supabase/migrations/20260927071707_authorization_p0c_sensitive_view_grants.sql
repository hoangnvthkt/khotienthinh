-- Authorization remediation P0-C (part 1): who may view project finance and
-- contracts. Adds Admin-managed switches per project (or for all projects) and
-- the helpers later RLS will use. No read policy changes yet.
-- Owner decisions 2026-09-27: two switches (finance, contract); an all-projects
-- option; payment / quantity-acceptance Room members see their project;
-- company contract managers see every contract; only Admin changes switches.

create table public.project_sensitive_view_grants (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  domain text not null check (domain in ('finance', 'contract')),
  is_active boolean not null default true,
  reason text not null check (length(btrim(reason)) >= 10),
  granted_by uuid not null references public.users(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.users(id),
  revoked_at timestamptz,
  revoke_reason text
);
comment on column public.project_sensitive_view_grants.project_id is 'NULL means every project.';
create unique index project_sensitive_view_grants_active_uidx
  on public.project_sensitive_view_grants (coalesce(project_id, '*'), user_id, domain)
  where is_active;
create index project_sensitive_view_grants_user_idx
  on public.project_sensitive_view_grants (user_id) where is_active;

alter table public.project_sensitive_view_grants enable row level security;
revoke all on public.project_sensitive_view_grants from anon, authenticated;
grant select on public.project_sensitive_view_grants to authenticated;
create policy project_sensitive_view_grants_select on public.project_sensitive_view_grants
  for select to authenticated
  using (public.is_admin() or user_id = public.current_app_user_id());

-- Company-wide visibility for the current actor.
create or replace function app_private.sensitive_view_all(p_domain text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_user_id() is not null and (
    public.is_admin()
    or exists (
      select 1 from public.project_sensitive_view_grants grant_row
      where grant_row.user_id = public.current_app_user_id()
        and grant_row.domain = p_domain and grant_row.is_active and grant_row.project_id is null
    )
    or (p_domain = 'contract' and app_private.contract_data_actor_can_manage(null))
  );
$$;

-- Projects the current actor may view for a domain (switches plus the
-- payment / quantity-acceptance Rooms). Evaluate once per statement.
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
      on action.room_member_id = member.id and action.is_active and action.action_code = 'view'
    join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
    where member.is_active
      and member.room_code in ('payment', 'quantity_acceptance')
      and staff.user_id = public.current_app_user_id()::text
  ) visible;
$$;

-- Construction sites of those projects, for rows that carry only a site id.
create or replace function app_private.sensitive_view_site_ids(p_domain text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(project_row.construction_site_id::text), '{}'::text[])
  from public.projects project_row
  where project_row.construction_site_id is not null
    and project_row.id = any(app_private.sensitive_view_project_ids(p_domain));
$$;

create or replace function app_private.sensitive_can_view(p_domain text, p_project_id text, p_construction_site_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.sensitive_view_all(p_domain)
    or (nullif(p_project_id, '') is not null and p_project_id = any(app_private.sensitive_view_project_ids(p_domain)))
    or (nullif(p_construction_site_id, '') is not null and p_construction_site_id = any(app_private.sensitive_view_site_ids(p_domain)));
$$;

revoke all on function app_private.sensitive_view_all(text) from public, anon;
revoke all on function app_private.sensitive_view_project_ids(text) from public, anon;
revoke all on function app_private.sensitive_view_site_ids(text) from public, anon;
revoke all on function app_private.sensitive_can_view(text, text, text) from public, anon;
grant execute on function app_private.sensitive_view_all(text) to authenticated;
grant execute on function app_private.sensitive_view_project_ids(text) to authenticated;
grant execute on function app_private.sensitive_view_site_ids(text) to authenticated;
grant execute on function app_private.sensitive_can_view(text, text, text) to authenticated;

-- What the signed-in user may view in one project (drives locked screens).
create or replace function public.get_my_project_sensitive_access(
  p_project_id text,
  p_construction_site_id text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'finance', app_private.sensitive_can_view('finance', p_project_id, p_construction_site_id),
    'contract', app_private.sensitive_can_view('contract', p_project_id, p_construction_site_id)
  );
$$;
revoke all on function public.get_my_project_sensitive_access(text, text) from public, anon;
grant execute on function public.get_my_project_sensitive_access(text, text) to authenticated;

-- Admin view: project people and anyone holding a switch, with why they can see.
-- p_project_id NULL lists only the all-projects switches.
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
      on action.room_member_id = member.id and action.is_active and action.action_code = 'view'
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
revoke all on function public.list_project_sensitive_view_access(text) from public, anon;
grant execute on function public.list_project_sensitive_view_access(text) to authenticated;

create or replace function public.set_project_sensitive_view_grant(
  p_user_id uuid,
  p_project_id text,
  p_domain text,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_grant_id uuid;
  v_changed boolean := false;
begin
  if not public.is_admin() then
    raise exception 'SENSITIVE_VIEW_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_domain not in ('finance', 'contract') then
    raise exception 'SENSITIVE_VIEW_DOMAIN_INVALID' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'SENSITIVE_VIEW_REASON_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and is_active and account_status = 'ACTIVE') then
    raise exception 'SENSITIVE_VIEW_USER_INACTIVE' using errcode = '22023';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'SENSITIVE_VIEW_PROJECT_NOT_FOUND' using errcode = '22023';
  end if;

  if p_enabled then
    insert into public.project_sensitive_view_grants (project_id, user_id, domain, reason, granted_by)
    values (p_project_id, p_user_id, p_domain, btrim(p_reason), v_actor)
    on conflict ((coalesce(project_id, '*')), user_id, domain) where is_active do nothing
    returning id into v_grant_id;
    v_changed := v_grant_id is not null;
  else
    update public.project_sensitive_view_grants
    set is_active = false, revoked_by = v_actor, revoked_at = now(), revoke_reason = btrim(p_reason)
    where user_id = p_user_id and domain = p_domain and is_active
      and project_id is not distinct from p_project_id
    returning id into v_grant_id;
    v_changed := v_grant_id is not null;
  end if;

  if v_changed then
    insert into public.audit_trail (table_name, record_id, action, new_data, module, description)
    values (
      'project_sensitive_view_grants', v_grant_id::text,
      case when p_enabled then 'INSERT' else 'UPDATE' end,
      jsonb_build_object('userId', p_user_id, 'projectId', p_project_id, 'domain', p_domain, 'enabled', p_enabled),
      'DA',
      case when p_enabled then 'Mở quyền xem ' else 'Tắt quyền xem ' end
        || case when p_domain = 'finance' then 'tài chính' else 'hợp đồng' end
        || case when p_project_id is null then ' (tất cả dự án)' else ' dự án' end
        || ': ' || btrim(p_reason)
    );
  end if;

  return jsonb_build_object('changed', v_changed, 'grantId', v_grant_id);
end;
$$;
revoke all on function public.set_project_sensitive_view_grant(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.set_project_sensitive_view_grant(uuid, text, text, boolean, text) to authenticated;
