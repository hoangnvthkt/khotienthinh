-- G8 cost norm library import.
-- Stores deterministic Excel parse results in a normalized work item/component model.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.cost_norm_libraries (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  code text not null,
  source text not null default 'G8',
  version text,
  region text,
  decision_no text,
  effective_date date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  description text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cost_norm_items (
  id text primary key default gen_random_uuid()::text,
  library_id text not null references public.cost_norm_libraries(id) on delete cascade,
  code text not null,
  name text not null,
  unit text,
  source_sheet_name text,
  source_row_start integer,
  source_row_end integer,
  search_text text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_norm_items_library_code_uniq unique (library_id, code)
);

create table if not exists public.cost_norm_resources (
  id text primary key default gen_random_uuid()::text,
  code text not null,
  name text not null,
  type text not null
    check (type in ('material', 'labor', 'machine', 'adjustment', 'other')),
  unit text,
  search_text text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_norm_resources_type_code_uniq unique (type, code)
);

create table if not exists public.cost_norm_item_components (
  id text primary key default gen_random_uuid()::text,
  norm_item_id text not null references public.cost_norm_items(id) on delete cascade,
  resource_id text references public.cost_norm_resources(id) on delete set null,
  resource_type text not null
    check (resource_type in ('material', 'labor', 'machine', 'adjustment', 'other')),
  raw_resource_code text,
  raw_resource_name text not null,
  unit text,
  coefficient numeric(18, 6),
  line_index integer not null default 0,
  source_sheet_name text,
  source_row_number integer,
  is_adjustment boolean not null default false,
  note text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cost_norm_import_jobs (
  id text primary key default gen_random_uuid()::text,
  library_id text references public.cost_norm_libraries(id) on delete set null,
  file_name text not null,
  file_url text,
  file_size bigint,
  file_hash text,
  status text not null default 'previewed'
    check (status in ('previewed', 'committing', 'committed', 'failed', 'cancelled')),
  total_rows integer not null default 0 check (total_rows >= 0),
  parsed_items integer not null default 0 check (parsed_items >= 0),
  parsed_components integer not null default 0 check (parsed_components >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  parser_version text not null default 'g8-v1',
  result_summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.cost_norm_import_errors (
  id text primary key default gen_random_uuid()::text,
  import_job_id text not null references public.cost_norm_import_jobs(id) on delete cascade,
  sheet_name text,
  row_number integer,
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'error')),
  code text not null,
  message text not null,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cost_norm_libraries_status
  on public.cost_norm_libraries(status, source, created_at desc);
create index if not exists idx_cost_norm_items_library
  on public.cost_norm_items(library_id, code);
create index if not exists idx_cost_norm_items_search_trgm
  on public.cost_norm_items using gin (search_text gin_trgm_ops);
create index if not exists idx_cost_norm_resources_lookup
  on public.cost_norm_resources(type, code);
create index if not exists idx_cost_norm_resources_search_trgm
  on public.cost_norm_resources using gin (search_text gin_trgm_ops);
create index if not exists idx_cost_norm_components_item
  on public.cost_norm_item_components(norm_item_id, line_index);
create index if not exists idx_cost_norm_components_resource
  on public.cost_norm_item_components(resource_id);
create index if not exists idx_cost_norm_import_jobs_created
  on public.cost_norm_import_jobs(created_at desc);
create index if not exists idx_cost_norm_import_errors_job
  on public.cost_norm_import_errors(import_job_id, severity, row_number);

drop trigger if exists trg_cost_norm_libraries_updated_at on public.cost_norm_libraries;
create trigger trg_cost_norm_libraries_updated_at
before update on public.cost_norm_libraries
for each row execute function public.set_updated_at();

drop trigger if exists trg_cost_norm_items_updated_at on public.cost_norm_items;
create trigger trg_cost_norm_items_updated_at
before update on public.cost_norm_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_cost_norm_resources_updated_at on public.cost_norm_resources;
create trigger trg_cost_norm_resources_updated_at
before update on public.cost_norm_resources
for each row execute function public.set_updated_at();

alter table public.cost_norm_libraries enable row level security;
alter table public.cost_norm_items enable row level security;
alter table public.cost_norm_resources enable row level security;
alter table public.cost_norm_item_components enable row level security;
alter table public.cost_norm_import_jobs enable row level security;
alter table public.cost_norm_import_errors enable row level security;

grant select, insert, update, delete on public.cost_norm_libraries to authenticated;
grant select, insert, update, delete on public.cost_norm_items to authenticated;
grant select, insert, update, delete on public.cost_norm_resources to authenticated;
grant select, insert, update, delete on public.cost_norm_item_components to authenticated;
grant select, insert, update, delete on public.cost_norm_import_jobs to authenticated;
grant select, insert, update, delete on public.cost_norm_import_errors to authenticated;

drop policy if exists cost_norm_libraries_access on public.cost_norm_libraries;
create policy cost_norm_libraries_access on public.cost_norm_libraries
for all to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
);

drop policy if exists cost_norm_items_access on public.cost_norm_items;
create policy cost_norm_items_access on public.cost_norm_items
for all to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
);

drop policy if exists cost_norm_resources_access on public.cost_norm_resources;
create policy cost_norm_resources_access on public.cost_norm_resources
for all to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
);

drop policy if exists cost_norm_components_access on public.cost_norm_item_components;
create policy cost_norm_components_access on public.cost_norm_item_components
for all to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
);

drop policy if exists cost_norm_import_jobs_access on public.cost_norm_import_jobs;
create policy cost_norm_import_jobs_access on public.cost_norm_import_jobs
for all to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
);

drop policy if exists cost_norm_import_errors_access on public.cost_norm_import_errors;
create policy cost_norm_import_errors_access on public.cost_norm_import_errors
for all to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
);
