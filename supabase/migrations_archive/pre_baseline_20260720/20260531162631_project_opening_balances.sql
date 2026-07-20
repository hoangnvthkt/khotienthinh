-- Opening balance import for projects already in progress before go-live.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.project_opening_balances (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  as_of_date date not null,
  contract_value numeric not null default 0 check (contract_value >= 0),
  construction_progress_percent numeric not null default 0
    check (construction_progress_percent >= 0 and construction_progress_percent <= 100),
  purchased_value numeric not null default 0 check (purchased_value >= 0),
  issued_value numeric not null default 0 check (issued_value >= 0),
  used_value numeric not null default 0 check (used_value >= 0),
  recognized_value numeric not null default 0 check (recognized_value >= 0),
  status text not null default 'draft' check (status in ('draft', 'locked', 'void')),
  note text,
  stock_transaction_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(stock_transaction_ids) = 'array'),
  material_project_transaction_id text,
  created_by text,
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_opening_balances_scope_check
    check (project_id is not null or construction_site_id is not null)
);

create index if not exists idx_project_opening_balances_scope
  on public.project_opening_balances(scope_key, status, as_of_date desc);

create index if not exists idx_project_opening_balances_project
  on public.project_opening_balances(project_id, status)
  where project_id is not null;

create index if not exists idx_project_opening_balances_site
  on public.project_opening_balances(construction_site_id, status)
  where construction_site_id is not null;

create unique index if not exists idx_project_opening_balances_locked_scope
  on public.project_opening_balances(scope_key)
  where status = 'locked';

create table if not exists public.project_opening_balance_lines (
  id uuid primary key default gen_random_uuid(),
  opening_balance_id uuid not null references public.project_opening_balances(id) on delete cascade,
  inventory_item_id text references public.items(id) on delete set null,
  sku text not null,
  item_name text not null,
  unit text not null default 'Cái',
  warehouse_id text not null references public.warehouses(id) on delete restrict,
  purchased_qty numeric not null default 0 check (purchased_qty >= 0),
  issued_qty numeric not null default 0 check (issued_qty >= 0),
  used_qty numeric not null default 0 check (used_qty >= 0),
  remaining_qty numeric not null default 0 check (remaining_qty >= 0),
  unit_price numeric not null default 0 check (unit_price >= 0),
  remaining_value numeric not null default 0 check (remaining_value >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_opening_balance_lines_opening
  on public.project_opening_balance_lines(opening_balance_id);

create index if not exists idx_project_opening_balance_lines_item
  on public.project_opening_balance_lines(inventory_item_id)
  where inventory_item_id is not null;

create index if not exists idx_project_opening_balance_lines_warehouse
  on public.project_opening_balance_lines(warehouse_id);

drop trigger if exists trg_project_opening_balances_updated_at
  on public.project_opening_balances;
create trigger trg_project_opening_balances_updated_at
  before update on public.project_opening_balances
  for each row execute function public.set_updated_at();

drop trigger if exists trg_project_opening_balance_lines_updated_at
  on public.project_opening_balance_lines;
create trigger trg_project_opening_balance_lines_updated_at
  before update on public.project_opening_balance_lines
  for each row execute function public.set_updated_at();

alter table public.project_opening_balances enable row level security;
alter table public.project_opening_balance_lines enable row level security;

drop policy if exists project_opening_balances_authenticated_all
  on public.project_opening_balances;
create policy project_opening_balances_authenticated_all
  on public.project_opening_balances
  for all
  to authenticated
  using (scope_key is not null)
  with check (scope_key is not null);

drop policy if exists project_opening_balance_lines_authenticated_all
  on public.project_opening_balance_lines;
create policy project_opening_balance_lines_authenticated_all
  on public.project_opening_balance_lines
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.project_opening_balances ob
      where ob.id = opening_balance_id
    )
  )
  with check (
    exists (
      select 1
      from public.project_opening_balances ob
      where ob.id = opening_balance_id
    )
  );

revoke all on table public.project_opening_balances from anon;
revoke all on table public.project_opening_balances from public;
revoke all on table public.project_opening_balances from authenticated;
grant select, insert, update, delete on table public.project_opening_balances to authenticated;

revoke all on table public.project_opening_balance_lines from anon;
revoke all on table public.project_opening_balance_lines from public;
revoke all on table public.project_opening_balance_lines from authenticated;
grant select, insert, update, delete on table public.project_opening_balance_lines to authenticated;

alter table if exists public.project_transactions
  add column if not exists source_ref text;

create unique index if not exists idx_project_transactions_source_ref_unique
  on public.project_transactions(source_ref);

notify pgrst, 'reload schema';
