-- Run once after the Release A2 migration commits and before postflight.
-- ALTER TYPE and SET EXPRESSION clear column statistics; this refreshes only
-- the affected quantity/generated columns without extending the DDL lock.

set lock_timeout = '5s';
set statement_timeout = '5min';

analyze public.inventory_ledger_entries (
  quantity_in,
  quantity_out,
  quantity_delta,
  balance_after_qty,
  amount
);

analyze public.inventory_balances (
  on_hand_qty
);

reset statement_timeout;
reset lock_timeout;
