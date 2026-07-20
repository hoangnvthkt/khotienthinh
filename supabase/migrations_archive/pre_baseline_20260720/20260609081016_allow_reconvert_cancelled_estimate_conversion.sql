-- Allow a finalized estimate to be converted again after a safe rollback.
-- The original v1 constraint blocked any future batch even when the prior
-- batch was cancelled.

alter table if exists public.estimate_conversion_batches
  drop constraint if exists estimate_conversion_batches_estimate_once_uniq;

create unique index if not exists idx_estimate_conversion_batches_estimate_active_uniq
  on public.estimate_conversion_batches(estimate_id)
  where status <> 'cancelled';
