begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.safety_workforce_normalize_identity(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(upper(regexp_replace(trim(coalesce(p_value, '')), '[^[:alnum:]]', '', 'g')), '');
$$;

revoke all on function app_private.safety_workforce_normalize_identity(text) from public, anon;
grant execute on function app_private.safety_workforce_normalize_identity(text) to authenticated;

alter table public.safety_worker_profiles
  add column if not exists worker_kind text,
  add column if not exists identity_number_normalized text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'safety_worker_profiles_worker_kind_check'
      and conrelid = 'public.safety_worker_profiles'::regclass
  ) then
    alter table public.safety_worker_profiles
      add constraint safety_worker_profiles_worker_kind_check
      check (worker_kind is null or worker_kind in ('company_staff', 'contractor_worker'));
  end if;
end;
$$;

create unique index if not exists safety_worker_profiles_identity_normalized_idx
  on public.safety_worker_profiles(identity_number_normalized)
  where identity_number_normalized is not null;

create or replace function app_private.set_safety_workforce_profile_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.identity_number_normalized := app_private.safety_workforce_normalize_identity(new.identity_number);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.set_safety_workforce_profile_identity() from public, anon, authenticated;

drop trigger if exists trg_safety_workforce_profile_identity on public.safety_worker_profiles;
create trigger trg_safety_workforce_profile_identity
  before insert or update of identity_number on public.safety_worker_profiles
  for each row
  execute function app_private.set_safety_workforce_profile_identity();

create table public.safety_worker_site_memberships (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.safety_worker_profiles(id) on delete restrict,
  project_id text not null references public.projects(id) on delete restrict,
  construction_site_id uuid not null references public.hrm_construction_sites(id) on delete restrict,
  default_subcontractor_id uuid references public.safety_subcontractors(id) on delete set null,
  default_team_id uuid references public.safety_teams(id) on delete set null,
  status text not null default 'candidate'
    check (status in ('candidate', 'active', 'inactive')),
  first_joined_at timestamptz not null default now(),
  last_left_at timestamptz,
  source text not null default 'manual'
    check (source in ('manual', 'transfer', 'son_mien_bac_backfill_v1')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_worker_memberships_worker_site_unique unique (worker_id, construction_site_id),
  constraint safety_worker_memberships_date_order_check
    check (last_left_at is null or last_left_at >= first_joined_at)
);

create index if not exists safety_memberships_worker_idx
  on public.safety_worker_site_memberships(worker_id);
create index if not exists safety_memberships_project_idx
  on public.safety_worker_site_memberships(project_id);
create index if not exists safety_memberships_site_status_created_idx
  on public.safety_worker_site_memberships(construction_site_id, status, created_at desc, id desc);
create index if not exists safety_memberships_default_subcontractor_idx
  on public.safety_worker_site_memberships(default_subcontractor_id)
  where default_subcontractor_id is not null;
create index if not exists safety_memberships_default_team_idx
  on public.safety_worker_site_memberships(default_team_id)
  where default_team_id is not null;
create index if not exists safety_memberships_created_by_idx
  on public.safety_worker_site_memberships(created_by)
  where created_by is not null;
create index if not exists safety_memberships_updated_by_idx
  on public.safety_worker_site_memberships(updated_by)
  where updated_by is not null;

create or replace function app_private.set_safety_workforce_membership_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.set_safety_workforce_membership_updated_at() from public, anon, authenticated;

create trigger trg_safety_workforce_membership_updated_at
  before update on public.safety_worker_site_memberships
  for each row
  execute function app_private.set_safety_workforce_membership_updated_at();

alter table public.safety_project_assignments
  add column if not exists membership_id uuid references public.safety_worker_site_memberships(id) on delete restrict,
  add column if not exists assignment_status text,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists subcontractor_id uuid references public.safety_subcontractors(id) on delete set null,
  add column if not exists team_id uuid references public.safety_teams(id) on delete set null,
  add column if not exists ended_by uuid references public.users(id) on delete set null,
  add column if not exists ended_reason text,
  add column if not exists source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'safety_project_assignments_lifecycle_status_check'
      and conrelid = 'public.safety_project_assignments'::regclass
  ) then
    alter table public.safety_project_assignments
      add constraint safety_project_assignments_lifecycle_status_check
      check (assignment_status is null or assignment_status in ('active', 'ended', 'suspended', 'cancelled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'safety_project_assignments_lifecycle_dates_check'
      and conrelid = 'public.safety_project_assignments'::regclass
  ) then
    alter table public.safety_project_assignments
      add constraint safety_project_assignments_lifecycle_dates_check
      check (ended_at is null or started_at is null or ended_at >= started_at);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'safety_project_assignments_source_check'
      and conrelid = 'public.safety_project_assignments'::regclass
  ) then
    alter table public.safety_project_assignments
      add constraint safety_project_assignments_source_check
      check (source is null or source in ('manual', 'legacy', 'transfer', 'son_mien_bac_backfill_v1'));
  end if;
end;
$$;

create unique index if not exists safety_worker_assignments_one_active_idx
  on public.safety_project_assignments(worker_id)
  where assignment_status = 'active';
create index if not exists safety_assignments_membership_started_idx
  on public.safety_project_assignments(membership_id, started_at desc, id desc)
  where membership_id is not null;
create index if not exists safety_assignments_subcontractor_idx
  on public.safety_project_assignments(subcontractor_id)
  where subcontractor_id is not null;
create index if not exists safety_assignments_team_idx
  on public.safety_project_assignments(team_id)
  where team_id is not null;
create index if not exists safety_assignments_ended_by_idx
  on public.safety_project_assignments(ended_by)
  where ended_by is not null;

create or replace function app_private.safety_workforce_assert_scope(
  p_project_id text,
  p_construction_site_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_project_id), '') is null or p_construction_site_id is null then
    raise exception 'SAFETY_SCOPE_REQUIRED: project and construction site are required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.projects project_row
    where project_row.id = p_project_id
      and project_row.construction_site_id = p_construction_site_id
  ) then
    raise exception 'SAFETY_SCOPE_MISMATCH: project is not linked to construction site'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function app_private.safety_workforce_can_view(
  p_project_id text,
  p_construction_site_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_app_user_id() is not null
    and exists (
      select 1
      from public.projects project_row
      where project_row.id = p_project_id
        and project_row.construction_site_id = p_construction_site_id
    )
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id::text,
        'project.safety.view',
        public.current_app_user_id()
      )
      or app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id::text,
        'project.safety.worker_manage',
        public.current_app_user_id()
      )
      or app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id::text,
        'project.safety.document_verify',
        public.current_app_user_id()
      )
    ),
    false
  );
$$;

create or replace function app_private.safety_workforce_can_manage(
  p_project_id text,
  p_construction_site_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_app_user_id() is not null
    and exists (
      select 1
      from public.projects project_row
      where project_row.id = p_project_id
        and project_row.construction_site_id = p_construction_site_id
    )
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id::text,
        'project.safety.worker_manage',
        public.current_app_user_id()
      )
    ),
    false
  );
$$;

create or replace function app_private.safety_workforce_can_view_sensitive(
  p_project_id text,
  p_construction_site_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.safety_workforce_can_manage(p_project_id, p_construction_site_id)
    or (
      app_private.safety_workforce_can_view(p_project_id, p_construction_site_id)
      and app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id::text,
        'project.safety.document_verify',
        public.current_app_user_id()
      )
    ),
    false
  );
$$;

create or replace function app_private.safety_workforce_can_access_worker_storage(
  p_worker_id uuid,
  p_sensitive boolean,
  p_write boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_worker_id is not null
    and public.current_app_user_id() is not null
    and exists (
      select 1
      from public.safety_worker_site_memberships membership
      where membership.worker_id = p_worker_id
        and case
          when p_write then app_private.safety_workforce_can_manage(
            membership.project_id,
            membership.construction_site_id
          )
          when p_sensitive then app_private.safety_workforce_can_view_sensitive(
            membership.project_id,
            membership.construction_site_id
          )
          else app_private.safety_workforce_can_view(
            membership.project_id,
            membership.construction_site_id
          )
        end
    ),
    false
  );
$$;

create or replace function app_private.safety_workforce_assert_subcontractor_team(
  p_project_id text,
  p_construction_site_id uuid,
  p_subcontractor_id uuid,
  p_team_id uuid,
  p_worker_kind text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.safety_workforce_assert_scope(p_project_id, p_construction_site_id);

  if p_worker_kind is null or p_worker_kind not in ('company_staff', 'contractor_worker') then
    raise exception 'SAFETY_INVALID_WORKER_KIND: unsupported worker kind'
      using errcode = '22023';
  end if;

  if p_worker_kind = 'company_staff' then
    if p_subcontractor_id is not null or p_team_id is not null then
      raise exception 'SAFETY_CONTRACTOR_SCOPE_MISMATCH: company staff cannot use contractor or team'
        using errcode = '22023';
    end if;
    return;
  end if;

  if p_subcontractor_id is null or not exists (
    select 1
    from public.safety_subcontractors subcontractor
    where subcontractor.id = p_subcontractor_id
      and subcontractor.project_id = p_project_id
      and subcontractor.construction_site_id = p_construction_site_id::text
      and subcontractor.status in ('approved', 'active')
  ) then
    raise exception 'SAFETY_CONTRACTOR_SCOPE_MISMATCH: contractor is not active in target site'
      using errcode = '22023';
  end if;

  if p_team_id is not null and not exists (
    select 1
    from public.safety_teams team
    where team.id = p_team_id
      and team.project_id = p_project_id
      and team.construction_site_id = p_construction_site_id::text
      and team.subcontractor_id = p_subcontractor_id
      and team.status = 'active'
  ) then
    raise exception 'SAFETY_TEAM_SCOPE_MISMATCH: team is not active for contractor in target site'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function app_private.safety_workforce_assert_scope(text, uuid) from public, anon;
revoke all on function app_private.safety_workforce_can_view(text, uuid) from public, anon;
revoke all on function app_private.safety_workforce_can_manage(text, uuid) from public, anon;
revoke all on function app_private.safety_workforce_can_view_sensitive(text, uuid) from public, anon;
revoke all on function app_private.safety_workforce_can_access_worker_storage(uuid, boolean, boolean) from public, anon;
revoke all on function app_private.safety_workforce_assert_subcontractor_team(text, uuid, uuid, uuid, text) from public, anon;

grant execute on function app_private.safety_workforce_assert_scope(text, uuid) to authenticated;
grant execute on function app_private.safety_workforce_can_view(text, uuid) to authenticated;
grant execute on function app_private.safety_workforce_can_manage(text, uuid) to authenticated;
grant execute on function app_private.safety_workforce_can_view_sensitive(text, uuid) to authenticated;
grant execute on function app_private.safety_workforce_can_access_worker_storage(uuid, boolean, boolean) to authenticated;
grant execute on function app_private.safety_workforce_assert_subcontractor_team(text, uuid, uuid, uuid, text) to authenticated;

alter table public.safety_worker_site_memberships enable row level security;

drop policy if exists safety_worker_memberships_select on public.safety_worker_site_memberships;
create policy safety_worker_memberships_select
  on public.safety_worker_site_memberships
  for select
  to authenticated
  using (app_private.safety_workforce_can_view(project_id, construction_site_id));

drop policy if exists safety_worker_memberships_insert on public.safety_worker_site_memberships;
create policy safety_worker_memberships_insert
  on public.safety_worker_site_memberships
  for insert
  to authenticated
  with check (
    app_private.safety_workforce_can_manage(project_id, construction_site_id)
    and created_by = (select public.current_app_user_id())
  );

drop policy if exists safety_worker_memberships_update on public.safety_worker_site_memberships;
create policy safety_worker_memberships_update
  on public.safety_worker_site_memberships
  for update
  to authenticated
  using (app_private.safety_workforce_can_manage(project_id, construction_site_id))
  with check (
    app_private.safety_workforce_can_manage(project_id, construction_site_id)
    and updated_by = (select public.current_app_user_id())
  );

grant select, insert, update on public.safety_worker_site_memberships to authenticated;

notify pgrst, 'reload schema';

commit;
