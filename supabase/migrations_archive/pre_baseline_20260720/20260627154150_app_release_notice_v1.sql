-- App release notes / What's New notice.
-- Users see the latest active release once after login.

create extension if not exists pgcrypto;

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  title text not null,
  release_date date not null default current_date,
  summary text not null default '',
  features jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  bug_fixes jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint app_releases_version_unique unique (version),
  constraint app_releases_features_array check (jsonb_typeof(features) = 'array'),
  constraint app_releases_improvements_array check (jsonb_typeof(improvements) = 'array'),
  constraint app_releases_bug_fixes_array check (jsonb_typeof(bug_fixes) = 'array')
);

create table if not exists public.user_release_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  release_id uuid not null references public.app_releases(id) on delete cascade,
  read_at timestamptz not null default now(),
  constraint user_release_reads_user_release_unique unique (user_id, release_id)
);

create index if not exists idx_app_releases_active_latest
  on public.app_releases(is_active, release_date desc, created_at desc);

create index if not exists idx_user_release_reads_user_release
  on public.user_release_reads(user_id, release_id);

alter table public.app_releases enable row level security;
alter table public.user_release_reads enable row level security;

drop policy if exists app_releases_select_active on public.app_releases;
drop policy if exists app_releases_admin_insert on public.app_releases;
drop policy if exists app_releases_admin_update on public.app_releases;
drop policy if exists app_releases_admin_delete on public.app_releases;

create policy app_releases_select_active
on public.app_releases
for select
to authenticated
using (is_active or public.is_admin());

create policy app_releases_admin_insert
on public.app_releases
for insert
to authenticated
with check (public.is_admin());

create policy app_releases_admin_update
on public.app_releases
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy app_releases_admin_delete
on public.app_releases
for delete
to authenticated
using (public.is_admin());

drop policy if exists user_release_reads_select_own on public.user_release_reads;
drop policy if exists user_release_reads_insert_own on public.user_release_reads;
drop policy if exists user_release_reads_admin_delete on public.user_release_reads;

create policy user_release_reads_select_own
on public.user_release_reads
for select
to authenticated
using (user_id = public.current_app_user_id() or public.is_admin());

create policy user_release_reads_insert_own
on public.user_release_reads
for insert
to authenticated
with check (user_id = public.current_app_user_id());

create policy user_release_reads_admin_delete
on public.user_release_reads
for delete
to authenticated
using (public.is_admin());

grant select, insert, update, delete on table public.app_releases to authenticated;
grant select, insert, delete on table public.user_release_reads to authenticated;

notify pgrst, 'reload schema';
