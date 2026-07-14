-- Release A1 WMS decimal stop-loss smoke test.
--
-- Prerequisites:
--   * Run only on a local or disposable database with all migrations through
--     20260714172459_wms_decimal_stop_loss.sql applied.
--   * The inventory ledger migrations and Phase 4 PBAC surface must exist.
--   * The executor must be able to seed fixtures before SET LOCAL ROLE.
--
-- The entire smoke test is transactional and rolls back all fixtures. It is
-- not executed by Vitest because it needs a migrated PostgreSQL/Supabase
-- database; the companion Vitest contract remains runnable without Docker.

begin;

do $$
begin
  if to_regprocedure('public.process_transaction_status(text,public.transaction_status,uuid)') is null then
    raise exception 'Missing process_transaction_status Release A1 prerequisite';
  end if;
  if to_regprocedure('public.apply_stock_change(text,text,numeric)') is null then
    raise exception 'Missing numeric apply_stock_change Release A1 prerequisite';
  end if;
  if to_regclass('public.inventory_ledger_entries') is null
     or to_regclass('public.inventory_balances') is null then
    raise exception 'Missing inventory ledger Release A1 prerequisite';
  end if;
end;
$$;

create temp table wms_decimal_stop_loss_smoke_ids (
  actor_id uuid not null,
  actor_email text not null,
  warehouse_a_id text not null,
  warehouse_b_id text not null,
  item_id text not null,
  import_tx_id text not null,
  export_tx_id text not null,
  transfer_tx_id text not null,
  adjustment_tx_id text not null,
  precision_tx_id text not null
) on commit drop;

grant select on table wms_decimal_stop_loss_smoke_ids to authenticated;

insert into wms_decimal_stop_loss_smoke_ids
select
  seed.actor_id,
  'wms-a1-smoke-' || seed.token || '@vioo.local',
  'wms-a1-wh-a-' || seed.token,
  'wms-a1-wh-b-' || seed.token,
  'wms-a1-item-' || seed.token,
  'wms-a1-import-' || seed.token,
  'wms-a1-export-' || seed.token,
  'wms-a1-transfer-' || seed.token,
  'wms-a1-adjustment-' || seed.token,
  'wms-a1-precision-' || seed.token
from (
  select
    gen_random_uuid() as actor_id,
    replace(gen_random_uuid()::text, '-', '') as token
) seed;

insert into public.users (
  id,
  name,
  email,
  username,
  role,
  is_active,
  allowed_modules,
  admin_modules,
  allowed_sub_modules,
  admin_sub_modules
)
select
  actor_id,
  'WMS A1 Decimal Smoke Admin',
  actor_email,
  actor_email,
  'ADMIN'::public.user_role,
  true,
  '{}'::text[],
  '{}'::text[],
  '{}'::jsonb,
  '{}'::jsonb
from wms_decimal_stop_loss_smoke_ids;

insert into public.warehouses (id, name, address, type)
select warehouse_a_id, 'WMS A1 Smoke Warehouse A', 'Smoke only', 'SITE'::public.warehouse_type
from wms_decimal_stop_loss_smoke_ids
union all
select warehouse_b_id, 'WMS A1 Smoke Warehouse B', 'Smoke only', 'SITE'::public.warehouse_type
from wms_decimal_stop_loss_smoke_ids;

insert into public.items (
  id,
  sku,
  name,
  category,
  unit,
  purchase_unit,
  purchase_conversion_factor,
  price_in,
  price_out,
  min_stock,
  stock_by_warehouse
)
select
  item_id,
  upper(left(item_id, 32)),
  'WMS A1 Decimal Smoke Item',
  'Smoke',
  'kg',
  'kg',
  1,
  0,
  0,
  0,
  jsonb_build_object(warehouse_a_id, 20.0000, warehouse_b_id, 5.0000)
from wms_decimal_stop_loss_smoke_ids;

insert into public.transactions (
  id,
  type,
  date,
  items,
  source_warehouse_id,
  target_warehouse_id,
  requester_id,
  approver_id,
  status,
  pending_items,
  note
)
select
  tx.id,
  tx.type::public.transaction_type,
  now(),
  jsonb_build_array(jsonb_build_object(
    'lineId', tx.id || '-line',
    'itemId', fixture.item_id,
    'quantity', tx.quantity,
    'price', 0
  )),
  tx.source_warehouse_id,
  tx.target_warehouse_id,
  fixture.actor_id,
  fixture.actor_id,
  'PENDING'::public.transaction_status,
  '[]'::jsonb,
  'Release A1 decimal smoke'
from wms_decimal_stop_loss_smoke_ids fixture
cross join lateral (
  values
    (fixture.import_tx_id, 'IMPORT', null::text, fixture.warehouse_a_id, 1.2500::numeric),
    (fixture.export_tx_id, 'EXPORT', fixture.warehouse_a_id, null::text, 0.5000::numeric),
    (fixture.transfer_tx_id, 'TRANSFER', fixture.warehouse_a_id, fixture.warehouse_b_id, 2.1250::numeric),
    (fixture.adjustment_tx_id, 'ADJUSTMENT', null::text, fixture.warehouse_a_id, -0.3750::numeric),
    (fixture.precision_tx_id, 'IMPORT', null::text, fixture.warehouse_a_id, 0.00001::numeric)
) tx(id, type, source_warehouse_id, target_warehouse_id, quantity);

set local role authenticated;

select set_config('request.jwt.claim.email', actor_email, true)
from wms_decimal_stop_loss_smoke_ids;

select set_config('request.jwt.claim.sub', actor_id::text, true)
from wms_decimal_stop_loss_smoke_ids;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', actor_email,
    'sub', actor_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from wms_decimal_stop_loss_smoke_ids;

do $smoke$
declare
  fixture wms_decimal_stop_loss_smoke_ids%rowtype;
  v_stock_a numeric;
  v_stock_b numeric;
  v_headers integer;
  v_entries integer;
  v_helper_denied boolean := false;
begin
  select * into fixture from wms_decimal_stop_loss_smoke_ids;

  if public.current_app_user_id() is distinct from fixture.actor_id then
    raise exception 'Smoke JWT did not resolve to the seeded admin';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.apply_stock_change(text,text,numeric)',
    'EXECUTE'
  ) then
    raise exception 'authenticated still has effective execute on apply_stock_change';
  end if;

  if has_function_privilege(
    'anon',
    'public.apply_stock_change(text,text,numeric)',
    'EXECUTE'
  ) then
    raise exception 'anon still has effective execute on apply_stock_change';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.process_transaction_status(text,public.transaction_status,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated lost execute on process_transaction_status';
  end if;

  begin
    perform public.apply_stock_change(fixture.item_id, fixture.warehouse_a_id, 0.1250);
  exception
    when insufficient_privilege then
      v_helper_denied := true;
  end;

  if not v_helper_denied then
    raise exception 'Direct apply_stock_change call was not denied';
  end if;

  perform public.process_transaction_status(
    fixture.import_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );

  select (i.stock_by_warehouse->>fixture.warehouse_a_id)::numeric
  into v_stock_a
  from public.items i
  where i.id = fixture.item_id;

  if v_stock_a <> 21.2500 then
    raise exception 'Decimal import expected stock 21.2500, got %', v_stock_a;
  end if;

  -- A second completion must be a no-op for both stock and the ledger.
  perform public.process_transaction_status(
    fixture.import_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );

  select count(*) into v_headers
  from public.inventory_transactions it
  where it.source_type = 'wms_transaction'
    and it.source_id = fixture.import_tx_id;

  select count(*) into v_entries
  from public.inventory_ledger_entries e
  join public.inventory_transactions it on it.id = e.inventory_transaction_id
  where it.source_type = 'wms_transaction'
    and it.source_id = fixture.import_tx_id;

  if v_headers <> 1 or v_entries <> 1 then
    raise exception 'Repeated completion duplicated import ledger rows: headers %, entries %', v_headers, v_entries;
  end if;

  perform public.process_transaction_status(
    fixture.export_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );
  perform public.process_transaction_status(
    fixture.transfer_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );
  perform public.process_transaction_status(
    fixture.adjustment_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );

  select
    (i.stock_by_warehouse->>fixture.warehouse_a_id)::numeric,
    (i.stock_by_warehouse->>fixture.warehouse_b_id)::numeric
  into v_stock_a, v_stock_b
  from public.items i
  where i.id = fixture.item_id;

  if v_stock_a <> 18.2500 or v_stock_b <> 7.1250 then
    raise exception 'Decimal export/transfer/adjustment expected A=18.2500 B=7.1250, got A=% B=%',
      v_stock_a,
      v_stock_b;
  end if;

  begin
    perform public.process_transaction_status(
      fixture.precision_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Five-decimal transaction unexpectedly completed';
  exception
    when others then
      if sqlstate <> 'P0001'
         or position('4 fractional digits' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  select
    (i.stock_by_warehouse->>fixture.warehouse_a_id)::numeric,
    (i.stock_by_warehouse->>fixture.warehouse_b_id)::numeric
  into v_stock_a, v_stock_b
  from public.items i
  where i.id = fixture.item_id;

  if v_stock_a <> 18.2500 or v_stock_b <> 7.1250 then
    raise exception 'Rejected five-decimal transaction changed stock';
  end if;

  if (select t.status from public.transactions t where t.id = fixture.precision_tx_id)
     <> 'PENDING'::public.transaction_status then
    raise exception 'Rejected five-decimal transaction changed status';
  end if;

  select count(*) into v_headers
  from public.inventory_transactions it
  where it.source_type = 'wms_transaction'
    and it.source_id in (
      fixture.import_tx_id,
      fixture.export_tx_id,
      fixture.transfer_tx_id,
      fixture.adjustment_tx_id,
      fixture.precision_tx_id
    );

  select count(*) into v_entries
  from public.inventory_ledger_entries e
  join public.inventory_transactions it on it.id = e.inventory_transaction_id
  where it.source_type = 'wms_transaction'
    and it.source_id in (
      fixture.import_tx_id,
      fixture.export_tx_id,
      fixture.transfer_tx_id,
      fixture.adjustment_tx_id,
      fixture.precision_tx_id
    );

  if v_headers <> 4 or v_entries <> 5 then
    raise exception 'Expected 4 ledger headers and 5 entries, got % and %', v_headers, v_entries;
  end if;

  raise notice 'WMS DECIMAL STOP-LOSS SMOKE PASSED';
end;
$smoke$;

rollback;
