-- Atomic project opening-balance command. This migration intentionally follows
-- the A2 quantity-policy and A3 posting-containment migrations.

set lock_timeout = '5s';
set statement_timeout = '60s';

create extension if not exists pgcrypto;
create schema if not exists app_private;

create or replace function app_private.normalize_project_opening_scope_key(
  p_scope_key text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(p_scope_key, '')),
      '[[:space:]]+',
      '',
      'g'
    )
  );
$$;

revoke all on function app_private.normalize_project_opening_scope_key(text)
  from public, anon, authenticated, service_role;

create or replace function app_private.parse_project_opening_nonnegative_numeric(
  p_value_text text,
  p_field_name text
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value numeric;
begin
  if nullif(pg_catalog.btrim(coalesce(p_value_text, '')), '') is null then
    return 0;
  end if;

  begin
    v_value := p_value_text::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception '% must be a finite non-negative numeric value', p_field_name
        using errcode = '22023';
  end;

  if pg_catalog.lower(v_value::text) in ('nan', 'infinity', '-infinity')
     or v_value < 0 then
    raise exception '% must be a finite non-negative numeric value', p_field_name
      using errcode = '22023';
  end if;
  return v_value;
end;
$$;

revoke all on function app_private.parse_project_opening_nonnegative_numeric(text, text)
  from public, anon, authenticated, service_role;

alter table public.project_opening_balances
  add column if not exists lock_command_id uuid,
  add column if not exists lock_request_hash text,
  add column if not exists project_finance_id text,
  add column if not exists posting_engine_version text;

comment on column public.project_opening_balances.lock_command_id is
  'Retry-safe client command identity for the atomic opening-balance lock.';
comment on column public.project_opening_balances.lock_request_hash is
  'SHA-256 of the canonical opening-balance command excluding commandId.';
comment on column public.project_opening_balances.project_finance_id is
  'Project-finance row persisted by the same atomic lock command.';
comment on column public.project_opening_balances.posting_engine_version is
  'Server posting implementation that produced the locked document.';

-- Duplicate locked scope preflight. Do not recreate the partial unique index
-- until every collision under the normalized key has been rejected visibly.
do $duplicate_locked_scope_preflight$
declare
  v_duplicates text;
begin
  select pg_catalog.string_agg(
    pg_catalog.format('%s (%s rows)', duplicate_scope.normalized_scope_key, duplicate_scope.row_count),
    ', '
    order by duplicate_scope.normalized_scope_key
  )
  into v_duplicates
  from (
    select
      app_private.normalize_project_opening_scope_key(opening.scope_key) as normalized_scope_key,
      count(*) as row_count
    from public.project_opening_balances opening
    where opening.status = 'locked'
    group by app_private.normalize_project_opening_scope_key(opening.scope_key)
    having count(*) > 1
  ) duplicate_scope;

  if v_duplicates is not null then
    raise exception 'duplicate locked scope preflight failed: %', v_duplicates
      using errcode = '23505';
  end if;
end;
$duplicate_locked_scope_preflight$;

drop index if exists public.idx_project_opening_balances_locked_scope;
create unique index idx_project_opening_balances_locked_scope
  on public.project_opening_balances (
    app_private.normalize_project_opening_scope_key(scope_key)
  )
  where status = 'locked';

create unique index if not exists idx_project_opening_balances_lock_command
  on public.project_opening_balances(lock_command_id)
  where lock_command_id is not null;

-- Exact command replay must not reread mutable finance/catalog/cache rows.
-- Persist the response as an immutable command artifact in a logged table.
create table app_private.project_opening_command_results (
  command_id uuid primary key,
  opening_balance_id uuid not null unique
    references public.project_opening_balances(id) on delete restrict,
  actor_id uuid not null,
  request_hash text not null check (pg_catalog.btrim(request_hash) <> ''),
  result jsonb not null check (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on table app_private.project_opening_command_results
  from public, anon, authenticated, service_role;
revoke truncate on table app_private.project_opening_command_results
  from public, anon, authenticated, service_role;

comment on table app_private.project_opening_command_results is
  'Stable, protected response snapshots for exact project opening-balance command replay.';

-- The public opening tables remain editable while a document is a draft, so
-- the lock transition needs a non-spoofable server capability. This follows
-- the A3 WMS containment pattern: an exact OLD/NEW row image, scoped to one
-- backend and transaction, is consumed once by the ALWAYS trigger.
create unlogged table app_private.project_opening_write_authorizations (
  id uuid primary key default gen_random_uuid(),
  backend_pid integer not null,
  transaction_xid bigint not null,
  write_kind text not null check (write_kind = 'lock'),
  target_key uuid not null,
  expected_before jsonb not null,
  expected_after jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index project_opening_write_authorizations_lookup_idx
  on app_private.project_opening_write_authorizations (
    backend_pid,
    transaction_xid,
    write_kind,
    target_key,
    created_at
  );

revoke all on table app_private.project_opening_write_authorizations
  from public, anon, authenticated, service_role;

comment on table app_private.project_opening_write_authorizations is
  'One-use exact row-image capabilities consumed by the project opening-balance lock guard.';

create or replace function app_private.authorize_project_opening_write(
  p_target_key uuid,
  p_expected_before jsonb,
  p_expected_after jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization_id uuid;
begin
  if p_target_key is null or p_expected_before is null or p_expected_after is null then
    raise exception 'project opening lock authorization requires a target and exact row images'
      using errcode = '22023';
  end if;

  insert into app_private.project_opening_write_authorizations (
    backend_pid,
    transaction_xid,
    write_kind,
    target_key,
    expected_before,
    expected_after
  )
  values (
    pg_catalog.pg_backend_pid(),
    pg_catalog.txid_current(),
    'lock',
    p_target_key,
    p_expected_before,
    p_expected_after
  )
  returning id into v_authorization_id;

  return v_authorization_id;
end;
$$;

revoke all on function app_private.authorize_project_opening_write(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function app_private.guard_locked_project_opening_balance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'direct opening balance lock is forbidden; use lock_project_opening_balance'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status in ('locked', 'void') then
    raise exception 'locked opening balance content is immutable; use a controlled reversal business path'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'locked' then
    delete from app_private.project_opening_write_authorizations auth_row
    where auth_row.id = (
      select candidate.id
      from app_private.project_opening_write_authorizations candidate
      where candidate.backend_pid = pg_catalog.pg_backend_pid()
        and candidate.transaction_xid = pg_catalog.txid_current()
        and candidate.write_kind = 'lock'
        and candidate.target_key = old.id
        and candidate.expected_before = pg_catalog.to_jsonb(old)
        and candidate.expected_after = pg_catalog.to_jsonb(new)
      order by candidate.created_at, candidate.id
      limit 1
      for update
    )
    returning auth_row.id into v_authorization_id;

    if v_authorization_id is null then
      raise exception 'direct opening balance lock is forbidden; use lock_project_opening_balance'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'opening balance status transitions require a controlled business path'
    using errcode = '42501';
end;
$$;

create or replace function app_private.guard_locked_project_opening_balance_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_opening_balance_id uuid := case
    when tg_op = 'INSERT' then null
    else old.opening_balance_id
  end;
  v_new_opening_balance_id uuid := case
    when tg_op = 'DELETE' then null
    else new.opening_balance_id
  end;
begin
  -- Serialize with a concurrent parent lock transition, then re-read status in
  -- a fresh statement snapshot. Stable ordering also covers line re-parenting.
  perform 1
  from public.project_opening_balances opening
  where opening.id in (v_old_opening_balance_id, v_new_opening_balance_id)
  order by opening.id
  for update;

  if exists (
    select 1
    from public.project_opening_balances opening
    where opening.id in (v_old_opening_balance_id, v_new_opening_balance_id)
      and opening.status in ('locked', 'void')
  ) then
    raise exception 'locked opening balance lines are immutable; use a controlled reversal business path'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_locked_project_opening_balance
  on public.project_opening_balances;
create trigger trg_guard_locked_project_opening_balance
before insert or update or delete on public.project_opening_balances
for each row execute function app_private.guard_locked_project_opening_balance();
alter table public.project_opening_balances
  enable always trigger trg_guard_locked_project_opening_balance;

drop trigger if exists trg_guard_locked_project_opening_balance_line
  on public.project_opening_balance_lines;
create trigger trg_guard_locked_project_opening_balance_line
before insert or update or delete on public.project_opening_balance_lines
for each row execute function app_private.guard_locked_project_opening_balance_line();
alter table public.project_opening_balance_lines
  enable always trigger trg_guard_locked_project_opening_balance_line;

revoke truncate on table public.project_opening_balances
  from public, anon, authenticated, service_role;
revoke truncate on table public.project_opening_balance_lines
  from public, anon, authenticated, service_role;

revoke all on function app_private.guard_locked_project_opening_balance()
  from public, anon, authenticated, service_role;
revoke all on function app_private.guard_locked_project_opening_balance_line()
  from public, anon, authenticated, service_role;

create or replace function app_private.project_opening_balance_result(
  p_opening_balance_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'opening_balance', pg_catalog.to_jsonb(opening),
    'lines', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(line) order by line.created_at, line.id)
      from public.project_opening_balance_lines line
      where line.opening_balance_id = opening.id
    ), '[]'::jsonb),
    'project_finance', (
      select pg_catalog.to_jsonb(finance)
      from public.project_finances finance
      where finance.id = opening.project_finance_id
    ),
    'material_project_transaction', (
      select pg_catalog.to_jsonb(project_transaction)
      from public.project_transactions project_transaction
      where project_transaction.id = opening.material_project_transaction_id
    ),
    'stock_transactions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(stock_transaction) order by stock_transaction.id)
      from public.transactions stock_transaction
      where stock_transaction.id in (
        select pg_catalog.jsonb_array_elements_text(
          coalesce(opening.stock_transaction_ids, '[]'::jsonb)
        )
      )
    ), '[]'::jsonb),
    'created_items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id)
      from public.items item
      where item.id like 'opening-item:%'
        and exists (
          select 1
          from public.project_opening_balance_lines line
          where line.opening_balance_id = opening.id
            and line.inventory_item_id = item.id
        )
    ), '[]'::jsonb),
    'updated_items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id)
      from public.items item
      where item.id not like 'opening-item:%'
        and exists (
          select 1
          from public.project_opening_balance_lines line
          where line.opening_balance_id = opening.id
            and line.inventory_item_id = item.id
        )
    ), '[]'::jsonb)
  )
  from public.project_opening_balances opening
  where opening.id = p_opening_balance_id;
$$;

revoke all on function app_private.project_opening_balance_result(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.lock_project_opening_balance(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_row public.users%rowtype;
  v_command_id uuid;
  v_opening jsonb;
  v_input_lines jsonb;
  v_finance_snapshot jsonb;
  v_canonical_finance_snapshot jsonb := 'null'::jsonb;
  v_finance_current_snapshot jsonb;
  v_finance_snapshot_updated_at timestamptz;
  v_project_finance_id text;
  v_requested_balance_id uuid;
  v_scope_key text;
  v_project_id text;
  v_construction_site_id text;
  v_as_of_date date;
  v_contract_value numeric;
  v_progress_percent numeric;
  v_purchased_value numeric;
  v_issued_value numeric;
  v_used_value numeric;
  v_recognized_value numeric;
  v_opening_note text;
  v_canonical_lines jsonb := '[]'::jsonb;
  v_canonical_request jsonb;
  v_request_hash text;
  v_line jsonb;
  v_line_index bigint;
  v_inventory_item_id text;
  v_accounting_code text;
  v_sku text;
  v_item_name text;
  v_unit text;
  v_warehouse_id text;
  v_missing_warehouse_id text;
  v_purchased_qty numeric;
  v_issued_qty numeric;
  v_used_qty numeric;
  v_remaining_qty numeric;
  v_unit_price numeric;
  v_remaining_value numeric;
  v_line_note text;
  v_lookup_key text;
  v_item_count bigint;
  v_accounting_item_count bigint;
  v_accounting_item_id text;
  v_resolved_item_id text;
  v_resolution_kind text;
  v_resolved_lines jsonb := '[]'::jsonb;
  v_final_lines jsonb := '[]'::jsonb;
  v_seen_new_item_ids text[] := '{}'::text[];
  v_inserted_item_id text;
  v_item_id text;
  v_item public.items%rowtype;
  v_command_balance public.project_opening_balances%rowtype;
  v_locked_balance public.project_opening_balances%rowtype;
  v_balance public.project_opening_balances%rowtype;
  v_authorized_balance public.project_opening_balances%rowtype;
  v_balance_id uuid;
  v_balance_exists boolean := false;
  v_finance public.project_finances%rowtype;
  v_finance_exists boolean := false;
  v_finance_count bigint;
  v_material_amount numeric;
  v_material_transaction_id text;
  v_source_ref text;
  v_stock_transaction_ids jsonb := '[]'::jsonb;
  v_transaction_id text;
  v_transaction_source_id text;
  v_transaction_items jsonb;
  v_transaction_hash text;
  v_existing_transaction public.transactions%rowtype;
  v_posted_transaction public.transactions%rowtype;
  v_saved_result jsonb;
begin
  -- Migration-session settings do not survive deployment. Bound every runtime
  -- row/table/advisory lock acquisition so contention fails retryably instead
  -- of leaving an API request waiting indefinitely.
  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- Response keys: 'opening_balance', 'lines', 'project_finance',
  -- 'material_project_transaction', 'stock_transactions', 'created_items',
  -- and 'updated_items'. The private result builder owns their row mapping.
  if p_command is null or pg_catalog.jsonb_typeof(p_command) <> 'object' then
    raise exception 'opening balance command must be a JSON object'
      using errcode = '22023';
  end if;

  begin
    v_command_id := nullif(pg_catalog.btrim(p_command->>'commandId'), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'opening balance commandId must be a UUID'
        using errcode = '22023';
  end;
  if v_command_id is null then
    raise exception 'opening balance commandId is required'
      using errcode = '22023';
  end if;

  v_opening := p_command->'openingBalance';
  v_input_lines := p_command->'lines';
  v_finance_snapshot := p_command->'financeSnapshot';
  v_project_finance_id := nullif(pg_catalog.btrim(p_command->>'projectFinanceId'), '');

  if pg_catalog.jsonb_typeof(v_opening) <> 'object' then
    raise exception 'openingBalance must be a JSON object'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_input_lines) <> 'array'
     or pg_catalog.jsonb_array_length(v_input_lines) = 0 then
    raise exception 'opening balance lines must be a non-empty JSON array'
      using errcode = '22023';
  end if;
  if v_finance_snapshot is not null
     and pg_catalog.jsonb_typeof(v_finance_snapshot) not in ('object', 'null') then
    raise exception 'financeSnapshot must be a JSON object or null'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_finance_snapshot) = 'object'
     and nullif(pg_catalog.btrim(v_finance_snapshot->>'id'), '') is distinct from v_project_finance_id then
    raise exception 'financeSnapshot id must match projectFinanceId'
      using errcode = '22023';
  end if;
  if v_project_finance_id is not null
     and pg_catalog.jsonb_typeof(v_finance_snapshot) is distinct from 'object' then
    raise exception 'finance snapshot is required when projectFinanceId is supplied'
      using errcode = '40001';
  end if;
  if pg_catalog.jsonb_typeof(v_finance_snapshot) = 'object' then
    if not (v_finance_snapshot ?& array[
      'id',
      'projectId',
      'constructionSiteId',
      'contractValue',
      'progressPercent',
      'status',
      'updatedAt'
    ]) then
      raise exception 'financeSnapshot is missing an optimistic-concurrency field'
        using errcode = '22023';
    end if;
    begin
      v_finance_snapshot_updated_at :=
        nullif(pg_catalog.btrim(v_finance_snapshot->>'updatedAt'), '')::timestamptz;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'financeSnapshot.updatedAt must be a timestamp with time zone'
          using errcode = '22023';
    end;
    if v_finance_snapshot_updated_at is null then
      raise exception 'financeSnapshot.updatedAt is required'
        using errcode = '22023';
    end if;
    v_canonical_finance_snapshot := pg_catalog.jsonb_build_object(
      'id', nullif(pg_catalog.btrim(v_finance_snapshot->>'id'), ''),
      'projectId', nullif(pg_catalog.btrim(v_finance_snapshot->>'projectId'), ''),
      'constructionSiteId', nullif(pg_catalog.btrim(v_finance_snapshot->>'constructionSiteId'), ''),
      'contractValue', app_private.parse_project_opening_nonnegative_numeric(
        v_finance_snapshot->>'contractValue', 'financeSnapshot.contractValue'
      ),
      'progressPercent', app_private.parse_project_opening_nonnegative_numeric(
        v_finance_snapshot->>'progressPercent', 'financeSnapshot.progressPercent'
      ),
      'status', v_finance_snapshot->>'status',
      'notes', v_finance_snapshot->>'notes',
      'updatedAt', pg_catalog.to_jsonb(v_finance_snapshot_updated_at)
    );
  end if;

  begin
    v_requested_balance_id := nullif(pg_catalog.btrim(v_opening->>'id'), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'openingBalance.id must be a UUID'
        using errcode = '22023';
  end;

  v_scope_key := app_private.normalize_project_opening_scope_key(v_opening->>'scopeKey');
  v_project_id := nullif(pg_catalog.btrim(v_opening->>'projectId'), '');
  v_construction_site_id := nullif(pg_catalog.btrim(v_opening->>'constructionSiteId'), '');
  v_opening_note := nullif(pg_catalog.btrim(v_opening->>'note'), '');
  if v_scope_key = '' then
    raise exception 'opening balance scopeKey is required'
      using errcode = '22023';
  end if;
  if v_project_id is null and v_construction_site_id is null then
    raise exception 'opening balance requires a project or construction site'
      using errcode = '22023';
  end if;

  begin
    v_as_of_date := (v_opening->>'asOfDate')::date;
    v_contract_value := app_private.parse_project_opening_nonnegative_numeric(
      v_opening->>'contractValue', 'openingBalance.contractValue'
    );
    v_progress_percent := app_private.parse_project_opening_nonnegative_numeric(
      v_opening->>'constructionProgressPercent', 'openingBalance.constructionProgressPercent'
    );
    v_purchased_value := app_private.parse_project_opening_nonnegative_numeric(
      v_opening->>'purchasedValue', 'openingBalance.purchasedValue'
    );
    v_issued_value := app_private.parse_project_opening_nonnegative_numeric(
      v_opening->>'issuedValue', 'openingBalance.issuedValue'
    );
    v_used_value := app_private.parse_project_opening_nonnegative_numeric(
      v_opening->>'usedValue', 'openingBalance.usedValue'
    );
  exception
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'opening balance contains an invalid date or numeric value'
        using errcode = '22023';
  end;
  if v_as_of_date is null
     or v_contract_value < 0
     or v_progress_percent < 0
     or v_progress_percent > 100
     or v_purchased_value < 0
     or v_issued_value < 0
     or v_used_value < 0 then
    raise exception 'opening balance totals are outside the accepted range'
      using errcode = '22023';
  end if;
  v_recognized_value := case
    when v_used_value > 0 then v_used_value
    when v_issued_value > 0 then v_issued_value
    else v_purchased_value
  end;

  for v_line, v_line_index in
    select input_line.value, input_line.ordinality
    from pg_catalog.jsonb_array_elements(v_input_lines)
      with ordinality as input_line(value, ordinality)
    order by input_line.ordinality
  loop
    if pg_catalog.jsonb_typeof(v_line) <> 'object' then
      raise exception 'opening balance line % must be a JSON object', v_line_index
        using errcode = '22023';
    end if;

    v_inventory_item_id := nullif(pg_catalog.btrim(v_line->>'inventoryItemId'), '');
    v_accounting_code := nullif(pg_catalog.btrim(v_line->>'accountingCode'), '');
    v_sku := nullif(pg_catalog.btrim(v_line->>'sku'), '');
    v_item_name := nullif(pg_catalog.btrim(v_line->>'itemName'), '');
    v_unit := nullif(pg_catalog.btrim(v_line->>'unit'), '');
    v_warehouse_id := nullif(pg_catalog.btrim(v_line->>'warehouseId'), '');
    v_line_note := nullif(pg_catalog.btrim(v_line->>'note'), '');

    if v_sku is null or v_item_name is null or v_unit is null or v_warehouse_id is null then
      raise exception 'opening balance line % requires sku, itemName, unit, and warehouseId', v_line_index
        using errcode = '22023';
    end if;

    begin
      v_purchased_qty := app_private.parse_project_opening_nonnegative_numeric(
        v_line->>'purchasedQty', 'openingBalance.lines.purchasedQty'
      );
      v_issued_qty := app_private.parse_project_opening_nonnegative_numeric(
        v_line->>'issuedQty', 'openingBalance.lines.issuedQty'
      );
      v_used_qty := app_private.parse_project_opening_nonnegative_numeric(
        v_line->>'usedQty', 'openingBalance.lines.usedQty'
      );
      v_remaining_qty := app_private.parse_project_opening_nonnegative_numeric(
        v_line->>'remainingQty', 'openingBalance.lines.remainingQty'
      );
      v_unit_price := app_private.parse_project_opening_nonnegative_numeric(
        v_line->>'unitPrice', 'openingBalance.lines.unitPrice'
      );
      v_remaining_value := app_private.parse_project_opening_nonnegative_numeric(
        v_line->>'remainingValue', 'openingBalance.lines.remainingValue'
      );
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'opening balance line % contains an invalid numeric value', v_line_index
          using errcode = '22023';
    end;

    if v_purchased_qty < 0
       or v_issued_qty < 0
       or v_used_qty < 0
       or v_remaining_qty < 0
       or v_unit_price < 0
       or v_remaining_value < 0 then
      raise exception 'opening balance line % contains a negative value', v_line_index
        using errcode = '22023';
    end if;

    v_purchased_qty := app_private.assert_quantity_precision(v_purchased_qty::text, v_unit);
    v_issued_qty := app_private.assert_quantity_precision(v_issued_qty::text, v_unit);
    v_used_qty := app_private.assert_quantity_precision(v_used_qty::text, v_unit);
    v_remaining_qty := app_private.assert_quantity_precision(v_remaining_qty::text, v_unit);

    v_canonical_lines := v_canonical_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'explicitItemId', v_inventory_item_id,
        'accountingCode', v_accounting_code,
        'sku', v_sku,
        'itemName', v_item_name,
        'unit', app_private.normalize_quantity_unit(v_unit),
        'warehouseId', v_warehouse_id,
        'purchasedQty', v_purchased_qty,
        'issuedQty', v_issued_qty,
        'usedQty', v_used_qty,
        'remainingQty', v_remaining_qty,
        'unitPrice', v_unit_price,
        'remainingValue', v_remaining_value,
        'note', v_line_note
      )
    );
  end loop;

  v_canonical_request := pg_catalog.jsonb_build_object(
    'openingBalance', pg_catalog.jsonb_build_object(
      'id', v_requested_balance_id,
      'scopeKey', v_scope_key,
      'projectId', v_project_id,
      'constructionSiteId', v_construction_site_id,
      'asOfDate', v_as_of_date,
      'contractValue', v_contract_value,
      'constructionProgressPercent', v_progress_percent,
      'purchasedValue', v_purchased_value,
      'issuedValue', v_issued_value,
      'usedValue', v_used_value,
      'recognizedValue', v_recognized_value,
      'note', v_opening_note
    ),
    'lines', v_canonical_lines,
    'projectFinanceId', v_project_finance_id,
    'financeSnapshot', v_canonical_finance_snapshot
  );
  v_request_hash := app_private.sha256_text(v_canonical_request::text);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('project-opening-command:' || v_command_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('project-opening-scope:' || v_scope_key, 0)
  );

  select * into v_actor_row
  from public.users actor_row
  where actor_row.id = v_actor;
  if not found then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;
  if not coalesce(v_actor_row.is_active, false) then
    raise exception 'inactive user cannot lock a project opening balance'
      using errcode = '42501';
  end if;

  if not app_private.project_has_permission_v2(
    v_project_id,
    v_construction_site_id,
    'project.budget.manage',
    v_actor
  ) then
    raise exception 'project.budget.manage is required for this project opening balance'
      using errcode = '42501';
  end if;

  select target_warehouse.id
  into v_missing_warehouse_id
  from (
    select distinct canonical_line.value->>'warehouseId' as id
    from pg_catalog.jsonb_array_elements(v_canonical_lines) canonical_line(value)
  ) target_warehouse
  where not exists (
    select 1
    from public.warehouses warehouse
    where warehouse.id = target_warehouse.id
      and not coalesce(warehouse.is_archived, false)
  )
  order by target_warehouse.id
  limit 1;
  if found then
    raise exception 'opening balance warehouse does not exist or is archived: %', v_missing_warehouse_id
      using errcode = '23503';
  end if;

  -- Lock all target warehouse rows in one stable order before checking the
  -- current actor's WMS action. Exact retries deliberately repeat this check.
  for v_warehouse_id in
    select warehouse.id
    from public.warehouses warehouse
    where not coalesce(warehouse.is_archived, false)
      and warehouse.id in (
        select distinct canonical_line.value->>'warehouseId'
        from pg_catalog.jsonb_array_elements(v_canonical_lines) canonical_line(value)
      )
    order by warehouse.id
    for update
  loop
    if not app_private.wms_has_action(
      'wms.transaction.complete',
      null,
      v_warehouse_id,
      v_actor,
      v_actor,
      v_actor
    ) then
      raise exception 'wms.transaction.complete is required for %', v_warehouse_id
        using errcode = '42501';
    end if;
  end loop;

  select * into v_command_balance
  from public.project_opening_balances opening
  where opening.lock_command_id = v_command_id
  for update;
  if found then
    if v_command_balance.status <> 'locked'
       or v_command_balance.lock_request_hash is distinct from v_request_hash
       or app_private.normalize_project_opening_scope_key(v_command_balance.scope_key) is distinct from v_scope_key then
      raise exception 'opening balance commandId was reused with different content'
        using errcode = '22023';
    end if;
    if v_command_balance.locked_by is distinct from v_actor::text then
      raise exception 'cross-actor retry is forbidden for this opening balance command actor'
        using errcode = '42501';
    end if;
    select command_result.result
    into v_saved_result
    from app_private.project_opening_command_results command_result
    where command_result.command_id = v_command_id
      and command_result.opening_balance_id = v_command_balance.id
      and command_result.actor_id = v_actor
      and command_result.request_hash = v_request_hash;
    if not found then
      raise exception 'opening balance command result snapshot is missing or inconsistent'
        using errcode = '55000';
    end if;
    return v_saved_result;
  end if;

  select * into v_locked_balance
  from public.project_opening_balances opening
  where opening.status = 'locked'
    and app_private.normalize_project_opening_scope_key(opening.scope_key) = v_scope_key
  order by opening.id
  limit 1
  for update;
  if found then
    raise exception 'opening balance scope is already locked: %', v_scope_key
      using errcode = '23505';
  end if;

  if v_requested_balance_id is not null then
    select * into v_balance
    from public.project_opening_balances opening
    where opening.id = v_requested_balance_id
    for update;
    v_balance_exists := found;
    if v_balance_exists then
      if v_balance.status <> 'draft'
         or app_private.normalize_project_opening_scope_key(v_balance.scope_key) <> v_scope_key then
        raise exception 'opening balance draft is stale or belongs to another scope'
          using errcode = '55000';
      end if;
      v_balance_id := v_balance.id;
    else
      if exists (
        select 1
        from public.project_opening_balances opening
        where opening.status = 'draft'
          and app_private.normalize_project_opening_scope_key(opening.scope_key) = v_scope_key
      ) then
        raise exception 'opening balance draft id is stale for scope %', v_scope_key
          using errcode = '55000';
      end if;
      v_balance_id := v_requested_balance_id;
    end if;
  else
    select * into v_balance
    from public.project_opening_balances opening
    where opening.status = 'draft'
      and app_private.normalize_project_opening_scope_key(opening.scope_key) = v_scope_key
    order by opening.updated_at desc, opening.id
    limit 1
    for update;
    v_balance_exists := found;
    v_balance_id := case when v_balance_exists then v_balance.id else gen_random_uuid() end;
  end if;

  -- Share the exact A3 business-source then transaction lock namespaces. Take
  -- every source lock first, both sets in warehouse order, before item locks.
  for v_warehouse_id in
    select distinct canonical_line.value->>'warehouseId' as "warehouseId"
    from pg_catalog.jsonb_array_elements(v_canonical_lines) canonical_line(value)
    where (canonical_line.value->>'remainingQty')::numeric > 0
    order by "warehouseId"
  loop
    v_transaction_source_id := v_balance_id::text || ':' || v_warehouse_id;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'wms-source:project_opening_balance:' || v_transaction_source_id,
        0
      )
    );
  end loop;

  for v_warehouse_id in
    select distinct canonical_line.value->>'warehouseId' as "warehouseId"
    from pg_catalog.jsonb_array_elements(v_canonical_lines) canonical_line(value)
    where (canonical_line.value->>'remainingQty')::numeric > 0
    order by "warehouseId"
  loop
    v_transaction_id := 'opening-balance:' || v_balance_id::text || ':'
      || pg_catalog.left(app_private.sha256_text(v_warehouse_id), 16);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wms-transaction:' || v_transaction_id, 0)
    );
  end loop;

  -- Items have no unique normalized SKU/accounting identity in the legacy
  -- schema. Serialize catalog writers for this one-time resolution window.
  lock table public.items in share row exclusive mode;

  for v_lookup_key in
    select distinct pg_catalog.lower(pg_catalog.btrim(canonical_line.value->>'sku'))
    from pg_catalog.jsonb_array_elements(v_canonical_lines) canonical_line(value)
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('project-opening-item:' || v_lookup_key, 0)
    );
  end loop;

  for v_lookup_key in
    select distinct pg_catalog.btrim(canonical_line.value->>'accountingCode')
    from pg_catalog.jsonb_array_elements(v_canonical_lines) canonical_line(value)
    where nullif(pg_catalog.btrim(canonical_line.value->>'accountingCode'), '') is not null
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('project-opening-accounting:' || v_lookup_key, 0)
    );
  end loop;

  for v_line, v_line_index in
    select canonical_line.value, canonical_line.ordinality
    from pg_catalog.jsonb_array_elements(v_canonical_lines)
      with ordinality as canonical_line(value, ordinality)
    order by canonical_line.ordinality
  loop
    v_inventory_item_id := nullif(v_line->>'explicitItemId', '');
    v_sku := v_line->>'sku';
    v_accounting_code := nullif(v_line->>'accountingCode', '');
    v_resolved_item_id := null;
    v_resolution_kind := null;
    v_item_count := 0;
    v_accounting_item_count := 0;
    v_accounting_item_id := null;

    if v_inventory_item_id is not null then
      select * into v_item
      from public.items item
      where item.id = v_inventory_item_id;
      if not found then
        raise exception 'explicit opening item does not exist: %', v_inventory_item_id
          using errcode = '23503';
      end if;
      if pg_catalog.lower(pg_catalog.btrim(v_item.sku))
         <> pg_catalog.lower(pg_catalog.btrim(v_sku)) then
        raise exception 'explicit opening item % does not agree with SKU %', v_inventory_item_id, v_sku
          using errcode = '22023';
      end if;
      if not app_private.quantity_units_are_equivalent(v_item.unit, v_line->>'unit') then
        raise exception 'explicit opening item % does not agree with unit %', v_inventory_item_id, v_line->>'unit'
          using errcode = '22023';
      end if;
      v_resolved_item_id := v_item.id;
      v_resolution_kind := 'explicit';
      v_item_count := 1;
    else
      select count(*), min(item.id)
      into v_item_count, v_resolved_item_id
      from public.items item
      where pg_catalog.lower(pg_catalog.btrim(item.sku))
        = pg_catalog.lower(pg_catalog.btrim(v_sku));
      if v_item_count > 1 then
        raise exception 'ambiguous opening item SKU lookup: %', v_sku
          using errcode = '21000';
      end if;
      if v_item_count = 1 then
        v_resolution_kind := 'sku';
      end if;

      if v_item_count = 0 and v_accounting_code is not null then
        select count(*), min(item.id)
        into v_item_count, v_resolved_item_id
        from public.items item
        where pg_catalog.btrim(item.accounting_code)
          = pg_catalog.btrim(v_accounting_code);
        if v_item_count > 1 then
          raise exception 'ambiguous opening item accounting code lookup: %', v_accounting_code
            using errcode = '21000';
        end if;
        if v_item_count = 1 then
          v_resolution_kind := 'accounting';
        end if;
      end if;

      if coalesce(v_item_count, 0) = 0 then
        v_resolved_item_id := 'opening-item:' || app_private.sha256_text(
          pg_catalog.lower(pg_catalog.btrim(v_sku))
        );
        v_resolution_kind := 'created';
      end if;
    end if;

    if v_accounting_code is not null then
      select count(*), min(item.id)
      into v_accounting_item_count, v_accounting_item_id
      from public.items item
      where pg_catalog.btrim(item.accounting_code) = pg_catalog.btrim(v_accounting_code);
      if v_accounting_item_count > 1 then
        raise exception 'ambiguous opening item accounting code lookup: %', v_accounting_code
          using errcode = '21000';
      end if;
      if v_accounting_item_count = 1
         and v_accounting_item_id is distinct from v_resolved_item_id then
        raise exception 'opening item SKU and accounting code resolve to different items'
          using errcode = '22023';
      end if;
    end if;

    v_resolved_lines := v_resolved_lines || pg_catalog.jsonb_build_array(
      v_line || pg_catalog.jsonb_build_object(
        'inventoryItemId', v_resolved_item_id,
        'resolutionKind', v_resolution_kind,
        'shouldCreate', coalesce(v_item_count, 0) = 0 and v_inventory_item_id is null
      )
    );
  end loop;

  for v_line in
    select resolved_line.value
    from pg_catalog.jsonb_array_elements(v_resolved_lines) resolved_line(value)
    where coalesce((resolved_line.value->>'shouldCreate')::boolean, false)
    order by resolved_line.value->>'inventoryItemId'
  loop
    v_resolved_item_id := v_line->>'inventoryItemId';
    if not (v_resolved_item_id = any(v_seen_new_item_ids)) then
      v_inserted_item_id := null;
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
      values (
        v_resolved_item_id,
        v_line->>'sku',
        nullif(v_line->>'accountingCode', ''),
        v_line->>'itemName',
        'Đầu kỳ',
        v_line->>'unit',
        null,
        1,
        (v_line->>'unitPrice')::numeric,
        (v_line->>'unitPrice')::numeric,
        0,
        '{}'::jsonb
      )
      on conflict (id) do nothing
      returning id into v_inserted_item_id;
      v_seen_new_item_ids := pg_catalog.array_append(v_seen_new_item_ids, v_resolved_item_id);
    end if;
  end loop;

  -- Acquire every resolved item row lock in ascending ID before catalog or
  -- stock mutations. public.process_transaction_status repeats this order.
  for v_item_id in
    select distinct resolved_line.value->>'inventoryItemId' as "itemId"
    from pg_catalog.jsonb_array_elements(v_resolved_lines) resolved_line(value)
    order by "itemId"
  loop
    perform 1
    from public.items item
    where item.id = v_item_id
    for update;
    if not found then
      raise exception 'resolved opening item disappeared: %', v_item_id
        using errcode = '23503';
    end if;
  end loop;

  for v_line, v_line_index in
    select resolved_line.value, resolved_line.ordinality
    from pg_catalog.jsonb_array_elements(v_resolved_lines)
      with ordinality as resolved_line(value, ordinality)
    order by resolved_line.ordinality
  loop
    select * into strict v_item
    from public.items item
    where item.id = v_line->>'inventoryItemId';

    if v_line->>'resolutionKind' in ('explicit', 'sku', 'created')
       and pg_catalog.lower(pg_catalog.btrim(v_item.sku))
         is distinct from pg_catalog.lower(pg_catalog.btrim(v_line->>'sku')) then
      raise exception 'resolved opening item no longer agrees with SKU %', v_line->>'sku'
        using errcode = '40001';
    end if;
    if v_line->>'resolutionKind' = 'accounting'
       and pg_catalog.btrim(v_item.accounting_code)
         is distinct from pg_catalog.btrim(v_line->>'accountingCode') then
      raise exception 'resolved opening item no longer agrees with accounting code %', v_line->>'accountingCode'
        using errcode = '40001';
    end if;

    if not app_private.quantity_units_are_equivalent(v_item.unit, v_line->>'unit') then
      raise exception 'opening line unit % does not agree with authoritative item unit %',
        v_line->>'unit', v_item.unit
        using errcode = '22023';
    end if;

    v_purchased_qty := app_private.assert_quantity_precision(v_line->>'purchasedQty', v_item.unit);
    v_issued_qty := app_private.assert_quantity_precision(v_line->>'issuedQty', v_item.unit);
    v_used_qty := app_private.assert_quantity_precision(v_line->>'usedQty', v_item.unit);
    v_remaining_qty := app_private.assert_quantity_precision(v_line->>'remainingQty', v_item.unit);
    v_unit_price := (v_line->>'unitPrice')::numeric;

    if v_unit_price > 0
       and (coalesce(v_item.price_in, 0) <= 0 or coalesce(v_item.price_out, 0) <= 0) then
      update public.items item
      set price_in = case when coalesce(item.price_in, 0) > 0 then item.price_in else v_unit_price end,
          price_out = case when coalesce(item.price_out, 0) > 0 then item.price_out else v_unit_price end
      where item.id = v_item.id
      returning * into v_item;
    end if;

    v_final_lines := v_final_lines || pg_catalog.jsonb_build_array(
      (v_line - 'explicitItemId' - 'resolutionKind' - 'shouldCreate') || pg_catalog.jsonb_build_object(
        'inventoryItemId', v_item.id,
        'sku', v_item.sku,
        'accountingCode', coalesce(nullif(v_line->>'accountingCode', ''), v_item.accounting_code),
        'unit', v_item.unit,
        'purchasedQty', v_purchased_qty,
        'issuedQty', v_issued_qty,
        'usedQty', v_used_qty,
        'remainingQty', v_remaining_qty
      )
    );
  end loop;

  if v_balance_exists then
    update public.project_opening_balances opening
    set scope_key = v_scope_key,
        project_id = v_project_id,
        construction_site_id = v_construction_site_id,
        as_of_date = v_as_of_date,
        contract_value = v_contract_value,
        construction_progress_percent = v_progress_percent,
        purchased_value = v_purchased_value,
        issued_value = v_issued_value,
        used_value = v_used_value,
        recognized_value = v_recognized_value,
        status = 'draft',
        note = v_opening_note,
        stock_transaction_ids = '[]'::jsonb,
        material_project_transaction_id = null,
        created_by = coalesce(opening.created_by, v_actor::text),
        locked_by = null,
        locked_at = null,
        lock_command_id = null,
        lock_request_hash = null,
        project_finance_id = null,
        posting_engine_version = null
    where opening.id = v_balance_id
    returning * into v_balance;
  else
    insert into public.project_opening_balances (
      id,
      scope_key,
      project_id,
      construction_site_id,
      as_of_date,
      contract_value,
      construction_progress_percent,
      purchased_value,
      issued_value,
      used_value,
      recognized_value,
      status,
      note,
      stock_transaction_ids,
      created_by
    )
    values (
      v_balance_id,
      v_scope_key,
      v_project_id,
      v_construction_site_id,
      v_as_of_date,
      v_contract_value,
      v_progress_percent,
      v_purchased_value,
      v_issued_value,
      v_used_value,
      v_recognized_value,
      'draft',
      v_opening_note,
      '[]'::jsonb,
      v_actor::text
    )
    returning * into v_balance;
  end if;

  delete from public.project_opening_balance_lines line
  where line.opening_balance_id = v_balance_id;

  for v_line, v_line_index in
    select final_line.value, final_line.ordinality
    from pg_catalog.jsonb_array_elements(v_final_lines)
      with ordinality as final_line(value, ordinality)
    order by final_line.ordinality
  loop
    insert into public.project_opening_balance_lines (
      opening_balance_id,
      inventory_item_id,
      accounting_code,
      sku,
      item_name,
      unit,
      warehouse_id,
      purchased_qty,
      issued_qty,
      used_qty,
      remaining_qty,
      unit_price,
      remaining_value,
      note
    )
    values (
      v_balance_id,
      v_line->>'inventoryItemId',
      nullif(v_line->>'accountingCode', ''),
      v_line->>'sku',
      v_line->>'itemName',
      v_line->>'unit',
      v_line->>'warehouseId',
      (v_line->>'purchasedQty')::numeric,
      (v_line->>'issuedQty')::numeric,
      (v_line->>'usedQty')::numeric,
      (v_line->>'remainingQty')::numeric,
      (v_line->>'unitPrice')::numeric,
      (v_line->>'remainingValue')::numeric,
      nullif(v_line->>'note', '')
    );
  end loop;

  if v_project_finance_id is not null then
    select * into v_finance
    from public.project_finances finance
    where finance.id = v_project_finance_id
    for update;
    v_finance_exists := found;
    if not v_finance_exists then
      raise exception 'finance snapshot is stale; project finance row % does not exist', v_project_finance_id
        using errcode = '40001';
    end if;
  else
    lock table public.project_finances in share row exclusive mode;
    select count(*), min(finance.id)
    into v_finance_count, v_project_finance_id
    from public.project_finances finance
    where (v_project_id is null or finance.project_id = v_project_id)
      and (
        v_construction_site_id is null
        or coalesce(finance.construction_site_id, finance."constructionSiteId") = v_construction_site_id
      );
    if v_finance_count > 1 then
      raise exception 'ambiguous project finance rows for opening scope %', v_scope_key
        using errcode = '21000';
    end if;
    if v_finance_count = 1 then
      raise exception 'finance snapshot is stale; existing finance % requires projectFinanceId and a full snapshot',
        v_project_finance_id
        using errcode = '40001';
    end if;
    v_project_finance_id := 'opening-finance:' || app_private.sha256_text(v_scope_key);
    v_finance_exists := false;
  end if;

  if v_finance_exists then
    v_finance_current_snapshot := pg_catalog.jsonb_build_object(
      'id', v_finance.id,
      'projectId', v_finance.project_id,
      'constructionSiteId', coalesce(v_finance.construction_site_id, v_finance."constructionSiteId"),
      'contractValue', v_finance."contractValue",
      'progressPercent', v_finance."progressPercent",
      'status', v_finance.status,
      'notes', v_finance.notes,
      'updatedAt', pg_catalog.to_jsonb(v_finance."updatedAt")
    );
    if v_finance_current_snapshot is distinct from v_canonical_finance_snapshot then
      raise exception 'finance snapshot is stale; project finance row % changed after it was loaded',
        v_finance.id
        using errcode = '40001';
    end if;
    if v_project_id is not null and v_finance.project_id is distinct from v_project_id then
      raise exception 'project finance row belongs to another project'
        using errcode = '22023';
    end if;
    if v_construction_site_id is not null
       and coalesce(v_finance.construction_site_id, v_finance."constructionSiteId")
         is distinct from v_construction_site_id then
      raise exception 'project finance row belongs to another construction site'
        using errcode = '22023';
    end if;

    update public.project_finances finance
    set "constructionSiteId" = coalesce(v_construction_site_id, finance."constructionSiteId", ''),
        "contractValue" = v_contract_value,
        "progressPercent" = case
          when coalesce(finance."progressPercent", 0) > 0 then finance."progressPercent"
          else v_progress_percent
        end,
        status = case
          when coalesce(finance.status, 'planning') = 'planning' and v_progress_percent > 0 then 'active'
          else coalesce(finance.status, 'active')
        end,
        notes = pg_catalog.concat_ws(
          E'\n',
          nullif(finance.notes, ''),
          coalesce(
            case when v_opening_note is not null
              then 'Đầu kỳ ' || v_as_of_date::text || ': ' || v_opening_note
            end,
            'Đầu kỳ dự án đã được chốt.'
          )
        ),
        "updatedAt" = pg_catalog.now(),
        project_id = coalesce(v_project_id, finance.project_id),
        construction_site_id = coalesce(v_construction_site_id, finance.construction_site_id)
    where finance.id = v_project_finance_id
    returning * into v_finance;
  else
    insert into public.project_finances (
      id,
      "constructionSiteId",
      "contractValue",
      "progressPercent",
      status,
      notes,
      "updatedAt",
      project_id,
      construction_site_id
    )
    values (
      v_project_finance_id,
      coalesce(v_construction_site_id, ''),
      v_contract_value,
      v_progress_percent,
      case when v_progress_percent > 0 then 'active' else 'planning' end,
      coalesce(
        case when v_opening_note is not null
          then 'Đầu kỳ ' || v_as_of_date::text || ': ' || v_opening_note
        end,
        'Đầu kỳ dự án đã được chốt.'
      ),
      pg_catalog.now(),
      v_project_id,
      v_construction_site_id
    )
    returning * into v_finance;
  end if;

  v_material_amount := v_recognized_value;
  if v_material_amount > 0 then
    v_material_transaction_id := 'opening-material:' || v_balance_id::text;
    v_source_ref := 'opening_balance:' || v_balance_id::text || ':materials';
    insert into public.project_transactions (
      id,
      "projectFinanceId",
      "constructionSiteId",
      project_id,
      project_finance_id,
      construction_site_id,
      type,
      category,
      amount,
      description,
      date,
      source,
      "sourceRef",
      source_ref,
      attachments,
      "createdBy",
      "createdAt"
    )
    values (
      v_material_transaction_id,
      v_project_finance_id,
      coalesce(v_construction_site_id, ''),
      v_project_id,
      v_project_finance_id,
      v_construction_site_id,
      'expense',
      'materials',
      v_material_amount,
      'Chi phí vật tư đã sử dụng đầu kỳ đến ' || v_as_of_date::text,
      v_as_of_date::text,
      'import',
      v_source_ref,
      v_source_ref,
      '[]'::jsonb,
      v_actor::text,
      pg_catalog.now()
    )
    returning id into v_material_transaction_id;
  end if;

  -- Positive remainingQty lines only. Warehouses are posted in ascending ID;
  -- a failure in any public.process_transaction_status call aborts this outer
  -- command transaction and rolls back every earlier warehouse movement.
  for v_warehouse_id in
    select distinct final_line.value->>'warehouseId' as "warehouseId"
    from pg_catalog.jsonb_array_elements(v_final_lines) final_line(value)
    where (final_line.value->>'remainingQty')::numeric > 0
    order by "warehouseId"
  loop
    v_transaction_id := 'opening-balance:' || v_balance_id::text || ':'
      || pg_catalog.left(app_private.sha256_text(v_warehouse_id), 16);
    v_transaction_source_id := v_balance_id::text || ':' || v_warehouse_id;

    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'lineId', v_balance_id::text || ':' || source_line.ordinality::text,
        'itemId', source_line.value->>'inventoryItemId',
        'quantity', (source_line.value->>'remainingQty')::numeric,
        'price', (source_line.value->>'unitPrice')::numeric,
        'unit', source_line.value->>'unit',
        'unitSnapshot', source_line.value->>'unit'
      )
      order by source_line.value->>'inventoryItemId', source_line.ordinality
    )
    into v_transaction_items
    from pg_catalog.jsonb_array_elements(v_final_lines)
      with ordinality as source_line(value, ordinality)
    where source_line.value->>'warehouseId' = v_warehouse_id
      and (source_line.value->>'remainingQty')::numeric > 0;

    select * into v_existing_transaction
    from public.transactions stock_transaction
    where stock_transaction.id = v_transaction_id
       or (
         stock_transaction.source_type = 'project_opening_balance'
         and stock_transaction.source_id = v_transaction_source_id
       )
    order by stock_transaction.id
    limit 1
    for update;
    if found then
      raise exception 'stale opening WMS transaction identity already exists: %', v_existing_transaction.id
        using errcode = '23505';
    end if;

    insert into public.transactions (
      id,
      type,
      date,
      items,
      source_warehouse_id,
      target_warehouse_id,
      supplier_id,
      requester_id,
      approver_id,
      status,
      note,
      related_request_id,
      pending_items,
      created_by,
      updated_by,
      source_type,
      source_id,
      posting_request_hash,
      posting_engine_version
    )
    values (
      v_transaction_id,
      'ADJUSTMENT'::public.transaction_type,
      (v_as_of_date::timestamp at time zone 'UTC'),
      v_transaction_items,
      null,
      v_warehouse_id,
      null,
      v_actor,
      v_actor,
      'PENDING'::public.transaction_status,
      'Nhập tồn đầu kỳ dự án ' || v_scope_key || ' (' || v_as_of_date::text || ')',
      null,
      '[]'::jsonb,
      v_actor,
      v_actor,
      'project_opening_balance',
      v_transaction_source_id,
      null,
      'wf001-opening-v1'
    )
    returning * into v_existing_transaction;

    -- Hash the exact persisted A3 canonical intent, including the timestamptz,
    -- null fields, server actor, note and pending items.
    v_transaction_hash := app_private.sha256_text(
      app_private.wms_transaction_intent(v_existing_transaction)::text
    );
    update public.transactions stock_transaction
    set posting_request_hash = v_transaction_hash
    where stock_transaction.id = v_transaction_id
    returning * into v_existing_transaction;

    v_posted_transaction := public.process_transaction_status(
      v_transaction_id,
      'COMPLETED'::public.transaction_status,
      v_actor
    );
    v_stock_transaction_ids := v_stock_transaction_ids
      || pg_catalog.jsonb_build_array(v_posted_transaction.id);
  end loop;

  -- The guard trigger runs alphabetically before the generic updated_at
  -- trigger. Authorize the exact row image it will observe, including the
  -- transaction-stable timestamp, then consume that authorization once.
  v_authorized_balance := v_balance;
  v_authorized_balance.status := 'locked';
  v_authorized_balance.locked_by := v_actor::text;
  v_authorized_balance.locked_at := pg_catalog.now();
  v_authorized_balance.stock_transaction_ids := v_stock_transaction_ids;
  v_authorized_balance.material_project_transaction_id := v_material_transaction_id;
  v_authorized_balance.lock_command_id := v_command_id;
  v_authorized_balance.lock_request_hash := v_request_hash;
  v_authorized_balance.project_finance_id := v_project_finance_id;
  v_authorized_balance.posting_engine_version := 'wf001-opening-v1';
  v_authorized_balance.updated_at := pg_catalog.now();

  perform app_private.authorize_project_opening_write(
    v_balance.id,
    pg_catalog.to_jsonb(v_balance),
    pg_catalog.to_jsonb(v_authorized_balance)
  );

  update public.project_opening_balances opening
  set status = 'locked',
      locked_by = v_actor::text,
      locked_at = pg_catalog.now(),
      stock_transaction_ids = v_stock_transaction_ids,
      material_project_transaction_id = v_material_transaction_id,
      lock_command_id = v_command_id,
      lock_request_hash = v_request_hash,
      project_finance_id = v_project_finance_id,
      posting_engine_version = 'wf001-opening-v1',
      updated_at = pg_catalog.now()
  where opening.id = v_balance_id
  returning * into v_balance;

  v_saved_result := app_private.project_opening_balance_result(v_balance.id);
  insert into app_private.project_opening_command_results (
    command_id,
    opening_balance_id,
    actor_id,
    request_hash,
    result
  )
  values (
    v_command_id,
    v_balance.id,
    v_actor,
    v_request_hash,
    v_saved_result
  );

  return v_saved_result;
end;
$$;

revoke all on function public.lock_project_opening_balance(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.lock_project_opening_balance(jsonb)
  to authenticated;

reset statement_timeout;
reset lock_timeout;

notify pgrst, 'reload schema';
