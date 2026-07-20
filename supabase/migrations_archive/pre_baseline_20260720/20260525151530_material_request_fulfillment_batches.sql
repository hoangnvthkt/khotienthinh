-- Track partial material fulfillment batches for one project/WMS material request.
-- Existing requests.items remains the source of requested/committed quantities.

create table if not exists public.material_request_fulfillment_batches (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  material_request_id text not null references public.requests(id) on delete cascade,
  batch_no text not null,
  batch_date timestamptz not null default now(),
  source_warehouse_id text references public.warehouses(id) on delete set null,
  target_warehouse_id text references public.warehouses(id) on delete set null,
  fulfillment_mode text not null default 'RECEIVE_TO_STOCK'
    check (fulfillment_mode in ('RECEIVE_TO_STOCK', 'DIRECT_CONSUMPTION')),
  source_type text not null default 'stock'
    check (source_type in ('stock', 'po_receipt', 'mixed')),
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'received', 'cancelled')),
  transaction_id text references public.transactions(id) on delete set null,
  reason text,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  issued_by uuid references public.users(id) on delete set null,
  issued_at timestamptz,
  received_by uuid references public.users(id) on delete set null,
  received_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists public.material_request_fulfillment_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.material_request_fulfillment_batches(id) on delete cascade,
  material_request_id text not null references public.requests(id) on delete cascade,
  request_line_id text not null,
  item_id text not null references public.items(id) on delete restrict,
  material_budget_item_id text references public.material_budget_items(id) on delete set null,
  work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
  po_id text references public.purchase_orders(id) on delete set null,
  po_line_id text,
  requested_qty_snapshot numeric not null default 0,
  committed_qty_snapshot numeric not null default 0,
  issued_qty numeric not null default 0 check (issued_qty >= 0),
  received_qty numeric not null default 0 check (received_qty >= 0),
  unit text,
  variance_reason text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_material_request_fulfillment_batches_request
  on public.material_request_fulfillment_batches(material_request_id, status, batch_date desc);

create index if not exists idx_material_request_fulfillment_batches_project
  on public.material_request_fulfillment_batches(project_id, batch_date desc)
  where project_id is not null;

create index if not exists idx_material_request_fulfillment_batches_site
  on public.material_request_fulfillment_batches(construction_site_id, batch_date desc)
  where construction_site_id is not null;

create index if not exists idx_material_request_fulfillment_batches_transaction
  on public.material_request_fulfillment_batches(transaction_id)
  where transaction_id is not null;

create index if not exists idx_material_request_fulfillment_lines_batch
  on public.material_request_fulfillment_lines(batch_id);

create index if not exists idx_material_request_fulfillment_lines_request_line
  on public.material_request_fulfillment_lines(material_request_id, request_line_id);

create index if not exists idx_material_request_fulfillment_lines_item
  on public.material_request_fulfillment_lines(item_id);

create index if not exists idx_material_request_fulfillment_lines_material_budget
  on public.material_request_fulfillment_lines(material_budget_item_id)
  where material_budget_item_id is not null;

create or replace function public.set_material_request_fulfillment_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_material_request_fulfillment_batches_updated_at
  on public.material_request_fulfillment_batches;
create trigger trg_material_request_fulfillment_batches_updated_at
  before update on public.material_request_fulfillment_batches
  for each row execute function public.set_material_request_fulfillment_updated_at();

drop trigger if exists trg_material_request_fulfillment_lines_updated_at
  on public.material_request_fulfillment_lines;
create trigger trg_material_request_fulfillment_lines_updated_at
  before update on public.material_request_fulfillment_lines
  for each row execute function public.set_material_request_fulfillment_updated_at();

alter table public.material_request_fulfillment_batches enable row level security;
alter table public.material_request_fulfillment_lines enable row level security;

drop policy if exists material_request_fulfillment_batches_project_access
  on public.material_request_fulfillment_batches;
create policy material_request_fulfillment_batches_project_access
  on public.material_request_fulfillment_batches
  for all
  to authenticated
  using (material_request_id is not null)
  with check (material_request_id is not null);

drop policy if exists material_request_fulfillment_lines_project_access
  on public.material_request_fulfillment_lines;
create policy material_request_fulfillment_lines_project_access
  on public.material_request_fulfillment_lines
  for all
  to authenticated
  using (material_request_id is not null and batch_id is not null)
  with check (material_request_id is not null and batch_id is not null);

revoke all on table public.material_request_fulfillment_batches from anon;
revoke all on table public.material_request_fulfillment_batches from public;
revoke all on table public.material_request_fulfillment_batches from authenticated;
grant select, insert, update, delete on table public.material_request_fulfillment_batches to authenticated;

revoke all on table public.material_request_fulfillment_lines from anon;
revoke all on table public.material_request_fulfillment_lines from public;
revoke all on table public.material_request_fulfillment_lines from authenticated;
grant select, insert, update, delete on table public.material_request_fulfillment_lines to authenticated;

revoke all on function public.set_material_request_fulfillment_updated_at() from public;

notify pgrst, 'reload schema';
