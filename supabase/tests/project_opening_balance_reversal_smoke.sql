-- A3.1 controlled project opening-balance reversal smoke.
-- Run only on a disposable database migrated through the reversal release.
-- Coverage: decimal inverse, exact retry, conflicting retry, cross-actor
-- replay, insufficient stock, stale finance, permission denial, ledger
-- immutability, source spoofing, and multi-warehouse all-or-nothing rollback.

begin;

do $prerequisites$
begin
  if pg_catalog.to_regprocedure('public.reverse_project_opening_balance(jsonb)') is null
     or pg_catalog.to_regprocedure('public.lock_project_opening_balance(jsonb)') is null
     or pg_catalog.to_regprocedure('public.post_wms_transaction(jsonb)') is null
     or pg_catalog.to_regclass('app_private.project_opening_reversal_results') is null then
    raise exception 'Missing project opening-balance reversal prerequisites';
  end if;
end;
$prerequisites$;

create temp table opening_reversal_fixture (
  admin_id uuid not null,
  admin_email text not null,
  second_admin_id uuid not null,
  second_admin_email text not null,
  denied_id uuid not null,
  denied_email text not null,
  warehouse_a_id text not null,
  warehouse_fail_id text not null,
  primary_site_id text not null,
  insufficient_site_id text not null,
  stale_site_id text not null,
  denied_site_id text not null,
  rollback_site_id text not null,
  primary_item_id text not null,
  insufficient_item_id text not null,
  stale_item_id text not null,
  denied_item_id text not null,
  rollback_item_id text not null,
  primary_balance_id uuid not null,
  insufficient_balance_id uuid not null,
  stale_balance_id uuid not null,
  denied_balance_id uuid not null,
  rollback_balance_id uuid not null,
  primary_lock_command_id uuid not null,
  insufficient_lock_command_id uuid not null,
  stale_lock_command_id uuid not null,
  denied_lock_command_id uuid not null,
  rollback_lock_command_id uuid not null,
  primary_reversal_command_id uuid not null,
  token text not null
) on commit drop;

insert into opening_reversal_fixture
select
  pg_catalog.gen_random_uuid(),
  'opening-reversal-admin-' || seed.token || '@vioo.local',
  pg_catalog.gen_random_uuid(),
  'opening-reversal-admin-2-' || seed.token || '@vioo.local',
  pg_catalog.gen_random_uuid(),
  'opening-reversal-denied-' || seed.token || '@vioo.local',
  'a-opening-reversal-' || seed.token,
  'z-opening-reversal-fail-' || seed.token,
  pg_catalog.gen_random_uuid()::text,
  pg_catalog.gen_random_uuid()::text,
  pg_catalog.gen_random_uuid()::text,
  pg_catalog.gen_random_uuid()::text,
  pg_catalog.gen_random_uuid()::text,
  'opening-reversal-primary-' || seed.token,
  'opening-reversal-insufficient-' || seed.token,
  'opening-reversal-stale-' || seed.token,
  'opening-reversal-denied-' || seed.token,
  'opening-reversal-rollback-' || seed.token,
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  pg_catalog.gen_random_uuid(),
  seed.token
from (
  select pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') as token
) seed;

grant select on table opening_reversal_fixture to authenticated;

insert into public.hrm_construction_sites (id, name)
select site_id::uuid, 'Opening reversal ' || label || ' smoke site'
from opening_reversal_fixture fixture
cross join lateral (
  values
    (fixture.primary_site_id, 'primary'),
    (fixture.insufficient_site_id, 'insufficient'),
    (fixture.stale_site_id, 'stale'),
    (fixture.denied_site_id, 'denied'),
    (fixture.rollback_site_id, 'rollback')
) site(site_id, label);

insert into public.users (
  id, name, email, username, role, is_active,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select fixture.admin_id, 'Opening Reversal Admin', fixture.admin_email,
       fixture.admin_email, 'ADMIN'::public.user_role, true,
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from opening_reversal_fixture fixture
union all
select fixture.second_admin_id, 'Opening Reversal Second Admin', fixture.second_admin_email,
       fixture.second_admin_email, 'ADMIN'::public.user_role, true,
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from opening_reversal_fixture fixture
union all
select fixture.denied_id, 'Opening Reversal Denied', fixture.denied_email,
       fixture.denied_email, 'EMPLOYEE'::public.user_role, true,
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from opening_reversal_fixture fixture;

insert into public.warehouses (id, name, address, type)
select fixture.warehouse_a_id, 'Opening Reversal Warehouse A', 'Smoke only',
       'SITE'::public.warehouse_type
from opening_reversal_fixture fixture
union all
select fixture.warehouse_fail_id, 'Opening Reversal Warehouse Failure', 'Smoke only',
       'SITE'::public.warehouse_type
from opening_reversal_fixture fixture;

insert into public.items (
  id, sku, accounting_code, name, category, unit, purchase_unit,
  purchase_conversion_factor, price_in, price_out, min_stock, stock_by_warehouse
)
select item_id,
       'REV-' || item_kind || '-' || pg_catalog.left(fixture.token, 10),
       '152-REV-' || item_kind || '-' || pg_catalog.left(fixture.token, 8),
       'Opening reversal ' || item_kind || ' item',
       'Smoke', 'kg', 'kg', 1, 10, 10, 0, '{}'::jsonb
from opening_reversal_fixture fixture
cross join lateral (
  values
    (fixture.primary_item_id, 'primary'),
    (fixture.insufficient_item_id, 'insufficient'),
    (fixture.stale_item_id, 'stale'),
    (fixture.denied_item_id, 'denied'),
    (fixture.rollback_item_id, 'rollback')
) item(item_id, item_kind);

create or replace function pg_temp.set_opening_reversal_actor(
  p_actor_id uuid,
  p_email text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.email', p_email, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'email', p_email,
      'sub', p_actor_id,
      'role', 'authenticated'
    )::text,
    true
  );
end;
$$;

create or replace function pg_temp.opening_reversal_line(
  p_item_id text,
  p_warehouse_id text,
  p_quantity numeric
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'inventoryItemId', item.id,
    'accountingCode', item.accounting_code,
    'sku', item.sku,
    'itemName', item.name,
    'unit', item.unit,
    'warehouseId', p_warehouse_id,
    'purchasedQty', p_quantity::text,
    'issuedQty', '0',
    'usedQty', '0',
    'remainingQty', p_quantity::text,
    'unitPrice', '10',
    'remainingValue', (p_quantity * 10)::text
  )
  from public.items item
  where item.id = p_item_id;
$$;

create or replace function pg_temp.opening_reversal_lock_command(
  p_command_id uuid,
  p_balance_id uuid,
  p_site_id text,
  p_lines jsonb,
  p_recognized_value numeric default 0
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
      'scopeKey', p_site_id,
      'projectId', null,
      'constructionSiteId', p_site_id,
      'asOfDate', '2026-07-15',
      'contractValue', '1000',
      'constructionProgressPercent', '25',
      'purchasedValue', '100',
      'issuedValue', '0',
      'usedValue', p_recognized_value::text,
      'recognizedValue', p_recognized_value::text,
      'status', 'draft'
    ),
    'lines', p_lines,
    'projectFinanceId', null,
    'financeSnapshot', null
  );
$$;

create or replace function pg_temp.opening_reversal_finance_snapshot(
  p_finance_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', finance.id,
    'projectId', finance.project_id,
    'constructionSiteId', nullif(
      coalesce(finance.construction_site_id, finance."constructionSiteId"),
      ''
    ),
    'contractValue', finance."contractValue",
    'progressPercent', finance."progressPercent",
    'status', finance.status,
    'notes', finance.notes,
    'updatedAt', pg_catalog.to_jsonb(finance."updatedAt")
  )
  from public.project_finances finance
  where finance.id = p_finance_id;
$$;

create or replace function pg_temp.opening_reversal_command(
  p_command_id uuid,
  p_balance_id uuid,
  p_reason text,
  p_expected jsonb,
  p_contract_value numeric,
  p_progress numeric,
  p_notes text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'commandId', p_command_id,
    'openingBalanceId', p_balance_id,
    'reason', p_reason,
    'expectedFinanceSnapshot', p_expected,
    'correctedFinanceSnapshot',
      (p_expected - 'updatedAt') || pg_catalog.jsonb_build_object(
        'contractValue', p_contract_value::text,
        'progressPercent', p_progress::text,
        'notes', p_notes
      )
  );
$$;

create or replace function pg_temp.mutate_opening_reversal_finance(
  p_finance_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_finances finance
  set notes = coalesce(finance.notes, '') || ' stale-smoke'
  where finance.id = p_finance_id;
end;
$$;

revoke all on function pg_temp.opening_reversal_line(text,text,numeric) from public;
revoke all on function pg_temp.opening_reversal_finance_snapshot(text) from public;
revoke all on function pg_temp.mutate_opening_reversal_finance(text) from public;
grant execute on function pg_temp.opening_reversal_line(text,text,numeric) to authenticated;
grant execute on function pg_temp.opening_reversal_finance_snapshot(text) to authenticated;
grant execute on function pg_temp.mutate_opening_reversal_finance(text) to authenticated;

-- Failure injection proves the entire two-warehouse reversal rolls back when
-- the lexically second posting fails after the first posting has completed.
create or replace function pg_temp.reject_opening_reversal_failure_warehouse()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_type = 'project_opening_balance_reversal'
     and exists (
       select 1
       from pg_temp.opening_reversal_fixture fixture
       where fixture.warehouse_fail_id = new.target_warehouse_id
     ) then
    raise exception 'injected reversal all-or-nothing failure'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger zz_opening_reversal_injected_failure
before insert on public.transactions
for each row execute function pg_temp.reject_opening_reversal_failure_warehouse();

set local role authenticated;

do $reversal_checks$
declare
  fixture opening_reversal_fixture%rowtype;
  v_lock jsonb;
  v_first jsonb;
  v_retry jsonb;
  v_command jsonb;
  v_expected jsonb;
  v_insufficient_expected jsonb;
  v_stale_expected jsonb;
  v_denied_expected jsonb;
  v_rollback_expected jsonb;
  v_finance_id text;
  v_insufficient_finance_id text;
  v_stale_finance_id text;
  v_denied_finance_id text;
  v_rollback_finance_id text;
  v_original_transaction_id text;
  v_compensating_transaction_id text;
  v_count integer;
  v_quantity numeric;
begin
  select * into strict fixture from opening_reversal_fixture;
  perform pg_temp.set_opening_reversal_actor(fixture.admin_id, fixture.admin_email);

  -- Lock five independent authoritative source documents first.
  v_lock := public.lock_project_opening_balance(
    pg_temp.opening_reversal_lock_command(
      fixture.primary_lock_command_id,
      fixture.primary_balance_id,
      fixture.primary_site_id,
      pg_catalog.jsonb_build_array(pg_temp.opening_reversal_line(
        fixture.primary_item_id, fixture.warehouse_a_id, 2.375
      )),
      23.75
    )
  );
  v_finance_id := v_lock->'opening_balance'->>'project_finance_id';
  v_expected := pg_temp.opening_reversal_finance_snapshot(v_finance_id);

  v_lock := public.lock_project_opening_balance(
    pg_temp.opening_reversal_lock_command(
      fixture.insufficient_lock_command_id,
      fixture.insufficient_balance_id,
      fixture.insufficient_site_id,
      pg_catalog.jsonb_build_array(pg_temp.opening_reversal_line(
        fixture.insufficient_item_id, fixture.warehouse_a_id, 1.75
      ))
    )
  );
  v_insufficient_finance_id := v_lock->'opening_balance'->>'project_finance_id';
  v_insufficient_expected := pg_temp.opening_reversal_finance_snapshot(v_insufficient_finance_id);

  v_lock := public.lock_project_opening_balance(
    pg_temp.opening_reversal_lock_command(
      fixture.stale_lock_command_id,
      fixture.stale_balance_id,
      fixture.stale_site_id,
      pg_catalog.jsonb_build_array(pg_temp.opening_reversal_line(
        fixture.stale_item_id, fixture.warehouse_a_id, 0.25
      ))
    )
  );
  v_stale_finance_id := v_lock->'opening_balance'->>'project_finance_id';
  v_stale_expected := pg_temp.opening_reversal_finance_snapshot(v_stale_finance_id);

  v_lock := public.lock_project_opening_balance(
    pg_temp.opening_reversal_lock_command(
      fixture.denied_lock_command_id,
      fixture.denied_balance_id,
      fixture.denied_site_id,
      pg_catalog.jsonb_build_array(pg_temp.opening_reversal_line(
        fixture.denied_item_id, fixture.warehouse_a_id, 0.4
      ))
    )
  );
  v_denied_finance_id := v_lock->'opening_balance'->>'project_finance_id';
  v_denied_expected := pg_temp.opening_reversal_finance_snapshot(v_denied_finance_id);

  v_lock := public.lock_project_opening_balance(
    pg_temp.opening_reversal_lock_command(
      fixture.rollback_lock_command_id,
      fixture.rollback_balance_id,
      fixture.rollback_site_id,
      pg_catalog.jsonb_build_array(
        pg_temp.opening_reversal_line(
          fixture.rollback_item_id, fixture.warehouse_a_id, 0.4
        ),
        pg_temp.opening_reversal_line(
          fixture.rollback_item_id, fixture.warehouse_fail_id, 0.6
        )
      )
    )
  );
  v_rollback_finance_id := v_lock->'opening_balance'->>'project_finance_id';
  v_rollback_expected := pg_temp.opening_reversal_finance_snapshot(v_rollback_finance_id);

  -- Decimal inverse and exact retry.
  v_command := pg_temp.opening_reversal_command(
    fixture.primary_reversal_command_id,
    fixture.primary_balance_id,
    'Correct primary opening balance',
    v_expected,
    900,
    20,
    null
  );
  v_first := public.reverse_project_opening_balance(v_command);
  v_retry := public.reverse_project_opening_balance(v_command);
  if v_retry is distinct from v_first then
    raise exception 'exact retry returned a different reversal result';
  end if;
  if (v_first->'compensating_stock_transactions'->0->'items'->0->>'quantity')::numeric
       is distinct from -2.375::numeric then
    raise exception 'decimal inverse did not preserve 2.375 exactly';
  end if;
  if (v_first->'compensating_material_project_transaction'->>'amount')::numeric
       is distinct from -23.75::numeric then
    raise exception 'material expense inverse was not deterministic';
  end if;
  select coalesce((item.stock_by_warehouse->>fixture.warehouse_a_id)::numeric, 0)
  into strict v_quantity
  from public.items item
  where item.id = fixture.primary_item_id;
  if v_quantity <> 0 then
    raise exception 'decimal inverse did not restore stock cache to zero: %', v_quantity;
  end if;
  select coalesce(pg_catalog.sum(balance.on_hand_qty), 0)
  into v_quantity
  from public.inventory_balances balance
  where balance.material_id = fixture.primary_item_id
    and balance.warehouse_id = fixture.warehouse_a_id;
  if v_quantity <> 0 then
    raise exception 'decimal inverse did not restore inventory balance to zero: %', v_quantity;
  end if;

  v_original_transaction_id := v_first->'stock_transaction_map'->0->>'originalTransactionId';
  v_compensating_transaction_id := v_first->'stock_transaction_map'->0->>'compensatingTransactionId';
  select pg_catalog.count(*) into v_count
  from public.inventory_ledger_entries ledger
  where ledger.inventory_transaction_id in (
    select inventory_transaction.id
    from public.inventory_transactions inventory_transaction
    where inventory_transaction.wms_transaction_id in (
      v_original_transaction_id,
      v_compensating_transaction_id
    )
  );
  if v_count <> 2 then
    raise exception 'expected immutable original plus compensating ledger rows, got %', v_count;
  end if;
  if has_table_privilege('authenticated', 'public.inventory_ledger_entries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.inventory_ledger_entries', 'DELETE')
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.inventory_ledger_entries'::pg_catalog.regclass
         and trigger_row.tgname = 'trg_guard_inventory_ledger_entry_immutable'
         and trigger_row.tgenabled = 'A'
     ) then
    raise exception 'ledger immutability surface is not enforced';
  end if;

  -- Conflicting retry with the same command identity is rejected.
  begin
    perform public.reverse_project_opening_balance(
      pg_catalog.jsonb_set(v_command, '{reason}', '"different-content"'::jsonb)
    );
    raise exception 'conflicting retry unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '22023' or position('different content' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Cross-actor exact replay is forbidden even when both actors are admins.
  perform pg_temp.set_opening_reversal_actor(fixture.second_admin_id, fixture.second_admin_email);
  begin
    perform public.reverse_project_opening_balance(v_command);
    raise exception 'cross-actor exact retry unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501' or position('cross-actor' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;
  perform pg_temp.set_opening_reversal_actor(fixture.admin_id, fixture.admin_email);

  -- Later movement leaves less stock than the immutable opening movement.
  perform public.post_wms_transaction(pg_catalog.jsonb_build_object(
    'id', 'opening-reversal-consume-' || fixture.token,
    'type', 'ADJUSTMENT',
    'date', pg_catalog.now(),
    'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'lineId', 'consume-line',
      'itemId', fixture.insufficient_item_id,
      'quantity', '-1',
      'price', '10',
      'unit', 'kg'
    )),
    'targetWarehouseId', fixture.warehouse_a_id,
    'requesterId', fixture.admin_id,
    'status', 'COMPLETED',
    'sourceType', 'opening_reversal_smoke_consume',
    'sourceId', fixture.insufficient_balance_id,
    'pendingItems', '[]'::jsonb
  ));
  begin
    perform public.reverse_project_opening_balance(pg_temp.opening_reversal_command(
      pg_catalog.gen_random_uuid(), fixture.insufficient_balance_id,
      'Insufficient stock check', v_insufficient_expected, 1000, 25, null
    ));
    raise exception 'insufficient stock reversal unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '40001' or position('insufficient stock' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Exact expected finance version is mandatory; no blind restore is allowed.
  perform pg_temp.mutate_opening_reversal_finance(v_stale_finance_id);
  begin
    perform public.reverse_project_opening_balance(pg_temp.opening_reversal_command(
      pg_catalog.gen_random_uuid(), fixture.stale_balance_id,
      'Stale finance check', v_stale_expected, 1000, 25, null
    ));
    raise exception 'stale finance reversal unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '40001' or position('finance snapshot is stale' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Permission denial: an active employee with no project/WMS grants fails.
  perform pg_temp.set_opening_reversal_actor(fixture.denied_id, fixture.denied_email);
  begin
    perform public.reverse_project_opening_balance(pg_temp.opening_reversal_command(
      pg_catalog.gen_random_uuid(), fixture.denied_balance_id,
      'Permission denial check', v_denied_expected, 1000, 25, null
    ));
    raise exception 'permission denial reversal unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501' then
        raise;
      end if;
  end;
  perform pg_temp.set_opening_reversal_actor(fixture.admin_id, fixture.admin_email);

  -- Reserved WMS and project material source spoofing must fail closed.
  begin
    insert into public.transactions (
      id, type, date, items, target_warehouse_id, requester_id, approver_id,
      status, pending_items, created_by, updated_by,
      source_type, source_id, posting_engine_version
    ) values (
      'opening-reversal-spoof-' || fixture.token,
      'ADJUSTMENT'::public.transaction_type,
      pg_catalog.now(),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'spoof-line', 'itemId', fixture.denied_item_id,
        'quantity', '-0.4', 'price', '10', 'unit', 'kg'
      )),
      fixture.warehouse_a_id, fixture.admin_id, fixture.admin_id,
      'PENDING'::public.transaction_status, '[]'::jsonb,
      fixture.admin_id, fixture.admin_id,
      'project_opening_balance_reversal',
      fixture.denied_balance_id::text || ':' || fixture.warehouse_a_id,
      'wf001-opening-reversal-v1'
    );
    raise exception 'WMS reversal source spoofing unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501' or position('one-use command capability' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  begin
    insert into public.project_transactions (
      id, "projectFinanceId", "constructionSiteId", project_finance_id,
      construction_site_id, type, category, amount, description, date,
      source, "sourceRef", source_ref, attachments, "createdBy", "createdAt"
    ) values (
      'opening-material-reversal-spoof:' || fixture.token,
      v_denied_finance_id, fixture.denied_site_id, v_denied_finance_id,
      fixture.denied_site_id, 'expense', 'materials', -4,
      'Spoofed opening reversal material', '2026-07-15',
      'workflow', 'opening_balance_reversal:' || fixture.denied_balance_id || ':materials',
      'opening_balance_reversal:' || fixture.denied_balance_id || ':materials',
      '[]'::jsonb, fixture.admin_id::text, pg_catalog.now()
    );
    raise exception 'project material source spoofing unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> '42501' or position('one-use command capability' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;

  -- Multi-warehouse all-or-nothing rollback after injected second-post failure.
  begin
    perform public.reverse_project_opening_balance(pg_temp.opening_reversal_command(
      pg_catalog.gen_random_uuid(), fixture.rollback_balance_id,
      'All-or-nothing rollback check', v_rollback_expected, 1000, 25, null
    ));
    raise exception 'injected multi-warehouse reversal unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> 'P0001' or position('all-or-nothing' in pg_catalog.lower(sqlerrm)) = 0 then
        raise;
      end if;
  end;
  if exists (
    select 1 from public.transactions transaction_row
    where transaction_row.source_type = 'project_opening_balance_reversal'
      and transaction_row.source_id like fixture.rollback_balance_id::text || ':%'
  ) then
    raise exception 'all-or-nothing failure left a compensating WMS transaction';
  end if;
  if not exists (
    select 1 from public.project_opening_balances opening
    where opening.id = fixture.rollback_balance_id
      and opening.status = 'locked'
      and opening.reversal_command_id is null
  ) then
    raise exception 'all-or-nothing failure changed the opening document';
  end if;
  if pg_temp.opening_reversal_finance_snapshot(v_rollback_finance_id)
       is distinct from v_rollback_expected then
    raise exception 'all-or-nothing failure changed project finance';
  end if;
  select coalesce((item.stock_by_warehouse->>fixture.warehouse_a_id)::numeric, 0)
       + coalesce((item.stock_by_warehouse->>fixture.warehouse_fail_id)::numeric, 0)
  into strict v_quantity
  from public.items item
  where item.id = fixture.rollback_item_id;
  if v_quantity is distinct from 1.0::numeric then
    raise exception 'all-or-nothing failure changed rollback stock: %', v_quantity;
  end if;
end;
$reversal_checks$;

reset role;

rollback;
