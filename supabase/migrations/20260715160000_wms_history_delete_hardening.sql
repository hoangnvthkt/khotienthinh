-- Release A3.3 stop-loss: posted WMS history must never be erased by a
-- browser maintenance action. Historical item references are intentionally
-- protected here because an earlier legacy-tolerance migration removed the
-- ledger foreign key.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists app_private;

create or replace function app_private.guard_inventory_item_history_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.inventory_ledger_entries ledger
    where ledger.material_id = old.id
  ) or exists (
    select 1
    from public.inventory_balances balance
    where balance.material_id = old.id
  ) or exists (
    select 1
    from public.transactions transaction_row
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(transaction_row.items, '[]'::jsonb)
    ) transaction_item(value)
    where transaction_row.status::text = 'COMPLETED'
      and coalesce(
        transaction_item.value->>'itemId',
        transaction_item.value->>'item_id'
      ) = old.id
  ) or exists (
    select 1
    from public.project_opening_balance_lines opening_line
    where opening_line.inventory_item_id = old.id
  ) then
    raise exception 'inventory item % has immutable WMS history; archive it instead of deleting it', old.id
      using errcode = '55000';
  end if;

  return old;
end;
$$;

revoke all on function app_private.guard_inventory_item_history_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_inventory_item_history_delete on public.items;
create trigger trg_guard_inventory_item_history_delete
before delete on public.items
for each row execute function app_private.guard_inventory_item_history_delete();
alter table public.items
  enable always trigger trg_guard_inventory_item_history_delete;

revoke truncate on table
  public.transactions,
  public.items,
  public.inventory_transactions,
  public.inventory_ledger_entries
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
