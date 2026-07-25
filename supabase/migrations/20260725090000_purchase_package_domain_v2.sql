alter table public.purchase_orders
  add column if not exists purchase_mode text not null default 'single',
  add column if not exists fulfillment_mode text not null default 'RECEIVE_TO_STOCK',
  add column if not exists reference_gross_amount numeric,
  add column if not exists closed_need_qty numeric not null default 0;

alter table public.purchase_orders
  drop constraint if exists purchase_orders_purchase_mode_check;
alter table public.purchase_orders
  add constraint purchase_orders_purchase_mode_check
  check (purchase_mode in ('single', 'multiple'));

alter table public.purchase_orders
  drop constraint if exists purchase_orders_fulfillment_mode_check;
alter table public.purchase_orders
  add constraint purchase_orders_fulfillment_mode_check
  check (fulfillment_mode in ('RECEIVE_TO_STOCK', 'DIRECT_CONSUMPTION'));

alter table public.purchase_orders
  drop constraint if exists purchase_orders_closed_need_qty_check;
alter table public.purchase_orders
  add constraint purchase_orders_closed_need_qty_check
  check (closed_need_qty >= 0) not valid;
alter table public.purchase_orders
  validate constraint purchase_orders_closed_need_qty_check;

alter table public.purchase_order_delivery_batches
  add column if not exists supplier_id text,
  add column if not exists supplier_name_snapshot text,
  add column if not exists fulfillment_mode text not null default 'RECEIVE_TO_STOCK',
  add column if not exists vat_rate numeric not null default 0,
  add column if not exists qr_token text,
  add column if not exists idempotency_key uuid,
  add column if not exists quality_result text,
  add column if not exists variance_reason text,
  add column if not exists quality_approved_by uuid references public.users(id) on delete set null,
  add column if not exists quality_approved_at timestamptz,
  add column if not exists received_by uuid references public.users(id) on delete set null,
  add column if not exists received_at timestamptz,
  add column if not exists accepted_gross_amount numeric not null default 0;

alter table public.purchase_order_delivery_lines
  add column if not exists accepted_qty numeric not null default 0,
  add column if not exists accepted_stock_qty numeric not null default 0,
  add column if not exists returned_qty numeric not null default 0;

alter table public.purchase_order_delivery_batches
  drop constraint if exists purchase_order_delivery_batches_status_check;
alter table public.purchase_order_delivery_batches
  add constraint purchase_order_delivery_batches_status_check
  check (status in (
    'planned', 'supplemental_pending', 'wms_pending',
    'waiting_delivery', 'receiving', 'quality_approved',
    'received', 'received_short', 'received_over', 'cancelled'
  ));

alter table public.purchase_order_delivery_batches
  drop constraint if exists purchase_order_delivery_batches_fulfillment_mode_check;
alter table public.purchase_order_delivery_batches
  add constraint purchase_order_delivery_batches_fulfillment_mode_check
  check (fulfillment_mode in ('RECEIVE_TO_STOCK', 'DIRECT_CONSUMPTION')) not valid;
alter table public.purchase_order_delivery_batches
  validate constraint purchase_order_delivery_batches_fulfillment_mode_check;

alter table public.purchase_order_delivery_batches
  drop constraint if exists purchase_order_delivery_batches_vat_rate_check;
alter table public.purchase_order_delivery_batches
  add constraint purchase_order_delivery_batches_vat_rate_check
  check (vat_rate >= 0) not valid;
alter table public.purchase_order_delivery_batches
  validate constraint purchase_order_delivery_batches_vat_rate_check;

alter table public.purchase_order_delivery_batches
  drop constraint if exists purchase_order_delivery_batches_quality_result_check;
alter table public.purchase_order_delivery_batches
  add constraint purchase_order_delivery_batches_quality_result_check
  check (quality_result is null or quality_result in ('passed', 'partial', 'rejected')) not valid;
alter table public.purchase_order_delivery_batches
  validate constraint purchase_order_delivery_batches_quality_result_check;

alter table public.purchase_order_delivery_batches
  drop constraint if exists purchase_order_delivery_batches_accepted_gross_amount_check;
alter table public.purchase_order_delivery_batches
  add constraint purchase_order_delivery_batches_accepted_gross_amount_check
  check (accepted_gross_amount >= 0) not valid;
alter table public.purchase_order_delivery_batches
  validate constraint purchase_order_delivery_batches_accepted_gross_amount_check;

alter table public.purchase_order_delivery_lines
  drop constraint if exists purchase_order_delivery_lines_accepted_qty_check;
alter table public.purchase_order_delivery_lines
  add constraint purchase_order_delivery_lines_accepted_qty_check
  check (accepted_qty >= 0) not valid;
alter table public.purchase_order_delivery_lines
  validate constraint purchase_order_delivery_lines_accepted_qty_check;

alter table public.purchase_order_delivery_lines
  drop constraint if exists purchase_order_delivery_lines_accepted_stock_qty_check;
alter table public.purchase_order_delivery_lines
  add constraint purchase_order_delivery_lines_accepted_stock_qty_check
  check (accepted_stock_qty >= 0) not valid;
alter table public.purchase_order_delivery_lines
  validate constraint purchase_order_delivery_lines_accepted_stock_qty_check;

alter table public.purchase_order_delivery_lines
  drop constraint if exists purchase_order_delivery_lines_returned_qty_check;
alter table public.purchase_order_delivery_lines
  add constraint purchase_order_delivery_lines_returned_qty_check
  check (returned_qty >= 0) not valid;
alter table public.purchase_order_delivery_lines
  validate constraint purchase_order_delivery_lines_returned_qty_check;

alter table public.purchase_order_delivery_lines
  drop constraint if exists purchase_order_delivery_lines_returned_lte_accepted_check;
alter table public.purchase_order_delivery_lines
  add constraint purchase_order_delivery_lines_returned_lte_accepted_check
  check (returned_qty <= accepted_qty) not valid;
alter table public.purchase_order_delivery_lines
  validate constraint purchase_order_delivery_lines_returned_lte_accepted_check;

create unique index if not exists uq_po_delivery_batch_idempotency
  on public.purchase_order_delivery_batches(purchase_order_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists uq_po_delivery_batch_qr_token
  on public.purchase_order_delivery_batches(qr_token)
  where qr_token is not null;

create index if not exists idx_po_delivery_batches_po_status_no_v2
  on public.purchase_order_delivery_batches(purchase_order_id, status, delivery_no);

create index if not exists idx_po_delivery_batches_wms_status_v2
  on public.purchase_order_delivery_batches(wms_transaction_id, status)
  where wms_transaction_id is not null;

create index if not exists idx_po_delivery_lines_batch_line_v2
  on public.purchase_order_delivery_lines(delivery_batch_id, purchase_order_line_id);
