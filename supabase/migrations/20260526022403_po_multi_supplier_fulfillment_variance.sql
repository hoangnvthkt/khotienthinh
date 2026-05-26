-- Support one procurement grouping that can split into multiple supplier POs,
-- and allow fulfillment batches to wait for variance resolution.

alter table if exists public.purchase_orders
  add column if not exists procurement_group_id text,
  add column if not exists procurement_group_no text;

create index if not exists idx_purchase_orders_procurement_group
  on public.purchase_orders(procurement_group_id)
  where procurement_group_id is not null;

create index if not exists idx_purchase_orders_procurement_group_no
  on public.purchase_orders(procurement_group_no, created_at desc)
  where procurement_group_no is not null;

alter table if exists public.material_request_fulfillment_batches
  drop constraint if exists material_request_fulfillment_batches_status_check;

alter table if exists public.material_request_fulfillment_batches
  add constraint material_request_fulfillment_batches_status_check
  check (status in ('draft', 'issued', 'received', 'variance_pending', 'cancelled'));

notify pgrst, 'reload schema';
