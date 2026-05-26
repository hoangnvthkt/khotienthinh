-- Allow site receivers to return an issued material fulfillment batch before it
-- is received into site stock.

alter table if exists public.material_request_fulfillment_batches
  drop constraint if exists material_request_fulfillment_batches_status_check;

alter table if exists public.material_request_fulfillment_batches
  add constraint material_request_fulfillment_batches_status_check
  check (status in ('draft', 'issued', 'received', 'variance_pending', 'returned', 'cancelled'));

notify pgrst, 'reload schema';
