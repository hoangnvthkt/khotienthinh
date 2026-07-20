-- Store explicit recipients for simple project approval/submission flows.
-- This is additive and keeps existing status workflows intact.

alter table if exists public.quantity_acceptances
  add column if not exists submitted_to_user_id text,
  add column if not exists submitted_to_name text,
  add column if not exists submitted_to_permission text,
  add column if not exists submission_note text;

alter table if exists public.payment_certificates
  add column if not exists submitted_to_user_id text,
  add column if not exists submitted_to_name text,
  add column if not exists submitted_to_permission text,
  add column if not exists submission_note text;

alter table if exists public.contract_variations
  add column if not exists submitted_to_user_id text,
  add column if not exists submitted_to_name text,
  add column if not exists submitted_to_permission text,
  add column if not exists submission_note text;

alter table if exists public.boq_reconciliation_groups
  add column if not exists submitted_to_user_id text,
  add column if not exists submitted_to_name text,
  add column if not exists submitted_to_permission text,
  add column if not exists submission_note text;

alter table if exists public.project_material_requests
  add column if not exists submitted_to_user_id text,
  add column if not exists submitted_to_name text,
  add column if not exists submitted_to_permission text,
  add column if not exists submission_note text;

alter table if exists public.purchase_orders
  add column if not exists submitted_to_user_id text,
  add column if not exists submitted_to_name text,
  add column if not exists submitted_to_permission text,
  add column if not exists submission_note text;

create index if not exists idx_quantity_acceptances_submitted_to
  on public.quantity_acceptances(submitted_to_user_id, status, submitted_at desc);

create index if not exists idx_payment_certificates_submitted_to
  on public.payment_certificates(submitted_to_user_id, status, submitted_at desc);

create index if not exists idx_contract_variations_submitted_to
  on public.contract_variations(submitted_to_user_id, status, submitted_at desc);

create index if not exists idx_boq_reconciliation_groups_submitted_to
  on public.boq_reconciliation_groups(submitted_to_user_id, status, updated_at desc);

create index if not exists idx_project_material_requests_submitted_to
  on public.project_material_requests(submitted_to_user_id, status, created_at desc);

create index if not exists idx_purchase_orders_submitted_to
  on public.purchase_orders(submitted_to_user_id, status, created_at desc);

notify pgrst, 'reload schema';
