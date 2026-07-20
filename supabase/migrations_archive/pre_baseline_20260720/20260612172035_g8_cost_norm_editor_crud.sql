-- G8 master-data editor and CRUD support.
-- Adds update metadata, component update tracking, and an audit log for manual curation.

create extension if not exists pgcrypto;

alter table public.cost_norm_libraries
  add column if not exists updated_by uuid references public.users(id) on delete set null;

alter table public.cost_norm_items
  add column if not exists updated_by uuid references public.users(id) on delete set null;

alter table public.cost_norm_resources
  add column if not exists updated_by uuid references public.users(id) on delete set null;

alter table public.cost_norm_item_components
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users(id) on delete set null;

drop trigger if exists trg_cost_norm_components_updated_at on public.cost_norm_item_components;
create trigger trg_cost_norm_components_updated_at
before update on public.cost_norm_item_components
for each row execute function public.set_updated_at();

create table if not exists public.cost_norm_change_logs (
  id text primary key default gen_random_uuid()::text,
  library_id text references public.cost_norm_libraries(id) on delete cascade,
  norm_item_id text references public.cost_norm_items(id) on delete set null,
  component_id text references public.cost_norm_item_components(id) on delete set null,
  action text not null
    check (action in (
      'library_update',
      'item_create',
      'item_update',
      'item_delete',
      'component_create',
      'component_update',
      'component_delete'
    )),
  actor_id uuid references public.users(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cost_norm_change_logs_library
  on public.cost_norm_change_logs(library_id, created_at desc);
create index if not exists idx_cost_norm_change_logs_item
  on public.cost_norm_change_logs(norm_item_id, created_at desc)
  where norm_item_id is not null;

alter table public.cost_norm_change_logs enable row level security;
grant select, insert on public.cost_norm_change_logs to authenticated;

drop policy if exists cost_norm_change_logs_admin_access on public.cost_norm_change_logs;
create policy cost_norm_change_logs_admin_access on public.cost_norm_change_logs
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- V3: G8 is system master data. Keep all manage/read access admin-only until
-- a later consumption phase exposes active catalogs read-only to HD/Tender.
drop policy if exists cost_norm_libraries_access on public.cost_norm_libraries;
drop policy if exists cost_norm_libraries_admin_access on public.cost_norm_libraries;
create policy cost_norm_libraries_admin_access on public.cost_norm_libraries
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists cost_norm_items_access on public.cost_norm_items;
drop policy if exists cost_norm_items_admin_access on public.cost_norm_items;
create policy cost_norm_items_admin_access on public.cost_norm_items
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists cost_norm_resources_access on public.cost_norm_resources;
drop policy if exists cost_norm_resources_admin_access on public.cost_norm_resources;
create policy cost_norm_resources_admin_access on public.cost_norm_resources
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists cost_norm_components_access on public.cost_norm_item_components;
drop policy if exists cost_norm_components_admin_access on public.cost_norm_item_components;
create policy cost_norm_components_admin_access on public.cost_norm_item_components
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists cost_norm_import_jobs_access on public.cost_norm_import_jobs;
drop policy if exists cost_norm_import_jobs_admin_access on public.cost_norm_import_jobs;
create policy cost_norm_import_jobs_admin_access on public.cost_norm_import_jobs
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists cost_norm_import_errors_access on public.cost_norm_import_errors;
drop policy if exists cost_norm_import_errors_admin_access on public.cost_norm_import_errors;
create policy cost_norm_import_errors_admin_access on public.cost_norm_import_errors
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists cost_norm_import_raw_rows_admin_access on public.cost_norm_import_raw_rows;
create policy cost_norm_import_raw_rows_admin_access on public.cost_norm_import_raw_rows
for all to authenticated
using (public.is_admin())
with check (public.is_admin());
