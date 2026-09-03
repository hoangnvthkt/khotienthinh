-- Reportable soft-reference snapshots for outside-BOQ aggregate material request lines.

create schema if not exists app_private;
revoke all on schema app_private from public;
revoke all on schema app_private from anon;
revoke all on schema app_private from authenticated;

create table if not exists public.material_request_material_group_snapshots (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.requests(id) on delete cascade,
  request_line_id text not null,
  project_id text,
  construction_site_id text,
  material_group_key text not null,
  inventory_item_id text,
  material_code_snapshot text,
  item_name_snapshot text,
  unit_snapshot text,
  total_boq_qty_snapshot numeric not null default 0,
  requested_before_qty_snapshot numeric not null default 0,
  request_qty numeric not null default 0,
  requested_after_qty_snapshot numeric not null default 0,
  remaining_boq_qty_snapshot numeric not null default 0,
  source_material_budget_item_ids text[] not null default '{}',
  request_status_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_request_material_group_snapshots_request_line_unique unique (request_id, request_line_id)
);

create index if not exists idx_mr_group_snapshots_project
  on public.material_request_material_group_snapshots(project_id, material_group_key);

create index if not exists idx_mr_group_snapshots_inventory
  on public.material_request_material_group_snapshots(inventory_item_id);

create index if not exists idx_mr_group_snapshots_material_code
  on public.material_request_material_group_snapshots(material_code_snapshot);

create index if not exists idx_mr_group_snapshots_request
  on public.material_request_material_group_snapshots(request_id);

drop trigger if exists trg_material_request_material_group_snapshots_updated_at
  on public.material_request_material_group_snapshots;
create trigger trg_material_request_material_group_snapshots_updated_at
  before update on public.material_request_material_group_snapshots
  for each row execute function public.set_updated_at();

create or replace function app_private.material_request_group_snapshot_can_select(
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

create or replace function app_private.material_request_group_snapshot_can_mutate(
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

alter table public.material_request_material_group_snapshots enable row level security;

drop policy if exists material_request_material_group_snapshots_select
  on public.material_request_material_group_snapshots;
drop policy if exists material_request_material_group_snapshots_insert
  on public.material_request_material_group_snapshots;
drop policy if exists material_request_material_group_snapshots_update
  on public.material_request_material_group_snapshots;
drop policy if exists material_request_material_group_snapshots_delete
  on public.material_request_material_group_snapshots;

revoke all on table public.material_request_material_group_snapshots from anon;
revoke all on table public.material_request_material_group_snapshots from public;
revoke all on table public.material_request_material_group_snapshots from authenticated;
grant select, insert, update, delete on table public.material_request_material_group_snapshots to authenticated;

create policy material_request_material_group_snapshots_select
  on public.material_request_material_group_snapshots
  for select
  to authenticated
  using (app_private.material_request_group_snapshot_can_select(request_id));

create policy material_request_material_group_snapshots_insert
  on public.material_request_material_group_snapshots
  for insert
  to authenticated
  with check (app_private.material_request_group_snapshot_can_mutate(request_id));

create policy material_request_material_group_snapshots_update
  on public.material_request_material_group_snapshots
  for update
  to authenticated
  using (app_private.material_request_group_snapshot_can_mutate(request_id))
  with check (app_private.material_request_group_snapshot_can_mutate(request_id));

create policy material_request_material_group_snapshots_delete
  on public.material_request_material_group_snapshots
  for delete
  to authenticated
  using (app_private.material_request_group_snapshot_can_mutate(request_id));

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
  where coalesce(line.value->>'materialGroupKey', line.value #>> '{materialGroupSnapshot,materialGroupKey}', '') <> ''
)
insert into public.material_request_material_group_snapshots (
  request_id,
  request_line_id,
  project_id,
  construction_site_id,
  material_group_key,
  inventory_item_id,
  material_code_snapshot,
  item_name_snapshot,
  unit_snapshot,
  total_boq_qty_snapshot,
  requested_before_qty_snapshot,
  request_qty,
  requested_after_qty_snapshot,
  remaining_boq_qty_snapshot,
  source_material_budget_item_ids,
  request_status_snapshot
)
select
  request_id,
  coalesce(nullif(line->>'lineId', ''), request_id || '-' || ordinality::text),
  project_id,
  construction_site_id,
  coalesce(nullif(line->>'materialGroupKey', ''), nullif(line #>> '{materialGroupSnapshot,materialGroupKey}', '')),
  coalesce(nullif(line #>> '{materialGroupSnapshot,inventoryItemId}', ''), nullif(line->>'itemId', '')),
  coalesce(nullif(line #>> '{materialGroupSnapshot,materialCodeSnapshot}', ''), nullif(line->>'skuSnapshot', '')),
  coalesce(nullif(line #>> '{materialGroupSnapshot,itemNameSnapshot}', ''), nullif(line->>'itemNameSnapshot', '')),
  coalesce(nullif(line #>> '{materialGroupSnapshot,unitSnapshot}', ''), nullif(line->>'unitSnapshot', '')),
  coalesce(nullif(line #>> '{materialGroupSnapshot,totalBoqQtySnapshot}', '')::numeric, nullif(line->>'budgetQtySnapshot', '')::numeric, 0),
  coalesce(nullif(line #>> '{materialGroupSnapshot,requestedBeforeQtySnapshot}', '')::numeric, 0),
  coalesce(nullif(line->>'requestQty', '')::numeric, 0),
  coalesce(nullif(line #>> '{materialGroupSnapshot,requestedBeforeQtySnapshot}', '')::numeric, 0)
    + coalesce(nullif(line->>'requestQty', '')::numeric, 0),
  coalesce(nullif(line #>> '{materialGroupSnapshot,remainingBoqQtySnapshot}', '')::numeric, 0),
  array(
    select jsonb_array_elements_text(coalesce(line #> '{materialGroupSnapshot,sourceMaterialBudgetItemIds}', '[]'::jsonb))
  ),
  request_status
from request_lines
on conflict (request_id, request_line_id) do update set
  project_id = excluded.project_id,
  construction_site_id = excluded.construction_site_id,
  material_group_key = excluded.material_group_key,
  inventory_item_id = excluded.inventory_item_id,
  material_code_snapshot = excluded.material_code_snapshot,
  item_name_snapshot = excluded.item_name_snapshot,
  unit_snapshot = excluded.unit_snapshot,
  total_boq_qty_snapshot = excluded.total_boq_qty_snapshot,
  requested_before_qty_snapshot = excluded.requested_before_qty_snapshot,
  request_qty = excluded.request_qty,
  requested_after_qty_snapshot = excluded.requested_after_qty_snapshot,
  remaining_boq_qty_snapshot = excluded.remaining_boq_qty_snapshot,
  source_material_budget_item_ids = excluded.source_material_budget_item_ids,
  request_status_snapshot = excluded.request_status_snapshot,
  updated_at = now();

notify pgrst, 'reload schema';
