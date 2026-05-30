-- Reportable BOQ overage snapshots for project material request lines.

create schema if not exists app_private;
revoke all on schema app_private from public;
revoke all on schema app_private from anon;
revoke all on schema app_private from authenticated;

create table if not exists public.material_request_boq_line_snapshots (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.requests(id) on delete cascade,
  request_line_id text not null,
  project_id text,
  construction_site_id text,
  work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
  material_budget_item_id text not null references public.material_budget_items(id) on delete cascade,
  inventory_item_id text,
  item_name_snapshot text,
  unit_snapshot text,
  request_qty numeric not null default 0,
  budget_qty_snapshot numeric not null default 0,
  reserved_before_qty numeric not null default 0,
  is_over_boq boolean not null default false,
  over_qty numeric not null default 0,
  over_percent numeric not null default 0,
  over_reason text,
  request_status_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_request_boq_line_snapshots_request_line_unique unique (request_id, request_line_id)
);

create index if not exists idx_mr_boq_snapshots_project_over
  on public.material_request_boq_line_snapshots(project_id, is_over_boq);

create index if not exists idx_mr_boq_snapshots_material_over
  on public.material_request_boq_line_snapshots(material_budget_item_id, is_over_boq);

create index if not exists idx_mr_boq_snapshots_work_over
  on public.material_request_boq_line_snapshots(work_boq_item_id, is_over_boq);

create index if not exists idx_mr_boq_snapshots_request
  on public.material_request_boq_line_snapshots(request_id);

drop trigger if exists trg_material_request_boq_line_snapshots_updated_at
  on public.material_request_boq_line_snapshots;
create trigger trg_material_request_boq_line_snapshots_updated_at
  before update on public.material_request_boq_line_snapshots
  for each row execute function public.set_updated_at();

create or replace function app_private.material_request_boq_snapshot_can_select(
  p_request_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    where r.id = p_request_id
      and app_private.material_request_can_select(
        r.request_origin,
        r.project_id,
        r.requester_id,
        r.submitted_to_user_id,
        r.source_warehouse_id,
        r.site_warehouse_id
      )
  );
$$;

create or replace function app_private.material_request_boq_snapshot_can_mutate(
  p_request_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    where r.id = p_request_id
      and app_private.material_request_can_update(
        r.request_origin,
        r.project_id,
        r.status::text,
        r.requester_id,
        r.submitted_to_user_id,
        r.source_warehouse_id,
        r.site_warehouse_id
      )
  );
$$;

alter table public.material_request_boq_line_snapshots enable row level security;

drop policy if exists material_request_boq_line_snapshots_select
  on public.material_request_boq_line_snapshots;
drop policy if exists material_request_boq_line_snapshots_insert
  on public.material_request_boq_line_snapshots;
drop policy if exists material_request_boq_line_snapshots_update
  on public.material_request_boq_line_snapshots;
drop policy if exists material_request_boq_line_snapshots_delete
  on public.material_request_boq_line_snapshots;

revoke all on table public.material_request_boq_line_snapshots from anon;
revoke all on table public.material_request_boq_line_snapshots from public;
revoke all on table public.material_request_boq_line_snapshots from authenticated;
grant select, insert, update, delete on table public.material_request_boq_line_snapshots to authenticated;

create policy material_request_boq_line_snapshots_select
  on public.material_request_boq_line_snapshots
  for select
  to authenticated
  using (app_private.material_request_boq_snapshot_can_select(request_id));

create policy material_request_boq_line_snapshots_insert
  on public.material_request_boq_line_snapshots
  for insert
  to authenticated
  with check (app_private.material_request_boq_snapshot_can_mutate(request_id));

create policy material_request_boq_line_snapshots_update
  on public.material_request_boq_line_snapshots
  for update
  to authenticated
  using (app_private.material_request_boq_snapshot_can_mutate(request_id))
  with check (app_private.material_request_boq_snapshot_can_mutate(request_id));

create policy material_request_boq_line_snapshots_delete
  on public.material_request_boq_line_snapshots
  for delete
  to authenticated
  using (app_private.material_request_boq_snapshot_can_mutate(request_id));

with request_lines as (
  select
    r.id as request_id,
    r.project_id,
    r.construction_site_id,
    r.status::text as request_status,
    line.value as line,
    line.ordinality
  from public.requests r
  cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) with ordinality as line(value, ordinality)
  where coalesce(line.value->>'materialBudgetItemId', '') <> ''
)
insert into public.material_request_boq_line_snapshots (
  request_id,
  request_line_id,
  project_id,
  construction_site_id,
  work_boq_item_id,
  material_budget_item_id,
  inventory_item_id,
  item_name_snapshot,
  unit_snapshot,
  request_qty,
  budget_qty_snapshot,
  reserved_before_qty,
  is_over_boq,
  over_qty,
  over_percent,
  over_reason,
  request_status_snapshot
)
select
  request_id,
  coalesce(nullif(line->>'lineId', ''), request_id || '-' || ordinality::text),
  project_id,
  construction_site_id,
  nullif(line->>'workBoqItemId', ''),
  line->>'materialBudgetItemId',
  nullif(line->>'itemId', ''),
  coalesce(nullif(line->>'itemNameSnapshot', ''), nullif(line->>'materialBudgetItemName', '')),
  nullif(line->>'unitSnapshot', ''),
  coalesce(nullif(line->>'requestQty', '')::numeric, 0),
  coalesce(nullif(line->>'budgetQtySnapshot', '')::numeric, 0),
  coalesce(
    nullif(line->>'reservedBeforeQtySnapshot', '')::numeric,
    nullif(line->>'previousRequestedQtySnapshot', '')::numeric,
    0
  ),
  coalesce(nullif(line->>'isOverBoq', '')::boolean, coalesce(nullif(line->>'overQty', '')::numeric, nullif(line->>'overBudgetQtySnapshot', '')::numeric, 0) > 0),
  coalesce(nullif(line->>'overQty', '')::numeric, nullif(line->>'overBudgetQtySnapshot', '')::numeric, 0),
  coalesce(nullif(line->>'overPercent', '')::numeric, nullif(line->>'overBudgetPercentSnapshot', '')::numeric, 0),
  coalesce(nullif(line->>'overReason', ''), nullif(line->>'overBudgetReason', '')),
  request_status
from request_lines
on conflict (request_id, request_line_id) do update set
  project_id = excluded.project_id,
  construction_site_id = excluded.construction_site_id,
  work_boq_item_id = excluded.work_boq_item_id,
  material_budget_item_id = excluded.material_budget_item_id,
  inventory_item_id = excluded.inventory_item_id,
  item_name_snapshot = excluded.item_name_snapshot,
  unit_snapshot = excluded.unit_snapshot,
  request_qty = excluded.request_qty,
  budget_qty_snapshot = excluded.budget_qty_snapshot,
  reserved_before_qty = excluded.reserved_before_qty,
  is_over_boq = excluded.is_over_boq,
  over_qty = excluded.over_qty,
  over_percent = excluded.over_percent,
  over_reason = excluded.over_reason,
  request_status_snapshot = excluded.request_status_snapshot,
  updated_at = now();

notify pgrst, 'reload schema';
