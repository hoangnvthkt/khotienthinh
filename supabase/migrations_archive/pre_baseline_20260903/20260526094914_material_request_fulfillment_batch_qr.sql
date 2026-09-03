-- Add QR token support for internal material request fulfillment batches.
-- Site warehouse keepers can scan the issued batch QR to confirm actual receipt.

alter table if exists public.material_request_fulfillment_batches
  add column if not exists qr_token text;

create unique index if not exists idx_material_request_fulfillment_batches_qr_token_unique
  on public.material_request_fulfillment_batches(qr_token)
  where qr_token is not null;

notify pgrst, 'reload schema';
