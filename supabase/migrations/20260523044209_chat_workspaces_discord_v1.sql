-- Chat Discord workspace V1
-- Adds real top-level chat channels/workspaces and account settings.

create table if not exists public.chat_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_text text,
  color text not null default 'indigo',
  description text,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.users(id)
);

create table if not exists public.chat_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chat_workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.users(id),
  unique (workspace_id, user_id)
);

alter table public.chat_user_settings
  add column if not exists sound_enabled boolean not null default true,
  add column if not exists notifications_enabled boolean not null default true,
  add column if not exists default_muted boolean not null default false,
  add column if not exists default_deafened boolean not null default false,
  add column if not exists status text not null default 'online',
  add column if not exists last_workspace_id uuid references public.chat_workspaces(id);

alter table public.chat_user_settings
  drop constraint if exists chat_user_settings_status_check;

alter table public.chat_user_settings
  add constraint chat_user_settings_status_check
  check (status in ('online', 'busy', 'away', 'offline'));

create index if not exists idx_chat_workspaces_active_sort
  on public.chat_workspaces(is_public, sort_order, name)
  where deleted_at is null;

create index if not exists idx_chat_workspace_members_user
  on public.chat_workspace_members(user_id, left_at);

create index if not exists idx_chat_workspace_members_workspace
  on public.chat_workspace_members(workspace_id, left_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_chat_workspaces_updated_at on public.chat_workspaces;
create trigger trg_chat_workspaces_updated_at
  before update on public.chat_workspaces
  for each row execute function public.set_updated_at();

alter table public.chat_workspaces enable row level security;
alter table public.chat_workspace_members enable row level security;

drop policy if exists chat_workspaces_select on public.chat_workspaces;
drop policy if exists chat_workspaces_insert on public.chat_workspaces;
drop policy if exists chat_workspaces_update on public.chat_workspaces;
drop policy if exists chat_workspaces_delete on public.chat_workspaces;
drop policy if exists chat_workspace_members_select on public.chat_workspace_members;
drop policy if exists chat_workspace_members_insert on public.chat_workspace_members;
drop policy if exists chat_workspace_members_update on public.chat_workspace_members;
drop policy if exists chat_workspace_members_delete on public.chat_workspace_members;

create policy chat_workspaces_select
  on public.chat_workspaces
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      public.is_admin()
      or exists (
        select 1
        from public.chat_workspace_members cwm
        where cwm.workspace_id = chat_workspaces.id
          and cwm.user_id = public.current_app_user_id()
          and cwm.left_at is null
      )
    )
  );

create policy chat_workspaces_insert
  on public.chat_workspaces
  for insert
  to authenticated
  with check (created_by = public.current_app_user_id() or public.is_admin());

create policy chat_workspaces_update
  on public.chat_workspaces
  for update
  to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_workspace_members cwm
      where cwm.workspace_id = chat_workspaces.id
        and cwm.user_id = public.current_app_user_id()
        and cwm.role in ('owner', 'admin')
        and cwm.left_at is null
    )
  )
  with check (
    public.is_admin()
    or created_by = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_workspace_members cwm
      where cwm.workspace_id = chat_workspaces.id
        and cwm.user_id = public.current_app_user_id()
        and cwm.role in ('owner', 'admin')
        and cwm.left_at is null
    )
  );

create policy chat_workspaces_delete
  on public.chat_workspaces
  for delete
  to authenticated
  using (public.is_admin() or created_by = public.current_app_user_id());

create policy chat_workspace_members_select
  on public.chat_workspace_members
  for select
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_workspace_members mine
      where mine.workspace_id = chat_workspace_members.workspace_id
        and mine.user_id = public.current_app_user_id()
        and mine.left_at is null
    )
  );

create policy chat_workspace_members_insert
  on public.chat_workspace_members
  for insert
  to authenticated
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_workspaces cw
      where cw.id = chat_workspace_members.workspace_id
        and cw.created_by = public.current_app_user_id()
        and cw.deleted_at is null
    )
    or exists (
      select 1
      from public.chat_workspace_members mine
      where mine.workspace_id = chat_workspace_members.workspace_id
        and mine.user_id = public.current_app_user_id()
        and mine.role in ('owner', 'admin')
        and mine.left_at is null
    )
  );

create policy chat_workspace_members_update
  on public.chat_workspace_members
  for update
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_workspaces cw
      where cw.id = chat_workspace_members.workspace_id
        and cw.created_by = public.current_app_user_id()
        and cw.deleted_at is null
    )
    or exists (
      select 1
      from public.chat_workspace_members mine
      where mine.workspace_id = chat_workspace_members.workspace_id
        and mine.user_id = public.current_app_user_id()
        and mine.role in ('owner', 'admin')
        and mine.left_at is null
    )
  )
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_workspaces cw
      where cw.id = chat_workspace_members.workspace_id
        and cw.created_by = public.current_app_user_id()
        and cw.deleted_at is null
    )
    or exists (
      select 1
      from public.chat_workspace_members mine
      where mine.workspace_id = chat_workspace_members.workspace_id
        and mine.user_id = public.current_app_user_id()
        and mine.role in ('owner', 'admin')
        and mine.left_at is null
    )
  );

create policy chat_workspace_members_delete
  on public.chat_workspace_members
  for delete
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_workspaces cw
      where cw.id = chat_workspace_members.workspace_id
        and cw.created_by = public.current_app_user_id()
        and cw.deleted_at is null
    )
  );

grant select, insert, update, delete on public.chat_workspaces to authenticated;
grant select, insert, update, delete on public.chat_workspace_members to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_workspaces'
    ) then
      alter publication supabase_realtime add table public.chat_workspaces;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_workspace_members'
    ) then
      alter publication supabase_realtime add table public.chat_workspace_members;
    end if;
  end if;
end $$;
