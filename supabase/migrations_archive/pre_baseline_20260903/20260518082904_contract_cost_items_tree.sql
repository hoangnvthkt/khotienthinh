-- HD master catalog: hierarchical cost items.
-- This is intentionally separate from project_cost_items, which is project-scoped.

create table if not exists public.contract_cost_items (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.contract_cost_items(id) on delete restrict,
  symbol text not null,
  name text not null,
  cost_type text,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_contract_cost_items_symbol
  on public.contract_cost_items (lower(symbol));
create index if not exists idx_contract_cost_items_parent
  on public.contract_cost_items (parent_id, sort_order, created_at);
create index if not exists idx_contract_cost_items_status
  on public.contract_cost_items (status);

alter table public.contract_cost_items enable row level security;

drop policy if exists "contract_cost_items_access" on public.contract_cost_items;
create policy "contract_cost_items_access"
  on public.contract_cost_items
  for all to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.contract_cost_items to authenticated;

notify pgrst, 'reload schema';
