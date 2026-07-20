-- Inventory Ledger legacy request reference tolerance
-- Historical WMS transactions may reference material requests that were later
-- removed or migrated. Keep the source request id as audit text instead of
-- blocking ledger backfill.

alter table if exists public.inventory_transactions
  drop constraint if exists inventory_transactions_related_request_id_fkey;

alter table if exists public.inventory_ledger_entries
  drop constraint if exists inventory_ledger_entries_related_request_id_fkey;

do $$
declare
  v_tx record;
begin
  for v_tx in
    select t.id
    from public.transactions t
    left join public.inventory_transactions it
      on it.source_type = 'wms_transaction'
     and it.source_id = t.id
    where t.status::text = 'COMPLETED'
      and it.id is null
    order by t.date asc, t.id asc
  loop
    begin
      perform app_private.sync_wms_transaction_to_inventory_ledger(v_tx.id);
    exception when others then
      raise notice 'inventory ledger legacy request backfill skipped transaction %: %', v_tx.id, sqlerrm;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
