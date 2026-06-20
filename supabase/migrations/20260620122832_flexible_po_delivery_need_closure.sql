-- Flexible PO allocation, delivery groups, and site-confirmed need closures.

alter table if exists public.purchase_order_request_lines
  add column if not exists target_warehouse_id text references public.warehouses(id) on delete set null,
  add column if not exists source_construction_site_id text,
  add column if not exists allocation_status text not null default 'open'
    check (allocation_status in ('open', 'need_closed', 'cancelled')),
  add column if not exists requested_qty_snapshot numeric not null default 0,
  add column if not exists ordered_stock_qty_snapshot numeric not null default 0,
  add column if not exists actual_received_qty_snapshot numeric not null default 0;

update public.purchase_order_request_lines porl
set
  source_construction_site_id = coalesce(porl.source_construction_site_id, porl.construction_site_id, r.construction_site_id),
  target_warehouse_id = coalesce(porl.target_warehouse_id, r.site_warehouse_id),
  requested_qty_snapshot = case
    when coalesce(porl.requested_qty_snapshot, 0) = 0 then coalesce(porl.requested_qty, 0)
    else porl.requested_qty_snapshot
  end,
  ordered_stock_qty_snapshot = case
    when coalesce(porl.ordered_stock_qty_snapshot, 0) = 0 then coalesce(porl.ordered_qty, 0)
    else porl.ordered_stock_qty_snapshot
  end
from public.requests r
where r.id = porl.material_request_id;

create index if not exists idx_po_request_lines_target_warehouse
  on public.purchase_order_request_lines(target_warehouse_id)
  where target_warehouse_id is not null;

create index if not exists idx_po_request_lines_allocation_status
  on public.purchase_order_request_lines(project_id, allocation_status, created_at desc)
  where project_id is not null;

create table if not exists public.purchase_order_delivery_groups (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete set null,
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  delivery_no text not null,
  planned_date timestamptz not null default now(),
  status text not null default 'issued'
    check (status in ('draft', 'issued', 'received', 'closed', 'cancelled')),
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(purchase_order_id, delivery_no)
);

create index if not exists idx_po_delivery_groups_po
  on public.purchase_order_delivery_groups(purchase_order_id, planned_date desc);

create index if not exists idx_po_delivery_groups_project
  on public.purchase_order_delivery_groups(project_id, planned_date desc)
  where project_id is not null;

alter table if exists public.material_request_fulfillment_batches
  add column if not exists po_delivery_group_id uuid references public.purchase_order_delivery_groups(id) on delete set null;

alter table if exists public.material_request_fulfillment_lines
  add column if not exists purchase_order_request_line_id uuid references public.purchase_order_request_lines(id) on delete set null,
  add column if not exists delivery_unit text,
  add column if not exists delivery_unit_price numeric not null default 0;

create index if not exists idx_mr_fulfillment_batches_po_delivery_group
  on public.material_request_fulfillment_batches(po_delivery_group_id)
  where po_delivery_group_id is not null;

create index if not exists idx_mr_fulfillment_lines_po_request_line
  on public.material_request_fulfillment_lines(purchase_order_request_line_id)
  where purchase_order_request_line_id is not null;

create table if not exists public.material_request_line_need_closures (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  material_request_id text not null references public.requests(id) on delete cascade,
  request_line_id text not null,
  item_id text not null references public.items(id) on delete restrict,
  work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
  material_budget_item_id text references public.material_budget_items(id) on delete set null,
  closed_qty numeric not null default 0 check (closed_qty >= 0),
  actual_received_qty_snapshot numeric not null default 0 check (actual_received_qty_snapshot >= 0),
  reason text not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  closed_by uuid references public.users(id) on delete set null,
  closed_at timestamptz not null default now(),
  cancelled_by uuid references public.users(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mr_need_closures_request_line
  on public.material_request_line_need_closures(material_request_id, request_line_id, status);

create index if not exists idx_mr_need_closures_project
  on public.material_request_line_need_closures(project_id, closed_at desc)
  where project_id is not null;

create index if not exists idx_mr_need_closures_site
  on public.material_request_line_need_closures(construction_site_id, closed_at desc)
  where construction_site_id is not null;

create or replace function public.set_purchase_order_delivery_group_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_po_delivery_groups_updated_at on public.purchase_order_delivery_groups;
create trigger trg_po_delivery_groups_updated_at
  before update on public.purchase_order_delivery_groups
  for each row execute function public.set_purchase_order_delivery_group_updated_at();

drop trigger if exists trg_mr_need_closures_updated_at on public.material_request_line_need_closures;
create trigger trg_mr_need_closures_updated_at
  before update on public.material_request_line_need_closures
  for each row execute function public.set_purchase_order_delivery_group_updated_at();

alter table public.purchase_order_delivery_groups enable row level security;
alter table public.material_request_line_need_closures enable row level security;

drop policy if exists purchase_order_delivery_groups_project_access
  on public.purchase_order_delivery_groups;
create policy purchase_order_delivery_groups_project_access
  on public.purchase_order_delivery_groups
  for all
  to authenticated
  using (
    app_private.purchase_order_delivery_group_can_access(
      purchase_order_id,
      project_id
    )
  )
  with check (
    app_private.purchase_order_delivery_group_can_access(
      purchase_order_id,
      project_id
    )
  );

drop policy if exists material_request_line_need_closures_project_access
  on public.material_request_line_need_closures;
create policy material_request_line_need_closures_project_access
  on public.material_request_line_need_closures
  for all
  to authenticated
  using (material_request_id is not null)
  with check (material_request_id is not null and length(trim(coalesce(reason, ''))) > 0);

revoke all on table public.purchase_order_delivery_groups from anon;
revoke all on table public.purchase_order_delivery_groups from public;
revoke all on table public.purchase_order_delivery_groups from authenticated;
grant select, insert, update, delete on table public.purchase_order_delivery_groups to authenticated;

revoke all on table public.material_request_line_need_closures from anon;
revoke all on table public.material_request_line_need_closures from public;
revoke all on table public.material_request_line_need_closures from authenticated;
grant select, insert, update, delete on table public.material_request_line_need_closures to authenticated;

revoke all on function public.set_purchase_order_delivery_group_updated_at() from public;

notify pgrst, 'reload schema';
