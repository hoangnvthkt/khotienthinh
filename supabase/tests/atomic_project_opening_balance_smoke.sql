-- A3.1 atomic project opening-balance smoke.
-- Run only on a disposable database migrated through A3.1. Every fixture,
-- finance update, WMS movement, and injected failure trigger is rolled back.
-- Coverage: success + exact retry, conflicting retry, zero quantity evidence,
-- multi-warehouse posting all-or-nothing, ambiguous item resolution,
-- stale/locked scope, finance staleness, and permission denial.

begin;

do $prerequisites$
begin
  if to_regprocedure('public.lock_project_opening_balance(jsonb)') is null
     or to_regprocedure('app_private.authorize_project_opening_write(uuid,jsonb,jsonb)') is null
     or to_regclass('app_private.project_opening_write_authorizations') is null then
    raise exception 'Missing A3.1 atomic project opening-balance prerequisites';
  end if;
end;
$prerequisites$;

create temp table atomic_opening_fixture (
  admin_id uuid not null,
  admin_email text not null,
  second_admin_id uuid not null,
  second_admin_email text not null,
  denied_id uuid not null,
  denied_email text not null,
  construction_site_id text not null,
  warehouse_a_id text not null,
  warehouse_b_id text not null,
  warehouse_fail_id text not null,
  item_id text not null,
  ambiguous_item_a_id text not null,
  ambiguous_item_b_id text not null,
  command_id uuid not null,
  balance_id uuid not null,
  rollback_command_id uuid not null,
  rollback_balance_id uuid not null,
  token text not null
) on commit drop;

insert into atomic_opening_fixture
select
  gen_random_uuid(),
  'atomic-opening-admin-' || seed.token || '@vioo.local',
  gen_random_uuid(),
  'atomic-opening-admin-2-' || seed.token || '@vioo.local',
  gen_random_uuid(),
  'atomic-opening-denied-' || seed.token || '@vioo.local',
  'atomic-opening-site-' || seed.token,
  'atomic-opening-a-' || seed.token,
  'atomic-opening-b-' || seed.token,
  'atomic-opening-z-fail-' || seed.token,
  'atomic-opening-item-' || seed.token,
  'atomic-opening-ambiguous-a-' || seed.token,
  'atomic-opening-ambiguous-b-' || seed.token,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  seed.token
from (
  select replace(gen_random_uuid()::text, '-', '') as token
) seed;

grant select on table atomic_opening_fixture to authenticated;

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
  'Atomic Opening Smoke Admin',
  fixture.admin_email,
  fixture.admin_email,
  'ADMIN'::public.user_role,
  true,
  '{}'::text[],
  '{}'::text[],
  '{}'::jsonb,
  '{}'::jsonb
from atomic_opening_fixture fixture
union all
select
  fixture.second_admin_id,
  'Atomic Opening Smoke Second Admin',
  fixture.second_admin_email,
  fixture.second_admin_email,
  'ADMIN'::public.user_role,
  true,
  '{}'::text[],
  '{}'::text[],
  '{}'::jsonb,
  '{}'::jsonb
from atomic_opening_fixture fixture
union all
select
  fixture.denied_id,
  'Atomic Opening Smoke Denied User',
  fixture.denied_email,
  fixture.denied_email,
  'EMPLOYEE'::public.user_role,
  true,
  '{}'::text[],
  '{}'::text[],
  '{}'::jsonb,
  '{}'::jsonb
from atomic_opening_fixture fixture;

insert into public.warehouses (id, name, address, type)
select warehouse_a_id, 'Atomic Opening Warehouse A', 'Smoke only', 'SITE'::public.warehouse_type
from atomic_opening_fixture
union all
select warehouse_b_id, 'Atomic Opening Warehouse B', 'Smoke only', 'SITE'::public.warehouse_type
from atomic_opening_fixture
union all
select warehouse_fail_id, 'Atomic Opening Warehouse Failure', 'Smoke only', 'SITE'::public.warehouse_type
from atomic_opening_fixture;

insert into public.items (
  id,
  sku,
  accounting_code,
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
  fixture.item_id,
  'ATOMIC-' || left(fixture.token, 16),
  '152-' || left(fixture.token, 16),
  'Atomic Opening Item',
  'Smoke',
  'kg',
  'kg',
  1,
  10,
  10,
  0,
  '{}'::jsonb
from atomic_opening_fixture fixture
union all
select
  fixture.ambiguous_item_a_id,
  'AMB-' || left(fixture.token, 16),
  'AMB-A-' || left(fixture.token, 12),
  'Ambiguous Item A',
  'Smoke',
  'kg',
  'kg',
  1,
  10,
  10,
  0,
  '{}'::jsonb
from atomic_opening_fixture fixture
union all
select
  fixture.ambiguous_item_b_id,
  lower('AMB-' || left(fixture.token, 16)),
  'AMB-B-' || left(fixture.token, 12),
  'Ambiguous Item B',
  'Smoke',
  'kg',
  'kg',
  1,
  10,
  10,
  0,
  '{}'::jsonb
from atomic_opening_fixture fixture;

create or replace function pg_temp.atomic_opening_command(
  p_command_id uuid,
  p_balance_id uuid,
  p_scope_key text,
  p_construction_site_id text,
  p_lines jsonb,
  p_project_finance_id text default null,
  p_finance_snapshot jsonb default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'commandId', p_command_id,
    'openingBalance', pg_catalog.jsonb_build_object(
      'id', p_balance_id,
      'scopeKey', p_scope_key,
      'projectId', null,
      'constructionSiteId', p_construction_site_id,
      'asOfDate', '2026-07-15',
      'contractValue', '1000',
      'constructionProgressPercent', '25',
      'purchasedValue', '100',
      'issuedValue', '40',
      'usedValue', '40',
      'recognizedValue', '40',
      'status', 'draft'
    ),
    'lines', p_lines,
    'projectFinanceId', p_project_finance_id,
    'financeSnapshot', p_finance_snapshot
  );
$$;

-- Inject a failure only at the lexically last target warehouse. The command
-- must roll back the earlier warehouse's completed movement with it.
create or replace function pg_temp.reject_atomic_opening_failure_warehouse()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_type = 'project_opening_balance'
     and exists (
       select 1
       from pg_temp.atomic_opening_fixture fixture
       where fixture.warehouse_fail_id = new.target_warehouse_id
     ) then
    raise exception 'injected multi-warehouse posting failure'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger zz_atomic_opening_injected_failure
before insert on public.transactions
for each row execute function pg_temp.reject_atomic_opening_failure_warehouse();

-- Mutate replay dependencies through a rollback-only owner helper so this
-- smoke proves the protected result snapshot is independent of later rows.
create or replace function pg_temp.mutate_atomic_opening_replay_dependencies(
  p_finance_id text,
  p_item_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_finances finance
  set "updatedAt" = finance."updatedAt" + interval '1 second'
  where finance.id = p_finance_id;

  update public.items item
  set name = item.name || ' (later catalog edit)'
  where item.id = p_item_id;
end;
$$;

revoke all on function pg_temp.mutate_atomic_opening_replay_dependencies(text, text)
  from public;
grant execute on function pg_temp.mutate_atomic_opening_replay_dependencies(text, text)
  to authenticated;

set local role authenticated;

select set_config('request.jwt.claim.email', admin_email, true)
from atomic_opening_fixture;
select set_config('request.jwt.claim.sub', admin_id::text, true)
from atomic_opening_fixture;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'email', admin_email,
    'sub', admin_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from atomic_opening_fixture;

do $security_surface$
declare
  fixture atomic_opening_fixture%rowtype;
begin
  select * into strict fixture from atomic_opening_fixture;

  if public.current_app_user_id() is distinct from fixture.admin_id then
    raise exception 'Smoke JWT did not resolve to the seeded admin';
  end if;
  if has_function_privilege(
    'authenticated',
    'app_private.authorize_project_opening_write(uuid,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can mint a project opening write authorization';
  end if;
  if has_table_privilege('authenticated', 'public.project_opening_balances', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.project_opening_balances', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.project_opening_balance_lines', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.project_opening_balance_lines', 'TRUNCATE') then
    raise exception 'an API role can truncate protected opening-balance history';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.project_opening_balances'::regclass
      and trigger_row.tgname = 'trg_guard_locked_project_opening_balance'
      and trigger_row.tgenabled = 'A'
  ) then
    raise exception 'opening-balance guard is not ENABLE ALWAYS';
  end if;
end;
$security_surface$;

do $atomic_command_checks$
declare
  fixture atomic_opening_fixture%rowtype;
  v_sku text;
  v_lines jsonb;
  v_command jsonb;
  v_first jsonb;
  v_retry jsonb;
  v_finance_snapshot jsonb;
  v_rollback_command jsonb;
  v_count integer;
  v_stock numeric;
begin
  select * into strict fixture from atomic_opening_fixture;
  select item.sku into strict v_sku
  from public.items item
  where item.id = fixture.item_id;

  v_lines := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'inventoryItemId', fixture.item_id,
      'accountingCode', '152-' || left(fixture.token, 16),
      'sku', v_sku,
      'itemName', 'Atomic Opening Item',
      'unit', 'kg',
      'warehouseId', fixture.warehouse_a_id,
      'purchasedQty', '1.25',
      'issuedQty', '0',
      'usedQty', '0',
      'remainingQty', '1.25',
      'unitPrice', '10',
      'remainingValue', '12.5'
    ),
    pg_catalog.jsonb_build_object(
      'inventoryItemId', fixture.item_id,
      'accountingCode', '152-' || left(fixture.token, 16),
      'sku', v_sku,
      'itemName', 'Zero quantity evidence',
      'unit', 'kg',
      'warehouseId', fixture.warehouse_b_id,
      'purchasedQty', '0',
      'issuedQty', '0',
      'usedQty', '0',
      'remainingQty', '0',
      'unitPrice', '10',
      'remainingValue', '0'
    )
  );
  v_command := pg_temp.atomic_opening_command(
    fixture.command_id,
    fixture.balance_id,
    '  Atomic Opening Scope ' || fixture.token || '  ',
    fixture.construction_site_id,
    v_lines
  );

  -- Non-finite quantity NaN is rejected before any document or WMS write.
  begin
    perform public.lock_project_opening_balance(
      pg_temp.atomic_opening_command(
        gen_random_uuid(),
        gen_random_uuid(),
        'atomic-opening-non-finite-quantity-' || fixture.token,
        fixture.construction_site_id,
        pg_catalog.jsonb_build_array(
          (v_lines->0) || pg_catalog.jsonb_build_object('remainingQty', 'NaN')
        )
      )
    );
    raise exception 'non-finite quantity NaN unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '22023' or position('finite' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Non-finite value Infinity is rejected at the same SQL trust boundary.
  begin
    perform public.lock_project_opening_balance(
      pg_temp.atomic_opening_command(
        gen_random_uuid(),
        gen_random_uuid(),
        'atomic-opening-non-finite-value-' || fixture.token,
        fixture.construction_site_id,
        pg_catalog.jsonb_build_array(
          (v_lines->0) || pg_catalog.jsonb_build_object('remainingValue', 'Infinity')
        )
      )
    );
    raise exception 'non-finite value Infinity unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '22023' or position('finite' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Successful lock and exact retry must return the same complete result.
  v_first := public.lock_project_opening_balance(v_command);
  v_retry := public.lock_project_opening_balance(v_command);
  if v_first is distinct from v_retry then
    raise exception 'exact retry returned a different result';
  end if;
  if not (v_first ?& array[
    'opening_balance',
    'lines',
    'project_finance',
    'material_project_transaction',
    'stock_transactions',
    'created_items',
    'updated_items'
  ]) then
    raise exception 'atomic response is missing required keys: %', v_first;
  end if;

  select count(*) into v_count
  from public.project_opening_balance_lines line
  where line.opening_balance_id = fixture.balance_id;
  if v_count <> 2 then
    raise exception 'zero quantity evidence line was not preserved';
  end if;

  select count(*) into v_count
  from public.transactions transaction_row
  where transaction_row.source_type = 'project_opening_balance'
    and transaction_row.source_id like fixture.balance_id::text || ':%';
  if v_count <> 1 then
    raise exception 'zero quantity line unexpectedly posted to WMS';
  end if;

  select (item.stock_by_warehouse->>fixture.warehouse_a_id)::numeric
  into v_stock
  from public.items item
  where item.id = fixture.item_id;
  if v_stock <> 1.25 then
    raise exception 'positive opening quantity did not post exactly once: %', v_stock;
  end if;

  -- Conflicting retry with the same command ID must fail closed.
  begin
    perform public.lock_project_opening_balance(
      pg_catalog.jsonb_set(v_command, '{openingBalance,purchasedValue}', '"101"'::jsonb)
    );
    raise exception 'conflicting retry unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '22023' or position('different content' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- A new command on the same normalized scope is stale/locked scope input.
  begin
    perform public.lock_project_opening_balance(
      pg_catalog.jsonb_set(v_command, '{commandId}', pg_catalog.to_jsonb(gen_random_uuid()))
    );
    raise exception 'stale/locked scope unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '23505' or position('already locked' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- The same command cannot be replayed by a different, currently authorized actor.
  perform set_config('request.jwt.claim.email', fixture.second_admin_email, true);
  perform set_config('request.jwt.claim.sub', fixture.second_admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'email', fixture.second_admin_email,
      'sub', fixture.second_admin_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
  begin
    perform public.lock_project_opening_balance(v_command);
    raise exception 'cross-actor exact retry unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501' or position('actor' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.email', fixture.admin_email, true);
  perform set_config('request.jwt.claim.sub', fixture.admin_id::text, true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'email', fixture.admin_email,
      'sub', fixture.admin_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  -- A supplied finance snapshot is an optimistic-concurrency precondition.
  -- Build the same semantic client snapshot that the RPC hashes and compares;
  -- the raw row image also contains legacy snake_case compatibility columns.
  select pg_catalog.jsonb_build_object(
    'id', finance.id,
    'projectId', finance.project_id,
    'constructionSiteId', coalesce(finance.construction_site_id, finance."constructionSiteId"),
    'contractValue', finance."contractValue",
    'progressPercent', finance."progressPercent",
    'status', finance.status,
    'notes', finance.notes,
    'updatedAt', finance."updatedAt"
  )
  into v_finance_snapshot
  from public.project_finances finance
  where finance.id = v_first->'project_finance'->>'id';
  perform pg_temp.mutate_atomic_opening_replay_dependencies(
    v_finance_snapshot->>'id',
    fixture.item_id
  );

  -- Exact retry returns the protected snapshot after finance and item edits.
  v_retry := public.lock_project_opening_balance(v_command);
  if v_retry is distinct from v_first then
    raise exception 'exact retry changed after later finance/item mutation';
  end if;

  begin
    perform public.lock_project_opening_balance(
      pg_temp.atomic_opening_command(
        gen_random_uuid(),
        gen_random_uuid(),
        'atomic-opening-finance-stale-' || fixture.token,
        fixture.construction_site_id,
        pg_catalog.jsonb_build_array(v_lines->0),
        v_finance_snapshot->>'id',
        v_finance_snapshot
      )
    );
    raise exception 'stale finance snapshot unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '40001' or position('finance snapshot is stale' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  select pg_catalog.jsonb_build_object(
    'id', finance.id,
    'projectId', finance.project_id,
    'constructionSiteId', coalesce(finance.construction_site_id, finance."constructionSiteId"),
    'contractValue', finance."contractValue",
    'progressPercent', finance."progressPercent",
    'status', finance.status,
    'notes', finance.notes,
    'updatedAt', finance."updatedAt"
  )
  into v_finance_snapshot
  from public.project_finances finance
  where finance.id = v_finance_snapshot->>'id';

  -- Case-insensitive exact SKU resolution must reject multiple matches.
  begin
    perform public.lock_project_opening_balance(
      pg_temp.atomic_opening_command(
        gen_random_uuid(),
        gen_random_uuid(),
        'atomic-opening-ambiguous-' || fixture.token,
        fixture.construction_site_id,
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'sku', 'AMB-' || left(fixture.token, 16),
            'itemName', 'Ambiguous item',
            'unit', 'kg',
            'warehouseId', fixture.warehouse_a_id,
            'purchasedQty', '1',
            'issuedQty', '0',
            'usedQty', '0',
            'remainingQty', '1',
            'unitPrice', '10',
            'remainingValue', '10'
          )
        )
      )
    );
    raise exception 'ambiguous item unexpectedly resolved';
  exception
    when others then
      if sqlstate <> '21000' or position('ambiguous' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- The failure warehouse sorts after warehouse B, proving the outer command
  -- transaction rolls back the already-posted first warehouse movement.
  v_rollback_command := pg_temp.atomic_opening_command(
    fixture.rollback_command_id,
    fixture.rollback_balance_id,
    'atomic-opening-rollback-' || fixture.token,
    fixture.construction_site_id,
    pg_catalog.jsonb_build_array(
      (v_lines->0) || pg_catalog.jsonb_build_object(
        'warehouseId', fixture.warehouse_b_id,
        'remainingQty', '0.50',
        'remainingValue', '5'
      ),
      (v_lines->0) || pg_catalog.jsonb_build_object(
        'warehouseId', fixture.warehouse_fail_id,
        'remainingQty', '0.75',
        'remainingValue', '7.5'
      )
    ),
    v_finance_snapshot->>'id',
    v_finance_snapshot
  );
  begin
    perform public.lock_project_opening_balance(v_rollback_command);
    raise exception 'multi-warehouse all-or-nothing command unexpectedly succeeded';
  exception
    when others then
      if position('injected multi-warehouse posting failure' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.project_opening_balances opening
    where opening.id = fixture.rollback_balance_id
  ) or exists (
    select 1
    from public.transactions transaction_row
    where transaction_row.source_type = 'project_opening_balance'
      and transaction_row.source_id like fixture.rollback_balance_id::text || ':%'
  ) then
    raise exception 'multi-warehouse all-or-nothing command left document rows behind';
  end if;
  select coalesce((item.stock_by_warehouse->>fixture.warehouse_b_id)::numeric, 0)
       + coalesce((item.stock_by_warehouse->>fixture.warehouse_fail_id)::numeric, 0)
  into v_stock
  from public.items item
  where item.id = fixture.item_id;
  if v_stock <> 0 then
    raise exception 'multi-warehouse all-or-nothing command left stock behind: %', v_stock;
  end if;

  -- A regular active user has neither project budget nor WMS completion rights.
  perform set_config('request.jwt.claim.email', fixture.denied_email, true);
  perform set_config('request.jwt.claim.sub', fixture.denied_id::text, true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'email', fixture.denied_email,
      'sub', fixture.denied_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
  begin
    perform public.lock_project_opening_balance(
      pg_temp.atomic_opening_command(
        gen_random_uuid(),
        gen_random_uuid(),
        'atomic-opening-permission-denial-' || fixture.token,
        fixture.construction_site_id,
        pg_catalog.jsonb_build_array(v_lines->0)
      )
    );
    raise exception 'permission denial command unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501' or position('project.budget.manage' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;
end;
$atomic_command_checks$;

reset role;

-- Owner/BYPASSRLS writes must still pass the ENABLE ALWAYS exact-image guard.
do $direct_write_and_immutability_checks$
declare
  fixture atomic_opening_fixture%rowtype;
  v_draft_id uuid := gen_random_uuid();
begin
  select * into strict fixture from atomic_opening_fixture;

  insert into public.project_opening_balances (
    id,
    scope_key,
    construction_site_id,
    as_of_date,
    status
  )
  values (
    v_draft_id,
    'atomic-opening-direct-lock-' || fixture.token,
    fixture.construction_site_id,
    '2026-07-15',
    'draft'
  );

  begin
    update public.project_opening_balances
    set status = 'locked'
    where id = v_draft_id;
    raise exception 'direct lock bypass unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501' or position('lock_project_opening_balance' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  begin
    insert into public.project_opening_balance_lines (
      opening_balance_id,
      inventory_item_id,
      sku,
      item_name,
      unit,
      warehouse_id
    )
    values (
      fixture.balance_id,
      fixture.item_id,
      'LOCKED-LINE-BYPASS',
      'Locked line bypass',
      'kg',
      fixture.warehouse_a_id
    );
    raise exception 'locked opening balance line insert unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '55000' or position('immutable' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  begin
    update public.project_opening_balance_lines
    set note = 'mutated locked line'
    where opening_balance_id = fixture.balance_id;
    raise exception 'locked opening balance line update unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '55000' or position('immutable' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  begin
    delete from public.project_opening_balance_lines
    where opening_balance_id = fixture.balance_id;
    raise exception 'locked opening balance line delete unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '55000' or position('immutable' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  begin
    update public.project_opening_balances
    set note = 'mutated history'
    where id = fixture.balance_id;
    raise exception 'locked opening balance mutation unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '55000' or position('immutable' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  begin
    update public.project_opening_balances
    set status = 'void'
    where id = fixture.balance_id;
    raise exception 'uncontrolled locked-to-void transition unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '55000' or position('immutable' in lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;
end;
$direct_write_and_immutability_checks$;

rollback;
