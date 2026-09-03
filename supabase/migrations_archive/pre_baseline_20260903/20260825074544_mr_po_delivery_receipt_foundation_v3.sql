-- Foundation for MR purchase orders whose commercial commitments live on
-- delivery batches and whose warehouse effects live on receipt events.

alter table public.purchase_orders
  add column if not exists procurement_flow_version integer not null default 2;

alter table public.purchase_orders
  drop constraint if exists purchase_orders_procurement_flow_version_check;
alter table public.purchase_orders
  add constraint purchase_orders_procurement_flow_version_check
  check (procurement_flow_version in (2, 3));

create table if not exists public.purchase_order_master_estimates (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null unique references public.purchase_orders(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  is_enabled boolean not null default true,
  estimate_lines jsonb not null default '[]'::jsonb,
  planned_period text,
  note text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_master_estimates_lines_array_check
    check (jsonb_typeof(estimate_lines) = 'array')
);

create table if not exists public.purchase_order_master_estimate_versions (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  master_estimate_id uuid references public.purchase_order_master_estimates(id) on delete set null,
  version_no integer not null check (version_no > 0),
  snapshot jsonb not null,
  issued_by uuid references public.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  constraint purchase_order_master_estimate_versions_snapshot_object_check
    check (jsonb_typeof(snapshot) = 'object'),
  unique (purchase_order_id, version_no)
);

create table if not exists public.purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  delivery_batch_id uuid not null references public.purchase_order_delivery_batches(id) on delete restrict,
  purchase_order_id text not null references public.purchase_orders(id) on delete restrict,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  receipt_no integer not null check (receipt_no > 0),
  status text not null default 'completed'
    check (status in ('completed', 'cancelled')),
  finance_status text not null default 'ready'
    check (finance_status in ('ready', 'variance_pending', 'posted')),
  quality_result text not null default 'passed'
    check (quality_result in ('passed', 'partial', 'rejected')),
  is_final boolean not null default false,
  variance_reason text,
  attachments jsonb not null default '[]'::jsonb,
  accepted_gross_amount numeric(18,2) not null default 0
    check (accepted_gross_amount >= 0),
  wms_transaction_id text not null references public.transactions(id) on delete restrict,
  idempotency_key uuid not null,
  received_by uuid references public.users(id) on delete set null,
  received_at timestamptz not null default now(),
  finance_confirmed_by uuid references public.users(id) on delete set null,
  finance_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_batch_id, receipt_no),
  unique (delivery_batch_id, idempotency_key),
  unique (wms_transaction_id),
  constraint purchase_order_receipts_attachments_array_check
    check (jsonb_typeof(attachments) = 'array')
);

create table if not exists public.purchase_order_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_order_receipts(id) on delete restrict,
  delivery_batch_id uuid not null references public.purchase_order_delivery_batches(id) on delete restrict,
  delivery_line_id uuid not null references public.purchase_order_delivery_lines(id) on delete restrict,
  purchase_order_id text not null references public.purchase_orders(id) on delete restrict,
  purchase_order_line_id text not null,
  item_id text not null references public.items(id) on delete restrict,
  purchase_unit text,
  stock_unit text,
  delivered_purchase_qty numeric not null check (delivered_purchase_qty >= 0),
  accepted_purchase_qty numeric not null check (accepted_purchase_qty >= 0),
  delivered_stock_qty numeric not null check (delivered_stock_qty >= 0),
  accepted_stock_qty numeric not null check (accepted_stock_qty >= 0),
  purchase_unit_price numeric not null default 0 check (purchase_unit_price >= 0),
  variance_reason text,
  created_at timestamptz not null default now(),
  constraint purchase_order_receipt_lines_purchase_acceptance_check
    check (accepted_purchase_qty <= delivered_purchase_qty),
  constraint purchase_order_receipt_lines_stock_acceptance_check
    check (accepted_stock_qty <= delivered_stock_qty),
  unique (receipt_id, delivery_line_id)
);

create index if not exists idx_po_master_estimates_project
  on public.purchase_order_master_estimates(project_id)
  where project_id is not null;
create index if not exists idx_po_master_estimates_created_by
  on public.purchase_order_master_estimates(created_by)
  where created_by is not null;
create index if not exists idx_po_master_estimates_updated_by
  on public.purchase_order_master_estimates(updated_by)
  where updated_by is not null;
create index if not exists idx_po_master_estimate_versions_estimate
  on public.purchase_order_master_estimate_versions(master_estimate_id)
  where master_estimate_id is not null;
create index if not exists idx_po_master_estimate_versions_issued_by
  on public.purchase_order_master_estimate_versions(issued_by)
  where issued_by is not null;

create index if not exists idx_po_receipts_purchase_order
  on public.purchase_order_receipts(purchase_order_id, received_at desc);
create index if not exists idx_po_receipts_project
  on public.purchase_order_receipts(project_id, received_at desc)
  where project_id is not null;
create index if not exists idx_po_receipts_received_by
  on public.purchase_order_receipts(received_by)
  where received_by is not null;
create index if not exists idx_po_receipts_finance_confirmed_by
  on public.purchase_order_receipts(finance_confirmed_by)
  where finance_confirmed_by is not null;
create index if not exists idx_po_receipts_finance_pending
  on public.purchase_order_receipts(delivery_batch_id, received_at)
  where status = 'completed' and finance_status = 'variance_pending';

create index if not exists idx_po_receipt_lines_receipt
  on public.purchase_order_receipt_lines(receipt_id);
create index if not exists idx_po_receipt_lines_batch
  on public.purchase_order_receipt_lines(delivery_batch_id);
create index if not exists idx_po_receipt_lines_delivery_line
  on public.purchase_order_receipt_lines(delivery_line_id);
create index if not exists idx_po_receipt_lines_purchase_order
  on public.purchase_order_receipt_lines(purchase_order_id, purchase_order_line_id);
create index if not exists idx_po_receipt_lines_item
  on public.purchase_order_receipt_lines(item_id);

create or replace function app_private.set_mr_po_flow_v3_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_po_master_estimates_updated_at
  on public.purchase_order_master_estimates;
create trigger trg_po_master_estimates_updated_at
before update on public.purchase_order_master_estimates
for each row execute function app_private.set_mr_po_flow_v3_updated_at();

drop trigger if exists trg_po_receipts_updated_at
  on public.purchase_order_receipts;
create trigger trg_po_receipts_updated_at
before update on public.purchase_order_receipts
for each row execute function app_private.set_mr_po_flow_v3_updated_at();

alter table public.purchase_order_master_estimates enable row level security;
alter table public.purchase_order_master_estimate_versions enable row level security;
alter table public.purchase_order_receipts enable row level security;
alter table public.purchase_order_receipt_lines enable row level security;

drop policy if exists po_master_estimates_select on public.purchase_order_master_estimates;
create policy po_master_estimates_select
on public.purchase_order_master_estimates
for select to authenticated
using (app_private.purchase_order_delivery_can_view(purchase_order_id));

drop policy if exists po_master_estimate_versions_select on public.purchase_order_master_estimate_versions;
create policy po_master_estimate_versions_select
on public.purchase_order_master_estimate_versions
for select to authenticated
using (app_private.purchase_order_delivery_can_view(purchase_order_id));

drop policy if exists po_receipts_select on public.purchase_order_receipts;
create policy po_receipts_select
on public.purchase_order_receipts
for select to authenticated
using (app_private.purchase_order_delivery_can_view(purchase_order_id));

drop policy if exists po_receipt_lines_select on public.purchase_order_receipt_lines;
create policy po_receipt_lines_select
on public.purchase_order_receipt_lines
for select to authenticated
using (app_private.purchase_order_delivery_can_view(purchase_order_id));

revoke all on table public.purchase_order_master_estimates from public, anon, authenticated;
revoke all on table public.purchase_order_master_estimate_versions from public, anon, authenticated;
revoke all on table public.purchase_order_receipts from public, anon, authenticated;
revoke all on table public.purchase_order_receipt_lines from public, anon, authenticated;

grant select on table public.purchase_order_master_estimates to authenticated;
grant select on table public.purchase_order_master_estimate_versions to authenticated;
grant select on table public.purchase_order_receipts to authenticated;
grant select on table public.purchase_order_receipt_lines to authenticated;

revoke all on function app_private.set_mr_po_flow_v3_updated_at()
  from public, anon, authenticated;
