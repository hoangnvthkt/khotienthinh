-- Phase 1 DB performance indexes for project workflow/procurement/inventory.
-- Additive only: no data mutation, no constraints, no business logic changes.
--
-- Production note:
--   This migration uses CREATE INDEX CONCURRENTLY to avoid long write locks on
--   busy tables. Run it outside an explicit transaction. If a migration runner
--   wraps files in a transaction, apply these statements manually via the
--   Supabase SQL runner/CLI or use non-concurrent CREATE INDEX during a
--   maintenance window.
--
-- Rollback:
--   drop index concurrently if exists public.idx_po_supplier_return_lines_item;
--   drop index concurrently if exists public.idx_material_party_ledger_item_created;
--   drop index concurrently if exists public.idx_material_issue_return_lines_item;
--   drop index concurrently if exists public.idx_material_issue_receipt_lines_item;
--   drop index concurrently if exists public.idx_material_issue_lines_item;
--   drop index concurrently if exists public.idx_purchase_orders_project_created;
--   drop index concurrently if exists public.idx_mrfl_po_line_batch;

set lock_timeout = '5s';
set statement_timeout = '0';

create index concurrently if not exists idx_mrfl_po_line_batch
  on public.material_request_fulfillment_lines(po_id, po_line_id, batch_id)
  where po_id is not null;

create index concurrently if not exists idx_purchase_orders_project_created
  on public.purchase_orders(project_id, created_at desc)
  where project_id is not null;

create index concurrently if not exists idx_material_issue_lines_item
  on public.material_issue_lines(item_id);

create index concurrently if not exists idx_material_issue_receipt_lines_item
  on public.material_issue_receipt_lines(item_id);

create index concurrently if not exists idx_material_issue_return_lines_item
  on public.material_issue_return_lines(item_id);

create index concurrently if not exists idx_material_party_ledger_item_created
  on public.material_party_ledger(item_id, created_at desc);

create index concurrently if not exists idx_po_supplier_return_lines_item
  on public.purchase_order_supplier_return_lines(item_id);

reset statement_timeout;
reset lock_timeout;
