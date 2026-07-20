-- BOQ reconciliation: contract BOQ and execution BOQ are independent trees.
-- This adds an auditable many-to-many reconciliation layer between them.

create table if not exists public.boq_reconciliation_groups (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  contract_type text not null check (contract_type in ('customer', 'subcontractor')),
  contract_id uuid,
  code text,
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'reviewed', 'locked')),
  prepared_by_id text,
  prepared_by_name text,
  reviewed_by_id text,
  reviewed_by_name text,
  reviewed_at timestamptz,
  locked_by_id text,
  locked_by_name text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boq_reconciliation_groups_scope_check
    check (project_id is not null or construction_site_id is not null)
);

create index if not exists idx_boq_reconciliation_groups_project
  on public.boq_reconciliation_groups(project_id, contract_type, status);
create index if not exists idx_boq_reconciliation_groups_site
  on public.boq_reconciliation_groups(construction_site_id, contract_type, status);
create index if not exists idx_boq_reconciliation_groups_contract
  on public.boq_reconciliation_groups(contract_id, contract_type);

create table if not exists public.boq_reconciliation_contract_lines (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.boq_reconciliation_groups(id) on delete cascade,
  contract_item_id uuid not null references public.contract_items(id) on delete cascade,
  contract_id uuid,
  contract_type text not null check (contract_type in ('customer', 'subcontractor')),
  original_quantity numeric not null default 0,
  original_unit text,
  allocated_quantity numeric not null default 0,
  allocated_percent numeric,
  converted_quantity numeric not null default 0,
  converted_unit text,
  conversion_factor numeric not null default 1,
  conversion_formula text,
  unit_price_snapshot numeric not null default 0,
  amount_snapshot numeric not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, contract_item_id)
);

create index if not exists idx_boq_recon_contract_lines_group
  on public.boq_reconciliation_contract_lines(group_id);
create index if not exists idx_boq_recon_contract_lines_item
  on public.boq_reconciliation_contract_lines(contract_item_id);

create table if not exists public.boq_reconciliation_work_lines (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.boq_reconciliation_groups(id) on delete cascade,
  work_boq_item_id text not null references public.project_work_boq_items(id) on delete cascade,
  source_task_id text,
  original_quantity numeric not null default 0,
  original_unit text,
  allocated_quantity numeric not null default 0,
  allocated_percent numeric,
  converted_quantity numeric not null default 0,
  converted_unit text,
  conversion_factor numeric not null default 1,
  conversion_formula text,
  unit_price_snapshot numeric not null default 0,
  amount_snapshot numeric not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, work_boq_item_id)
);

create index if not exists idx_boq_recon_work_lines_group
  on public.boq_reconciliation_work_lines(group_id);
create index if not exists idx_boq_recon_work_lines_item
  on public.boq_reconciliation_work_lines(work_boq_item_id);
create index if not exists idx_boq_recon_work_lines_task
  on public.boq_reconciliation_work_lines(source_task_id);

alter table if exists public.daily_log_volumes
  add column if not exists work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
  add column if not exists work_boq_item_name text;

create index if not exists idx_daily_log_volumes_work_boq_item
  on public.daily_log_volumes(work_boq_item_id);

alter table if exists public.supplier_contracts
  add column if not exists project_id text references public.projects(id) on delete set null,
  add column if not exists construction_site_id text;

create index if not exists idx_supplier_contracts_project_id
  on public.supplier_contracts(project_id);
create index if not exists idx_supplier_contracts_construction_site_id
  on public.supplier_contracts(construction_site_id);

alter table if exists public.project_transactions
  add column if not exists source_ref text;

create unique index if not exists idx_project_transactions_source_ref_unique
  on public.project_transactions(source_ref);

create or replace function public.set_boq_reconciliation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_boq_reconciliation_groups_updated_at on public.boq_reconciliation_groups;
create trigger trg_boq_reconciliation_groups_updated_at
  before update on public.boq_reconciliation_groups
  for each row execute function public.set_boq_reconciliation_updated_at();

drop trigger if exists trg_boq_reconciliation_contract_lines_updated_at on public.boq_reconciliation_contract_lines;
create trigger trg_boq_reconciliation_contract_lines_updated_at
  before update on public.boq_reconciliation_contract_lines
  for each row execute function public.set_boq_reconciliation_updated_at();

drop trigger if exists trg_boq_reconciliation_work_lines_updated_at on public.boq_reconciliation_work_lines;
create trigger trg_boq_reconciliation_work_lines_updated_at
  before update on public.boq_reconciliation_work_lines
  for each row execute function public.set_boq_reconciliation_updated_at();

alter table public.boq_reconciliation_groups enable row level security;
alter table public.boq_reconciliation_contract_lines enable row level security;
alter table public.boq_reconciliation_work_lines enable row level security;

drop policy if exists boq_reconciliation_groups_project_access on public.boq_reconciliation_groups;
create policy boq_reconciliation_groups_project_access
  on public.boq_reconciliation_groups
  for all
  to authenticated
  using (project_id is not null or construction_site_id is not null)
  with check (project_id is not null or construction_site_id is not null);

drop policy if exists boq_reconciliation_contract_lines_group_access on public.boq_reconciliation_contract_lines;
create policy boq_reconciliation_contract_lines_group_access
  on public.boq_reconciliation_contract_lines
  for all
  to authenticated
  using (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_contract_lines.group_id
      and (g.project_id is not null or g.construction_site_id is not null)
  ))
  with check (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_contract_lines.group_id
      and (g.project_id is not null or g.construction_site_id is not null)
  ));

drop policy if exists boq_reconciliation_work_lines_group_access on public.boq_reconciliation_work_lines;
create policy boq_reconciliation_work_lines_group_access
  on public.boq_reconciliation_work_lines
  for all
  to authenticated
  using (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_work_lines.group_id
      and (g.project_id is not null or g.construction_site_id is not null)
  ))
  with check (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_work_lines.group_id
      and (g.project_id is not null or g.construction_site_id is not null)
  ));

revoke all on table public.boq_reconciliation_groups from anon;
revoke all on table public.boq_reconciliation_groups from public;
revoke all on table public.boq_reconciliation_contract_lines from anon;
revoke all on table public.boq_reconciliation_contract_lines from public;
revoke all on table public.boq_reconciliation_work_lines from anon;
revoke all on table public.boq_reconciliation_work_lines from public;

grant select, insert, update, delete on table public.boq_reconciliation_groups to authenticated;
grant select, insert, update, delete on table public.boq_reconciliation_contract_lines to authenticated;
grant select, insert, update, delete on table public.boq_reconciliation_work_lines to authenticated;

notify pgrst, 'reload schema';
