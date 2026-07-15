-- Release A2 WMS quantity precision policy smoke test.
--
-- Run only on a local or disposable PostgreSQL/Supabase database with all
-- migrations through the newest wms_quantity_precision_policy migration.
-- The executor must be able to seed fixtures before SET LOCAL ROLE. Every
-- fixture and policy row is rolled back at the end.

begin;

do $$
begin
  if to_regclass('public.quantity_precision_policies') is null then
    raise exception 'Missing quantity_precision_policies Release A2 prerequisite';
  end if;
  if to_regprocedure('public.resolve_quantity_precision_policy(text)') is null
     or to_regprocedure('app_private.resolve_quantity_precision_policy(text)') is null
     or to_regprocedure('app_private.quantity_units_are_equivalent(text,text)') is null
     or to_regprocedure('app_private.assert_quantity_precision(text,text)') is null then
    raise exception 'Missing quantity precision resolver/assertion Release A2 prerequisite';
  end if;
  if to_regprocedure('public.process_transaction_status(text,public.transaction_status,uuid)') is null then
    raise exception 'Missing process_transaction_status Release A2 prerequisite';
  end if;
end;
$$;

-- Verify all five quantity typmods, retained monetary typmods, and the exact
-- generated-column contract after the temporary constant expressions used by
-- the migration. Both generated columns must finish with attgenerated = 's'.
do $catalog_checks$
declare
  v_type text;
  v_generated "char";
  v_expression text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into v_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.inventory_ledger_entries'::regclass
    and a.attname = 'quantity_in'
    and not a.attisdropped;
  if v_type <> 'numeric(20,6)' then
    raise exception 'quantity_in expected numeric(20,6), got %', v_type;
  end if;

  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into v_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.inventory_ledger_entries'::regclass
    and a.attname = 'quantity_out'
    and not a.attisdropped;
  if v_type <> 'numeric(20,6)' then
    raise exception 'quantity_out expected numeric(20,6), got %', v_type;
  end if;

  select
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    a.attgenerated,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid)
  into v_type, v_generated, v_expression
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid
   and d.adnum = a.attnum
  where a.attrelid = 'public.inventory_ledger_entries'::regclass
    and a.attname = 'quantity_delta'
    and not a.attisdropped;
  if v_type <> 'numeric(20,6)'
     or v_generated <> 's'
     or v_expression <> '(quantity_in - quantity_out)' then
    raise exception 'quantity_delta contract mismatch: type %, generated %, expression %',
      v_type, v_generated, v_expression;
  end if;

  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into v_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.inventory_ledger_entries'::regclass
    and a.attname = 'balance_after_qty'
    and not a.attisdropped;
  if v_type <> 'numeric(20,6)' then
    raise exception 'balance_after_qty expected numeric(20,6), got %', v_type;
  end if;

  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into v_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.inventory_balances'::regclass
    and a.attname = 'on_hand_qty'
    and not a.attisdropped;
  if v_type <> 'numeric(20,6)' then
    raise exception 'on_hand_qty expected numeric(20,6), got %', v_type;
  end if;

  select
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    a.attgenerated,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid)
  into v_type, v_generated, v_expression
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid
   and d.adnum = a.attnum
  where a.attrelid = 'public.inventory_ledger_entries'::regclass
    and a.attname = 'amount'
    and not a.attisdropped;
  if v_type <> 'numeric(18,4)'
     or v_generated <> 's'
     or v_expression <> '((quantity_in - quantity_out) * unit_price)' then
    raise exception 'amount contract mismatch: type %, generated %, expression %',
      v_type, v_generated, v_expression;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where (
      (a.attrelid = 'public.inventory_ledger_entries'::regclass
       and a.attname in ('unit_price', 'balance_after_value'))
      or
      (a.attrelid = 'public.inventory_balances'::regclass
       and a.attname in ('total_value', 'average_unit_cost'))
    )
      and not a.attisdropped
      and pg_catalog.format_type(a.atttypid, a.atttypmod) <> 'numeric(18,4)'
  ) then
    raise exception 'Release A2 changed a monetary column typmod';
  end if;
end;
$catalog_checks$;

create temp table wms_quantity_precision_smoke_ids (
  actor_id uuid not null,
  actor_email text not null,
  warehouse_id text not null,
  default_item_id text not null,
  scale3_item_id text not null,
  scale0_item_id text not null,
  default_valid_tx_id text not null,
  scale3_valid_tx_id text not null,
  scale0_valid_tx_id text not null,
  default_over_scale_tx_id text not null,
  scale3_over_scale_tx_id text not null,
  scale0_over_scale_tx_id text not null,
  out_of_range_tx_id text not null,
  spoofed_unit_tx_id text not null,
  blank_pending_item_id text not null,
  blank_pending_unit_tx_id text not null,
  malformed_tx_id text not null
) on commit drop;

grant select on table wms_quantity_precision_smoke_ids to authenticated;

insert into wms_quantity_precision_smoke_ids
select
  seed.actor_id,
  'wms-a2-smoke-' || seed.token || '@vioo.local',
  'wms-a2-wh-' || seed.token,
  'wms-a2-default-item-' || seed.token,
  'wms-a2-scale3-item-' || seed.token,
  'wms-a2-scale0-item-' || seed.token,
  'wms-a2-default-valid-' || seed.token,
  'wms-a2-scale3-valid-' || seed.token,
  'wms-a2-scale0-valid-' || seed.token,
  'wms-a2-default-over-scale-' || seed.token,
  'wms-a2-scale3-over-scale-' || seed.token,
  'wms-a2-scale0-over-scale-' || seed.token,
  'wms-a2-out-of-range-' || seed.token,
  'wms-a2-spoofed-unit-' || seed.token,
  'wms-a2-blank-pending-item-' || seed.token,
  'wms-a2-blank-pending-unit-' || seed.token,
  'wms-a2-malformed-' || seed.token
from (
  select
    gen_random_uuid() as actor_id,
    replace(gen_random_uuid()::text, '-', '') as token
) seed;

insert into public.quantity_precision_policies (
  unit_key,
  display_name,
  aliases,
  max_fraction_digits,
  conversion_rounding_mode,
  version,
  lifecycle_status,
  effective_from
)
values
  (
    'piece',
    'Piece (whole units)',
    array['cái', 'ea']::text[],
    0,
    'half_away_from_zero',
    4,
    'active',
    now() - interval '1 minute'
  ),
  (
    'kg',
    'Kilogram (milligram precision)',
    array['ki lô gam', 'kilogram']::text[],
    3,
    'half_away_from_zero',
    7,
    'active',
    now() - interval '1 minute'
  );

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
  'WMS A2 Quantity Precision Smoke Admin',
  actor_email,
  actor_email,
  'ADMIN'::public.user_role,
  true,
  '{}'::text[],
  '{}'::text[],
  '{}'::jsonb,
  '{}'::jsonb
from wms_quantity_precision_smoke_ids;

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'WMS A2 Smoke Warehouse', 'Smoke only', 'SITE'::public.warehouse_type
from wms_quantity_precision_smoke_ids;

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
  fixture.default_item_id,
  upper(left(fixture.default_item_id, 32)),
  'WMS A2 Default Scale Item',
  'Smoke',
  'm3',
  'm3',
  1,
  0,
  0,
  0,
  jsonb_build_object(fixture.warehouse_id, 10.000000)
from wms_quantity_precision_smoke_ids fixture
union all
select
  fixture.scale3_item_id,
  upper(left(fixture.scale3_item_id, 32)),
  'WMS A2 Scale 3 Item',
  'Smoke',
  'kg',
  'kg',
  1,
  0,
  0,
  0,
  jsonb_build_object(fixture.warehouse_id, 10.000000)
from wms_quantity_precision_smoke_ids fixture
union all
select
  fixture.scale0_item_id,
  upper(left(fixture.scale0_item_id, 32)),
  'WMS A2 Scale 0 Item',
  'Smoke',
  'piece',
  'piece',
  1,
  0,
  0,
  0,
  jsonb_build_object(fixture.warehouse_id, 10.000000)
from wms_quantity_precision_smoke_ids fixture;

insert into public.transactions (
  id,
  type,
  date,
  items,
  target_warehouse_id,
  requester_id,
  approver_id,
  status,
  pending_items,
  note
)
select
  tx.id,
  'IMPORT'::public.transaction_type,
  now(),
  jsonb_build_array(
    jsonb_strip_nulls(
      jsonb_build_object(
        'lineId', tx.id || '-line',
        'itemId', tx.item_id,
        'quantity', tx.quantity,
        'price', 0,
        'unit', tx.unit,
        'unitSnapshot', tx.unit_snapshot
      )
    )
  ),
  fixture.warehouse_id,
  fixture.actor_id,
  fixture.actor_id,
  'PENDING'::public.transaction_status,
  '[]'::jsonb,
  'Release A2 quantity precision smoke'
from wms_quantity_precision_smoke_ids fixture
cross join lateral (
  values
    (fixture.default_valid_tx_id, fixture.default_item_id, to_jsonb(0.123456::numeric), null::text, null::text),
    (fixture.scale3_valid_tx_id, fixture.scale3_item_id, to_jsonb(0.123::numeric), '  KILOGRAM  ', null::text),
    (fixture.scale0_valid_tx_id, fixture.scale0_item_id, to_jsonb(2::numeric), null::text, '  EA  '),
    (fixture.default_over_scale_tx_id, fixture.default_item_id, to_jsonb(0.1234567::numeric), null::text, null::text),
    (fixture.scale3_over_scale_tx_id, fixture.scale3_item_id, to_jsonb(0.1234::numeric), 'kg', null::text),
    (fixture.scale0_over_scale_tx_id, fixture.scale0_item_id, to_jsonb(1.5::numeric), 'piece', null::text),
    (fixture.out_of_range_tx_id, fixture.default_item_id, to_jsonb(100000000000000::numeric), null::text, null::text),
    (fixture.spoofed_unit_tx_id, fixture.scale0_item_id, to_jsonb(1.5::numeric), 'kg', null::text),
    (fixture.malformed_tx_id, fixture.default_item_id, to_jsonb('malformed'::text), null::text, null::text)
) tx(id, item_id, quantity, unit, unit_snapshot);

insert into public.transactions (
  id,
  type,
  date,
  items,
  target_warehouse_id,
  requester_id,
  approver_id,
  status,
  pending_items,
  note
)
select
  fixture.blank_pending_unit_tx_id,
  'IMPORT'::public.transaction_type,
  now(),
  jsonb_build_array(
    jsonb_build_object(
      'lineId', fixture.blank_pending_unit_tx_id || '-line',
      'itemId', fixture.blank_pending_item_id,
      'quantity', 1.5,
      'price', 0
    )
  ),
  fixture.warehouse_id,
  fixture.actor_id,
  fixture.actor_id,
  'PENDING'::public.transaction_status,
  jsonb_build_array(
    jsonb_build_object(
      'id', fixture.blank_pending_item_id,
      'sku', upper(left(fixture.blank_pending_item_id, 32)),
      'name', 'WMS A2 Blank Pending Unit',
      'category', 'Smoke',
      'unit', ''
    )
  ),
  'Blank pending unit must use the persisted Cái policy during validation'
from wms_quantity_precision_smoke_ids fixture;

do $range_boundary_checks$
begin
  if app_private.assert_quantity_precision('99999999999999.999999', 'm3')
     <> 99999999999999.999999::numeric then
    raise exception 'numeric(20,6) maximum valid quantity boundary changed';
  end if;
end;
$range_boundary_checks$;

set local role authenticated;

select set_config('request.jwt.claim.email', actor_email, true)
from wms_quantity_precision_smoke_ids;

select set_config('request.jwt.claim.sub', actor_id::text, true)
from wms_quantity_precision_smoke_ids;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', actor_email,
    'sub', actor_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from wms_quantity_precision_smoke_ids;

do $smoke$
declare
  fixture wms_quantity_precision_smoke_ids%rowtype;
  v_policy record;
  v_stock_default numeric;
  v_stock_scale3 numeric;
  v_stock_scale0 numeric;
  v_invalid_headers integer;
  v_invalid_entries integer;
begin
  select * into fixture from wms_quantity_precision_smoke_ids;

  if public.current_app_user_id() is distinct from fixture.actor_id then
    raise exception 'Smoke JWT did not resolve to the seeded admin';
  end if;

  if has_table_privilege('authenticated', 'public.quantity_precision_policies', 'INSERT')
     or has_table_privilege('authenticated', 'public.quantity_precision_policies', 'UPDATE')
     or has_table_privilege('authenticated', 'public.quantity_precision_policies', 'DELETE') then
    raise exception 'authenticated retains direct quantity policy write privileges';
  end if;

  if not has_function_privilege(
    'authenticated',
    'app_private.resolve_quantity_precision_policy(text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute the safe read-only private resolver';
  end if;

  if has_function_privilege(
    'authenticated',
    'app_private.assert_quantity_precision(text,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute the private quantity assertion';
  end if;

  if has_function_privilege(
    'authenticated',
    'app_private.quantity_units_are_equivalent(text,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute the private unit equivalence helper';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.resolve_quantity_precision_policy(text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated lost read-only policy resolver access';
  end if;

  select * into strict v_policy
  from public.resolve_quantity_precision_policy('  M3  ');
  if v_policy.max_fraction_digits <> 6
     or not v_policy.allow_fraction
     or v_policy.policy_version <> 0
     or not v_policy.is_default
     or v_policy.comparison_tolerance <> 0.0000005 then
    raise exception 'Default scale 6 policy contract mismatch: %', row_to_json(v_policy);
  end if;

  select * into strict v_policy
  from public.resolve_quantity_precision_policy(E'\tKI\t LÔ \n GAM\t');
  if v_policy.unit_key <> 'kg'
     or v_policy.max_fraction_digits <> 3
     or v_policy.policy_version <> 7
     or v_policy.is_default
     or v_policy.comparison_tolerance <> 0.0005000 then
    raise exception 'Configured scale 3 alias contract mismatch: %', row_to_json(v_policy);
  end if;

  select * into strict v_policy
  from public.resolve_quantity_precision_policy('  EA  ');
  if v_policy.unit_key <> 'piece'
     or v_policy.max_fraction_digits <> 0
     or v_policy.allow_fraction
     or v_policy.policy_version <> 4
     or v_policy.is_default
     or v_policy.comparison_tolerance <> 0.5000000 then
    raise exception 'Configured scale 0 alias contract mismatch: %', row_to_json(v_policy);
  end if;

  perform public.process_transaction_status(
    fixture.default_valid_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );
  perform public.process_transaction_status(
    fixture.scale3_valid_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );
  perform public.process_transaction_status(
    fixture.scale0_valid_tx_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );

  select
    (i.stock_by_warehouse->>fixture.warehouse_id)::numeric
  into v_stock_default
  from public.items i
  where i.id = fixture.default_item_id;

  select
    (i.stock_by_warehouse->>fixture.warehouse_id)::numeric
  into v_stock_scale3
  from public.items i
  where i.id = fixture.scale3_item_id;

  select
    (i.stock_by_warehouse->>fixture.warehouse_id)::numeric
  into v_stock_scale0
  from public.items i
  where i.id = fixture.scale0_item_id;

  if v_stock_default <> 10.123456
     or v_stock_scale3 <> 10.123000
     or v_stock_scale0 <> 12.000000 then
    raise exception 'Accepted policy quantities produced wrong stock: default %, scale3 %, scale0 %',
      v_stock_default, v_stock_scale3, v_stock_scale0;
  end if;

  if not exists (
    select 1
    from public.inventory_ledger_entries e
    join public.inventory_transactions it on it.id = e.inventory_transaction_id
    where it.source_type = 'wms_transaction'
      and it.source_id = fixture.default_valid_tx_id
      and e.quantity_in = 0.123456
      and e.quantity_out = 0
      and e.quantity_delta = 0.123456
  ) then
    raise exception 'Six-decimal quantity did not persist exactly in the ledger';
  end if;

  begin
    perform public.process_transaction_status(
      fixture.default_over_scale_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Default over-scale transaction unexpectedly completed';
  exception
    when others then
      if sqlstate <> '22023' or position('at most 6 fractional digits' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.process_transaction_status(
      fixture.scale3_over_scale_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Scale 3 over-scale transaction unexpectedly completed';
  exception
    when others then
      if sqlstate <> '22023' or position('at most 3 fractional digits' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.process_transaction_status(
      fixture.scale0_over_scale_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Scale 0 over-scale transaction unexpectedly completed';
  exception
    when others then
      if sqlstate <> '22023' or position('at most 0 fractional digits' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.process_transaction_status(
      fixture.malformed_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Malformed transaction quantity unexpectedly completed';
  exception
    when others then
      if sqlstate <> '22023' or position('finite numeric value' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.process_transaction_status(
      fixture.spoofed_unit_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Spoofed unit transaction unexpectedly completed';
  exception
    when others then
      if sqlstate <> '22023'
         or position('does not match authoritative stock unit' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.process_transaction_status(
      fixture.blank_pending_unit_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Blank pending unit transaction unexpectedly completed';
  exception
    when others then
      if sqlstate <> '22023' or position('at most 0 fractional digits' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.process_transaction_status(
      fixture.out_of_range_tx_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Out-of-range transaction unexpectedly completed';
  exception
    when others then
      if sqlstate <> '22003' or position('numeric(20,6) range' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  -- Rejection must leave unchanged stock across every configured/default case.
  if (select (i.stock_by_warehouse->>fixture.warehouse_id)::numeric
      from public.items i where i.id = fixture.default_item_id) <> v_stock_default
     or (select (i.stock_by_warehouse->>fixture.warehouse_id)::numeric
         from public.items i where i.id = fixture.scale3_item_id) <> v_stock_scale3
     or (select (i.stock_by_warehouse->>fixture.warehouse_id)::numeric
         from public.items i where i.id = fixture.scale0_item_id) <> v_stock_scale0 then
    raise exception 'Rejected quantity changed stock';
  end if;

  select count(*) into v_invalid_headers
  from public.inventory_transactions it
  where it.source_type = 'wms_transaction'
    and it.source_id in (
      fixture.default_over_scale_tx_id,
      fixture.scale3_over_scale_tx_id,
      fixture.scale0_over_scale_tx_id,
      fixture.out_of_range_tx_id,
      fixture.spoofed_unit_tx_id,
      fixture.blank_pending_unit_tx_id,
      fixture.malformed_tx_id
    );

  select count(*) into v_invalid_entries
  from public.inventory_ledger_entries e
  join public.inventory_transactions it on it.id = e.inventory_transaction_id
  where it.source_type = 'wms_transaction'
    and it.source_id in (
      fixture.default_over_scale_tx_id,
      fixture.scale3_over_scale_tx_id,
      fixture.scale0_over_scale_tx_id,
      fixture.out_of_range_tx_id,
      fixture.spoofed_unit_tx_id,
      fixture.blank_pending_unit_tx_id,
      fixture.malformed_tx_id
    );

  -- Rejection must leave unchanged ledger/header state: no rows at all.
  if v_invalid_headers <> 0 or v_invalid_entries <> 0 then
    raise exception 'Rejected quantity changed ledger: headers %, entries %',
      v_invalid_headers, v_invalid_entries;
  end if;

  if exists (
    select 1
    from public.transactions t
    where t.id in (
      fixture.default_over_scale_tx_id,
      fixture.scale3_over_scale_tx_id,
      fixture.scale0_over_scale_tx_id,
      fixture.out_of_range_tx_id,
      fixture.spoofed_unit_tx_id,
      fixture.blank_pending_unit_tx_id,
      fixture.malformed_tx_id
    )
      and t.status <> 'PENDING'::public.transaction_status
  ) then
    raise exception 'Rejected quantity changed transaction status';
  end if;

  if exists (
    select 1
    from public.items i
    where i.id = fixture.blank_pending_item_id
  ) then
    raise exception 'Rejected blank pending unit inserted the pending item';
  end if;

  raise notice 'WMS QUANTITY PRECISION POLICY SMOKE PASSED';
end;
$smoke$;

rollback;
