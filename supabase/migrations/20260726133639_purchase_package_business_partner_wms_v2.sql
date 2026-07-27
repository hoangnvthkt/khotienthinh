create schema if not exists app_private;

create or replace function app_private.normalize_po_delivery_transaction_counterparty_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_type = 'po_delivery_batch'
    and new.supplier_id is not null
    and not exists (
      select 1
      from public.suppliers supplier
      where supplier.id = new.supplier_id
    )
    and exists (
      select 1
      from public.business_partners partner
      where partner.id = new.supplier_id
    )
  then
    new.business_partner_id := new.supplier_id;
    new.supplier_id := null;
  end if;

  return new;
end;
$$;

revoke all on function app_private.normalize_po_delivery_transaction_counterparty_v2()
  from public, anon;

drop trigger if exists normalize_po_delivery_transaction_counterparty_v2
  on public.transactions;

create trigger normalize_po_delivery_transaction_counterparty_v2
before insert or update of supplier_id, business_partner_id, source_type on public.transactions
for each row
execute function app_private.normalize_po_delivery_transaction_counterparty_v2();

notify pgrst, 'reload schema';
