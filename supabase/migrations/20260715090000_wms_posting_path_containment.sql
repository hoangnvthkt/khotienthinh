-- Release A3: make WMS posting the only path that can transition documents or
-- mutate the legacy stock cache. One-use row-image authorizations are stored
-- in a protected, crash-ephemeral table; callers cannot spoof the context with
-- a custom GUC or call either authorization/stock helper directly.

set lock_timeout = '5s';
set statement_timeout = '60s';

create extension if not exists pgcrypto;
create schema if not exists app_private;

-- The containment guards intentionally fail deployment if the live enum has
-- drifted. Case variants would otherwise bypass immutable/transition checks.
do $enum_precondition$
declare
  v_labels text[];
begin
  select pg_catalog.array_agg(enum_value.enumlabel order by enum_value.enumsortorder)
  into v_labels
  from pg_catalog.pg_enum enum_value
  join pg_catalog.pg_type enum_type on enum_type.oid = enum_value.enumtypid
  join pg_catalog.pg_namespace namespace on namespace.oid = enum_type.typnamespace
  where namespace.nspname = 'public'
    and enum_type.typname = 'transaction_status';

  if v_labels is distinct from array['PENDING', 'APPROVED', 'COMPLETED', 'CANCELLED']::text[] then
    raise exception 'unexpected public.transaction_status labels: %', v_labels
      using errcode = '22023';
  end if;
end;
$enum_precondition$;

alter table public.transactions
  add column if not exists posting_request_hash text,
  add column if not exists posting_engine_version text;

create unlogged table app_private.wms_write_authorizations (
  id uuid primary key default gen_random_uuid(),
  backend_pid integer not null,
  transaction_xid bigint not null,
  write_kind text not null check (write_kind in ('transaction_status', 'stock_cache')),
  target_key text not null check (pg_catalog.btrim(target_key) <> ''),
  expected_before jsonb not null,
  expected_after jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index wms_write_authorizations_lookup_idx
  on app_private.wms_write_authorizations (
    backend_pid,
    transaction_xid,
    write_kind,
    target_key,
    created_at
  );

revoke all on table app_private.wms_write_authorizations
  from public, anon, authenticated, service_role;

comment on table app_private.wms_write_authorizations is
  'One-use, exact row-image capabilities consumed by A3 WMS guard triggers. Never grant this table or its authorizer to API roles.';

create or replace function app_private.authorize_wms_write(
  p_write_kind text,
  p_target_key text,
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
  if p_write_kind not in ('transaction_status', 'stock_cache') then
    raise exception 'unsupported WMS write authorization kind: %', p_write_kind
      using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(p_target_key), '') is null then
    raise exception 'WMS write authorization target is required'
      using errcode = '22023';
  end if;
  if p_expected_before is null or p_expected_after is null then
    raise exception 'WMS write authorization requires exact row images'
      using errcode = '22023';
  end if;

  insert into app_private.wms_write_authorizations (
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
    p_write_kind,
    p_target_key,
    p_expected_before,
    p_expected_after
  )
  returning id into v_authorization_id;

  return v_authorization_id;
end;
$$;

create or replace function app_private.guard_wms_transaction_write()
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
    if new.status::text <> 'PENDING' then
      raise exception 'direct completed insert is forbidden; create a PENDING WMS transaction and use process_transaction_status'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status::text = 'COMPLETED' then
      raise exception 'completed transaction is immutable; use a compensating transaction'
        using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status::text = 'COMPLETED'
     and to_jsonb(old) is distinct from to_jsonb(new) then
    raise exception 'completed transaction is immutable; use a compensating transaction'
      using errcode = '55000';
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  delete from app_private.wms_write_authorizations auth_row
  where auth_row.id = (
    select candidate.id
    from app_private.wms_write_authorizations candidate
    where candidate.backend_pid = pg_catalog.pg_backend_pid()
      and candidate.transaction_xid = pg_catalog.txid_current()
      and candidate.write_kind = 'transaction_status'
      and candidate.target_key = old.id
      and candidate.expected_before = to_jsonb(old)
      and candidate.expected_after = to_jsonb(new)
    order by candidate.created_at, candidate.id
    limit 1
    for update
  )
  returning auth_row.id into v_authorization_id;

  if v_authorization_id is null then
    raise exception 'transaction status changes must use process_transaction_status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_wms_transaction_write on public.transactions;
create trigger trg_guard_wms_transaction_write
before insert or update or delete on public.transactions
for each row execute function app_private.guard_wms_transaction_write();

create or replace function app_private.guard_item_stock_cache_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization_id uuid;
begin
  if tg_op = 'DELETE' then
    if coalesce(old.stock_by_warehouse, '{}'::jsonb) <> '{}'::jsonb
       or exists (
         select 1
         from public.inventory_ledger_entries entry
         where entry.material_id = old.id
       )
       or exists (
         select 1
         from public.inventory_balances balance
         where balance.material_id = old.id
       )
       or exists (
         select 1
         from public.transactions transaction_row
         cross join lateral pg_catalog.jsonb_array_elements(
           coalesce(transaction_row.items, '[]'::jsonb)
         ) line(value)
         where line.value->>'itemId' = old.id
       ) then
      raise exception 'inventory item with stock history is immutable; archive it instead'
        using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.stock_by_warehouse, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'new inventory items must start with an empty stock cache; post opening stock through WMS'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.id is distinct from new.id then
    raise exception 'inventory item identity is immutable; archive it and create a new item'
      using errcode = '55000';
  end if;

  if old.stock_by_warehouse is not distinct from new.stock_by_warehouse then
    return new;
  end if;

  delete from app_private.wms_write_authorizations auth_row
  where auth_row.id = (
    select candidate.id
    from app_private.wms_write_authorizations candidate
    where candidate.backend_pid = pg_catalog.pg_backend_pid()
      and candidate.transaction_xid = pg_catalog.txid_current()
      and candidate.write_kind = 'stock_cache'
      and candidate.target_key = old.id
      and candidate.expected_before = to_jsonb(old)
      and candidate.expected_after = to_jsonb(new)
    order by candidate.created_at, candidate.id
    limit 1
    for update
  )
  returning auth_row.id into v_authorization_id;

  if v_authorization_id is null then
    raise exception 'direct stock cache update is forbidden; use the WMS posting command'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_item_stock_cache_insert on public.items;
create trigger trg_guard_item_stock_cache_insert
before insert or delete on public.items
for each row execute function app_private.guard_item_stock_cache_write();

drop trigger if exists trg_guard_item_stock_cache_update on public.items;
create trigger trg_guard_item_stock_cache_update
before update on public.items
for each row execute function app_private.guard_item_stock_cache_write();

create or replace function app_private.apply_stock_change_internal(
  p_item_id text,
  p_warehouse_id text,
  p_delta numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_stock jsonb;
  v_current numeric;
  v_delta numeric;
  v_next numeric;
  v_expected_after jsonb;
begin
  if public.current_app_user_id() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if nullif(p_warehouse_id, '') is null then
    raise exception 'warehouse id is required' using errcode = '22023';
  end if;

  select * into v_item
  from public.items
  where id = p_item_id
  for update;
  if not found then
    raise exception 'item not found: %', p_item_id using errcode = 'P0002';
  end if;

  v_delta := app_private.assert_quantity_precision(p_delta::text, v_item.unit);
  v_stock := coalesce(v_item.stock_by_warehouse, '{}'::jsonb);
  v_current := coalesce((v_stock ->> p_warehouse_id)::numeric, 0);
  v_next := v_current + v_delta;

  if v_next < 0 then
    raise exception 'insufficient stock for item %, warehouse %: available %, delta %',
      p_item_id, p_warehouse_id, v_current, v_delta;
  end if;

  v_next := app_private.assert_quantity_precision(v_next::text, v_item.unit);
  if v_delta = 0 then
    return v_stock;
  end if;

  v_stock := pg_catalog.jsonb_set(
    v_stock,
    array[p_warehouse_id],
    pg_catalog.to_jsonb(v_next),
    true
  );
  v_expected_after := to_jsonb(v_item)
    || pg_catalog.jsonb_build_object('stock_by_warehouse', v_stock);

  perform app_private.authorize_wms_write(
    'stock_cache',
    p_item_id,
    to_jsonb(v_item),
    v_expected_after
  );

  update public.items
  set stock_by_warehouse = v_stock
  where id = p_item_id;

  return v_stock;
end;
$$;

-- Preserve the old signature for catalog compatibility, but make the exposed
-- helper fail closed. The posting command below calls only the private helper.
create or replace function public.apply_stock_change(
  p_item_id text,
  p_warehouse_id text,
  p_delta numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'direct stock helper calls are forbidden; use process_transaction_status'
    using errcode = '42501';
end;
$$;

drop policy if exists transactions_phase4_insert on public.transactions;
create policy transactions_phase4_insert
on public.transactions for insert
to authenticated
with check (
  status = 'PENDING'::public.transaction_status
  and app_private.transaction_can_insert(
    type::text,
    requester_id,
    approver_id,
    source_warehouse_id,
    target_warehouse_id,
    related_request_id,
    items
  )
);

create or replace function app_private.enrich_inventory_transaction_metadata()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_policy_snapshots jsonb := '[]'::jsonb;
begin
  if new.source_type <> 'wms_transaction' then
    return new;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'item_id', line.value->>'itemId',
          'source_quantity_text', line.value->>'quantity',
          'stock_unit_snapshot', coalesce(
            nullif(item.unit, ''),
            nullif(line.value->>'unit', ''),
            nullif(line.value->>'unitSnapshot', ''),
            nullif(line.value->>'unit_snapshot', ''),
            nullif(line.value->>'accountingUnit', '')
          ),
          'quantity_policy_id', policy.policy_id,
          'quantity_policy_version', policy.policy_version,
          'max_fraction_digits', policy.max_fraction_digits
        )
      )
      order by line.ordinality
    ),
    '[]'::jsonb
  )
  into v_policy_snapshots
  from public.transactions transaction_row
  cross join lateral jsonb_array_elements(coalesce(transaction_row.items, '[]'::jsonb))
    with ordinality as line(value, ordinality)
  left join public.items item on item.id = line.value->>'itemId'
  cross join lateral app_private.resolve_quantity_precision_policy(
    coalesce(
      nullif(item.unit, ''),
      nullif(line.value->>'unit', ''),
      nullif(line.value->>'unitSnapshot', ''),
      nullif(line.value->>'unit_snapshot', ''),
      nullif(line.value->>'accountingUnit', '')
    )
  ) policy
  where transaction_row.id = new.source_id;

  v_actor_id := coalesce(
    public.current_app_user_id(),
    new.approved_by,
    new.created_by
  );
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'posting_engine_version', 'wf001-a3-v1',
      'quantity_policy_snapshots', v_policy_snapshots,
      'actor_id', v_actor_id,
      'posted_at', coalesce(new.posted_at, pg_catalog.now())
    ));
  return new;
end;
$$;

create or replace function app_private.enrich_inventory_ledger_entry_metadata()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_stock_unit text;
  v_policy record;
begin
  if new.source_type <> 'wms_transaction' then
    return new;
  end if;

  select nullif(item.unit, '')
  into v_stock_unit
  from public.items item
  where item.id = new.material_id;

  v_stock_unit := coalesce(
    v_stock_unit,
    nullif(new.unit, ''),
    nullif(new.metadata->>'unit', ''),
    nullif(new.metadata->>'unitSnapshot', ''),
    nullif(new.metadata->>'unit_snapshot', ''),
    nullif(new.metadata->>'accountingUnit', '')
  );

  select * into strict v_policy
  from app_private.resolve_quantity_precision_policy(v_stock_unit);

  v_actor_id := coalesce(
    public.current_app_user_id(),
    new.approved_by,
    new.created_by
  );
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'posting_engine_version', 'wf001-a3-v1',
      'quantity_policy_id', v_policy.policy_id,
      'quantity_policy_version', v_policy.policy_version,
      'max_fraction_digits', v_policy.max_fraction_digits,
      'stock_unit_snapshot', v_stock_unit,
      'source_quantity_text', case
        when new.movement_direction = 'in' then new.quantity_in::text
        else new.quantity_out::text
      end,
      'actor_id', v_actor_id,
      'posted_at', coalesce(new.created_at, pg_catalog.now())
    ));
  return new;
end;
$$;

drop trigger if exists trg_enrich_inventory_transaction_metadata
  on public.inventory_transactions;
create trigger trg_enrich_inventory_transaction_metadata
before insert on public.inventory_transactions
for each row execute function app_private.enrich_inventory_transaction_metadata();

drop trigger if exists trg_enrich_inventory_ledger_entry_metadata
  on public.inventory_ledger_entries;
create trigger trg_enrich_inventory_ledger_entry_metadata
before insert on public.inventory_ledger_entries
for each row execute function app_private.enrich_inventory_ledger_entry_metadata();

create or replace function app_private.guard_inventory_ledger_immutable()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  raise exception 'posted inventory ledger is immutable; use a reversal or compensating transaction'
    using errcode = '55000';
end;
$$;

drop trigger if exists trg_guard_inventory_transaction_immutable
  on public.inventory_transactions;
create trigger trg_guard_inventory_transaction_immutable
before update or delete on public.inventory_transactions
for each row execute function app_private.guard_inventory_ledger_immutable();

drop trigger if exists trg_guard_inventory_ledger_entry_immutable
  on public.inventory_ledger_entries;
create trigger trg_guard_inventory_ledger_entry_immutable
before update or delete on public.inventory_ledger_entries
for each row execute function app_private.guard_inventory_ledger_immutable();

revoke all on function app_private.authorize_wms_write(text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.guard_wms_transaction_write()
  from public, anon, authenticated, service_role;
revoke all on function app_private.guard_item_stock_cache_write()
  from public, anon, authenticated, service_role;
revoke all on function app_private.enrich_inventory_transaction_metadata()
  from public, anon, authenticated, service_role;
revoke all on function app_private.enrich_inventory_ledger_entry_metadata()
  from public, anon, authenticated, service_role;
revoke all on function app_private.guard_inventory_ledger_immutable()
  from public, anon, authenticated, service_role;
revoke all on function app_private.apply_stock_change_internal(text, text, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_stock_change(text, text, numeric)
  from public, anon, authenticated, service_role;

revoke truncate on table
  public.transactions,
  public.items,
  public.inventory_transactions,
  public.inventory_ledger_entries
from public, anon, authenticated, service_role;

create or replace function app_private.wms_transaction_intent(
  p_transaction public.transactions
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_transaction.id,
    'type', p_transaction.type::text,
    'date', pg_catalog.to_jsonb(p_transaction.date),
    'items', coalesce(p_transaction.items, '[]'::jsonb),
    'sourceWarehouseId', p_transaction.source_warehouse_id,
    'targetWarehouseId', p_transaction.target_warehouse_id,
    'supplierId', p_transaction.supplier_id,
    'requesterId', p_transaction.requester_id,
    'createdBy', p_transaction.created_by,
    'businessPartnerId', p_transaction.business_partner_id,
    'businessPartnerNameSnapshot', p_transaction.business_partner_name_snapshot,
    'note', p_transaction.note,
    'sourceType', p_transaction.source_type,
    'sourceId', p_transaction.source_id,
    'relatedRequestId', p_transaction.related_request_id,
    'pendingItems', coalesce(p_transaction.pending_items, '[]'::jsonb)
  );
$$;

revoke all on function app_private.wms_transaction_intent(public.transactions)
  from public, anon, authenticated, service_role;

create or replace function app_private.sha256_text(p_value text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_extension_schema text;
  v_hash text;
begin
  select namespace.nspname
  into v_extension_schema
  from pg_catalog.pg_extension extension_row
  join pg_catalog.pg_namespace namespace on namespace.oid = extension_row.extnamespace
  where extension_row.extname = 'pgcrypto';
  if v_extension_schema is null then
    raise exception 'pgcrypto extension is required for WMS request hashing';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest($1, $2), ''hex'')',
    v_extension_schema
  )
  into v_hash
  using p_value, 'sha256';
  return v_hash;
end;
$$;

revoke all on function app_private.sha256_text(text)
  from public, anon, authenticated, service_role;

-- Keep the complete A2 PBAC/reservation/precision body, then add A3 ordering,
-- private stock mutation, exact status authorization and empty-cache rules.
create or replace function public.process_transaction_status(
  p_transaction_id text,
  p_status public.transaction_status,
  p_approver_id uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_check record;
  v_item_id text;
  v_unit_text text;
  v_catalog_unit_text text;
  v_pending_unit_text text;
  v_supplied_unit_text text;
  v_qty numeric;
  v_on_hand numeric;
  v_tx_reserved numeric;
  v_request_reserved numeric;
  v_reserved numeric;
  v_available numeric;
  v_item_name text;
  v_warehouse_name text;
  v_stock_warehouse_id text;
  v_expected_tx jsonb;
  v_is_fulfillment_transfer boolean := false;
  v_can_approve boolean := false;
  v_can_complete boolean := false;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;
  if not coalesce(v_user.is_active, true) then
    raise exception 'inactive user cannot execute WMS status commands'
      using errcode = '42501';
  end if;
  if p_status not in (
    'APPROVED'::public.transaction_status,
    'COMPLETED'::public.transaction_status,
    'CANCELLED'::public.transaction_status
  ) then
    raise exception 'unsupported transaction status command: %', p_status
      using errcode = '22023';
  end if;
  if p_approver_id is distinct from v_user.id then
    raise exception 'approver must match the authenticated actor'
      using errcode = '42501';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
    where nullif(line.value->>'fulfillmentBatchId', '') is not null
  )
  into v_is_fulfillment_transfer;

  v_is_fulfillment_transfer := v_is_fulfillment_transfer
    and v_tx.type = 'TRANSFER'::public.transaction_type
    and nullif(v_tx.target_warehouse_id, '') is not null;

  v_can_approve := app_private.wms_has_action(
    'wms.transaction.approve',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  v_can_complete := app_private.wms_has_action(
    'wms.transaction.complete',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  if p_status = 'APPROVED'::public.transaction_status and not v_can_approve then
    raise exception 'insufficient privilege to approve transaction'
      using errcode = '42501';
  end if;

  if p_status = 'CANCELLED'::public.transaction_status
     and not v_can_approve
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to cancel transaction'
      using errcode = '42501';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status and not v_can_complete then
    raise exception 'insufficient privilege to complete transaction'
      using errcode = '42501';
  end if;

  if v_tx.status = p_status then
    return v_tx;
  end if;
  if v_tx.status = 'APPROVED'::public.transaction_status
     and p_status not in (
       'COMPLETED'::public.transaction_status,
       'CANCELLED'::public.transaction_status
     ) then
    raise exception 'approved transaction can only be completed or cancelled'
      using errcode = '22023';
  end if;
  if v_tx.status = 'CANCELLED'::public.transaction_status then
    raise exception 'cancelled transaction cannot be changed';
  end if;
  if v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'completed transaction cannot be changed';
  end if;
  if p_status = 'COMPLETED'::public.transaction_status
     and exists (
       select 1
       from public.inventory_transactions inventory_transaction
       where inventory_transaction.source_type = 'wms_transaction'
         and inventory_transaction.source_id = v_tx.id
     ) then
    raise exception 'inventory ledger already exists for non-completed transaction %; quarantine and reconcile before posting',
      v_tx.id using errcode = '55000';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_line in
      select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb))
    loop
      select nullif(app_private.normalize_quantity_unit(i.unit), '')
      into v_catalog_unit_text
      from public.items i
      where i.id = v_line->>'itemId';

      select coalesce(
        nullif(app_private.normalize_quantity_unit(pending.value->>'unit'), ''),
        app_private.normalize_quantity_unit('Cái')
      )
      into v_pending_unit_text
      from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb)) pending(value)
      where pending.value->>'id' = v_line->>'itemId'
      limit 1;

      v_unit_text := coalesce(
        v_catalog_unit_text,
        v_pending_unit_text,
        nullif(app_private.normalize_quantity_unit(v_line->>'unit'), ''),
        nullif(app_private.normalize_quantity_unit(v_line->>'unitSnapshot'), ''),
        nullif(app_private.normalize_quantity_unit(v_line->>'unit_snapshot'), ''),
        ''
      );

      foreach v_supplied_unit_text in array array[
        v_pending_unit_text,
        app_private.normalize_quantity_unit(v_line->>'unit'),
        app_private.normalize_quantity_unit(v_line->>'unitSnapshot'),
        app_private.normalize_quantity_unit(v_line->>'unit_snapshot')
      ]
      loop
        if nullif(v_supplied_unit_text, '') is not null
           and not app_private.quantity_units_are_equivalent(
             v_unit_text,
             v_supplied_unit_text
           ) then
          raise exception 'transaction unit snapshot "%" does not match authoritative stock unit "%"',
            v_supplied_unit_text,
            coalesce(nullif(v_unit_text, ''), '<default>')
            using errcode = '22023';
        end if;
      end loop;

      v_qty := app_private.assert_quantity_precision(
        v_line->>'quantity',
        v_unit_text
      );
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status
     and v_is_fulfillment_transfer
     and v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'Đợt cấp cần được thủ kho công trường duyệt số lượng/chất lượng trước khi xác nhận nhập kho.';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status)
     and v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type, 'ADJUSTMENT'::public.transaction_type) then
    v_stock_warehouse_id := case
      when v_tx.type = 'ADJUSTMENT'::public.transaction_type then v_tx.target_warehouse_id
      else v_tx.source_warehouse_id
    end;
    if nullif(v_stock_warehouse_id, '') is null then
      raise exception 'source warehouse is required for stock-out transaction';
    end if;

    for v_check in
      select
        line.value->>'itemId' as item_id,
        sum(
          case
            when v_tx.type = 'ADJUSTMENT'::public.transaction_type
              then abs(least(0, coalesce(nullif(line.value->>'quantity', '')::numeric, 0)))
            else coalesce(nullif(line.value->>'quantity', '')::numeric, 0)
          end
        ) as qty
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
      group by line.value->>'itemId'
      order by item_id
    loop
      v_item_id := v_check.item_id;
      v_qty := coalesce(v_check.qty, 0);
      if v_item_id is null then
        raise exception 'invalid transaction item payload';
      end if;
      if v_qty <= 0 then
        if v_tx.type = 'ADJUSTMENT'::public.transaction_type then
          continue;
        end if;
        raise exception 'invalid transaction item payload';
      end if;

      select
        coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> v_stock_warehouse_id)::numeric, 0),
        i.name
      into v_on_hand, v_item_name
      from public.items i
      where i.id = v_item_id
      for update;
      if not found then
        raise exception 'item not found: %', v_item_id;
      end if;

      select coalesce(sum(coalesce(nullif(line.value->>'quantity', '')::numeric, 0)), 0)
      into v_tx_reserved
      from public.transactions t
      cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) line(value)
      where t.id <> v_tx.id
        and t.source_warehouse_id = v_stock_warehouse_id
        and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
        and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
        and line.value->>'itemId' = v_item_id;

      select coalesce(sum(
        case
          when r.status = 'PENDING'::public.request_status
            then coalesce(nullif(line.value->>'requestQty', '')::numeric, 0)
          else coalesce(nullif(line.value->>'approvedQty', '')::numeric, 0)
        end
      ), 0)
      into v_request_reserved
      from public.requests r
      cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) line(value)
      where r.source_warehouse_id = v_stock_warehouse_id
        and (v_tx.related_request_id is null or r.id <> v_tx.related_request_id)
        and r.status in ('PENDING'::public.request_status, 'APPROVED'::public.request_status, 'IN_TRANSIT'::public.request_status)
        and not (
          (coalesce(r.request_origin, 'wms') = 'project' or r.project_id is not null or r.construction_site_id is not null)
          and r.status <> 'PENDING'::public.request_status
        )
        and line.value->>'itemId' = v_item_id;

      v_reserved := coalesce(v_tx_reserved, 0) + coalesce(v_request_reserved, 0);
      v_available := greatest(0, v_on_hand - v_reserved);
      if v_qty > v_available then
        select name into v_warehouse_name from public.warehouses where id = v_stock_warehouse_id;
        raise exception 'Không đủ tồn khả dụng tại kho "%": vật tư "%"; cần %, tồn thực %, đang giữ %, khả dụng %. Vui lòng xử lý phiếu pending/giữ chỗ trước.',
          coalesce(v_warehouse_name, v_stock_warehouse_id),
          coalesce(v_item_name, v_item_id),
          v_qty,
          v_on_hand,
          v_reserved,
          v_available;
      end if;
    end loop;
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_pending in
      select value
      from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb)) pending(value)
      order by value->>'id'
    loop
      insert into public.items (
        id, sku, name, category, unit, purchase_unit,
        price_in, price_out, min_stock, supplier_id, image_url,
        stock_by_warehouse, location
      )
      values (
        v_pending->>'id',
        v_pending->>'sku',
        v_pending->>'name',
        coalesce(nullif(v_pending->>'category', ''), 'Khác'),
        coalesce(nullif(v_pending->>'unit', ''), 'Cái'),
        nullif(v_pending->>'purchaseUnit', ''),
        coalesce(nullif(v_pending->>'priceIn', '')::numeric, 0),
        coalesce(nullif(v_pending->>'priceOut', '')::numeric, 0),
        coalesce(nullif(v_pending->>'minStock', '')::integer, 0),
        nullif(v_pending->>'supplierId', ''),
        nullif(v_pending->>'imageUrl', ''),
        '{}'::jsonb,
        nullif(v_pending->>'location', '')
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  -- Imports and positive adjustments do not pass through the availability
  -- loop. Acquire every item lock in one canonical order before any mutation;
  -- the locks remain held through the ledger AFTER trigger and transaction end.
  if p_status = 'COMPLETED'::public.transaction_status then
    for v_check in
      select distinct line.value->>'itemId' as item_id
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
      order by item_id
    loop
      v_item_id := nullif(v_check.item_id, '');
      if v_item_id is null then
        raise exception 'invalid transaction item payload';
      end if;

      perform 1
      from public.items
      where id = v_item_id
      for update;
      if not found then
        raise exception 'item not found: %', v_item_id;
      end if;
    end loop;

    for v_line in
      select value
      from jsonb_array_elements(v_tx.items) line(value)
      order by value->>'itemId'
    loop
      v_item_id := v_line->>'itemId';
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
      if v_item_id is null
         or (v_tx.type = 'ADJUSTMENT'::public.transaction_type and v_qty = 0)
         or (v_tx.type <> 'ADJUSTMENT'::public.transaction_type and v_qty <= 0) then
        raise exception 'invalid transaction item payload';
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform app_private.apply_stock_change_internal(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform app_private.apply_stock_change_internal(v_item_id, v_tx.source_warehouse_id, -v_qty);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform app_private.apply_stock_change_internal(v_item_id, v_tx.source_warehouse_id, -v_qty);
        perform app_private.apply_stock_change_internal(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform app_private.apply_stock_change_internal(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  end if;

  v_expected_tx := to_jsonb(v_tx)
    || jsonb_build_object(
      'status', p_status,
      'approver_id', v_user.id
    );
  perform app_private.authorize_wms_write(
    'transaction_status',
    p_transaction_id,
    to_jsonb(v_tx),
    v_expected_tx
  );

  update public.transactions
  set status = p_status,
      approver_id = v_user.id
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$$;

-- Atomic create/resume/complete command used by every client path that needs
-- an immediately posted WMS document. A lost response can be retried with the
-- same id and exact payload without rewriting COMPLETED back to PENDING.
create or replace function public.post_wms_transaction(
  p_transaction jsonb
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_tx public.transactions%rowtype;
  v_id text;
  v_type public.transaction_type;
  v_date timestamptz;
  v_items jsonb;
  v_source_warehouse_id text;
  v_target_warehouse_id text;
  v_supplier_id text;
  v_requester_id uuid;
  v_created_by uuid;
  v_business_partner_id text;
  v_business_partner_name_snapshot text;
  v_note text;
  v_source_type text;
  v_source_id text;
  v_related_request_id text;
  v_pending_items jsonb;
  v_expected_intent jsonb;
  v_actual_intent jsonb;
  v_request_hash text;
  v_existing_source_transaction_id text;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if pg_catalog.jsonb_typeof(p_transaction) <> 'object' then
    raise exception 'WMS posting payload must be a JSON object' using errcode = '22023';
  end if;
  if coalesce(p_transaction->>'status', '') <> 'COMPLETED' then
    raise exception 'post_wms_transaction accepts only COMPLETED intent'
      using errcode = '22023';
  end if;

  v_id := nullif(pg_catalog.btrim(p_transaction->>'id'), '');
  if v_id is null then
    raise exception 'WMS transaction id is required' using errcode = '22023';
  end if;
  v_type := (p_transaction->>'type')::public.transaction_type;
  v_date := (p_transaction->>'date')::timestamptz;
  v_items := coalesce(p_transaction->'items', '[]'::jsonb);
  if pg_catalog.jsonb_typeof(v_items) <> 'array' or pg_catalog.jsonb_array_length(v_items) = 0 then
    raise exception 'WMS transaction items must be a non-empty array' using errcode = '22023';
  end if;

  v_source_warehouse_id := nullif(coalesce(
    p_transaction->>'sourceWarehouseId',
    p_transaction->>'source_warehouse_id'
  ), '');
  v_target_warehouse_id := nullif(coalesce(
    p_transaction->>'targetWarehouseId',
    p_transaction->>'target_warehouse_id'
  ), '');
  v_supplier_id := nullif(coalesce(p_transaction->>'supplierId', p_transaction->>'supplier_id'), '');
  v_requester_id := nullif(coalesce(p_transaction->>'requesterId', p_transaction->>'requester_id'), '')::uuid;
  if v_requester_id is null then
    raise exception 'WMS requester id is required' using errcode = '22023';
  end if;
  v_created_by := v_actor;
  v_business_partner_id := nullif(coalesce(
    p_transaction->>'businessPartnerId',
    p_transaction->>'business_partner_id'
  ), '');
  v_business_partner_name_snapshot := nullif(coalesce(
    p_transaction->>'businessPartnerNameSnapshot',
    p_transaction->>'business_partner_name_snapshot'
  ), '');
  v_note := nullif(p_transaction->>'note', '');
  v_source_type := nullif(coalesce(p_transaction->>'sourceType', p_transaction->>'source_type'), '');
  v_source_id := nullif(coalesce(p_transaction->>'sourceId', p_transaction->>'source_id'), '');
  v_related_request_id := nullif(coalesce(
    p_transaction->>'relatedRequestId',
    p_transaction->>'related_request_id'
  ), '');
  v_pending_items := coalesce(
    p_transaction->'pendingItems',
    p_transaction->'pending_items',
    '[]'::jsonb
  );
  if pg_catalog.jsonb_typeof(v_pending_items) <> 'array' then
    raise exception 'pendingItems must be an array' using errcode = '22023';
  end if;

  v_expected_intent := pg_catalog.jsonb_build_object(
    'id', v_id,
    'type', v_type::text,
    'date', pg_catalog.to_jsonb(v_date),
    'items', v_items,
    'sourceWarehouseId', v_source_warehouse_id,
    'targetWarehouseId', v_target_warehouse_id,
    'supplierId', v_supplier_id,
    'requesterId', v_requester_id,
    'createdBy', v_created_by,
    'businessPartnerId', v_business_partner_id,
    'businessPartnerNameSnapshot', v_business_partner_name_snapshot,
    'note', v_note,
    'sourceType', v_source_type,
    'sourceId', v_source_id,
    'relatedRequestId', v_related_request_id,
    'pendingItems', v_pending_items
  );
  v_request_hash := app_private.sha256_text(v_expected_intent::text);

  if v_source_type is not null and v_source_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wms-source:' || v_source_type || ':' || v_source_id, 0)
    );

    select transaction_row.id
    into v_existing_source_transaction_id
    from public.transactions transaction_row
    where transaction_row.source_type = v_source_type
      and transaction_row.source_id = v_source_id
      and transaction_row.id <> v_id
    order by transaction_row.id
    limit 1
    for update;

    if v_existing_source_transaction_id is not null then
      raise exception 'business source is already posted by transaction %',
        v_existing_source_transaction_id
        using errcode = '23505';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wms-transaction:' || v_id, 0)
  );

  select * into v_tx
  from public.transactions transaction_row
  where transaction_row.id = v_id
  for update;

  if not found then
    if not app_private.transaction_can_insert(
      v_type::text,
      v_requester_id,
      v_actor,
      v_source_warehouse_id,
      v_target_warehouse_id,
      v_related_request_id,
      v_items
    ) then
      raise exception 'insufficient privilege to create WMS transaction'
        using errcode = '42501';
    end if;

    insert into public.transactions (
      id, type, date, items,
      source_warehouse_id, target_warehouse_id, supplier_id,
      requester_id, approver_id, status, note,
      related_request_id, pending_items,
      created_by, updated_by,
      business_partner_id, business_partner_name_snapshot,
      source_type, source_id,
      posting_request_hash, posting_engine_version
    )
    values (
      v_id, v_type, v_date, v_items,
      v_source_warehouse_id, v_target_warehouse_id, v_supplier_id,
      v_requester_id, v_actor, 'PENDING'::public.transaction_status, v_note,
      v_related_request_id, v_pending_items,
      v_created_by, v_actor,
      v_business_partner_id, v_business_partner_name_snapshot,
      v_source_type, v_source_id,
      v_request_hash, 'wf001-a3-v1'
    )
    returning * into v_tx;
  end if;

  v_actual_intent := app_private.wms_transaction_intent(v_tx);
  if v_actual_intent is distinct from v_expected_intent
     or (
       v_tx.posting_request_hash is not null
       and v_tx.posting_request_hash is distinct from v_request_hash
     ) then
    raise exception 'posting request payload does not match existing transaction %', v_id
      using errcode = '22023';
  end if;
  if v_tx.status not in (
    'PENDING'::public.transaction_status,
    'APPROVED'::public.transaction_status,
    'COMPLETED'::public.transaction_status
  ) then
    raise exception 'transaction % cannot be posted from status %', v_id, v_tx.status
      using errcode = '22023';
  end if;

  return public.process_transaction_status(
    v_id,
    'COMPLETED'::public.transaction_status,
    v_actor
  );
end;
$$;

revoke all on function public.post_wms_transaction(jsonb) from public, anon;
grant execute on function public.post_wms_transaction(jsonb) to authenticated;

-- This legacy command previously bypassed process_transaction_status for its
-- PENDING -> CANCELLED transition. Keep its business checks, but route the WMS
-- document transition through the same guarded command.
create or replace function public.cancel_material_issue_order(
  p_order_id uuid,
  p_reason text
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_initial_transaction_id text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Bắt buộc nhập lý do huỷ.'; end if;

  -- Canonical lock order is transaction -> material issue order. The
  -- completion path already takes those rows in that order via its AFTER
  -- trigger; reversing them here creates a cancel-vs-complete deadlock.
  select issue_order.transaction_id
  into v_initial_transaction_id
  from public.material_issue_orders issue_order
  where issue_order.id = p_order_id;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;

  if v_initial_transaction_id is not null then
    perform 1
    from public.transactions transaction_row
    where transaction_row.id = v_initial_transaction_id
    for update;
    if not found then
      raise exception 'Không tìm thấy phiếu kho liên kết: %', v_initial_transaction_id;
    end if;
  end if;

  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.transaction_id is distinct from v_initial_transaction_id then
    raise exception 'transaction changed while cancellation was acquiring canonical locks'
      using errcode = '40001';
  end if;
  if v_order.status not in ('draft', 'submitted', 'wms_pending') then
    raise exception 'Phiếu đã phát sinh xuất kho hoặc quyết toán, không thể huỷ trực tiếp.';
  end if;
  if not (public.is_admin() or public.is_module_admin('WMS') or v_order.created_by = v_actor) then
    raise exception 'Bạn không có quyền huỷ phiếu này.';
  end if;
  if v_order.transaction_id is not null then
    perform public.process_transaction_status(
      v_order.transaction_id,
      'CANCELLED'::public.transaction_status,
      v_actor
    );
  end if;
  update public.material_issue_orders
  set status = 'cancelled',
      cancelled_by = v_actor,
      cancelled_at = now(),
      cancel_reason = trim(p_reason)
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

revoke all on function public.process_transaction_status(text, public.transaction_status, uuid)
  from public, anon;
grant execute on function public.process_transaction_status(text, public.transaction_status, uuid)
  to authenticated;

-- Triggers must continue to fire for replication-role sessions used by
-- privileged integrations; RLS bypass must never become a posting bypass.
alter table public.transactions enable always trigger trg_guard_wms_transaction_write;
alter table public.items enable always trigger trg_guard_item_stock_cache_insert;
alter table public.items enable always trigger trg_guard_item_stock_cache_update;
alter table public.inventory_transactions enable always trigger trg_guard_inventory_transaction_immutable;
alter table public.inventory_ledger_entries enable always trigger trg_guard_inventory_ledger_entry_immutable;

reset statement_timeout;
reset lock_timeout;

notify pgrst, 'reload schema';
