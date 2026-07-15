-- Release A3.2: one atomic, idempotent inventory-audit command.
--
-- The physical observation is persisted as immutable evidence. Any non-zero
-- delta is posted through the existing A3 WMS command in the same outer SQL
-- transaction. Cache/ledger divergence is never papered over by an audit.

set lock_timeout = '5s';
set statement_timeout = '60s';

create extension if not exists pgcrypto;
create schema if not exists app_private;

-- `inventory_audit` becomes a reserved WMS source in this release. Existing
-- rows cannot be authenticated after the fact, so deployment fails closed and
-- requires the operator to quarantine/reconcile them first.
do $inventory_audit_source_precondition$
begin
  if exists (
    select 1
    from public.transactions transaction_row
    where transaction_row.source_type = 'inventory_audit'
  ) then
    raise exception 'pre-existing inventory_audit WMS sources require reconciliation before A3.2'
      using errcode = '55000';
  end if;
end;
$inventory_audit_source_precondition$;

alter table public.audit_sessions
  add column if not exists command_id uuid,
  add column if not exists request_hash text,
  add column if not exists posting_engine_version text;

do $inventory_audit_command_precondition$
begin
  if exists (
    select audit.command_id
    from public.audit_sessions audit
    where audit.command_id is not null
    group by audit.command_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'duplicate inventory-audit command ids require reconciliation before A3.2'
      using errcode = '23505';
  end if;
end;
$inventory_audit_command_precondition$;

create unique index audit_sessions_command_id_unique_idx
  on public.audit_sessions(command_id)
  where command_id is not null;

alter table public.audit_sessions
  add constraint audit_sessions_command_metadata_check check (
    command_id is null
    or (
      request_hash ~ '^[0-9a-f]{64}$'
      and posting_engine_version = 'wf001-audit-v1'
    )
  );

create unique index transactions_inventory_audit_source_unique_idx
  on public.transactions(source_type, source_id)
  where source_type = 'inventory_audit';

create table app_private.inventory_audit_command_results (
  command_id uuid primary key,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null,
  warehouse_id text not null,
  result jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on table app_private.inventory_audit_command_results
  from public, anon, authenticated, service_role;
revoke truncate on table app_private.inventory_audit_command_results
  from public, anon, authenticated, service_role;

comment on table app_private.inventory_audit_command_results is
  'Immutable response snapshots for exact A3.2 retries. Never expose to API roles.';

create unlogged table app_private.inventory_audit_write_authorizations (
  id uuid primary key default gen_random_uuid(),
  backend_pid integer not null,
  transaction_xid bigint not null,
  write_kind text not null check (write_kind in ('audit_session', 'wms_source')),
  target_key text not null check (pg_catalog.btrim(target_key) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index inventory_audit_write_authorizations_lookup_idx
  on app_private.inventory_audit_write_authorizations (
    backend_pid,
    transaction_xid,
    write_kind,
    target_key,
    request_hash,
    created_at
  );

revoke all on table app_private.inventory_audit_write_authorizations
  from public, anon, authenticated, service_role;

comment on table app_private.inventory_audit_write_authorizations is
  'One-use row/source capabilities consumed by A3.2 ALWAYS guards.';

create or replace function app_private.authorize_inventory_audit_write(
  p_write_kind text,
  p_target_key text,
  p_request_hash text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_write_kind not in ('audit_session', 'wms_source') then
    raise exception 'unsupported inventory-audit authorization kind: %', p_write_kind
      using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(p_target_key), '') is null
     or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid inventory-audit write authorization'
      using errcode = '22023';
  end if;

  insert into app_private.inventory_audit_write_authorizations (
    backend_pid,
    transaction_xid,
    write_kind,
    target_key,
    request_hash
  )
  values (
    pg_catalog.pg_backend_pid(),
    pg_catalog.txid_current(),
    p_write_kind,
    p_target_key,
    p_request_hash
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app_private.authorize_inventory_audit_write(text, text, text)
  from public, anon, authenticated, service_role;

create or replace function app_private.guard_inventory_audit_wms_source()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization_id uuid;
begin
  if tg_op = 'UPDATE' then
    if old.source_type = 'inventory_audit'
       or new.source_type = 'inventory_audit' then
      raise exception 'reserved inventory_audit source identity is immutable'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if new.source_type <> 'inventory_audit' then
    return new;
  end if;
  if nullif(pg_catalog.btrim(new.source_id), '') is null then
    raise exception 'reserved inventory_audit source requires a command id'
      using errcode = '22023';
  end if;

  delete from app_private.inventory_audit_write_authorizations auth_row
  where auth_row.id = (
    select candidate.id
    from app_private.inventory_audit_write_authorizations candidate
    where candidate.backend_pid = pg_catalog.pg_backend_pid()
      and candidate.transaction_xid = pg_catalog.txid_current()
      and candidate.write_kind = 'wms_source'
      and candidate.target_key = new.source_id || ':' || new.id
    order by candidate.created_at, candidate.id
    limit 1
    for update
  )
  returning auth_row.id into v_authorization_id;

  if v_authorization_id is null then
    raise exception 'direct use of reserved inventory_audit WMS source is forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_inventory_audit_wms_source()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_inventory_audit_wms_source on public.transactions;
create trigger trg_guard_inventory_audit_wms_source
before insert or update of source_type, source_id on public.transactions
for each row execute function app_private.guard_inventory_audit_wms_source();
alter table public.transactions enable always trigger trg_guard_inventory_audit_wms_source;

create or replace function app_private.guard_inventory_audit_session_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization_id uuid;
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    raise exception 'inventory audit sessions are immutable; use reconciliation and a compensating transaction'
      using errcode = '55000';
  end if;

  if new.command_id is null
     or new.request_hash !~ '^[0-9a-f]{64}$'
     or new.posting_engine_version <> 'wf001-audit-v1' then
    raise exception 'inventory audit sessions must be created by post_inventory_audit'
      using errcode = '42501';
  end if;

  delete from app_private.inventory_audit_write_authorizations auth_row
  where auth_row.id = (
    select candidate.id
    from app_private.inventory_audit_write_authorizations candidate
    where candidate.backend_pid = pg_catalog.pg_backend_pid()
      and candidate.transaction_xid = pg_catalog.txid_current()
      and candidate.write_kind = 'audit_session'
      and candidate.target_key = new.command_id::text
      and candidate.request_hash = new.request_hash
    order by candidate.created_at, candidate.id
    limit 1
    for update
  )
  returning auth_row.id into v_authorization_id;

  if v_authorization_id is null then
    raise exception 'direct inventory audit session DML is forbidden; use post_inventory_audit'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_inventory_audit_session_write()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_inventory_audit_session on public.audit_sessions;
create trigger trg_guard_inventory_audit_session
before insert or update or delete on public.audit_sessions
for each row execute function app_private.guard_inventory_audit_session_write();
alter table public.audit_sessions enable always trigger trg_guard_inventory_audit_session;

revoke insert, update, delete on table public.audit_sessions
  from public, anon, authenticated, service_role;
revoke truncate on table public.audit_sessions
  from public, anon, authenticated, service_role;

create or replace function app_private.parse_inventory_audit_nonnegative_decimal(
  p_value jsonb,
  p_field_name text
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_value numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'string' then
    raise exception 'inventory-audit % must be a canonical decimal string', p_field_name
      using errcode = '22023';
  end if;

  v_text := p_value #>> '{}';
  -- Canonical machine decimals use a dot, no sign/leading zeroes/trailing
  -- zeroes, and never locale grouping. Zero is represented exactly as `0`.
  if v_text !~ '^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$' then
    raise exception 'inventory-audit % must be a canonical nonnegative decimal: %',
      p_field_name, v_text using errcode = '22023';
  end if;

  begin
    v_value := v_text::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'inventory-audit % must be a finite decimal: %', p_field_name, v_text
        using errcode = '22023';
  end;

  if pg_catalog.lower(v_value::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'inventory-audit % must be finite: %', p_field_name, v_text
      using errcode = '22023';
  end if;
  if v_value < 0 or v_value >= 100000000000000::numeric then
    raise exception 'inventory-audit % is outside numeric(20,6) range: %', p_field_name, v_text
      using errcode = '22003';
  end if;

  return v_value;
end;
$$;

revoke all on function app_private.parse_inventory_audit_nonnegative_decimal(jsonb, text)
  from public, anon, authenticated, service_role;

create or replace function app_private.inventory_audit_decimal_text(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_value = 0 then '0'
    else pg_catalog.trim_scale(p_value)::text
  end;
$$;

revoke all on function app_private.inventory_audit_decimal_text(numeric)
  from public, anon, authenticated, service_role;

create or replace function public.post_inventory_audit(
  p_command_id uuid,
  p_warehouse_id text,
  p_audited_at timestamptz,
  p_observations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_user public.users%rowtype;
  v_warehouse public.warehouses%rowtype;
  v_item public.items%rowtype;
  v_audit_session public.audit_sessions%rowtype;
  v_stock_transaction public.transactions%rowtype;
  v_saved app_private.inventory_audit_command_results%rowtype;
  v_observation jsonb;
  v_canonical_observations jsonb := '[]'::jsonb;
  v_session_items jsonb := '[]'::jsonb;
  v_transaction_items jsonb := '[]'::jsonb;
  v_updated_items jsonb := '[]'::jsonb;
  v_request_hash text;
  v_item_id text;
  v_actual numeric;
  v_expected numeric;
  v_cache numeric;
  v_cache_text text;
  v_balance numeric;
  v_delta numeric;
  v_loss_reason text;
  v_note text;
  v_loss_percent numeric;
  v_norm_percent numeric;
  v_loss_value numeric;
  v_total_loss_value numeric := 0;
  v_total_discrepancies integer := 0;
  v_total_exceed_norm integer := 0;
  v_nonzero_count integer := 0;
  v_exceeds_norm boolean;
  v_session_id text;
  v_transaction_id text;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_user
  from public.users user_row
  where user_row.id = v_actor;
  if not found then
    raise exception 'authenticated actor is not an application user'
      using errcode = '42501';
  end if;
  if not coalesce(v_user.is_active, true) then
    raise exception 'inactive user cannot post an inventory audit'
      using errcode = '42501';
  end if;

  if p_command_id is null then
    raise exception 'inventory-audit command id is required' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(p_warehouse_id), '') is null then
    raise exception 'inventory-audit warehouse is required' using errcode = '22023';
  end if;
  if p_audited_at is null or not pg_catalog.isfinite(p_audited_at) then
    raise exception 'inventory-audit timestamp must be finite' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_observations) <> 'array'
     or pg_catalog.jsonb_array_length(p_observations) not between 1 and 500 then
    raise exception 'inventory-audit observations must contain between 1 and 500 items'
      using errcode = '22023';
  end if;

  -- Passing null requester/assignee forces the PBAC decision to the target
  -- warehouse/global scope rather than an `own` shortcut.
  if not app_private.wms_has_action(
    'wms.transaction.create',
    null,
    p_warehouse_id,
    null,
    null,
    v_actor
  ) then
    raise exception 'insufficient warehouse privilege to create inventory-audit adjustment'
      using errcode = '42501';
  end if;
  if not app_private.wms_has_action(
    'wms.transaction.complete',
    null,
    p_warehouse_id,
    null,
    null,
    v_actor
  ) then
    raise exception 'insufficient warehouse privilege to complete inventory-audit adjustment'
      using errcode = '42501';
  end if;

  for v_observation in
    select observation.value
    from pg_catalog.jsonb_array_elements(p_observations) observation(value)
  loop
    if pg_catalog.jsonb_typeof(v_observation) <> 'object' then
      raise exception 'each inventory-audit observation must be an object'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_observation) supplied_key(key)
      where supplied_key.key not in (
        'item_id', 'actual_qty', 'expected_system_qty', 'loss_reason', 'note'
      )
    ) then
      raise exception 'inventory-audit observation contains unsupported fields'
        using errcode = '22023';
    end if;

    v_item_id := nullif(pg_catalog.btrim(v_observation->>'item_id'), '');
    if v_item_id is null then
      raise exception 'inventory-audit item_id is required' using errcode = '22023';
    end if;
    v_actual := app_private.parse_inventory_audit_nonnegative_decimal(
      v_observation->'actual_qty', 'actual_qty'
    );
    v_expected := app_private.parse_inventory_audit_nonnegative_decimal(
      v_observation->'expected_system_qty', 'expected_system_qty'
    );
    v_loss_reason := nullif(pg_catalog.btrim(v_observation->>'loss_reason'), '');
    v_note := nullif(pg_catalog.btrim(v_observation->>'note'), '');
    if v_note is not null and pg_catalog.length(v_note) > 2000 then
      raise exception 'inventory-audit note exceeds 2000 characters'
        using errcode = '22023';
    end if;
    if v_loss_reason is not null and v_loss_reason not in (
      'NATURAL_LOSS',
      'DAMAGE',
      'THEFT',
      'MEASUREMENT',
      'EXPIRED',
      'PROCESS_WASTE'
    ) then
      raise exception 'unsupported inventory-audit loss reason: %', v_loss_reason
        using errcode = '22023';
    end if;
    if v_actual <> v_expected and v_loss_reason is null then
      raise exception 'loss_reason is required for every non-zero inventory-audit delta'
        using errcode = '22023';
    end if;

    v_canonical_observations := v_canonical_observations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'item_id', v_item_id,
        'actual_qty', app_private.inventory_audit_decimal_text(v_actual),
        'expected_system_qty', app_private.inventory_audit_decimal_text(v_expected),
        'loss_reason', v_loss_reason,
        'note', v_note
      ))
    );
  end loop;

  if exists (
    select observation.value->>'item_id'
    from pg_catalog.jsonb_array_elements(v_canonical_observations) observation(value)
    group by observation.value->>'item_id'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'duplicate item in inventory-audit observations'
      using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(observation.value order by observation.value->>'item_id'),
    '[]'::jsonb
  )
  into v_canonical_observations
  from pg_catalog.jsonb_array_elements(v_canonical_observations) observation(value);

  v_request_hash := app_private.sha256_text(
    pg_catalog.jsonb_build_object(
      'posting_engine_version', 'wf001-audit-v1',
      'warehouse_id', p_warehouse_id,
      'audited_at', pg_catalog.to_jsonb(p_audited_at),
      'observations', v_canonical_observations
    )::text
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('inventory-audit-command:' || p_command_id::text, 0)
  );

  select * into v_saved
  from app_private.inventory_audit_command_results saved
  where saved.command_id = p_command_id
  for update;
  if found then
    if v_saved.actor_id is distinct from v_actor then
      raise exception 'inventory-audit command belongs to a different actor'
        using errcode = '42501';
    end if;
    if v_saved.request_hash is distinct from v_request_hash then
      raise exception 'inventory-audit command id was reused with different content'
        using errcode = '22023';
    end if;
    return v_saved.result;
  end if;

  if exists (
    select 1
    from public.audit_sessions audit
    where audit.command_id = p_command_id
  ) then
    raise exception 'inventory-audit command evidence exists without a result snapshot; reconcile before retry'
      using errcode = '55000';
  end if;

  v_transaction_id := 'audit-adjustment-' || p_command_id::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wms-source:inventory_audit:' || p_command_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wms-transaction:' || v_transaction_id, 0)
  );

  select * into v_warehouse
  from public.warehouses warehouse
  where warehouse.id = p_warehouse_id
    and not coalesce(warehouse.is_archived, false)
  for update;
  if not found then
    raise exception 'active inventory-audit warehouse not found: %', p_warehouse_id
      using errcode = '22023';
  end if;

  for v_observation in
    select observation.value
    from pg_catalog.jsonb_array_elements(v_canonical_observations) observation(value)
    order by observation.value->>'item_id'
  loop
    v_item_id := v_observation->>'item_id';

    select * into v_item
    from public.items item
    where item.id = v_item_id
    for update;
    if not found then
      raise exception 'inventory-audit item not found: %', v_item_id
        using errcode = '22023';
    end if;

    v_actual := app_private.assert_quantity_precision(
      v_observation->>'actual_qty', v_item.unit
    );
    v_expected := app_private.assert_quantity_precision(
      v_observation->>'expected_system_qty', v_item.unit
    );

    begin
      v_cache_text := coalesce(
        coalesce(v_item.stock_by_warehouse, '{}'::jsonb) ->> p_warehouse_id,
        '0'
      );
      v_cache := v_cache_text::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'inventory cache is not numeric for item %; reconciliation required', v_item_id
          using errcode = '55000';
    end;
    if pg_catalog.lower(v_cache::text) in ('nan', 'infinity', '-infinity')
       or v_cache < 0 then
      raise exception 'inventory cache is invalid for item %; reconciliation required', v_item_id
        using errcode = '55000';
    end if;
    if v_cache is distinct from v_expected then
      raise exception 'inventory cache changed for item % (expected %, current %)',
        v_item_id, v_expected, v_cache using errcode = '40001';
    end if;

    -- Intentional all-scope aggregate: project/lot/batch/serial balance rows
    -- all contribute to the legacy item+warehouse cache.
    select coalesce(pg_catalog.sum(balance.on_hand_qty), 0)
    into v_balance
    from public.inventory_balances balance
    where balance.material_id = v_item_id
      and balance.warehouse_id = p_warehouse_id;

    if pg_catalog.lower(v_balance::text) in ('nan', 'infinity', '-infinity')
       or v_balance is distinct from v_cache then
      raise exception 'inventory balance/cache mismatch for item %; reconciliation required (balance %, cache %)',
        v_item_id, v_balance, v_cache using errcode = '55000';
    end if;

    v_delta := v_actual - v_expected;
    v_loss_reason := nullif(v_observation->>'loss_reason', '');
    v_note := nullif(v_observation->>'note', '');
    v_norm_percent := null;
    v_loss_percent := null;
    v_exceeds_norm := false;
    v_loss_value := 0;

    if pg_catalog.lower(v_item.price_in::text) in ('nan', 'infinity', '-infinity')
       or coalesce(v_item.price_in, 0) < 0 then
      raise exception 'inventory item price is invalid for item %; reconciliation required', v_item_id
        using errcode = '55000';
    end if;

    if v_delta < 0 then
      if v_expected > 0 then
        v_loss_percent := pg_catalog.round((pg_catalog.abs(v_delta) * 100) / v_expected, 6);
      end if;

      select norm.allowed_percentage
      into v_norm_percent
      from public.loss_norms norm
      where norm.item_id = v_item_id
         or (
           norm.item_id is null
           and norm.category_id is not null
           and exists (
             select 1
             from public.categories category
             where category.id = norm.category_id
               and category.name = v_item.category
           )
         )
      order by (norm.item_id = v_item_id) desc,
               norm.created_at desc nulls last,
               norm.id
      limit 1;

      if v_norm_percent is not null
         and pg_catalog.lower(v_norm_percent::text) in ('nan', 'infinity', '-infinity') then
        raise exception 'inventory loss norm is invalid for item %; reconciliation required', v_item_id
          using errcode = '55000';
      end if;
      v_exceeds_norm := v_loss_percent is not null
        and v_norm_percent is not null
        and v_loss_percent > v_norm_percent;
      v_loss_value := pg_catalog.abs(v_delta) * coalesce(v_item.price_in, 0);
    end if;

    if v_delta <> 0 then
      v_total_discrepancies := v_total_discrepancies + 1;
      v_nonzero_count := v_nonzero_count + 1;
      if v_exceeds_norm then
        v_total_exceed_norm := v_total_exceed_norm + 1;
      end if;
      v_transaction_items := v_transaction_items || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'itemId', v_item.id,
          'quantity', app_private.inventory_audit_decimal_text(v_delta),
          'price', app_private.inventory_audit_decimal_text(coalesce(v_item.price_in, 0)),
          'unit', v_item.unit,
          'unitSnapshot', v_item.unit,
          'auditCommandId', p_command_id::text,
          'auditLossReason', v_loss_reason
        )
      );
    end if;

    v_total_loss_value := v_total_loss_value + v_loss_value;
    v_session_items := v_session_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'itemId', v_item.id,
        'itemName', v_item.name,
        'sku', v_item.sku,
        'unit', v_item.unit,
        'systemStock', app_private.inventory_audit_decimal_text(v_expected),
        'actualStock', app_private.inventory_audit_decimal_text(v_actual),
        'delta', app_private.inventory_audit_decimal_text(v_delta),
        'lossReason', v_loss_reason,
        'note', v_note,
        'exceedsNorm', v_exceeds_norm,
        'lossPercent', app_private.inventory_audit_decimal_text(v_loss_percent),
        'normPercent', app_private.inventory_audit_decimal_text(v_norm_percent),
        'lossValue', app_private.inventory_audit_decimal_text(v_loss_value)
      ))
    );
  end loop;

  v_session_id := 'audit-' || p_command_id::text;
  perform app_private.authorize_inventory_audit_write(
    'audit_session', p_command_id::text, v_request_hash
  );

  insert into public.audit_sessions (
    id,
    "warehouseId",
    "warehouseName",
    date,
    "auditorId",
    "auditorName",
    items,
    "totalItems",
    "totalDiscrepancies",
    "totalExceedNorm",
    "totalLossValue",
    "transactionId",
    command_id,
    request_hash,
    posting_engine_version
  )
  values (
    v_session_id,
    p_warehouse_id,
    v_warehouse.name,
    p_audited_at,
    v_actor::text,
    coalesce(nullif(v_user.name, ''), nullif(v_user.username, ''), v_actor::text),
    v_session_items,
    pg_catalog.jsonb_array_length(v_session_items),
    v_total_discrepancies,
    v_total_exceed_norm,
    v_total_loss_value,
    case when v_nonzero_count > 0 then v_transaction_id else null end,
    p_command_id,
    v_request_hash,
    'wf001-audit-v1'
  )
  returning * into v_audit_session;

  if v_nonzero_count > 0 then
    perform app_private.authorize_inventory_audit_write(
      'wms_source', p_command_id::text || ':' || v_transaction_id, v_request_hash
    );

    select * into v_stock_transaction
    from public.post_wms_transaction(
      pg_catalog.jsonb_build_object(
        'id', v_transaction_id,
        'type', 'ADJUSTMENT',
        'date', pg_catalog.to_jsonb(p_audited_at),
        'items', v_transaction_items,
        'targetWarehouseId', p_warehouse_id,
        'requesterId', v_actor::text,
        'status', 'COMPLETED',
        'note', 'Kiểm kê kho ' || v_warehouse.name || ' (command ' || p_command_id::text || ')',
        'sourceType', 'inventory_audit',
        'sourceId', p_command_id::text,
        'pendingItems', '[]'::jsonb
      )
    );
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id), '[]'::jsonb)
  into v_updated_items
  from public.items item
  where item.id in (
    select observation.value->>'item_id'
    from pg_catalog.jsonb_array_elements(v_canonical_observations) observation(value)
  );

  v_result := pg_catalog.jsonb_build_object(
    'audit_session',
      pg_catalog.to_jsonb(v_audit_session)
      || pg_catalog.jsonb_build_object(
        'totalLossValue', app_private.inventory_audit_decimal_text(v_total_loss_value)
      ),
    'stock_transaction',
      case when v_nonzero_count > 0 then pg_catalog.to_jsonb(v_stock_transaction) else null end,
    'updated_items', v_updated_items
  );

  insert into app_private.inventory_audit_command_results (
    command_id,
    request_hash,
    actor_id,
    warehouse_id,
    result
  )
  values (
    p_command_id,
    v_request_hash,
    v_actor,
    p_warehouse_id,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.post_inventory_audit(uuid, text, timestamptz, jsonb)
  from public, anon;
grant execute on function public.post_inventory_audit(uuid, text, timestamptz, jsonb)
  to authenticated;

comment on function public.post_inventory_audit(uuid, text, timestamptz, jsonb) is
  'A3.2 atomic physical inventory audit. Canonical decimal strings in; immutable evidence and optional deterministic compensating WMS adjustment out.';
