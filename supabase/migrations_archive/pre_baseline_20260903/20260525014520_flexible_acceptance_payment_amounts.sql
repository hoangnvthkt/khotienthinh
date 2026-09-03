-- Flexible acceptance/payment amounts.
-- Keeps legacy quantity x unit-price fields for compatibility, while allowing
-- negotiated accepted/payment amounts to be entered independently.

alter table if exists public.quantity_acceptance_items
  add column if not exists accepted_percent numeric not null default 0,
  add column if not exists suggested_amount numeric not null default 0,
  add column if not exists amount_note text;

alter table if exists public.payment_certificate_items
  add column if not exists contract_amount numeric not null default 0,
  add column if not exists payment_percent numeric not null default 0,
  add column if not exists source_accepted_amount numeric not null default 0,
  add column if not exists payment_note text;

update public.quantity_acceptance_items qai
set
  suggested_amount = coalesce(nullif(qai.suggested_amount, 0), nullif(qai.accepted_quantity * qai.unit_price, 0), qai.accepted_amount, 0),
  accepted_percent = coalesce(
    nullif(qai.accepted_percent, 0),
    case
      when coalesce(ci.revised_total_price, ci.total_price, 0) > 0
        then round((coalesce(qai.accepted_amount, 0) / coalesce(ci.revised_total_price, ci.total_price, 0)) * 100, 4)
      else 0
    end
  )
from public.contract_items ci
where ci.id = qai.contract_item_id;

update public.payment_certificate_items pci
set
  contract_amount = coalesce(
    nullif(pci.contract_amount, 0),
    ci.revised_total_price,
    ci.total_price,
    pci.revised_contract_quantity * pci.unit_price,
    0
  ),
  source_accepted_amount = coalesce(nullif(pci.source_accepted_amount, 0), pci.current_amount, 0),
  payment_percent = coalesce(
    nullif(pci.payment_percent, 0),
    case
      when coalesce(ci.revised_total_price, ci.total_price, 0) > 0
        then round((coalesce(pci.current_amount, 0) / coalesce(ci.revised_total_price, ci.total_price, 0)) * 100, 4)
      else 0
    end
  )
from public.contract_items ci
where ci.id = pci.contract_item_id;

notify pgrst, 'reload schema';
