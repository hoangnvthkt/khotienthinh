-- Project work BOQ: deployment quantities derived from project schedule tasks.
-- BOQ hop dong (contract_items) remains read-only for this flow.

create table if not exists public.project_work_boq_items (
  id text primary key,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  source_task_id text,
  parent_id text references public.project_work_boq_items(id) on delete set null,
  wbs_code text,
  name text not null,
  unit text not null default '',
  planned_qty numeric not null default 0,
  unit_price numeric not null default 0,
  total_amount numeric generated always as (planned_qty * unit_price) stored,
  sort_order integer not null default 0,
  sync_status text not null default 'manual'
    check (sync_status in ('synced', 'manual', 'orphaned')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_project_work_boq_items_source_task
  on public.project_work_boq_items(source_task_id)
  where source_task_id is not null;

create index if not exists idx_project_work_boq_items_project
  on public.project_work_boq_items(project_id, sort_order);

create index if not exists idx_project_work_boq_items_site
  on public.project_work_boq_items(construction_site_id, sort_order);

create index if not exists idx_project_work_boq_items_parent
  on public.project_work_boq_items(parent_id);

alter table public.material_budget_items
  add column if not exists work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
  add column if not exists sort_order integer not null default 0;

create index if not exists idx_material_budget_items_work_boq_item
  on public.material_budget_items(work_boq_item_id, sort_order);

alter table public.project_work_boq_items enable row level security;

drop policy if exists project_work_boq_items_project_access on public.project_work_boq_items;
create policy project_work_boq_items_project_access
  on public.project_work_boq_items
  for all
  to authenticated
  using (project_id is not null or construction_site_id is not null)
  with check (project_id is not null or construction_site_id is not null);

revoke all on table public.project_work_boq_items from anon;
revoke all on table public.project_work_boq_items from public;
revoke all on table public.project_work_boq_items from authenticated;
grant select, insert, update, delete on table public.project_work_boq_items to authenticated;

notify pgrst, 'reload schema';
