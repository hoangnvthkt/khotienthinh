-- Contract BOQ / acceptance / payment guard fixes.
-- Keeps payment line schema aligned with the app model and backfills BOQ locks
-- for items that already have approved/paid downstream documents.

alter table if exists public.payment_certificate_items
  add column if not exists certified_quantity numeric not null default 0;

update public.payment_certificate_items
set certified_quantity = current_quantity
where certified_quantity = 0
  and current_quantity <> 0;

update public.contract_items ci
set
  is_locked = true,
  locked_at = coalesce(ci.locked_at, now())
where coalesce(ci.is_locked, false) = false
  and (
    exists (
      select 1
      from public.payment_certificate_items pci
      join public.payment_certificates pc on pc.id = pci.payment_certificate_id
      where pci.contract_item_id = ci.id
        and pc.status in ('approved', 'paid')
    )
    or exists (
      select 1
      from public.quantity_acceptance_items qai
      join public.quantity_acceptances qa on qa.id = qai.acceptance_id
      where qai.contract_item_id = ci.id
        and qa.status = 'approved'
    )
  );

notify pgrst, 'reload schema';
