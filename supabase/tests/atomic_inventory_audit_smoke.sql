-- A3.2 atomic inventory-audit runtime smoke.
-- Run only on a disposable database migrated through 20260715140000.
-- All fixtures, ledger movements, injected failures and capability rows roll
-- back with this transaction.

begin;

do $prerequisites$
begin
  if pg_catalog.to_regprocedure(
       'public.post_inventory_audit(uuid,text,timestamptz,jsonb)'
     ) is null
     or pg_catalog.to_regclass(
       'app_private.inventory_audit_command_results'
     ) is null
     or pg_catalog.to_regclass(
       'app_private.inventory_audit_write_authorizations'
     ) is null then
    raise exception 'Missing A3.2 atomic inventory-audit prerequisites';
  end if;
end;
$prerequisites$;

create temp table atomic_audit_fixture (
  admin_id uuid not null,
  admin_email text not null,
  denied_id uuid not null,
  denied_email text not null,
  warehouse_id text not null,
  item_025_id text not null,
  item_175_id text not null,
  item_2375_id text not null,
  item_6dp_id text not null,
  mismatch_item_id text not null,
  negative_price_item_id text not null,
  rollback_a_item_id text not null,
  rollback_z_item_id text not null,
  command_id uuid not null,
  zero_command_id uuid not null,
  rollback_command_id uuid not null,
  token text not null
) on commit drop;

insert into atomic_audit_fixture
select
  pg_catalog.gen_random_uuid(),
  'atomic-audit-admin-' || seed.token || '@vioo.local',
  pg_catalog.gen_random_uuid(),
  'atomic-audit-denied-' || seed.token || '@vioo.local',
  'atomic-audit-warehouse-' || seed.token,
  'atomic-audit-025-' || seed.token,
  'atomic-audit-175-' || seed.token,
  'atomic-audit-2375-' || seed.token,
  'atomic-audit-6dp-' || seed.token,
  'atomic-audit-mismatch-' || seed.token,
  'atomic-audit-negative-price-' || seed.token,
  'atomic-audit-rollback-a-' || seed.token,
  'atomic-audit-rollback-z-' || seed.token,
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  seed.token
from (
  select pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') as token
) seed;

grant select on table atomic_audit_fixture to authenticated;

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
  fixture.admin_id,
  'Atomic Audit Smoke Admin',
  fixture.admin_email,
  fixture.admin_email,
  'ADMIN'::public.user_role,
  true,
  '{}'::text[],
  '{}'::text[],
  '{}'::jsonb,
  '{}'::jsonb
from atomic_audit_fixture fixture
union all
select
  fixture.denied_id,
  'Atomic Audit Smoke Denied',
  fixture.denied_email,
  fixture.denied_email,
  'EMPLOYEE'::public.user_role,
  true,
  '{}'::text[],
  '{}'::text[],
  '{}'::jsonb,
  '{}'::jsonb
from atomic_audit_fixture fixture;

insert into public.warehouses (id, name, address, type)
select
  fixture.warehouse_id,
  'Atomic Audit Warehouse',
  'Smoke only',
  'SITE'::public.warehouse_type
from atomic_audit_fixture fixture;

insert into public.items (
  id,
  sku,
  name,
  category,
  unit,
  price_in,
  price_out,
  min_stock,
  stock_by_warehouse
)
select fixture.item_025_id, 'AUD-025-' || left(fixture.token, 10),
       'Audit decimal 0.25', 'Smoke', 'kg', 10, 10, 0, '{}'::jsonb
from atomic_audit_fixture fixture
union all
select fixture.item_175_id, 'AUD-175-' || left(fixture.token, 10),
       'Audit decimal 1.75', 'Smoke', 'kg', 10, 10, 0, '{}'::jsonb
from atomic_audit_fixture fixture
union all
select fixture.item_2375_id, 'AUD-2375-' || left(fixture.token, 10),
       'Audit decimal 2.375', 'Smoke', 'kg', 10, 10, 0, '{}'::jsonb
from atomic_audit_fixture fixture
union all
select fixture.item_6dp_id, 'AUD-6DP-' || left(fixture.token, 10),
       'Audit decimal 0.123456', 'Smoke', 'kg', 10, 10, 0, '{}'::jsonb
from atomic_audit_fixture fixture
union all
select fixture.mismatch_item_id, 'AUD-MISMATCH-' || left(fixture.token, 10),
       'Audit balance mismatch', 'Smoke', 'kg', 10, 10, 0, '{}'::jsonb
from atomic_audit_fixture fixture
union all
select fixture.negative_price_item_id, 'AUD-NEG-PRICE-' || left(fixture.token, 10),
       'Audit invalid negative price', 'Smoke', 'kg', -10, 10, 0, '{}'::jsonb
from atomic_audit_fixture fixture
union all
select fixture.rollback_a_item_id, 'AUD-RB-A-' || left(fixture.token, 10),
       'Audit rollback first item', 'Smoke', 'kg', 10, 10, 0, '{}'::jsonb
from atomic_audit_fixture fixture
union all
select fixture.rollback_z_item_id, 'AUD-RB-Z-' || left(fixture.token, 10),
       'Audit rollback failing item', 'Smoke', 'kg', 10, 10, 0, '{}'::jsonb
from atomic_audit_fixture fixture;

set local role authenticated;

select pg_catalog.set_config('request.jwt.claim.email', admin_email, true)
from atomic_audit_fixture;
select pg_catalog.set_config('request.jwt.claim.sub', admin_id::text, true)
from atomic_audit_fixture;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'email', admin_email,
    'sub', admin_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from atomic_audit_fixture;

-- Seed authoritative cache + ledger/balance through the hardened posting
-- engine. Zero-stock rollback-a deliberately has no seed movement.
select public.post_wms_transaction(
  pg_catalog.jsonb_build_object(
    'id', 'atomic-audit-seed-' || fixture.token,
    'type', 'IMPORT',
    'date', pg_catalog.to_jsonb(pg_catalog.now()),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', fixture.item_025_id, 'quantity', '1', 'unit', 'kg'),
      pg_catalog.jsonb_build_object('itemId', fixture.item_175_id, 'quantity', '2', 'unit', 'kg'),
      pg_catalog.jsonb_build_object('itemId', fixture.item_2375_id, 'quantity', '3', 'unit', 'kg'),
      pg_catalog.jsonb_build_object('itemId', fixture.item_6dp_id, 'quantity', '1', 'unit', 'kg'),
      pg_catalog.jsonb_build_object('itemId', fixture.mismatch_item_id, 'quantity', '1', 'unit', 'kg'),
      pg_catalog.jsonb_build_object('itemId', fixture.rollback_z_item_id, 'quantity', '1', 'unit', 'kg')
    ),
    'targetWarehouseId', fixture.warehouse_id,
    'requesterId', fixture.admin_id::text,
    'status', 'COMPLETED',
    'note', 'A3.2 smoke seed',
    'sourceType', 'atomic_inventory_audit_smoke_seed',
    'sourceId', fixture.token,
    'pendingItems', '[]'::jsonb
  )
)
from atomic_audit_fixture fixture;

reset role;

-- Create an all-scope mismatch that must not be hidden by checking only the
-- default `||||` balance row.
insert into public.inventory_balances (
  material_id,
  warehouse_id,
  project_id,
  on_hand_qty,
  total_value,
  average_unit_cost
)
select mismatch_item_id, warehouse_id, 'atomic-audit-extra-scope-' || token, 0.5, 5, 10
from atomic_audit_fixture;

-- Failure injection between two item cache mutations proves the outer audit
-- command rolls back its session, first stock update and ledger together.
create or replace function pg_temp.fail_atomic_audit_second_item()
returns trigger
language plpgsql
as $$
declare
  v_failure_item_id text;
begin
  select rollback_z_item_id into strict v_failure_item_id
  from atomic_audit_fixture;
  if new.id = v_failure_item_id
     and old.stock_by_warehouse is distinct from new.stock_by_warehouse then
    raise exception 'injected multi-item rollback failure';
  end if;
  return new;
end;
$$;

create trigger trg_atomic_audit_injected_failure
before update on public.items
for each row execute function pg_temp.fail_atomic_audit_second_item();

set local role authenticated;

do $security_surface$
declare
  fixture atomic_audit_fixture%rowtype;
begin
  select * into strict fixture from atomic_audit_fixture;

  if public.current_app_user_id() is distinct from fixture.admin_id then
    raise exception 'A3.2 smoke JWT did not resolve to the seeded admin';
  end if;
  if pg_catalog.has_function_privilege(
    'authenticated',
    'app_private.authorize_inventory_audit_write(text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can mint an inventory-audit capability';
  end if;
  if pg_catalog.has_table_privilege(
       'authenticated', 'public.audit_sessions', 'INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.audit_sessions', 'INSERT,UPDATE,DELETE'
     ) then
    raise exception 'direct DML remains available on audit_sessions';
  end if;
  if pg_catalog.has_table_privilege(
       'authenticated', 'public.audit_sessions', 'TRUNCATE'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.audit_sessions', 'TRUNCATE'
     ) then
    raise exception 'TRUNCATE denial is missing on audit_sessions';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.audit_sessions'::pg_catalog.regclass
      and trigger_row.tgname = 'trg_guard_inventory_audit_session'
      and trigger_row.tgenabled = 'A'
  ) then
    raise exception 'inventory-audit immutable guard is not ENABLE ALWAYS';
  end if;

  -- Direct DML must fail before it can create forged physical evidence.
  begin
    insert into public.audit_sessions (id, "warehouseId", items)
    values ('forged-audit-' || fixture.token, fixture.warehouse_id, '[]'::jsonb);
    raise exception 'direct DML unexpectedly inserted an audit session';
  exception
    when insufficient_privilege then null;
  end;

  -- Generic posting cannot claim the deterministic reserved source.
  begin
    perform public.post_wms_transaction(
      pg_catalog.jsonb_build_object(
        'id', 'forged-audit-adjustment-' || fixture.token,
        'type', 'ADJUSTMENT',
        'date', pg_catalog.to_jsonb(pg_catalog.now()),
        'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'itemId', fixture.rollback_a_item_id,
            'quantity', '1',
            'unit', 'kg'
          )
        ),
        'targetWarehouseId', fixture.warehouse_id,
        'requesterId', fixture.admin_id::text,
        'status', 'COMPLETED',
        'sourceType', 'inventory_audit',
        'sourceId', pg_catalog.gen_random_uuid()::text,
        'pendingItems', '[]'::jsonb
      )
    );
    raise exception 'generic posting spoofed the reserved inventory_audit source';
  exception
    when insufficient_privilege then null;
  end;
end;
$security_surface$;

do $atomic_audit_checks$
declare
  fixture atomic_audit_fixture%rowtype;
  v_observations jsonb;
  v_first jsonb;
  v_retry jsonb;
  v_zero jsonb;
  v_zero_retry jsonb;
  v_count integer;
  v_stock numeric;
begin
  select * into strict fixture from atomic_audit_fixture;

  -- Decimal success: 0.25, 1.75, 2.375 and six digits are posted exactly.
  v_observations := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'item_id', fixture.item_025_id,
      'actual_qty', '0.25',
      'expected_system_qty', '1',
      'loss_reason', 'MEASUREMENT',
      'note', '0.25 decimal check'
    ),
    pg_catalog.jsonb_build_object(
      'item_id', fixture.item_175_id,
      'actual_qty', '1.75',
      'expected_system_qty', '2',
      'loss_reason', 'MEASUREMENT'
    ),
    pg_catalog.jsonb_build_object(
      'item_id', fixture.item_2375_id,
      'actual_qty', '2.375',
      'expected_system_qty', '3',
      'loss_reason', 'MEASUREMENT'
    ),
    pg_catalog.jsonb_build_object(
      'item_id', fixture.item_6dp_id,
      'actual_qty', '0.123456',
      'expected_system_qty', '1',
      'loss_reason', 'MEASUREMENT'
    )
  );

  v_first := public.post_inventory_audit(
    fixture.command_id,
    fixture.warehouse_id,
    '2026-07-15T03:00:00Z'::timestamptz,
    v_observations
  );
  v_retry := public.post_inventory_audit(
    fixture.command_id,
    fixture.warehouse_id,
    '2026-07-15T03:00:00Z'::timestamptz,
    v_observations
  );
  if v_first is distinct from v_retry then
    raise exception 'exact retry returned a different stable result';
  end if;
  if not (v_first ?& array['audit_session', 'stock_transaction', 'updated_items']) then
    raise exception 'atomic inventory-audit response shape drifted: %', v_first;
  end if;
  if v_first->'stock_transaction'->>'source_type' <> 'inventory_audit'
     or v_first->'stock_transaction'->>'source_id' <> fixture.command_id::text
     or v_first->'stock_transaction'->>'id' <> 'audit-adjustment-' || fixture.command_id::text then
    raise exception 'deterministic source or transaction identity drifted: %', v_first;
  end if;

  select (item.stock_by_warehouse->>fixture.warehouse_id)::numeric
  into v_stock
  from public.items item
  where item.id = fixture.item_6dp_id;
  if v_stock <> 0.123456 then
    raise exception 'six-digit inventory audit quantity drifted: %', v_stock;
  end if;

  -- Conflicting retry must never post twice.
  begin
    perform public.post_inventory_audit(
      fixture.command_id,
      fixture.warehouse_id,
      '2026-07-15T03:00:00Z'::timestamptz,
      pg_catalog.jsonb_set(v_observations, '{0,actual_qty}', '"0.5"'::jsonb)
    );
    raise exception 'conflicting retry unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;

  -- All-zero observations remain immutable evidence but create no movement.
  v_zero := public.post_inventory_audit(
    fixture.zero_command_id,
    fixture.warehouse_id,
    '2026-07-15T04:00:00Z'::timestamptz,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_id', fixture.item_025_id,
        'actual_qty', '0.25',
        'expected_system_qty', '0.25'
      )
    )
  );
  if v_zero->'stock_transaction' <> 'null'::jsonb then
    raise exception 'all-zero audit unexpectedly created a WMS movement';
  end if;

  -- The function pins UTC, so an exact lost-response retry remains stable
  -- even when pooled sessions have different TimeZone settings.
  perform pg_catalog.set_config('TimeZone', 'Asia/Ho_Chi_Minh', true);
  v_zero_retry := public.post_inventory_audit(
    fixture.zero_command_id,
    fixture.warehouse_id,
    '2026-07-15T04:00:00Z'::timestamptz,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_id', fixture.item_025_id,
        'actual_qty', '0.25',
        'expected_system_qty', '0.25'
      )
    )
  );
  perform pg_catalog.set_config('TimeZone', 'UTC', true);
  if v_zero_retry is distinct from v_zero then
    raise exception 'exact retry changed across session TimeZone settings';
  end if;

  -- Duplicate item validation precedes any write.
  begin
    perform public.post_inventory_audit(
      pg_catalog.gen_random_uuid(),
      fixture.warehouse_id,
      pg_catalog.now(),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', fixture.item_025_id,
          'actual_qty', '0.25',
          'expected_system_qty', '0.25'
        ),
        pg_catalog.jsonb_build_object(
          'item_id', fixture.item_025_id,
          'actual_qty', '0.25',
          'expected_system_qty', '0.25'
        )
      )
    );
    raise exception 'duplicate item unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;

  -- Stale client cache uses the explicit serialization failure SQLSTATE 40001.
  begin
    perform public.post_inventory_audit(
      pg_catalog.gen_random_uuid(),
      fixture.warehouse_id,
      pg_catalog.now(),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', fixture.item_025_id,
          'actual_qty', '0.25',
          'expected_system_qty', '1',
          'loss_reason', 'MEASUREMENT'
        )
      )
    );
    raise exception 'stale expected cache unexpectedly succeeded';
  exception
    when serialization_failure then null; -- SQLSTATE 40001
  end;

  -- SUM(inventory_balances) across all scopes detects this extra scoped row.
  begin
    perform public.post_inventory_audit(
      pg_catalog.gen_random_uuid(),
      fixture.warehouse_id,
      pg_catalog.now(),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', fixture.mismatch_item_id,
          'actual_qty', '1',
          'expected_system_qty', '1'
        )
      )
    );
    raise exception 'balance/cache mismatch unexpectedly succeeded';
  exception
    when object_not_in_prerequisite_state then
      if pg_catalog.position('reconciliation' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Legacy negative item prices must fail closed instead of producing a
  -- negative server-authoritative loss value.
  begin
    perform public.post_inventory_audit(
      pg_catalog.gen_random_uuid(),
      fixture.warehouse_id,
      pg_catalog.now(),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', fixture.negative_price_item_id,
          'actual_qty', '0',
          'expected_system_qty', '0'
        )
      )
    );
    raise exception 'negative item price unexpectedly succeeded';
  exception
    when object_not_in_prerequisite_state then
      if pg_catalog.position('price' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Injected second-item failure must roll back first cache mutation, session,
  -- ledger and deterministic transaction (multi-item rollback).
  begin
    perform public.post_inventory_audit(
      fixture.rollback_command_id,
      fixture.warehouse_id,
      pg_catalog.now(),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', fixture.rollback_a_item_id,
          'actual_qty', '1',
          'expected_system_qty', '0',
          'loss_reason', 'MEASUREMENT'
        ),
        pg_catalog.jsonb_build_object(
          'item_id', fixture.rollback_z_item_id,
          'actual_qty', '0',
          'expected_system_qty', '1',
          'loss_reason', 'MEASUREMENT'
        )
      )
    );
    raise exception 'multi-item injected rollback unexpectedly succeeded';
  exception
    when others then
      if pg_catalog.position('injected multi-item rollback failure' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  select coalesce((item.stock_by_warehouse->>fixture.warehouse_id)::numeric, 0)
  into v_stock
  from public.items item
  where item.id = fixture.rollback_a_item_id;
  if v_stock <> 0 then
    raise exception 'multi-item rollback retained the first cache mutation: %', v_stock;
  end if;
  select pg_catalog.count(*) into v_count
  from public.audit_sessions audit
  where audit.command_id = fixture.rollback_command_id;
  if v_count <> 0 then
    raise exception 'multi-item rollback retained immutable audit evidence';
  end if;
  select pg_catalog.count(*) into v_count
  from public.transactions transaction_row
  where transaction_row.source_type = 'inventory_audit'
    and transaction_row.source_id = fixture.rollback_command_id::text;
  if v_count <> 0 then
    raise exception 'multi-item rollback retained its deterministic source';
  end if;
end;
$atomic_audit_checks$;

do $permission_denial$
declare
  fixture atomic_audit_fixture%rowtype;
begin
  select * into strict fixture from atomic_audit_fixture;
  perform pg_catalog.set_config('request.jwt.claim.email', fixture.denied_email, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', fixture.denied_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'email', fixture.denied_email,
      'sub', fixture.denied_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.post_inventory_audit(
      pg_catalog.gen_random_uuid(),
      fixture.warehouse_id,
      pg_catalog.now(),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', fixture.item_025_id,
          'actual_qty', '0.25',
          'expected_system_qty', '0.25'
        )
      )
    );
    raise exception 'permission denial unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$permission_denial$;

rollback;
