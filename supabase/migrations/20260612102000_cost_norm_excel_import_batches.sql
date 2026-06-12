-- Cost norm Excel import audit trail.
-- Stores the reviewed AI parse result separately from the finalized norm library.

create table if not exists public.cost_norm_import_batches (
  id text primary key default gen_random_uuid()::text,
  file_name text not null,
  sheet_name text not null,
  template_id text references public.cost_templates(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'imported', 'cancelled')),
  total_rows integer not null default 0 check (total_rows >= 0),
  parsed_packages integer not null default 0 check (parsed_packages >= 0),
  parsed_lines integer not null default 0 check (parsed_lines >= 0),
  confidence_score numeric(5, 4) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  warnings jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cost_norm_import_rows (
  id text primary key default gen_random_uuid()::text,
  batch_id text not null references public.cost_norm_import_batches(id) on delete cascade,
  sheet_name text not null,
  row_number integer not null check (row_number > 0),
  raw_values jsonb not null default '{}'::jsonb,
  parsed_package jsonb not null default '{}'::jsonb,
  parsed_line jsonb not null default '{}'::jsonb,
  confidence_score numeric(5, 4) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  warnings jsonb not null default '[]'::jsonb,
  status text not null default 'parsed'
    check (status in ('raw', 'parsed', 'reviewed', 'ignored', 'imported', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_norm_import_rows_batch_row_uniq unique (batch_id, row_number)
);

create index if not exists idx_cost_norm_import_batches_created
  on public.cost_norm_import_batches(created_at desc);

create index if not exists idx_cost_norm_import_batches_template
  on public.cost_norm_import_batches(template_id, created_at desc);

create index if not exists idx_cost_norm_import_rows_batch
  on public.cost_norm_import_rows(batch_id, row_number);

drop trigger if exists trg_cost_norm_import_batches_updated_at on public.cost_norm_import_batches;
create trigger trg_cost_norm_import_batches_updated_at
before update on public.cost_norm_import_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_cost_norm_import_rows_updated_at on public.cost_norm_import_rows;
create trigger trg_cost_norm_import_rows_updated_at
before update on public.cost_norm_import_rows
for each row execute function public.set_updated_at();

alter table public.cost_norm_import_batches enable row level security;
alter table public.cost_norm_import_rows enable row level security;

grant select, insert, update, delete on public.cost_norm_import_batches to authenticated;
grant select, insert, update, delete on public.cost_norm_import_rows to authenticated;

drop policy if exists cost_norm_import_batches_select on public.cost_norm_import_batches;
create policy cost_norm_import_batches_select on public.cost_norm_import_batches
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
);

drop policy if exists cost_norm_import_batches_manage on public.cost_norm_import_batches;
create policy cost_norm_import_batches_manage on public.cost_norm_import_batches
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

drop policy if exists cost_norm_import_rows_select on public.cost_norm_import_rows;
create policy cost_norm_import_rows_select on public.cost_norm_import_rows
for select to authenticated
using (
  exists (
    select 1
    from public.cost_norm_import_batches b
    where b.id = batch_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('TENDER_AI')
      )
  )
);

drop policy if exists cost_norm_import_rows_manage on public.cost_norm_import_rows;
create policy cost_norm_import_rows_manage on public.cost_norm_import_rows
for all to authenticated
using (
  exists (
    select 1
    from public.cost_norm_import_batches b
    where b.id = batch_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('TENDER_AI')
      )
  )
)
with check (
  exists (
    select 1
    from public.cost_norm_import_batches b
    where b.id = batch_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('TENDER_AI')
      )
  )
);
