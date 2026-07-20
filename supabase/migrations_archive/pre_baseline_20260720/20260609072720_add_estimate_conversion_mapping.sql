-- Estimate conversion traceability.
-- Tracks one controlled conversion from a finalized estimate into project operating data.

create table if not exists public.estimate_conversion_batches (
  id text primary key,
  estimate_id text not null references public.estimate_scenarios(id) on delete cascade,
  contract_id text not null,
  contract_type text not null check (contract_type in ('customer', 'subcontractor')),
  project_id text,
  construction_site_id text,
  status text not null default 'completed' check (status in ('previewed', 'completed', 'cancelled')),
  summary jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  constraint estimate_conversion_batches_estimate_once_uniq unique (estimate_id)
);

create table if not exists public.estimate_conversion_items (
  id text primary key,
  batch_id text not null references public.estimate_conversion_batches(id) on delete cascade,
  estimate_id text not null references public.estimate_scenarios(id) on delete cascade,
  estimate_item_id text references public.estimate_items(id) on delete set null,
  target_table text not null check (target_table in ('contract_items', 'project_work_boq_items', 'material_budget_items')),
  target_id text not null,
  target_code text,
  target_name text,
  target_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_conversion_batches_estimate
  on public.estimate_conversion_batches(estimate_id);
create index if not exists idx_estimate_conversion_batches_project
  on public.estimate_conversion_batches(project_id, contract_id);
create index if not exists idx_estimate_conversion_items_batch
  on public.estimate_conversion_items(batch_id);
create index if not exists idx_estimate_conversion_items_estimate_item
  on public.estimate_conversion_items(estimate_item_id);
create index if not exists idx_estimate_conversion_items_target
  on public.estimate_conversion_items(target_table, target_id);

alter table public.estimate_conversion_batches enable row level security;
alter table public.estimate_conversion_items enable row level security;

grant select, insert, update, delete on public.estimate_conversion_batches to authenticated;
grant select, insert, update, delete on public.estimate_conversion_items to authenticated;

drop policy if exists estimate_conversion_batches_select on public.estimate_conversion_batches;
create policy estimate_conversion_batches_select on public.estimate_conversion_batches
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and es.created_by = public.current_app_user_id()
  )
);

drop policy if exists estimate_conversion_batches_manage on public.estimate_conversion_batches;
create policy estimate_conversion_batches_manage on public.estimate_conversion_batches
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));

drop policy if exists estimate_conversion_items_select on public.estimate_conversion_items;
create policy estimate_conversion_items_select on public.estimate_conversion_items
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and es.created_by = public.current_app_user_id()
  )
);

drop policy if exists estimate_conversion_items_manage on public.estimate_conversion_items;
create policy estimate_conversion_items_manage on public.estimate_conversion_items
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));
