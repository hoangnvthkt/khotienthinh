-- Stores the full deterministic row trace for G8 imports.
-- The normalized item/component tables keep quick trace snippets; this table is the master raw source for review.

create extension if not exists pgcrypto;

create table if not exists public.cost_norm_import_raw_rows (
  id text primary key default gen_random_uuid()::text,
  import_job_id text not null references public.cost_norm_import_jobs(id) on delete cascade,
  library_id text references public.cost_norm_libraries(id) on delete cascade,
  sheet_name text not null,
  row_number integer not null,
  row_type text not null
    check (row_type in ('work_item', 'group', 'component', 'ignored', 'warning')),
  row_text text,
  raw_values jsonb not null default '{}'::jsonb,
  values jsonb not null default '[]'::jsonb,
  work_item_code text,
  parent_item_code text,
  resource_code text,
  resource_type text
    check (resource_type is null or resource_type in ('material', 'labor', 'machine', 'adjustment', 'other')),
  coefficient numeric(18, 6),
  parsed_data jsonb not null default '{}'::jsonb,
  warnings text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint cost_norm_import_raw_rows_job_sheet_row_uniq unique (import_job_id, sheet_name, row_number)
);

create index if not exists idx_cost_norm_import_raw_rows_job
  on public.cost_norm_import_raw_rows(import_job_id, row_number);
create index if not exists idx_cost_norm_import_raw_rows_library
  on public.cost_norm_import_raw_rows(library_id, row_type, row_number);
create index if not exists idx_cost_norm_import_raw_rows_work_item
  on public.cost_norm_import_raw_rows(library_id, work_item_code)
  where work_item_code is not null;
create index if not exists idx_cost_norm_import_raw_rows_resource
  on public.cost_norm_import_raw_rows(library_id, resource_code)
  where resource_code is not null;

alter table public.cost_norm_import_raw_rows enable row level security;

grant select, insert, update, delete on public.cost_norm_import_raw_rows to authenticated;

drop policy if exists cost_norm_import_raw_rows_admin_access on public.cost_norm_import_raw_rows;
create policy cost_norm_import_raw_rows_admin_access on public.cost_norm_import_raw_rows
for all to authenticated
using (public.is_admin())
with check (public.is_admin());
