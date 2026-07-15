-- Release A3 WMS posting containment smoke.
-- Run only on a disposable database migrated through A3. All fixtures and
-- movements are rolled back.

begin;

-- The canonical immediate-completion path is public.post_wms_transaction;
-- the focused runtime case below also verifies its exact idempotent replay.

do $prerequisites$
begin
  if to_regclass('app_private.wms_write_authorizations') is null
     or to_regprocedure('app_private.authorize_wms_write(text,text,jsonb,jsonb)') is null
     or to_regprocedure('app_private.apply_stock_change_internal(text,text,numeric)') is null
     or to_regprocedure('app_private.guard_wms_transaction_write()') is null
     or to_regprocedure('app_private.guard_item_stock_cache_write()') is null then
    raise exception 'Missing Release A3 WMS containment prerequisites';
  end if;
  if to_regprocedure('public.process_transaction_status(text,public.transaction_status,uuid)') is null then
    raise exception 'Missing guarded process_transaction_status';
  end if;
end;
$prerequisites$;

create temp table wms_posting_containment_fixture (
  actor_id uuid not null,
  actor_email text not null,
  warehouse_id text not null,
  item_a_id text not null,
  item_b_id text not null,
  direct_item_id text not null,
  direct_completed_tx_id text not null,
  adjustment_tx_id text not null,
  duplicate_line_tx_id text not null,
  failing_tx_id text not null,
  token text not null
) on commit drop;

grant select on table wms_posting_containment_fixture to authenticated;

insert into wms_posting_containment_fixture
select
  seed.actor_id,
  'wms-a3-smoke-' || seed.token || '@vioo.local',
  'wms-a3-warehouse-' || seed.token,
  'wms-a3-item-a-' || seed.token,
  'wms-a3-item-b-' || seed.token,
  'wms-a3-direct-item-' || seed.token,
  'wms-a3-direct-completed-' || seed.token,
  'wms-a3-adjustment-' || seed.token,
  'wms-a3-duplicate-lines-' || seed.token,
  'wms-a3-failing-' || seed.token,
  seed.token
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
  'WMS A3 Posting Smoke Admin',
  actor_email,
  actor_email,
  'ADMIN'::public.user_role,
  true,
  '{}'::text[],
  '{}'::text[],
  '{}'::jsonb,
  '{}'::jsonb
from wms_posting_containment_fixture;

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'WMS A3 Smoke Warehouse', 'Smoke only', 'SITE'::public.warehouse_type
from wms_posting_containment_fixture;

-- The A3 insert trigger allows catalog fixtures only with empty cache state.
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
  fixture.item_a_id,
  upper(left(fixture.item_a_id, 32)),
  'WMS A3 Smoke Item A',
  'Smoke',
  'm3',
  'm3',
  1,
  0,
  0,
  0,
  '{}'::jsonb
from wms_posting_containment_fixture fixture
union all
select
  fixture.item_b_id,
  upper(left(fixture.item_b_id, 32)),
  'WMS A3 Smoke Item B',
  'Smoke',
  'm3',
  'm3',
  1,
  0,
  0,
  0,
  '{}'::jsonb
from wms_posting_containment_fixture fixture;

set local role authenticated;

select set_config('request.jwt.claim.email', actor_email, true)
from wms_posting_containment_fixture;
select set_config('request.jwt.claim.sub', actor_id::text, true)
from wms_posting_containment_fixture;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', actor_email,
    'sub', actor_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from wms_posting_containment_fixture;

do $client_surface_checks$
declare
  fixture wms_posting_containment_fixture%rowtype;
begin
  select * into fixture from wms_posting_containment_fixture;

  if public.current_app_user_id() is distinct from fixture.actor_id then
    raise exception 'Smoke JWT did not resolve to the seeded A3 admin';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.apply_stock_change(text,text,numeric)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute the public fail-closed stock helper';
  end if;
  if has_function_privilege(
    'authenticated',
    'app_private.apply_stock_change_internal(text,text,numeric)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute the private stock helper';
  end if;
  if has_function_privilege(
    'authenticated',
    'app_private.authorize_wms_write(text,text,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can mint a WMS write authorization';
  end if;

  begin
    insert into public.transactions (
      id, type, date, items, target_warehouse_id,
      requester_id, approver_id, status, pending_items, note
    )
    values (
      fixture.direct_completed_tx_id,
      'ADJUSTMENT'::public.transaction_type,
      now(),
      jsonb_build_array(jsonb_build_object(
        'lineId', fixture.direct_completed_tx_id || '-line',
        'itemId', fixture.item_a_id,
        'quantity', 9.25,
        'price', 0
      )),
      fixture.warehouse_id,
      fixture.actor_id,
      fixture.actor_id,
      'COMPLETED'::public.transaction_status,
      '[]'::jsonb,
      'Direct completed insert must fail'
    );
    raise exception 'Direct completed insert unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501'
         or position('direct completed insert' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  begin
    insert into public.items (
      id, sku, name, category, unit,
      price_in, price_out, min_stock, stock_by_warehouse
    )
    values (
      fixture.direct_item_id,
      upper(left(fixture.direct_item_id, 32)),
      'Direct non-empty cache must fail',
      'Smoke',
      'm3',
      0,
      0,
      0,
      jsonb_build_object(fixture.warehouse_id, 1.25)
    );
    raise exception 'Direct non-empty stock cache insert unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501'
         or position('empty stock cache' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  begin
    update public.items
    set stock_by_warehouse = jsonb_build_object(fixture.warehouse_id, 99.5)
    where id = fixture.item_a_id;
    raise exception 'Direct stock cache update unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501'
         or position('direct stock cache' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Normal catalog edits remain possible when they do not alter cache state.
  update public.items
  set name = name || ' (catalog edit)'
  where id = fixture.item_a_id;
  if not found then
    raise exception 'Ordinary item metadata update was unexpectedly blocked';
  end if;
end;
$client_surface_checks$;

insert into public.transactions (
  id, type, date, items, target_warehouse_id,
  requester_id, approver_id, status, pending_items, note
)
select
  fixture.adjustment_tx_id,
  'ADJUSTMENT'::public.transaction_type,
  now(),
  jsonb_build_array(jsonb_build_object(
    'lineId', fixture.adjustment_tx_id || '-line',
    'itemId', fixture.item_a_id,
    'quantity', 1.25,
    'price', 0,
    'posting_engine_version', 'client-spoof',
    'quantity_policy_version', 999,
    'unitSnapshot', 'm3'
  )),
  fixture.warehouse_id,
  fixture.actor_id,
  fixture.actor_id,
  'PENDING'::public.transaction_status,
  '[]'::jsonb,
  'Guarded decimal adjustment'
from wms_posting_containment_fixture fixture;

-- RLS currently hides direct status updates. Reset to the migration owner to
-- prove the ENABLE ALWAYS trigger also blocks BYPASSRLS/definer-style writes.
reset role;

do $privileged_direct_status_check$
declare
  fixture wms_posting_containment_fixture%rowtype;
begin
  select * into fixture from wms_posting_containment_fixture;
  begin
    update public.transactions
    set status = 'COMPLETED'::public.transaction_status
    where id = fixture.adjustment_tx_id;
    raise exception 'Privileged direct status update unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501'
         or position('process_transaction_status' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$privileged_direct_status_check$;

set local role authenticated;

do $posting_and_idempotency_checks$
declare
  fixture wms_posting_containment_fixture%rowtype;
  v_stock numeric;
  v_balance numeric;
  v_header_count integer;
  v_entry_count integer;
  v_header_count_after integer;
  v_entry_count_after integer;
  v_header_metadata jsonb;
  v_entry_metadata jsonb;
begin
  select * into fixture from wms_posting_containment_fixture;

  perform public.process_transaction_status(
    fixture.adjustment_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );

  select (item.stock_by_warehouse->>fixture.warehouse_id)::numeric
  into v_stock
  from public.items item
  where item.id = fixture.item_a_id;

  select balance.on_hand_qty
  into v_balance
  from public.inventory_balances balance
  where balance.material_id = fixture.item_a_id
    and balance.warehouse_id = fixture.warehouse_id
    and balance.scope_key = '||||';

  select count(*)
  into v_header_count
  from public.inventory_transactions inventory_transaction
  where inventory_transaction.source_type = 'wms_transaction'
    and inventory_transaction.source_id = fixture.adjustment_tx_id;

  select inventory_transaction.metadata
  into v_header_metadata
  from public.inventory_transactions inventory_transaction
  where inventory_transaction.source_type = 'wms_transaction'
    and inventory_transaction.source_id = fixture.adjustment_tx_id
  limit 1;

  select count(*)
  into v_entry_count
  from public.inventory_ledger_entries entry
  where entry.source_type = 'wms_transaction'
    and entry.source_id = fixture.adjustment_tx_id;

  select entry.metadata
  into v_entry_metadata
  from public.inventory_ledger_entries entry
  where entry.source_type = 'wms_transaction'
    and entry.source_id = fixture.adjustment_tx_id
  limit 1;

  if v_stock <> 1.250000 or v_balance <> 1.250000 then
    raise exception 'Guarded posting did not converge: stock %, balance %', v_stock, v_balance;
  end if;
  if v_header_count <> 1 or v_entry_count <> 1 then
    raise exception 'Guarded posting expected one header/entry, got %/%', v_header_count, v_entry_count;
  end if;
  if v_header_metadata->>'posting_engine_version' <> 'wf001-a3-v1'
     or v_header_metadata->>'actor_id' <> fixture.actor_id::text
     or v_header_metadata->>'posted_at' is null
     or jsonb_array_length(v_header_metadata->'quantity_policy_snapshots') <> 1 then
    raise exception 'Header posting metadata contract mismatch: %', v_header_metadata;
  end if;
  if v_entry_metadata->>'posting_engine_version' <> 'wf001-a3-v1'
     or v_entry_metadata->>'quantity_policy_version' <> '0'
     or v_entry_metadata->>'stock_unit_snapshot' <> 'm3'
     or v_entry_metadata->>'source_quantity_text' <> '1.250000'
     or v_entry_metadata->>'actor_id' <> fixture.actor_id::text
     or v_entry_metadata->>'posted_at' is null then
    raise exception 'Ledger entry posting metadata contract mismatch: %', v_entry_metadata;
  end if;

  -- Same-status completion must be idempotent: no second stock or ledger write.
  perform public.process_transaction_status(
    fixture.adjustment_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );

  select count(*) into v_header_count_after
  from public.inventory_transactions inventory_transaction
  where inventory_transaction.source_type = 'wms_transaction'
    and inventory_transaction.source_id = fixture.adjustment_tx_id;
  select count(*) into v_entry_count_after
  from public.inventory_ledger_entries entry
  where entry.source_type = 'wms_transaction'
    and entry.source_id = fixture.adjustment_tx_id;
  select (item.stock_by_warehouse->>fixture.warehouse_id)::numeric
  into v_stock
  from public.items item
  where item.id = fixture.item_a_id;

  if v_stock <> 1.250000
     or v_header_count_after <> v_header_count
     or v_entry_count_after <> v_entry_count then
    raise exception 'Idempotent retry changed stock or ledger';
  end if;
end;
$posting_and_idempotency_checks$;

insert into public.transactions (
  id, type, date, items, target_warehouse_id,
  requester_id, approver_id, status, pending_items, note
)
select
  fixture.duplicate_line_tx_id,
  'ADJUSTMENT'::public.transaction_type,
  now(),
  jsonb_build_array(
    jsonb_build_object(
      'lineId', fixture.duplicate_line_tx_id || '-1',
      'itemId', fixture.item_b_id,
      'quantity', 0.4,
      'price', 0
    ),
    jsonb_build_object(
      'lineId', fixture.duplicate_line_tx_id || '-2',
      'itemId', fixture.item_b_id,
      'quantity', 0.6,
      'price', 0
    )
  ),
  fixture.warehouse_id,
  fixture.actor_id,
  fixture.actor_id,
  'PENDING'::public.transaction_status,
  '[]'::jsonb,
  'Duplicate decimal lines must remain exact'
from wms_posting_containment_fixture fixture;

select public.process_transaction_status(
  duplicate_line_tx_id,
  'COMPLETED'::public.transaction_status,
  actor_id
)
from wms_posting_containment_fixture;

insert into public.transactions (
  id, type, date, items, target_warehouse_id,
  requester_id, approver_id, status, pending_items, note
)
select
  fixture.failing_tx_id,
  'ADJUSTMENT'::public.transaction_type,
  now(),
  jsonb_build_array(
    jsonb_build_object(
      'lineId', fixture.failing_tx_id || '-valid',
      'itemId', fixture.item_a_id,
      'quantity', 0.5,
      'price', 0
    ),
    jsonb_build_object(
      'lineId', fixture.failing_tx_id || '-missing',
      'itemId', 'wms-a3-missing-' || fixture.token,
      'quantity', 0.5,
      'price', 0
    )
  ),
  fixture.warehouse_id,
  fixture.actor_id,
  fixture.actor_id,
  'PENDING'::public.transaction_status,
  '[]'::jsonb,
  'Failure injection must roll back the whole posting'
from wms_posting_containment_fixture fixture;

do $rollback_and_final_checks$
declare
  fixture wms_posting_containment_fixture%rowtype;
  v_stock_a numeric;
  v_stock_b numeric;
  v_balance_b numeric;
  v_status text;
begin
  select * into fixture from wms_posting_containment_fixture;

  begin
    perform public.process_transaction_status(
      fixture.failing_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Failure injection transaction unexpectedly completed';
  exception
    when others then
      if position('item not found' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  select (item.stock_by_warehouse->>fixture.warehouse_id)::numeric
  into v_stock_a
  from public.items item where item.id = fixture.item_a_id;
  select (item.stock_by_warehouse->>fixture.warehouse_id)::numeric
  into v_stock_b
  from public.items item where item.id = fixture.item_b_id;
  select balance.on_hand_qty
  into v_balance_b
  from public.inventory_balances balance
  where balance.material_id = fixture.item_b_id
    and balance.warehouse_id = fixture.warehouse_id
    and balance.scope_key = '||||';
  select transaction_row.status::text
  into v_status
  from public.transactions transaction_row
  where transaction_row.id = fixture.failing_tx_id;

  if v_stock_a <> 1.250000 then
    raise exception 'Failure injection changed stock; expected unchanged stock 1.25, got %', v_stock_a;
  end if;
  if v_stock_b <> 1.000000 or v_balance_b <> 1.000000 then
    raise exception 'Duplicate .4 + .6 posting was not exact: stock %, balance %', v_stock_b, v_balance_b;
  end if;
  if v_status <> 'PENDING' then
    raise exception 'Failure injection changed transaction status to %', v_status;
  end if;
  if exists (
    select 1 from public.inventory_transactions inventory_transaction
    where inventory_transaction.source_type = 'wms_transaction'
      and inventory_transaction.source_id in (
        fixture.direct_completed_tx_id,
        fixture.failing_tx_id
      )
  ) or exists (
    select 1 from public.inventory_ledger_entries entry
    where entry.source_type = 'wms_transaction'
      and entry.source_id in (
        fixture.direct_completed_tx_id,
        fixture.failing_tx_id
      )
  ) then
    raise exception 'Rejected path changed ledger; expected unchanged ledger';
  end if;
end;
$rollback_and_final_checks$;

reset role;

do $protected_state_checks$
declare
  fixture wms_posting_containment_fixture%rowtype;
begin
  select * into fixture from wms_posting_containment_fixture;

  if exists (select 1 from app_private.wms_write_authorizations) then
    raise exception 'A3 left an unconsumed one-use authorization';
  end if;
  if exists (
    select 1 from public.transactions transaction_row
    where transaction_row.id = fixture.direct_completed_tx_id
  ) then
    raise exception 'Rejected direct completed insert left a transaction row';
  end if;
  if exists (
    select 1 from public.items item
    where item.id = fixture.direct_item_id
  ) then
    raise exception 'Rejected direct cache insert left an item row';
  end if;

  begin
    update public.transactions
    set note = 'Completed payload mutation must fail'
    where id = fixture.adjustment_tx_id;
    raise exception 'Completed transaction mutation unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '55000'
         or position('completed transaction is immutable' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;
end;
$protected_state_checks$;

do $$
begin
  raise notice 'WMS POSTING CONTAINMENT SMOKE PASSED';
end;
$$;

rollback;
