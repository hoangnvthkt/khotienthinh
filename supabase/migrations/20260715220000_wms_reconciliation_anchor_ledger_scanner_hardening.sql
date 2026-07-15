-- Release B2b review closure: immutable candidates, fail-closed provenance and
-- operator-attested WF-001 exposure. This is forward-only; prior migrations are
-- intentionally left unchanged.

set lock_timeout = '5s';
set statement_timeout = '120s';

create table app_private.wms_reconciliation_frozen_sources (
  run_id uuid not null references public.wms_reconciliation_runs(id) on delete cascade,
  phase text not null check (phase in (
    'manifest', 'physical_anchor', 'opening_balance', 'transaction_ledger'
  )),
  source_key text not null,
  sort_at timestamptz not null,
  sort_id text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (run_id, phase, source_key),
  check (pg_catalog.btrim(source_key) <> ''),
  check (pg_catalog.jsonb_typeof(payload) = 'object')
);

create index wms_reconciliation_frozen_sources_scan_idx
  on app_private.wms_reconciliation_frozen_sources(
    run_id, phase, sort_at, sort_id
  );

revoke all privileges on table app_private.wms_reconciliation_frozen_sources
  from public, anon, authenticated, service_role;

create table app_private.wms_reconciliation_wf001_exposure_windows (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  effective_from timestamptz not null,
  effective_to timestamptz not null,
  posting_engine_version text,
  legacy_function_hash text not null check (legacy_function_hash ~ '^[0-9a-f]{64}$'),
  deployment_evidence_hash text not null check (deployment_evidence_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  reason text not null check (pg_catalog.btrim(reason) <> ''),
  configured_by uuid references public.users(id) on delete restrict,
  configured_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (posting_engine_version is null or pg_catalog.btrim(posting_engine_version) <> ''),
  check (effective_from < effective_to),
  unique (posting_engine_version, effective_from, effective_to, legacy_function_hash)
);

create index wms_reconciliation_wf001_exposure_active_idx
  on app_private.wms_reconciliation_wf001_exposure_windows(
    posting_engine_version, effective_from, effective_to
  ) where status = 'active';

revoke all privileges on table app_private.wms_reconciliation_wf001_exposure_windows
  from public, anon, authenticated, service_role;

comment on table app_private.wms_reconciliation_wf001_exposure_windows is
  'Operator-owned deployment evidence. A decimal rounding fingerprint is high confidence only when completion and posting evidence match one active window, its engine version, and its legacy function fingerprint.';

create or replace function app_private.try_wms_reconciliation_numeric_20_6(
  p_value text
)
returns numeric
language plpgsql
immutable
parallel safe
security invoker
set search_path = ''
as $$
declare
  v_value text := pg_catalog.btrim(p_value);
  v_result numeric(20,6);
begin
  -- Canonical input only. Reject exponent notation before casting so hostile
  -- exponents cannot request unbounded numeric allocation.
  if v_value is null
     or pg_catalog.length(v_value) > 23
     or v_value !~ '^[+-]?(0|[0-9]{1,14})([.][0-9]{1,6})?$' then
    return null;
  end if;
  begin
    v_result := v_value::numeric(20,6);
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return null;
  end;
  return v_result;
end;
$$;

revoke all on function app_private.try_wms_reconciliation_numeric_20_6(text)
  from public, anon, authenticated, service_role;

-- Canonical evidence for the only reviewed legacy WF-001 implementation:
-- commit 754e171, migration 20260713005814_phase4_erp_permission_surface.sql,
-- pg_get_functiondef body SHA-256 f72ca3318bf40b8367db3f308b598c3a0375f00d66e38bce0009c8e2bf4d8fe2.
create or replace function app_private.wms_reconciliation_known_wf001_legacy_function_hash()
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select '036fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc'::text;
$$;

revoke all on function app_private.wms_reconciliation_known_wf001_legacy_function_hash()
  from public, anon, authenticated, service_role;

-- Validate only the two immutable JSON values supplied by the freezer.  This
-- function deliberately has no relation access: callers can hash its complete
-- definition and safely replay it against a frozen run.
create or replace function app_private.validate_wms_reconciliation_frozen_transaction(
  p_transaction jsonb,
  p_frozen_ledger jsonb
)
returns jsonb
language plpgsql
immutable
parallel safe
security invoker
set search_path = ''
as $$
declare
  v_line record;
  v_type text := p_transaction ->> 'type';
  v_quantity numeric;
  v_rounded_quantity numeric;
  v_entry_no integer := 0;
  v_direction text;
  v_entry_type text;
  v_receipt_direction text;
  v_receipt_entry_type text;
  v_warehouse_id text;
  v_source_line_id text;
  v_unit text;
  v_expected_entries jsonb := '[]'::jsonb;
  v_actual_entries jsonb := '[]'::jsonb;
  v_expected_metadata jsonb;
  v_expected_header_type text;
  v_expected_header_metadata jsonb;
  v_header jsonb;
  v_source_valid boolean;
  v_header_exists boolean;
  v_header_valid boolean;
  v_entry_identity_valid boolean;
  v_quantity_exact boolean;
  v_quantity_rounded boolean;
begin
  -- Zero quantities are valid non-movements.  Non-adjustment movements must
  -- be positive; ADJUSTMENT deliberately accepts either non-zero sign.
  v_source_valid := pg_catalog.jsonb_typeof(p_transaction) = 'object'
    and p_transaction ->> 'status' = 'COMPLETED'
    and v_type in ('IMPORT', 'EXPORT', 'TRANSFER', 'LIQUIDATION', 'ADJUSTMENT')
    and nullif(p_transaction ->> 'id', '') is not null
    and nullif(p_transaction ->> 'date', '') is not null
    and pg_catalog.jsonb_typeof(p_transaction -> 'items') = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_transaction -> 'items') line(value)
      cross join lateral (
        select app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'quantity')
      ) parsed(quantity)
      where pg_catalog.jsonb_typeof(line.value) <> 'object'
         or nullif(line.value ->> 'itemId', '') is null
         or nullif(coalesce(line.value ->> 'unitSnapshot', line.value ->> 'unit'), '') is null
         or parsed.quantity is null
         or case v_type
              when 'IMPORT' then parsed.quantity < 0
                or (parsed.quantity <> 0 and nullif(p_transaction ->> 'target_warehouse_id', '') is null)
              when 'EXPORT' then parsed.quantity < 0
                or (parsed.quantity <> 0 and nullif(p_transaction ->> 'source_warehouse_id', '') is null)
              when 'LIQUIDATION' then parsed.quantity < 0
                or (parsed.quantity <> 0 and nullif(p_transaction ->> 'source_warehouse_id', '') is null)
              when 'TRANSFER' then parsed.quantity < 0
                or (parsed.quantity <> 0 and (
                  nullif(p_transaction ->> 'source_warehouse_id', '') is null
                  or nullif(p_transaction ->> 'target_warehouse_id', '') is null
                ))
              when 'ADJUSTMENT' then parsed.quantity is null
                or (parsed.quantity <> 0 and nullif(coalesce(
                  p_transaction ->> 'target_warehouse_id',
                  p_transaction ->> 'source_warehouse_id'
                ), '') is null)
              else true
            end
    );

  if v_source_valid then
    for v_line in
      select line.value, line.ordinality
      from pg_catalog.jsonb_array_elements(p_transaction -> 'items')
        with ordinality line(value, ordinality)
    loop
      v_quantity := app_private.try_wms_reconciliation_numeric_20_6(v_line.value ->> 'quantity');
      if v_quantity = 0 then
        continue;
      end if;
      v_rounded_quantity := case
        when v_quantity between -2147483648::numeric and 2147483647::numeric
          then (v_quantity::integer)::numeric
        else null
      end;
      v_source_line_id := nullif(coalesce(
        v_line.value ->> 'requestLineId',
        v_line.value ->> 'materialIssueLineId',
        v_line.value ->> 'lineId'
      ), '');
      v_unit := coalesce(v_line.value ->> 'unitSnapshot', v_line.value ->> 'unit');
      v_expected_metadata := v_line.value;

      if v_type = 'TRANSFER' then
        v_entry_type := 'transfer_issue';
        v_direction := 'out';
        v_receipt_entry_type := 'transfer_receipt';
        v_receipt_direction := 'in';
        v_entry_no := v_entry_no + 1;
        v_expected_entries := v_expected_entries || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'entryNo', v_entry_no, 'itemId', v_line.value ->> 'itemId',
            'warehouseId', p_transaction ->> 'source_warehouse_id',
            'transactionType', v_entry_type, 'direction', v_direction,
            'transactionDate', p_transaction ->> 'date',
            'sourceType', 'wms_transaction', 'sourceId', p_transaction ->> 'id',
            'sourceCode', p_transaction ->> 'id', 'sourceLineId', v_source_line_id,
            'unit', v_unit, 'metadata', v_expected_metadata,
            'quantityIn', 0, 'quantityOut', pg_catalog.abs(v_quantity),
            'quantityDelta', -pg_catalog.abs(v_quantity),
            'roundedQuantityIn', 0,
            'roundedQuantityOut', pg_catalog.abs(v_rounded_quantity),
            'roundedQuantityDelta', -pg_catalog.abs(v_rounded_quantity)
          )
        );
        v_entry_no := v_entry_no + 1;
        v_expected_entries := v_expected_entries || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'entryNo', v_entry_no, 'itemId', v_line.value ->> 'itemId',
            'warehouseId', p_transaction ->> 'target_warehouse_id',
            'transactionType', v_receipt_entry_type, 'direction', v_receipt_direction,
            'transactionDate', p_transaction ->> 'date',
            'sourceType', 'wms_transaction', 'sourceId', p_transaction ->> 'id',
            'sourceCode', p_transaction ->> 'id', 'sourceLineId', v_source_line_id,
            'unit', v_unit, 'metadata', v_expected_metadata,
            'quantityIn', pg_catalog.abs(v_quantity), 'quantityOut', 0,
            'quantityDelta', pg_catalog.abs(v_quantity),
            'roundedQuantityIn', pg_catalog.abs(v_rounded_quantity),
            'roundedQuantityOut', 0,
            'roundedQuantityDelta', pg_catalog.abs(v_rounded_quantity)
          )
        );
      elsif v_type = 'ADJUSTMENT' and v_quantity <> 0 then
        v_entry_no := v_entry_no + 1;
        v_direction := case when v_quantity > 0 then 'in' else 'out' end;
        v_entry_type := case when v_quantity > 0 then 'adjustment_in' else 'adjustment_out' end;
        v_warehouse_id := coalesce(
          p_transaction ->> 'target_warehouse_id', p_transaction ->> 'source_warehouse_id'
        );
        v_expected_entries := v_expected_entries || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'entryNo', v_entry_no, 'itemId', v_line.value ->> 'itemId',
            'warehouseId', v_warehouse_id, 'direction', v_direction,
            'transactionType', v_entry_type, 'transactionDate', p_transaction ->> 'date',
            'sourceType', 'wms_transaction', 'sourceId', p_transaction ->> 'id',
            'sourceCode', p_transaction ->> 'id', 'sourceLineId', v_source_line_id,
            'unit', v_unit, 'metadata', v_expected_metadata,
            'quantityIn', case when v_direction = 'in' then pg_catalog.abs(v_quantity) else 0 end,
            'quantityOut', case when v_direction = 'out' then pg_catalog.abs(v_quantity) else 0 end,
            'quantityDelta', case when v_direction = 'in' then pg_catalog.abs(v_quantity) else -pg_catalog.abs(v_quantity) end,
            'roundedQuantityIn', case when v_direction = 'in' then pg_catalog.abs(v_rounded_quantity) else 0 end,
            'roundedQuantityOut', case when v_direction = 'out' then pg_catalog.abs(v_rounded_quantity) else 0 end,
            'roundedQuantityDelta', case when v_direction = 'in' then pg_catalog.abs(v_rounded_quantity) else -pg_catalog.abs(v_rounded_quantity) end
          )
        );
      else
        if v_type = 'IMPORT' then
          v_entry_type := 'purchase_receipt';
          v_direction := 'in';
          v_warehouse_id := p_transaction ->> 'target_warehouse_id';
        elsif v_type = 'EXPORT' then
          v_entry_type := 'project_issue';
          v_direction := 'out';
          v_warehouse_id := p_transaction ->> 'source_warehouse_id';
        elsif v_type = 'LIQUIDATION' then
          v_entry_type := 'loss_issue';
          v_direction := 'out';
          v_warehouse_id := p_transaction ->> 'source_warehouse_id';
        end if;
        v_entry_no := v_entry_no + 1;
        v_expected_entries := v_expected_entries || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'entryNo', v_entry_no, 'itemId', v_line.value ->> 'itemId',
            'warehouseId', v_warehouse_id, 'direction', v_direction,
            'transactionType', v_entry_type, 'transactionDate', p_transaction ->> 'date',
            'sourceType', 'wms_transaction', 'sourceId', p_transaction ->> 'id',
            'sourceCode', p_transaction ->> 'id', 'sourceLineId', v_source_line_id,
            'unit', v_unit, 'metadata', v_expected_metadata,
            'quantityIn', case when v_direction = 'in' then pg_catalog.abs(v_quantity) else 0 end,
            'quantityOut', case when v_direction = 'out' then pg_catalog.abs(v_quantity) else 0 end,
            'quantityDelta', case when v_direction = 'in' then pg_catalog.abs(v_quantity) else -pg_catalog.abs(v_quantity) end,
            'roundedQuantityIn', case when v_direction = 'in' then pg_catalog.abs(v_rounded_quantity) else 0 end,
            'roundedQuantityOut', case when v_direction = 'out' then pg_catalog.abs(v_rounded_quantity) else 0 end,
            'roundedQuantityDelta', case when v_direction = 'in' then pg_catalog.abs(v_rounded_quantity) else -pg_catalog.abs(v_rounded_quantity) end
          )
        );
      end if;
    end loop;
  end if;

  select coalesce(pg_catalog.jsonb_agg(entry.value order by
    (entry.value ->> 'entry_no')::integer, entry.value ->> 'id'), '[]'::jsonb)
  into v_actual_entries
  from pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(p_frozen_ledger) = 'array'
      then p_frozen_ledger else '[]'::jsonb end
  ) header(value)
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(header.value -> 'ledgerEntries') = 'array'
      then header.value -> 'ledgerEntries' else '[]'::jsonb end
  ) entry(value);

  v_header_exists := pg_catalog.jsonb_typeof(p_frozen_ledger) = 'array'
    and pg_catalog.jsonb_array_length(p_frozen_ledger) > 0;
  v_header := case when v_header_exists then p_frozen_ledger #> '{0,header}' else null end;
  v_expected_header_type := case v_type
    when 'IMPORT' then 'purchase_receipt'
    when 'EXPORT' then 'project_issue'
    when 'LIQUIDATION' then 'loss_issue'
    when 'TRANSFER' then 'transfer_receipt'
    when 'ADJUSTMENT' then case
      when exists (
        select 1 from pg_catalog.jsonb_array_elements(v_expected_entries) expected(value)
        where expected.value ->> 'direction' = 'out'
      ) and not exists (
        select 1 from pg_catalog.jsonb_array_elements(v_expected_entries) expected(value)
        where expected.value ->> 'direction' = 'in'
      ) then 'adjustment_out' else 'adjustment_in' end
  end;
  v_expected_header_metadata := pg_catalog.jsonb_build_object(
    'wmsTransactionId', p_transaction ->> 'id',
    'wmsType', v_type,
    'wmsStatus', p_transaction ->> 'status',
    'sourceWarehouseId', p_transaction -> 'source_warehouse_id',
    'targetWarehouseId', p_transaction -> 'target_warehouse_id',
    'supplierId', p_transaction -> 'supplier_id',
    'items', p_transaction -> 'items'
  );
  v_header_valid := case
    when pg_catalog.jsonb_array_length(v_expected_entries) = 0 then
      not v_header_exists and pg_catalog.jsonb_array_length(v_actual_entries) = 0
    else
      pg_catalog.jsonb_array_length(p_frozen_ledger) = 1
      and pg_catalog.jsonb_typeof(v_header) = 'object'
      and nullif(v_header ->> 'code', '') is not null
      and v_header ->> 'transaction_type' is not distinct from v_expected_header_type
      and v_header ->> 'status' is not distinct from 'posted'
      and v_header ->> 'transaction_date' is not distinct from p_transaction ->> 'date'
      and v_header ->> 'source_type' is not distinct from 'wms_transaction'
      and v_header ->> 'source_id' is not distinct from p_transaction ->> 'id'
      and v_header ->> 'source_code' is not distinct from p_transaction ->> 'id'
      and v_header -> 'metadata' is not distinct from v_expected_header_metadata
  end;

  -- FULL JOIN by entry_no plus direct field comparisons makes this a true
  -- bijection; aggregate-equal but identity-corrupt ledgers cannot pass.
  v_entry_identity_valid := not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_expected_entries) expected(value)
    full outer join pg_catalog.jsonb_array_elements(v_actual_entries) actual(value)
      on expected.value ->> 'entryNo' = actual.value ->> 'entry_no'
    where expected.value is null
       or actual.value is null
       or expected.value ->> 'entryNo' is distinct from actual.value ->> 'entry_no'
       or expected.value ->> 'itemId' is distinct from actual.value ->> 'material_id'
       or expected.value ->> 'warehouseId' is distinct from actual.value ->> 'warehouse_id'
       or expected.value ->> 'direction' is distinct from actual.value ->> 'movement_direction'
       or expected.value ->> 'transactionType' is distinct from actual.value ->> 'transaction_type'
       or expected.value ->> 'transactionDate' is distinct from actual.value ->> 'transaction_date'
       or expected.value ->> 'sourceType' is distinct from actual.value ->> 'source_type'
       or expected.value ->> 'sourceId' is distinct from actual.value ->> 'source_id'
       or expected.value ->> 'sourceCode' is distinct from actual.value ->> 'source_code'
       or expected.value ->> 'sourceLineId' is distinct from actual.value ->> 'source_line_id'
       or expected.value ->> 'unit' is distinct from actual.value ->> 'unit'
       or expected.value -> 'metadata' is distinct from actual.value -> 'metadata'
    union all
    select 1
    where pg_catalog.jsonb_array_length(v_expected_entries) <>
      pg_catalog.jsonb_array_length(v_actual_entries)
  );

  v_quantity_exact := not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_expected_entries) expected(value)
    full outer join pg_catalog.jsonb_array_elements(v_actual_entries) actual(value)
      on expected.value ->> 'entryNo' = actual.value ->> 'entry_no'
    where expected.value is null or actual.value is null
       or app_private.try_wms_reconciliation_numeric_20_6(expected.value ->> 'quantityIn')
          is distinct from app_private.try_wms_reconciliation_numeric_20_6(actual.value ->> 'quantity_in')
       or app_private.try_wms_reconciliation_numeric_20_6(expected.value ->> 'quantityOut')
          is distinct from app_private.try_wms_reconciliation_numeric_20_6(actual.value ->> 'quantity_out')
       or app_private.try_wms_reconciliation_numeric_20_6(expected.value ->> 'quantityDelta')
          is distinct from app_private.try_wms_reconciliation_numeric_20_6(actual.value ->> 'quantity_delta')
  );
  v_quantity_rounded := not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_expected_entries) expected(value)
    full outer join pg_catalog.jsonb_array_elements(v_actual_entries) actual(value)
      on expected.value ->> 'entryNo' = actual.value ->> 'entry_no'
    where expected.value is null or actual.value is null
       or expected.value -> 'roundedQuantityIn' = 'null'::jsonb
       or expected.value -> 'roundedQuantityOut' = 'null'::jsonb
       or expected.value -> 'roundedQuantityDelta' = 'null'::jsonb
       or app_private.try_wms_reconciliation_numeric_20_6(expected.value ->> 'roundedQuantityIn')
          is distinct from app_private.try_wms_reconciliation_numeric_20_6(actual.value ->> 'quantity_in')
       or app_private.try_wms_reconciliation_numeric_20_6(expected.value ->> 'roundedQuantityOut')
          is distinct from app_private.try_wms_reconciliation_numeric_20_6(actual.value ->> 'quantity_out')
       or app_private.try_wms_reconciliation_numeric_20_6(expected.value ->> 'roundedQuantityDelta')
          is distinct from app_private.try_wms_reconciliation_numeric_20_6(actual.value ->> 'quantity_delta')
  );

  return pg_catalog.jsonb_build_object(
    'expectedEntries', v_expected_entries,
    'actualEntries', v_actual_entries,
    'headerSnapshot', v_header,
    'entrySnapshots', v_actual_entries,
    'sourceValid', v_source_valid,
    'headerExists', v_header_exists,
    'headerValid', v_header_valid,
    'entryIdentityValid', v_entry_identity_valid,
    'quantityExact', v_quantity_exact,
    'quantityRounded', v_quantity_rounded
  );
end;
$$;

revoke all on function app_private.validate_wms_reconciliation_frozen_transaction(jsonb,jsonb)
  from public, anon, authenticated, service_role;

create or replace function app_private.reject_wms_reconciliation_frozen_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'WMS reconciliation frozen source evidence is immutable'
      using errcode = '55000';
  end if;
  -- Permit the FK cascade only after the parent is no longer visible.
  if exists (
    select 1 from public.wms_reconciliation_runs run where run.id = old.run_id
  ) then
    raise exception 'WMS reconciliation frozen source evidence cannot be deleted'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

revoke all on function app_private.reject_wms_reconciliation_frozen_source_mutation()
  from public, anon, authenticated, service_role;

create trigger trg_reject_wms_reconciliation_frozen_source_mutation
before update or delete on app_private.wms_reconciliation_frozen_sources
for each row execute function app_private.reject_wms_reconciliation_frozen_source_mutation();

create or replace function app_private.freeze_wms_reconciliation_run_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
begin
  -- A single INSERT ... UNION ALL statement gives manifest, audit, opening and
  -- completed-transaction candidates one READ COMMITTED statement snapshot.
  insert into app_private.wms_reconciliation_frozen_sources (
    run_id, phase, source_key, sort_at, sort_id, source_hash, payload
  )
  with scoped_physical as (
    select
      audit.id,
      audit.date as sort_at,
      pg_catalog.jsonb_build_object(
        'source', pg_catalog.to_jsonb(audit),
        'warehouseExists', exists (
          select 1 from public.warehouses warehouse
          where warehouse.id = audit."warehouseId"
        ),
        'commandResult', (
          select pg_catalog.to_jsonb(command_result)
          from app_private.inventory_audit_command_results command_result
          where command_result.command_id = audit.command_id
        ),
        'stockTransaction', (
          select pg_catalog.to_jsonb(transaction_row)
          from public.transactions transaction_row
          where transaction_row.id = audit."transactionId"
        ),
        'transactionItems', (
          select transaction_row.items
          from public.transactions transaction_row
          where transaction_row.id = audit."transactionId"
        ),
        'ledgerHeaders', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'header', pg_catalog.to_jsonb(header),
              'ledgerEntries', coalesce((
                select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(entry) order by entry.created_at, entry.id)
                from public.inventory_ledger_entries entry
                where entry.inventory_transaction_id = header.id
              ), '[]'::jsonb)
            ) order by header.created_at, header.id
          )
          from public.inventory_transactions header
          where header.source_type = 'wms_transaction'
            and header.source_id = audit."transactionId"
        ), '[]'::jsonb),
        'catalogItems', coalesce((
          select pg_catalog.jsonb_object_agg(item.id, pg_catalog.to_jsonb(item) order by item.id)
          from public.items item
          where exists (
            select 1 from pg_catalog.jsonb_array_elements(
              case when pg_catalog.jsonb_typeof(audit.items) = 'array' then audit.items else '[]'::jsonb end
            ) line(value)
            where line.value ->> 'itemId' = item.id
          )
        ), '{}'::jsonb)
      ) as payload
    from public.audit_sessions audit
    where audit.date is not null
      and audit.date <= new.as_of
      and (new.affected_from is null or audit.date >= new.affected_from)
      and (
        new.scope -> 'warehouseIds' = '["*"]'::jsonb
        or (new.scope -> 'warehouseIds') ? audit."warehouseId"
      )
      and (
        pg_catalog.jsonb_array_length(new.scope -> 'sourceTypes') = 0
        or (new.scope -> 'sourceTypes') ? 'physical_anchor'
        or (new.scope -> 'sourceTypes') ? 'inventory_audit'
      )
      and (
        pg_catalog.jsonb_array_length(new.scope -> 'itemIds') = 0
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(audit.items) = 'array' then audit.items else '[]'::jsonb end
          ) line(value)
          where (new.scope -> 'itemIds') ? (line.value ->> 'itemId')
        )
      )
  ), scoped_opening as (
    select
      opening.id,
      opening.as_of_date::timestamptz as sort_at,
      pg_catalog.jsonb_build_object(
        'source', pg_catalog.to_jsonb(opening),
        'lines', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(line) order by line.created_at, line.id)
          from public.project_opening_balance_lines line
          where line.opening_balance_id = opening.id
        ), '[]'::jsonb),
        'commandResult', (
          select pg_catalog.to_jsonb(command_result)
          from app_private.project_opening_command_results command_result
          where command_result.opening_balance_id = opening.id
        ),
        'reversalResult', (
          select pg_catalog.to_jsonb(reversal_result)
          from app_private.project_opening_reversal_results reversal_result
          where reversal_result.opening_balance_id = opening.id
        ),
        'originalStockTransactions', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(transaction_row) order by transaction_row.id)
          from public.transactions transaction_row
          where opening.stock_transaction_ids ? transaction_row.id
        ), '[]'::jsonb),
        'reversalStockTransactions', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(transaction_row) order by transaction_row.id)
          from public.transactions transaction_row
          where opening.reversal_stock_transaction_ids ? transaction_row.id
        ), '[]'::jsonb),
        'originalTransactionItems', coalesce((
          select pg_catalog.jsonb_object_agg(transaction_row.id, transaction_row.items order by transaction_row.id)
          from public.transactions transaction_row
          where opening.stock_transaction_ids ? transaction_row.id
        ), '{}'::jsonb),
        'reversalTransactionItems', coalesce((
          select pg_catalog.jsonb_object_agg(transaction_row.id, transaction_row.items order by transaction_row.id)
          from public.transactions transaction_row
          where opening.reversal_stock_transaction_ids ? transaction_row.id
        ), '{}'::jsonb),
        'originalLedgerHeaders', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'header', pg_catalog.to_jsonb(header),
              'ledgerEntries', coalesce((
                select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(entry) order by entry.created_at, entry.id)
                from public.inventory_ledger_entries entry
                where entry.inventory_transaction_id = header.id
              ), '[]'::jsonb)
            ) order by header.created_at, header.id
          )
          from public.inventory_transactions header
          where header.source_type = 'wms_transaction'
            and opening.stock_transaction_ids ? header.source_id
        ), '[]'::jsonb),
        'reversalLedgerHeaders', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'header', pg_catalog.to_jsonb(header),
              'ledgerEntries', coalesce((
                select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(entry) order by entry.created_at, entry.id)
                from public.inventory_ledger_entries entry
                where entry.inventory_transaction_id = header.id
              ), '[]'::jsonb)
            ) order by header.created_at, header.id
          )
          from public.inventory_transactions header
          where header.source_type = 'wms_transaction'
            and opening.reversal_stock_transaction_ids ? header.source_id
        ), '[]'::jsonb),
        'stockTransactions', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(transaction_row) order by transaction_row.id)
          from public.transactions transaction_row
          where opening.stock_transaction_ids ? transaction_row.id
             or coalesce(opening.reversal_stock_transaction_ids, '[]'::jsonb) ? transaction_row.id
        ), '[]'::jsonb),
        'transactionItems', coalesce((
          select pg_catalog.jsonb_object_agg(transaction_row.id, transaction_row.items order by transaction_row.id)
          from public.transactions transaction_row
          where opening.stock_transaction_ids ? transaction_row.id
             or coalesce(opening.reversal_stock_transaction_ids, '[]'::jsonb) ? transaction_row.id
        ), '{}'::jsonb),
        'ledgerHeaders', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'header', pg_catalog.to_jsonb(header),
              'ledgerEntries', coalesce((
                select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(entry) order by entry.created_at, entry.id)
                from public.inventory_ledger_entries entry
                where entry.inventory_transaction_id = header.id
              ), '[]'::jsonb)
            ) order by header.created_at, header.id
          )
          from public.inventory_transactions header
          where header.source_type = 'wms_transaction'
            and (
              opening.stock_transaction_ids ? header.source_id
              or coalesce(opening.reversal_stock_transaction_ids, '[]'::jsonb) ? header.source_id
            )
        ), '[]'::jsonb),
        'catalogItems', coalesce((
          select pg_catalog.jsonb_object_agg(item.id, pg_catalog.to_jsonb(item) order by item.id)
          from public.items item
          where exists (
            select 1 from public.project_opening_balance_lines line
            where line.opening_balance_id = opening.id
              and line.inventory_item_id = item.id
          )
        ), '{}'::jsonb),
        'warehouseIds', coalesce((
          select pg_catalog.jsonb_agg(distinct line.warehouse_id order by line.warehouse_id)
          from public.project_opening_balance_lines line
          where line.opening_balance_id = opening.id
        ), '[]'::jsonb),
        'missingWarehouses', coalesce((
          select pg_catalog.jsonb_agg(distinct line.warehouse_id order by line.warehouse_id)
          from public.project_opening_balance_lines line
          where line.opening_balance_id = opening.id
            and not exists (
              select 1 from public.warehouses warehouse where warehouse.id = line.warehouse_id
            )
        ), '[]'::jsonb)
      ) as payload
    from public.project_opening_balances opening
    where opening.as_of_date <= new.as_of::date
      and (new.affected_from is null or opening.as_of_date >= new.affected_from::date)
      and opening.status in ('locked', 'void')
      and (
        pg_catalog.jsonb_array_length(new.scope -> 'sourceTypes') = 0
        or (new.scope -> 'sourceTypes') ? 'opening_balance'
        or (new.scope -> 'sourceTypes') ? 'project_opening_balance'
      )
      and exists (
        select 1 from public.project_opening_balance_lines line
        where line.opening_balance_id = opening.id
          and (
            new.scope -> 'warehouseIds' = '["*"]'::jsonb
            or (new.scope -> 'warehouseIds') ? line.warehouse_id
          )
          and (
            pg_catalog.jsonb_array_length(new.scope -> 'itemIds') = 0
            or (new.scope -> 'itemIds') ? line.inventory_item_id
          )
      )
  ), scoped_transactions as (
    select
      transaction_row.id,
      transaction_row.date as sort_at,
      pg_catalog.jsonb_build_object(
        'transaction', pg_catalog.to_jsonb(transaction_row),
        'warehouseExistence', pg_catalog.jsonb_build_object(
          'source', case when transaction_row.source_warehouse_id is null then null else exists (
            select 1 from public.warehouses warehouse where warehouse.id = transaction_row.source_warehouse_id
          ) end,
          'target', case when transaction_row.target_warehouse_id is null then null else exists (
            select 1 from public.warehouses warehouse where warehouse.id = transaction_row.target_warehouse_id
          ) end
        ),
        'ledgerHeaders', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'header', pg_catalog.to_jsonb(header),
              'ledgerEntries', coalesce((
                select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(entry) order by entry.created_at, entry.id)
                from public.inventory_ledger_entries entry
                where entry.inventory_transaction_id = header.id
              ), '[]'::jsonb)
            ) order by header.created_at, header.id
          )
          from public.inventory_transactions header
          where header.source_type = 'wms_transaction'
            and header.source_id = transaction_row.id
        ), '[]'::jsonb),
        'catalogItems', coalesce((
          select pg_catalog.jsonb_object_agg(item.id, pg_catalog.to_jsonb(item) order by item.id)
          from public.items item
          where exists (
            select 1 from pg_catalog.jsonb_array_elements(
              case when pg_catalog.jsonb_typeof(transaction_row.items) = 'array' then transaction_row.items else '[]'::jsonb end
            ) line(value)
            where line.value ->> 'itemId' = item.id
          )
        ), '{}'::jsonb),
        'exposureWindows', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', exposure.id,
            'effectiveFrom', exposure.effective_from,
            'effectiveTo', exposure.effective_to,
            'postingEngineVersion', exposure.posting_engine_version,
            'legacyFunctionHash', exposure.legacy_function_hash,
            'deploymentEvidenceHash', exposure.deployment_evidence_hash
          ) order by exposure.effective_from, exposure.id)
          from app_private.wms_reconciliation_wf001_exposure_windows exposure
          where exposure.status = 'active'
            and transaction_row.posting_engine_version is not distinct from exposure.posting_engine_version
            and exists (
              select 1 from public.inventory_transactions header
              where header.source_type = 'wms_transaction'
                and header.source_id = transaction_row.id
                and header.status = 'posted'
                and header.posted_at >= exposure.effective_from
                and header.posted_at < exposure.effective_to
            )
        ), '[]'::jsonb)
        , 'postingFunctionFingerprint', app_private.wms_reconciliation_known_wf001_legacy_function_hash()
      ) as payload
    from public.transactions transaction_row
    where transaction_row.status::text = 'COMPLETED'
      and transaction_row.type::text in ('IMPORT','EXPORT','TRANSFER','LIQUIDATION','ADJUSTMENT')
      and transaction_row.date <= new.as_of
      and (new.affected_from is null or transaction_row.date >= new.affected_from)
      and (
        pg_catalog.jsonb_array_length(new.scope -> 'sourceTypes') = 0
        or (new.scope -> 'sourceTypes') ? 'wms_transaction'
        or (new.scope -> 'sourceTypes') ? pg_catalog.lower(transaction_row.type::text)
      )
      and (
        new.scope -> 'warehouseIds' = '["*"]'::jsonb
        or (new.scope -> 'warehouseIds') ? transaction_row.source_warehouse_id
        or (new.scope -> 'warehouseIds') ? transaction_row.target_warehouse_id
      )
      and (
        pg_catalog.jsonb_array_length(new.scope -> 'itemIds') = 0
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(transaction_row.items) = 'array' then transaction_row.items else '[]'::jsonb end
          ) line(value)
          where (new.scope -> 'itemIds') ? (line.value ->> 'itemId')
        )
      )
  ), frozen as (
    select
      new.id as run_id,
      'manifest'::text as phase,
      'b2b-v2'::text as source_key,
      new.created_at as sort_at,
      'b2b-v2'::text as sort_id,
      pg_catalog.jsonb_build_object(
        'snapshotVersion', 'b2b-v2',
        'functionHashes', new.source_snapshot -> 'functionHashes',
        'canonicalWf001LegacyFunctionHash', app_private.wms_reconciliation_known_wf001_legacy_function_hash(),
        'knownWf001HelperDefinitionHash', app_private.wms_reconciliation_function_hash(
          'app_private.wms_reconciliation_known_wf001_legacy_function_hash()'::regprocedure
        ),
        'frozenTransactionValidatorDefinitionHash', app_private.wms_reconciliation_function_hash(
          'app_private.validate_wms_reconciliation_frozen_transaction(jsonb,jsonb)'::regprocedure
        ),
        'schemaHash', new.schema_hash,
        'scopeHash', new.scope_hash
      ) as payload
    union all
    select new.id, 'physical_anchor', physical.id, physical.sort_at, physical.id, physical.payload
    from scoped_physical physical
    union all
    select new.id, 'opening_balance', opening.id::text, opening.sort_at, opening.id::text, opening.payload
    from scoped_opening opening
    union all
    select new.id, 'transaction_ledger', transaction_row.id, transaction_row.sort_at, transaction_row.id, transaction_row.payload
    from scoped_transactions transaction_row
  )
  select
    frozen.run_id,
    frozen.phase,
    frozen.source_key,
    frozen.sort_at,
    frozen.sort_id,
    app_private.sha256_text(frozen.payload::text),
    frozen.payload
  from frozen;

  return new;
end;
$$;

revoke all on function app_private.freeze_wms_reconciliation_run_sources()
  from public, anon, authenticated, service_role;

create trigger trg_freeze_wms_reconciliation_run_sources
after insert on public.wms_reconciliation_runs
for each row execute function app_private.freeze_wms_reconciliation_run_sources();

create or replace function app_private.assert_wms_reconciliation_b2b_fingerprints(
  p_run_id uuid,
  p_source_snapshot jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.wms_reconciliation_runs%rowtype;
  v_manifest jsonb;
begin
  select run.* into v_run
  from public.wms_reconciliation_runs run
  where run.id = p_run_id;
  if not found then
    raise exception 'WMS reconciliation run does not exist' using errcode = 'P0002';
  end if;
  if p_source_snapshot is distinct from v_run.source_snapshot then
    raise exception 'source snapshot differs from frozen run evidence' using errcode = '40001';
  end if;
  select frozen.payload into v_manifest
  from app_private.wms_reconciliation_frozen_sources frozen
  where frozen.run_id = p_run_id and frozen.phase = 'manifest' and frozen.source_key = 'b2b-v2';
  if not found or v_manifest ->> 'snapshotVersion' is distinct from 'b2b-v2' then
    raise exception 'B2b frozen candidate snapshot is missing' using errcode = '40001';
  end if;
  if v_manifest ->> 'canonicalWf001LegacyFunctionHash' is distinct from
      app_private.wms_reconciliation_known_wf001_legacy_function_hash() then
    raise exception 'canonical WF-001 fingerprint changed after run creation'
      using errcode = '40001';
  end if;
  if v_manifest ->> 'knownWf001HelperDefinitionHash' is distinct from
      app_private.wms_reconciliation_function_hash(
        'app_private.wms_reconciliation_known_wf001_legacy_function_hash()'::regprocedure
      ) then
    raise exception 'canonical WF-001 helper definition changed after run creation'
      using errcode = '40001';
  end if;
  if v_manifest ->> 'frozenTransactionValidatorDefinitionHash' is distinct from
      app_private.wms_reconciliation_function_hash(
        'app_private.validate_wms_reconciliation_frozen_transaction(jsonb,jsonb)'::regprocedure
      ) then
    raise exception 'frozen transaction validator definition changed after run creation'
      using errcode = '40001';
  end if;
  if v_manifest -> 'functionHashes' is distinct from p_source_snapshot -> 'functionHashes'
     or p_source_snapshot #>> '{functionHashes,scanPhases,physicalAnchor}' is distinct from
       app_private.wms_reconciliation_function_hash(
         'app_private.scan_wms_reconciliation_phase_physical_anchor(uuid,integer,jsonb,jsonb)'::regprocedure
       )
     or p_source_snapshot #>> '{functionHashes,scanPhases,openingBalance}' is distinct from
       app_private.wms_reconciliation_function_hash(
         'app_private.scan_wms_reconciliation_phase_opening_balance(uuid,integer,jsonb,jsonb)'::regprocedure
       )
     or p_source_snapshot #>> '{functionHashes,scanPhases,transactionLedger}' is distinct from
       app_private.wms_reconciliation_function_hash(
         'app_private.scan_wms_reconciliation_phase_transaction_ledger(uuid,integer,jsonb,jsonb)'::regprocedure
       )
     or p_source_snapshot #>> '{functionHashes,recheck}' is distinct from
       app_private.wms_reconciliation_function_hash(
         'app_private.recheck_wms_reconciliation_finding(uuid,jsonb)'::regprocedure
       ) then
    raise exception 'WMS reconciliation phase/recheck function fingerprint changed after run creation'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function app_private.assert_wms_reconciliation_b2b_fingerprints(uuid,jsonb)
  from public, anon, authenticated, service_role;

-- Runs created by the B2a zero-candidate shells do not have immutable
-- candidates and must never be resumed under the hardened scanner.
update public.wms_reconciliation_runs
set status = 'failed',
    error_text = 'B2b frozen candidate snapshot is required; create a new run',
    updated_at = pg_catalog.clock_timestamp()
where status in ('created', 'scanning')
  and not exists (
    select 1
    from app_private.wms_reconciliation_frozen_sources frozen
    where frozen.run_id = wms_reconciliation_runs.id
      and frozen.phase = 'manifest'
      and frozen.source_key = 'b2b-v2'
  );

create or replace function app_private.scan_wms_reconciliation_phase_physical_anchor(
  p_run_id uuid,
  p_batch_size integer,
  p_cursor jsonb,
  p_source_snapshot jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_run public.wms_reconciliation_runs%rowtype;
  v_frozen record;
  v_line record;
  v_source jsonb;
  v_command_result jsonb;
  v_stock_transaction jsonb;
  v_ledger_entries jsonb;
  v_ledger_quantities jsonb;
  v_validation jsonb;
  v_last_at timestamptz;
  v_last_id text;
  v_processed integer := 0;
  v_complete boolean;
  v_anchor_valid boolean;
  v_line_valid boolean;
  v_uom_invalid boolean;
  v_reason text;
  v_system numeric;
  v_actual numeric;
  v_delta numeric;
  v_item_id text;
  v_unit text;
  v_precondition_hash text;
  v_excluded_ids jsonb;
begin
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception 'physical anchor batch size must be between 1 and 500'
      using errcode = '22023';
  end if;
  perform app_private.assert_wms_reconciliation_b2b_fingerprints(p_run_id, p_source_snapshot);
  select run.* into v_run from public.wms_reconciliation_runs run where run.id = p_run_id;
  if pg_catalog.jsonb_typeof(p_cursor) <> 'object'
     or p_cursor ->> 'phase' is distinct from 'physical_anchor'
     or not (p_cursor ? 'lastKey') then
    raise exception 'invalid physical anchor cursor' using errcode = '22023';
  end if;
  if p_cursor -> 'lastKey' <> 'null'::jsonb then
    begin
      v_last_at := (p_cursor #>> '{lastKey,date}')::timestamptz;
      v_last_id := p_cursor #>> '{lastKey,id}';
      if not pg_catalog.isfinite(v_last_at) or nullif(pg_catalog.btrim(v_last_id), '') is null then
        raise exception 'invalid physical anchor lastKey' using errcode = '22023';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid physical anchor lastKey' using errcode = '22023';
    end;
  end if;

  for v_frozen in
    select frozen.*
    from app_private.wms_reconciliation_frozen_sources frozen
    where frozen.run_id = p_run_id
      and frozen.phase = 'physical_anchor'
      and (
        v_last_at is null
        or frozen.sort_at > v_last_at
        or (frozen.sort_at = v_last_at and frozen.sort_id > v_last_id)
      )
    order by frozen.sort_at, frozen.sort_id
    limit p_batch_size
  loop
    v_source := v_frozen.payload -> 'source';
    v_command_result := v_frozen.payload -> 'commandResult';
    v_stock_transaction := v_frozen.payload -> 'stockTransaction';
    select coalesce(pg_catalog.jsonb_agg(entry.value order by entry.value ->> 'created_at', entry.value ->> 'id'), '[]'::jsonb)
    into v_ledger_entries
    from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'ledgerHeaders') header(value)
    cross join lateral pg_catalog.jsonb_array_elements(header.value -> 'ledgerEntries') entry(value);
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', entry.value ->> 'id',
      'itemId', entry.value ->> 'material_id',
      'warehouseId', entry.value ->> 'warehouse_id',
      'unit', entry.value ->> 'unit',
      'quantityIn', entry.value ->> 'quantity_in',
      'quantityOut', entry.value ->> 'quantity_out',
      'quantityDelta', entry.value ->> 'quantity_delta'
    ) order by entry.value ->> 'id'), '[]'::jsonb)
    into v_ledger_quantities
    from pg_catalog.jsonb_array_elements(v_ledger_entries) entry(value);
    v_validation := app_private.validate_wms_reconciliation_frozen_transaction(
      v_stock_transaction, v_frozen.payload -> 'ledgerHeaders'
    );

    v_anchor_valid := true;
    v_reason := null;
    if coalesce((v_frozen.payload ->> 'warehouseExists')::boolean, false) is not true
       or nullif(v_source ->> 'warehouseId', '') is null then
      v_anchor_valid := false;
      v_reason := 'audit warehouse is missing from the frozen catalog';
    elsif pg_catalog.jsonb_typeof(v_source -> 'items') <> 'array'
       or pg_catalog.jsonb_array_length(v_source -> 'items') = 0 then
      v_anchor_valid := false;
      v_reason := 'audit item evidence is missing';
    elsif v_source ->> 'command_id' is null
       or v_source ->> 'request_hash' !~ '^[0-9a-f]{64}$'
       or v_source ->> 'posting_engine_version' is distinct from 'wf001-audit-v1'
       or pg_catalog.jsonb_typeof(v_command_result) <> 'object'
       or v_command_result ->> 'command_id' is distinct from v_source ->> 'command_id'
       or v_command_result ->> 'request_hash' is distinct from v_source ->> 'request_hash'
       or v_command_result ->> 'warehouse_id' is distinct from v_source ->> 'warehouseId'
       or (
         v_command_result #> '{result,audit_session}' is distinct from v_source
         and (v_command_result #> '{result,audit_session}') - 'totalLossValue'::text
           is distinct from v_source - 'totalLossValue'::text
       ) then
      v_anchor_valid := false;
      v_reason := 'commandResult does not exactly match audit session and lines';
    end if;

    if v_anchor_valid and exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_source -> 'items') line(value)
      where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'delta') is distinct from 0::numeric
    ) then
      if pg_catalog.jsonb_typeof(v_stock_transaction) <> 'object'
         or v_command_result #> '{result,stock_transaction}' is distinct from v_stock_transaction
         or v_source ->> 'transactionId' is distinct from v_stock_transaction ->> 'id'
         or v_stock_transaction ->> 'id' is distinct from 'audit-adjustment-' || (v_source ->> 'command_id')
         or v_stock_transaction ->> 'type' is distinct from 'ADJUSTMENT'
         or v_stock_transaction ->> 'status' is distinct from 'COMPLETED'
         or v_stock_transaction ->> 'source_type' is distinct from 'inventory_audit'
         or v_stock_transaction ->> 'source_id' is distinct from v_source ->> 'command_id'
         or v_stock_transaction ->> 'target_warehouse_id' is distinct from v_source ->> 'warehouseId'
         or v_frozen.payload -> 'transactionItems' is distinct from v_stock_transaction -> 'items'
         or pg_catalog.jsonb_array_length(v_frozen.payload -> 'ledgerHeaders') <> 1
         or v_frozen.payload #>> '{ledgerHeaders,0,header,source_type}' is distinct from 'wms_transaction'
         or v_frozen.payload #>> '{ledgerHeaders,0,header,source_id}' is distinct from v_stock_transaction ->> 'id'
         or v_frozen.payload #>> '{ledgerHeaders,0,header,status}' is distinct from 'posted'
         or pg_catalog.jsonb_array_length(v_stock_transaction -> 'items') <> (
           select pg_catalog.count(*)
           from pg_catalog.jsonb_array_elements(v_source -> 'items') line(value)
           where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'delta') is distinct from 0::numeric
         )
         or pg_catalog.jsonb_array_length(v_ledger_entries) <> (
           select pg_catalog.count(*)
           from pg_catalog.jsonb_array_elements(v_source -> 'items') line(value)
           where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'delta') is distinct from 0::numeric
         ) then
        v_anchor_valid := false;
        v_reason := 'stockTransaction, transactionItems or linked ledgerEntries count is incomplete';
      elsif (v_validation ->> 'sourceValid')::boolean is not true
         or (v_validation ->> 'headerValid')::boolean is not true
         or (v_validation ->> 'entryIdentityValid')::boolean is not true
         or (v_validation ->> 'quantityExact')::boolean is not true then
        v_anchor_valid := false;
        v_reason := 'stock transaction fails exact frozen header, entry identity or ledger quantity validation';
      elsif exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_source -> 'items') audit_line(value)
        where app_private.try_wms_reconciliation_numeric_20_6(audit_line.value ->> 'delta') is distinct from 0::numeric
          and not exists (
            select 1
            from pg_catalog.jsonb_array_elements(v_stock_transaction -> 'items') transaction_line(value)
            where transaction_line.value ->> 'itemId' = audit_line.value ->> 'itemId'
              and app_private.try_wms_reconciliation_numeric_20_6(transaction_line.value ->> 'quantity') =
                  app_private.try_wms_reconciliation_numeric_20_6(audit_line.value ->> 'delta')
              and app_private.normalize_quantity_unit(coalesce(transaction_line.value ->> 'unitSnapshot', transaction_line.value ->> 'unit')) =
                  app_private.normalize_quantity_unit(audit_line.value ->> 'unit')
          )
      ) or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_source -> 'items') audit_line(value)
        where app_private.try_wms_reconciliation_numeric_20_6(audit_line.value ->> 'delta') is distinct from 0::numeric
          and not exists (
            select 1
            from pg_catalog.jsonb_array_elements(v_ledger_entries) ledger_line(value)
            where ledger_line.value ->> 'material_id' = audit_line.value ->> 'itemId'
              and ledger_line.value ->> 'warehouse_id' = v_source ->> 'warehouseId'
              and app_private.normalize_quantity_unit(ledger_line.value ->> 'unit') =
                  app_private.normalize_quantity_unit(audit_line.value ->> 'unit')
              and app_private.try_wms_reconciliation_numeric_20_6(ledger_line.value ->> 'quantity_delta') =
                  app_private.try_wms_reconciliation_numeric_20_6(audit_line.value ->> 'delta')
              and app_private.try_wms_reconciliation_numeric_20_6(ledger_line.value ->> 'quantity_in') -
                  app_private.try_wms_reconciliation_numeric_20_6(ledger_line.value ->> 'quantity_out') =
                  app_private.try_wms_reconciliation_numeric_20_6(audit_line.value ->> 'delta')
          )
      ) then
        v_anchor_valid := false;
        v_reason := 'audit lines do not exactly match transactionItems and ledger quantities';
      end if;
    end if;

    v_reason := case when v_anchor_valid then v_reason
      else coalesce(v_reason, 'nonzero audit provenance is invalid') end;
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_source -> 'items') line(value)
      where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'delta') <> 0
    ) and (
      v_source ->> 'transactionId' is not null
      or v_command_result #> '{result,stock_transaction}' <> 'null'::jsonb
      or v_stock_transaction <> 'null'::jsonb
      or pg_catalog.jsonb_array_length(v_frozen.payload -> 'ledgerHeaders') <> 0
    ) then
      v_anchor_valid := false;
      v_reason := 'all-zero audit has a partial stock posting artifact';
    end if;

    -- Any invalid numeric, catalog item, unit or warehouse invalidates the whole
    -- anchor, so no partially-valid aggregate can affect replay.
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_source -> 'items') line(value)
      where nullif(line.value ->> 'itemId', '') is null
         or app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'systemStock') is null
         or app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'actualStock') is null
         or app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'delta') is null
         or app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'actualStock') -
            app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'systemStock') <>
            app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'delta')
         or not ((v_frozen.payload -> 'catalogItems') ? (line.value ->> 'itemId'))
         or app_private.normalize_quantity_unit(line.value ->> 'unit') is distinct from
            app_private.normalize_quantity_unit(v_frozen.payload #>> array['catalogItems', line.value ->> 'itemId', 'unit'])
    ) then
      v_anchor_valid := false;
      v_reason := coalesce(v_reason, 'invalid numeric, UOM or catalog line was excluded from valid anchor aggregate');
    end if;

    for v_line in
      select line.value, line.ordinality
      from pg_catalog.jsonb_array_elements(v_source -> 'items') with ordinality line(value, ordinality)
    loop
      v_item_id := nullif(v_line.value ->> 'itemId', '');
      v_unit := nullif(v_line.value ->> 'unit', '');
      v_system := app_private.try_wms_reconciliation_numeric_20_6(v_line.value ->> 'systemStock');
      v_actual := app_private.try_wms_reconciliation_numeric_20_6(v_line.value ->> 'actualStock');
      v_delta := app_private.try_wms_reconciliation_numeric_20_6(v_line.value ->> 'delta');
      v_uom_invalid := v_item_id is null
        or not ((v_frozen.payload -> 'catalogItems') ? coalesce(v_item_id, ''))
        or v_unit is null
        or app_private.normalize_quantity_unit(v_unit) is distinct from
           app_private.normalize_quantity_unit(v_frozen.payload #>> array['catalogItems', coalesce(v_item_id, ''), 'unit']);
      v_line_valid := v_anchor_valid and not v_uom_invalid
        and v_system is not null and v_actual is not null and v_delta is not null
        and v_actual - v_system = v_delta;
      v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
        'phase', 'physical_anchor', 'frozenSourceHash', v_frozen.source_hash,
        'lineOrdinality', v_line.ordinality, 'line', v_line.value,
        'commandResult', v_command_result, 'stockTransaction', v_stock_transaction,
        'transactionItems', v_frozen.payload -> 'transactionItems',
        'ledgerQuantities', v_ledger_quantities,
        'validation', v_validation,
        'policyVersion', p_source_snapshot -> 'policyVersion'
      )::text);
      insert into public.wms_reconciliation_findings (
        run_id, finding_type, severity, confidence, item_id, warehouse_id, unit,
        raw_value_text, raw_values, before_qty, expected_qty, delta_qty,
        evidence, blockers, proposed_action, precondition_hash, status, quarantine_reason
      )
      select
        p_run_id,
        case when v_line_valid then 'PHYSICAL_ANCHOR'
             when v_uom_invalid then 'UOM_PRECISION' else 'LINEAGE_GAP' end,
        case when v_line_valid then 'P2' else 'P1' end,
        case when v_line_valid then 'high' else 'low' end,
        v_item_id, nullif(v_source ->> 'warehouseId', ''), v_unit,
        v_line.value::text,
        pg_catalog.jsonb_build_object(
          'systemStock', v_line.value ->> 'systemStock',
          'actualStock', v_line.value ->> 'actualStock',
          'delta', v_line.value ->> 'delta'
        ),
        v_system, v_actual, v_delta,
        pg_catalog.jsonb_build_object(
          'frozenSourceHash', v_frozen.source_hash,
          'validAnchor', v_line_valid,
          'source', v_source,
          'commandResult', v_command_result,
          'stockTransaction', v_stock_transaction,
          'transactionItems', v_frozen.payload -> 'transactionItems',
          'ledgerEntries', v_ledger_entries,
          'ledgerQuantities', v_ledger_quantities,
          'validation', v_validation
        ),
        case when v_line_valid then '[]'::jsonb else pg_catalog.jsonb_build_array(coalesce(v_reason, 'invalid anchor line')) end,
        case when v_line_valid then 'use_as_physical_anchor' else 'manual_review' end,
        v_precondition_hash,
        case when v_line_valid then 'open' else 'quarantined' end,
        case when v_line_valid then null else coalesce(v_reason, 'invalid anchor line') end
      where not exists (
        select 1 from public.wms_reconciliation_findings finding
        where finding.run_id = p_run_id
          and finding.finding_type = case when v_line_valid then 'PHYSICAL_ANCHOR'
            when v_uom_invalid then 'UOM_PRECISION' else 'LINEAGE_GAP' end
          and finding.item_id is not distinct from v_item_id
          and finding.warehouse_id is not distinct from nullif(v_source ->> 'warehouseId', '')
          and finding.precondition_hash = v_precondition_hash
      );
    end loop;

    if v_anchor_valid then
      v_excluded_ids := case
        when v_stock_transaction is null or v_stock_transaction = 'null'::jsonb then '[]'::jsonb
        else pg_catalog.jsonb_build_array(v_stock_transaction ->> 'id')
      end;
      insert into app_private.wms_reconciliation_run_work (
        run_id, phase, source_key, source_hash, payload
      ) values (
        p_run_id, 'physical_anchor', v_source ->> 'id', v_frozen.source_hash,
        pg_catalog.jsonb_build_object(
          'validAnchor', true,
          'excludedTransactionIds', v_excluded_ids,
          'anchorDate', v_source ->> 'date',
          'ledgerQuantities', v_ledger_quantities
        )
      ) on conflict (run_id, phase, source_key, warehouse_id, item_id) do nothing;
    end if;

    v_last_at := v_frozen.sort_at;
    v_last_id := v_frozen.sort_id;
    v_processed := v_processed + 1;
  end loop;

  v_complete := not exists (
    select 1 from app_private.wms_reconciliation_frozen_sources frozen
    where frozen.run_id = p_run_id and frozen.phase = 'physical_anchor'
      and (v_last_at is null or frozen.sort_at > v_last_at or (frozen.sort_at = v_last_at and frozen.sort_id > v_last_id))
  );
  return pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'physical_anchor', 'lastKey',
      case when v_last_at is null then null else pg_catalog.jsonb_build_object('date', v_last_at, 'id', v_last_id) end),
    'processed', v_processed, 'complete', v_complete
  );
end;
$$;

revoke all on function app_private.scan_wms_reconciliation_phase_physical_anchor(uuid,integer,jsonb,jsonb)
  from public, anon, authenticated, service_role;

create or replace function app_private.scan_wms_reconciliation_phase_opening_balance(
  p_run_id uuid,
  p_batch_size integer,
  p_cursor jsonb,
  p_source_snapshot jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_run public.wms_reconciliation_runs%rowtype;
  v_frozen record;
  v_line record;
  v_source jsonb;
  v_command_result jsonb;
  v_reversal_result jsonb;
  v_stock_transactions jsonb;
  v_transaction_items jsonb;
  v_original_stock_transactions jsonb;
  v_reversal_stock_transactions jsonb;
  v_original_transaction_items jsonb;
  v_reversal_transaction_items jsonb;
  v_original_ledger_headers jsonb;
  v_reversal_ledger_headers jsonb;
  v_original_validation jsonb;
  v_reversal_validation jsonb;
  v_bound_headers jsonb;
  v_transaction record;
  v_original_warehouse_id text;
  v_reversal_warehouse_id text;
  v_ledger_entries jsonb;
  v_ledger_quantities jsonb;
  v_last_at timestamptz;
  v_last_id text;
  v_processed integer := 0;
  v_complete boolean;
  v_anchor_valid boolean;
  v_line_valid boolean;
  v_uom_invalid boolean;
  v_reason text;
  v_quantity numeric;
  v_item_id text;
  v_warehouse_id text;
  v_unit text;
  v_precondition_hash text;
  v_excluded_ids jsonb;
begin
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception 'opening balance batch size must be between 1 and 500'
      using errcode = '22023';
  end if;
  perform app_private.assert_wms_reconciliation_b2b_fingerprints(p_run_id, p_source_snapshot);
  select run.* into v_run from public.wms_reconciliation_runs run where run.id = p_run_id;
  if pg_catalog.jsonb_typeof(p_cursor) <> 'object'
     or p_cursor ->> 'phase' is distinct from 'opening_balance'
     or not (p_cursor ? 'lastKey') then
    raise exception 'invalid opening balance cursor' using errcode = '22023';
  end if;
  if p_cursor -> 'lastKey' <> 'null'::jsonb then
    begin
      v_last_at := (p_cursor #>> '{lastKey,date}')::timestamptz;
      v_last_id := p_cursor #>> '{lastKey,id}';
      if not pg_catalog.isfinite(v_last_at) or nullif(pg_catalog.btrim(v_last_id), '') is null then
        raise exception 'invalid opening balance lastKey' using errcode = '22023';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid opening balance lastKey' using errcode = '22023';
    end;
  end if;

  for v_frozen in
    select frozen.*
    from app_private.wms_reconciliation_frozen_sources frozen
    where frozen.run_id = p_run_id and frozen.phase = 'opening_balance'
      and (v_last_at is null or frozen.sort_at > v_last_at or (frozen.sort_at = v_last_at and frozen.sort_id > v_last_id))
    order by frozen.sort_at, frozen.sort_id
    limit p_batch_size
  loop
    v_source := v_frozen.payload -> 'source';
    v_command_result := v_frozen.payload -> 'commandResult';
    v_reversal_result := v_frozen.payload -> 'reversalResult';
    v_original_stock_transactions := v_frozen.payload -> 'originalStockTransactions';
    v_reversal_stock_transactions := v_frozen.payload -> 'reversalStockTransactions';
    v_original_transaction_items := v_frozen.payload -> 'originalTransactionItems';
    v_reversal_transaction_items := v_frozen.payload -> 'reversalTransactionItems';
    v_original_ledger_headers := v_frozen.payload -> 'originalLedgerHeaders';
    v_reversal_ledger_headers := v_frozen.payload -> 'reversalLedgerHeaders';
    v_stock_transactions := v_frozen.payload -> 'stockTransactions';
    v_transaction_items := v_frozen.payload -> 'transactionItems';
    select coalesce(pg_catalog.jsonb_agg(entry.value order by entry.value ->> 'created_at', entry.value ->> 'id'), '[]'::jsonb)
    into v_ledger_entries
    from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'ledgerHeaders') header(value)
    cross join lateral pg_catalog.jsonb_array_elements(header.value -> 'ledgerEntries') entry(value);
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', entry.value ->> 'id', 'itemId', entry.value ->> 'material_id',
      'warehouseId', entry.value ->> 'warehouse_id', 'unit', entry.value ->> 'unit',
      'quantityIn', entry.value ->> 'quantity_in', 'quantityOut', entry.value ->> 'quantity_out',
      'quantityDelta', entry.value ->> 'quantity_delta'
    ) order by entry.value ->> 'id'), '[]'::jsonb)
    into v_ledger_quantities
    from pg_catalog.jsonb_array_elements(v_ledger_entries) entry(value);

    v_anchor_valid := true;
    v_reason := null;
    if v_source ->> 'status' not in ('locked', 'void')
       or v_source ->> 'posting_engine_version' is distinct from 'wf001-opening-v1'
       or v_source ->> 'lock_command_id' is null
       or nullif(v_source ->> 'lock_request_hash', '') is null then
      v_anchor_valid := false;
      v_reason := 'opening balance is not controlled locked/valid-void provenance';
    elsif pg_catalog.jsonb_typeof(v_frozen.payload -> 'lines') <> 'array'
       or pg_catalog.jsonb_array_length(v_frozen.payload -> 'lines') = 0 then
      v_anchor_valid := false;
      v_reason := 'opening lines are missing';
    elsif pg_catalog.jsonb_array_length(v_frozen.payload -> 'missingWarehouses') <> 0 then
      v_anchor_valid := false;
      v_reason := 'opening warehouse is missing from the frozen catalog';
    elsif pg_catalog.jsonb_typeof(v_command_result) <> 'object'
       or v_command_result ->> 'command_id' is distinct from v_source ->> 'lock_command_id'
       or v_command_result ->> 'opening_balance_id' is distinct from v_source ->> 'id'
       or v_command_result ->> 'request_hash' is distinct from v_source ->> 'lock_request_hash'
       or v_command_result #>> '{result,opening_balance,id}' is distinct from v_source ->> 'id'
       or v_command_result #>> '{result,opening_balance,lock_request_hash}' is distinct from v_source ->> 'lock_request_hash'
       or v_command_result #>> '{result,opening_balance,posting_engine_version}' is distinct from 'wf001-opening-v1'
       or v_command_result #> '{result,lines}' is distinct from v_frozen.payload -> 'lines'
       or v_command_result #> '{result,stock_transactions}' is distinct from v_original_stock_transactions then
      v_anchor_valid := false;
      v_reason := 'commandResult does not exactly match opening balance, lines and stockTransaction evidence';
    elsif v_source ->> 'status' = 'void' and (
      pg_catalog.jsonb_typeof(v_reversal_result) <> 'object'
      or v_reversal_result ->> 'opening_balance_id' is distinct from v_source ->> 'id'
      or v_reversal_result ->> 'command_id' is distinct from v_source ->> 'reversal_command_id'
      or v_reversal_result ->> 'request_hash' is distinct from v_source ->> 'reversal_request_hash'
      or v_reversal_result #>> '{result,opening_balance,id}' is distinct from v_source ->> 'id'
      or v_reversal_result #> '{result,compensating_stock_transactions}' is distinct from v_reversal_stock_transactions
      or v_reversal_result #> '{result,stock_transaction_map}' is null
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_reversal_result #> '{result,stock_transaction_map}') mapping(value)
        where nullif(mapping.value ->> 'originalTransactionId', '') is null
           or nullif(mapping.value ->> 'compensatingTransactionId', '') is null
           or not (v_original_stock_transactions @> pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object('id', mapping.value ->> 'originalTransactionId')
           ))
           or not (v_reversal_stock_transactions @> pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object('id', mapping.value ->> 'compensatingTransactionId')
           ))
      )
    ) then
      v_anchor_valid := false;
      v_reason := 'void opening reversalResult is incomplete';
    end if;

    if v_source ->> 'status' = 'locked' and (
      pg_catalog.jsonb_array_length(v_reversal_stock_transactions) <> 0
      or pg_catalog.jsonb_array_length(v_reversal_ledger_headers) <> 0
      or (v_reversal_result is not null and v_reversal_result <> 'null'::jsonb)
    ) then
      v_anchor_valid := false;
      v_reason := 'locked opening has reversal artifacts';
    end if;

    -- Validate each original transaction against only its original frozen
    -- header array.  Deterministic identity and intent are checked before its
    -- exact header/entry/quantity validator result may preserve validAnchor.
    v_original_validation := app_private.validate_wms_reconciliation_frozen_transaction(
      v_original_stock_transactions -> 0, v_original_ledger_headers
    );
    if pg_catalog.jsonb_array_length(v_original_stock_transactions) = 1 and (
      (v_original_validation ->> 'sourceValid')::boolean is not true
      or (v_original_validation ->> 'headerValid')::boolean is not true
      or (v_original_validation ->> 'entryIdentityValid')::boolean is not true
      or (v_original_validation ->> 'quantityExact')::boolean is not true
    ) then
      v_anchor_valid := false;
      v_reason := 'original opening transaction failed exact validator';
    end if;
    for v_transaction in
      select stock_transaction.value
      from pg_catalog.jsonb_array_elements(v_original_stock_transactions) stock_transaction(value)
    loop
      v_original_warehouse_id := v_transaction.value ->> 'target_warehouse_id';
      if v_transaction.value ->> 'id' is distinct from
           'opening-balance:' || (v_source ->> 'id') || ':' ||
           pg_catalog.left(app_private.sha256_text(v_original_warehouse_id), 16)
         or v_transaction.value ->> 'type' is distinct from 'ADJUSTMENT'
         or v_transaction.value ->> 'status' is distinct from 'COMPLETED'
         or v_transaction.value ->> 'source_type' is distinct from 'project_opening_balance'
         or v_transaction.value ->> 'source_id' is distinct from
           (v_source ->> 'id') || ':' || v_original_warehouse_id
         or v_transaction.value ->> 'source_warehouse_id' is not null
         or v_transaction.value ->> 'posting_engine_version' is distinct from 'wf001-opening-v1'
         or v_transaction.value ->> 'posting_request_hash' is distinct from app_private.sha256_text(
           pg_catalog.jsonb_build_object(
             'id', v_transaction.value -> 'id', 'type', v_transaction.value -> 'type',
             'date', v_transaction.value -> 'date', 'items', v_transaction.value -> 'items',
             'sourceWarehouseId', v_transaction.value -> 'source_warehouse_id',
             'targetWarehouseId', v_transaction.value -> 'target_warehouse_id',
             'supplierId', v_transaction.value -> 'supplier_id',
             'requesterId', v_transaction.value -> 'requester_id',
             'createdBy', v_transaction.value -> 'created_by',
             'businessPartnerId', v_transaction.value -> 'business_partner_id',
             'businessPartnerNameSnapshot', v_transaction.value -> 'business_partner_name_snapshot',
             'note', v_transaction.value -> 'note', 'sourceType', v_transaction.value -> 'source_type',
             'sourceId', v_transaction.value -> 'source_id',
             'relatedRequestId', v_transaction.value -> 'related_request_id',
             'pendingItems', coalesce(v_transaction.value -> 'pending_items', '[]'::jsonb)
           )::text
         ) then
        v_anchor_valid := false;
        v_reason := 'original opening stockTransaction identity or posting intent is invalid';
      end if;
      select coalesce(pg_catalog.jsonb_agg(header.value), '[]'::jsonb)
      into v_bound_headers
      from pg_catalog.jsonb_array_elements(v_original_ledger_headers) header(value)
      where header.value #>> '{header,source_id}' = v_transaction.value ->> 'id';
      v_original_validation := app_private.validate_wms_reconciliation_frozen_transaction(
        v_transaction.value, v_bound_headers
      );
      if (v_original_validation ->> 'sourceValid')::boolean is not true
         or (v_original_validation ->> 'headerValid')::boolean is not true
         or (v_original_validation ->> 'entryIdentityValid')::boolean is not true
         or (v_original_validation ->> 'quantityExact')::boolean is not true then
        v_anchor_valid := false;
        v_reason := 'original opening transaction failed exact validator';
      end if;
    end loop;

    if v_source ->> 'status' = 'void' then
      v_reversal_validation := app_private.validate_wms_reconciliation_frozen_transaction(
        v_reversal_stock_transactions -> 0, v_reversal_ledger_headers
      );
      if pg_catalog.jsonb_array_length(v_reversal_stock_transactions) = 1 and (
        (v_reversal_validation ->> 'sourceValid')::boolean is not true
        or (v_reversal_validation ->> 'headerValid')::boolean is not true
        or (v_reversal_validation ->> 'entryIdentityValid')::boolean is not true
        or (v_reversal_validation ->> 'quantityExact')::boolean is not true
      ) then
        v_anchor_valid := false;
        v_reason := 'reversal opening transaction failed exact validator';
      end if;
      for v_transaction in
        select stock_transaction.value
        from pg_catalog.jsonb_array_elements(v_reversal_stock_transactions) stock_transaction(value)
      loop
        v_reversal_warehouse_id := v_transaction.value ->> 'target_warehouse_id';
        if v_transaction.value ->> 'id' is distinct from
             'opening-reversal:' || (v_source ->> 'id') || ':' ||
             pg_catalog.left(app_private.sha256_text(v_reversal_warehouse_id), 16)
           or v_transaction.value ->> 'source_type' is distinct from 'project_opening_balance_reversal'
           or v_transaction.value ->> 'posting_engine_version' is distinct from 'wf001-opening-reversal-v1'
           or exists (
             select 1
             from pg_catalog.jsonb_array_elements(v_transaction.value -> 'items') reversal_line(value)
             where app_private.try_wms_reconciliation_numeric_20_6(reversal_line.value ->> 'quantity') >= 0
                or nullif(reversal_line.value ->> 'reversalOfLineId', '') is null
           ) then
          v_anchor_valid := false;
          v_reason := 'project_opening_balance_reversal transaction identity or negative quantity is invalid';
        end if;
        select coalesce(pg_catalog.jsonb_agg(header.value), '[]'::jsonb)
        into v_bound_headers
        from pg_catalog.jsonb_array_elements(v_reversal_ledger_headers) header(value)
        where header.value #>> '{header,source_id}' = v_transaction.value ->> 'id';
        v_reversal_validation := app_private.validate_wms_reconciliation_frozen_transaction(
          v_transaction.value, v_bound_headers
        );
        if exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_transaction.value -> 'items') reversal_line(value)
          join pg_catalog.jsonb_array_elements(v_reversal_validation -> 'actualEntries') actual_line(value)
            on actual_line.value ->> 'source_line_id' = reversal_line.value ->> 'lineId'
          cross join lateral (
            select app_private.try_wms_reconciliation_numeric_20_6(
              reversal_line.value ->> 'quantity'
            ) as quantity
          ) parsed
          where parsed.quantity < 0
            and (
              app_private.try_wms_reconciliation_numeric_20_6(actual_line.value ->> 'quantity_out')
                is distinct from pg_catalog.abs(parsed.quantity)
              or not (
                app_private.try_wms_reconciliation_numeric_20_6(actual_line.value ->> 'quantity_delta') =
                app_private.try_wms_reconciliation_numeric_20_6(reversal_line.value ->> 'quantity')
              )
            )
        ) then
          v_anchor_valid := false;
          v_reason := 'reversal ledger magnitude or signed delta differs from source quantity';
        end if;
        if (v_reversal_validation ->> 'sourceValid')::boolean is not true
           or (v_reversal_validation ->> 'headerValid')::boolean is not true
           or (v_reversal_validation ->> 'entryIdentityValid')::boolean is not true
           or (v_reversal_validation ->> 'quantityExact')::boolean is not true then
          v_anchor_valid := false;
          v_reason := 'reversal opening quantityOut must equal abs(quantity) and quantityDelta = quantity';
        end if;
        if v_transaction.value ->> 'posting_request_hash' is distinct from app_private.sha256_text(
          pg_catalog.jsonb_build_object(
            'id', v_transaction.value -> 'id', 'type', v_transaction.value -> 'type',
            'date', v_transaction.value -> 'date', 'items', v_transaction.value -> 'items',
            'sourceWarehouseId', v_transaction.value -> 'source_warehouse_id',
            'targetWarehouseId', v_transaction.value -> 'target_warehouse_id',
            'supplierId', v_transaction.value -> 'supplier_id',
            'requesterId', v_transaction.value -> 'requester_id',
            'createdBy', v_transaction.value -> 'created_by',
            'businessPartnerId', v_transaction.value -> 'business_partner_id',
            'businessPartnerNameSnapshot', v_transaction.value -> 'business_partner_name_snapshot',
            'note', v_transaction.value -> 'note', 'sourceType', v_transaction.value -> 'source_type',
            'sourceId', v_transaction.value -> 'source_id',
            'relatedRequestId', v_transaction.value -> 'related_request_id',
            'pendingItems', coalesce(v_transaction.value -> 'pending_items', '[]'::jsonb)
          )::text
        ) then
          v_anchor_valid := false;
          v_reason := 'reversal opening posting_request_hash differs from frozen canonical intent';
        end if;
      end loop;
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') line(value)
      where nullif(line.value ->> 'inventory_item_id', '') is null
         or nullif(line.value ->> 'warehouse_id', '') is null
         or app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'remaining_qty') is null
         or not ((v_frozen.payload -> 'catalogItems') ? (line.value ->> 'inventory_item_id'))
         or app_private.normalize_quantity_unit(line.value ->> 'unit') is distinct from
            app_private.normalize_quantity_unit(v_frozen.payload #>> array['catalogItems', line.value ->> 'inventory_item_id', 'unit'])
    ) then
      v_anchor_valid := false;
      v_reason := coalesce(v_reason, 'invalid numeric, UOM or catalog line was excluded from valid opening aggregate');
    end if;

    if v_anchor_valid and exists (
      select 1 from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') line(value)
      where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'remaining_qty') <> 0
    ) then
      if pg_catalog.jsonb_array_length(v_original_stock_transactions) <> (
        select pg_catalog.count(distinct line.value ->> 'warehouse_id')
        from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') line(value)
        where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'remaining_qty') <> 0
      )
      or (v_source ->> 'status' = 'void' and
        pg_catalog.jsonb_array_length(v_reversal_stock_transactions) <> (
          select pg_catalog.count(distinct line.value ->> 'warehouse_id')
          from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') line(value)
          where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'remaining_qty') <> 0
        ))
      or pg_catalog.jsonb_array_length(v_frozen.payload -> 'ledgerHeaders') <>
         pg_catalog.jsonb_array_length(v_stock_transactions)
      or (v_source ->> 'status' = 'locked' and (
        select coalesce(pg_catalog.sum(pg_catalog.jsonb_array_length(stock_transaction.value -> 'items')), 0)
        from pg_catalog.jsonb_array_elements(v_stock_transactions) stock_transaction(value)
      ) <> (
        select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') line(value)
        where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'remaining_qty') <> 0
      ))
      or pg_catalog.jsonb_array_length(v_ledger_entries) <> (
        select pg_catalog.count(*) * case when v_source ->> 'status' = 'void' then 2 else 1 end
        from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') line(value)
        where app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'remaining_qty') <> 0
      ) then
        v_anchor_valid := false;
        v_reason := 'stockTransaction or linked ledgerEntries count is incomplete';
      elsif exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') opening_line(value)
        where app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty') <> 0
          and not exists (
            select 1
            from pg_catalog.jsonb_array_elements(v_stock_transactions) stock_transaction(value)
            cross join lateral pg_catalog.jsonb_array_elements(stock_transaction.value -> 'items') transaction_line(value)
            where stock_transaction.value ->> 'id' is not distinct from
                'opening-balance:' || (v_source ->> 'id') || ':' || pg_catalog.left(
                  app_private.sha256_text(opening_line.value ->> 'warehouse_id'), 16
                )
              and stock_transaction.value ->> 'source_type' = 'project_opening_balance'
              and stock_transaction.value ->> 'source_id' =
                  (v_source ->> 'id') || ':' || (opening_line.value ->> 'warehouse_id')
              and stock_transaction.value ->> 'target_warehouse_id' = opening_line.value ->> 'warehouse_id'
              and transaction_line.value ->> 'itemId' = opening_line.value ->> 'inventory_item_id'
              and app_private.try_wms_reconciliation_numeric_20_6(transaction_line.value ->> 'quantity') =
                  app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty')
              and app_private.normalize_quantity_unit(coalesce(transaction_line.value ->> 'unitSnapshot', transaction_line.value ->> 'unit')) =
                  app_private.normalize_quantity_unit(opening_line.value ->> 'unit')
          )
      ) or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') opening_line(value)
        where app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty') <> 0
          and not exists (
            select 1 from pg_catalog.jsonb_array_elements(v_ledger_entries) ledger_line(value)
            where ledger_line.value ->> 'material_id' = opening_line.value ->> 'inventory_item_id'
              and ledger_line.value ->> 'warehouse_id' = opening_line.value ->> 'warehouse_id'
              and app_private.normalize_quantity_unit(ledger_line.value ->> 'unit') =
                  app_private.normalize_quantity_unit(opening_line.value ->> 'unit')
              and app_private.try_wms_reconciliation_numeric_20_6(ledger_line.value ->> 'quantity_in') =
                  app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty')
              and app_private.try_wms_reconciliation_numeric_20_6(ledger_line.value ->> 'quantity_out') = 0
              and app_private.try_wms_reconciliation_numeric_20_6(ledger_line.value ->> 'quantity_delta') =
                  app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty')
          )
      ) or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_stock_transactions) stock_transaction(value)
        where not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'ledgerHeaders') header(value)
          where header.value #>> '{header,source_type}' = 'wms_transaction'
            and header.value #>> '{header,source_id}' = stock_transaction.value ->> 'id'
            and header.value #>> '{header,status}' = 'posted'
            and pg_catalog.jsonb_array_length(header.value -> 'ledgerEntries') > 0
        )
      ) or (
        v_source ->> 'status' = 'void' and exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') opening_line(value)
          where app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty') <> 0
            and not exists (
              select 1
              from pg_catalog.jsonb_array_elements(v_stock_transactions) stock_transaction(value)
              cross join lateral pg_catalog.jsonb_array_elements(stock_transaction.value -> 'items') transaction_line(value)
              where coalesce(v_source -> 'reversal_stock_transaction_ids', '[]'::jsonb) ? (stock_transaction.value ->> 'id')
                and stock_transaction.value ->> 'source_type' = 'project_opening_balance_reversal'
                and stock_transaction.value ->> 'source_id' =
                    (v_source ->> 'id') || ':' || (opening_line.value ->> 'warehouse_id')
                and transaction_line.value ->> 'itemId' = opening_line.value ->> 'inventory_item_id'
                and app_private.try_wms_reconciliation_numeric_20_6(transaction_line.value ->> 'quantity') =
                    -app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty')
                and exists (
                  select 1
                  from pg_catalog.jsonb_array_elements(v_ledger_entries) ledger_line(value)
                  where ledger_line.value ->> 'source_id' = stock_transaction.value ->> 'id'
                    and ledger_line.value ->> 'material_id' = opening_line.value ->> 'inventory_item_id'
                    and ledger_line.value ->> 'warehouse_id' = opening_line.value ->> 'warehouse_id'
                    and app_private.try_wms_reconciliation_numeric_20_6(ledger_line.value ->> 'quantity_out') =
                        app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty')
                    and app_private.try_wms_reconciliation_numeric_20_6(ledger_line.value ->> 'quantity_delta') =
                       -app_private.try_wms_reconciliation_numeric_20_6(opening_line.value ->> 'remaining_qty')
                )
            )
        )
      ) then
        v_anchor_valid := false;
        v_reason := 'opening lines do not exactly match transactionItems and ledger quantities';
      end if;
    end if;

    for v_line in
      select line.value, line.ordinality
      from pg_catalog.jsonb_array_elements(v_frozen.payload -> 'lines') with ordinality line(value, ordinality)
    loop
      v_item_id := nullif(v_line.value ->> 'inventory_item_id', '');
      v_warehouse_id := nullif(v_line.value ->> 'warehouse_id', '');
      v_unit := nullif(v_line.value ->> 'unit', '');
      v_quantity := app_private.try_wms_reconciliation_numeric_20_6(v_line.value ->> 'remaining_qty');
      v_uom_invalid := v_item_id is null or v_warehouse_id is null
        or not ((v_frozen.payload -> 'catalogItems') ? coalesce(v_item_id, ''))
        or v_unit is null
        or app_private.normalize_quantity_unit(v_unit) is distinct from
           app_private.normalize_quantity_unit(v_frozen.payload #>> array['catalogItems', coalesce(v_item_id, ''), 'unit']);
      v_line_valid := v_anchor_valid and not v_uom_invalid and v_quantity is not null;
      v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
        'phase', 'opening_balance', 'frozenSourceHash', v_frozen.source_hash,
        'lineOrdinality', v_line.ordinality, 'line', v_line.value,
        'commandResult', v_command_result, 'reversalResult', v_reversal_result,
        'stockTransactions', v_stock_transactions, 'transactionItems', v_transaction_items,
        'originalStockTransactions', v_original_stock_transactions,
        'reversalStockTransactions', v_reversal_stock_transactions,
        'originalLedgerHeaders', v_original_ledger_headers,
        'reversalLedgerHeaders', v_reversal_ledger_headers,
        'originalValidation', v_original_validation,
        'reversalValidation', v_reversal_validation,
        'ledgerQuantities', v_ledger_quantities,
        'policyVersion', p_source_snapshot -> 'policyVersion'
      )::text);
      insert into public.wms_reconciliation_findings (
        run_id, finding_type, severity, confidence, item_id, warehouse_id, unit,
        raw_value_text, raw_values, before_qty, expected_qty, delta_qty,
        evidence, blockers, proposed_action, precondition_hash, status, quarantine_reason
      )
      select p_run_id,
        case when v_line_valid then 'PHYSICAL_ANCHOR'
             when v_uom_invalid then 'UOM_PRECISION' else 'LINEAGE_GAP' end,
        case when v_line_valid then 'P2' else 'P1' end,
        case when v_line_valid then 'high' else 'low' end,
        v_item_id, v_warehouse_id, v_unit, v_line.value::text,
        pg_catalog.jsonb_build_object('remainingQty', v_line.value ->> 'remaining_qty'),
        null, case when v_source ->> 'status' = 'void' then 0 else v_quantity end,
        case when v_source ->> 'status' = 'void' then -v_quantity else v_quantity end,
        pg_catalog.jsonb_build_object(
          'frozenSourceHash', v_frozen.source_hash, 'validAnchor', v_line_valid,
          'source', v_source, 'commandResult', v_command_result,
          'reversalResult', v_reversal_result, 'stockTransactions', v_stock_transactions,
          'transactionItems', v_transaction_items, 'ledgerEntries', v_ledger_entries,
          'ledgerQuantities', v_ledger_quantities,
          'originalStockTransactions', v_original_stock_transactions,
          'reversalStockTransactions', v_reversal_stock_transactions,
          'originalLedgerHeaders', v_original_ledger_headers,
          'reversalLedgerHeaders', v_reversal_ledger_headers,
          'originalValidation', v_original_validation,
          'reversalValidation', v_reversal_validation
        ),
        case when v_line_valid then '[]'::jsonb else pg_catalog.jsonb_build_array(coalesce(v_reason, 'invalid opening line')) end,
        case when v_line_valid then 'use_as_opening_anchor' else 'manual_review' end,
        v_precondition_hash, case when v_line_valid then 'open' else 'quarantined' end,
        case when v_line_valid then null else coalesce(v_reason, 'invalid opening line') end
      where not exists (
        select 1 from public.wms_reconciliation_findings finding
        where finding.run_id = p_run_id
          and finding.finding_type = case when v_line_valid then 'PHYSICAL_ANCHOR'
            when v_uom_invalid then 'UOM_PRECISION' else 'LINEAGE_GAP' end
          and finding.item_id is not distinct from v_item_id
          and finding.warehouse_id is not distinct from v_warehouse_id
          and finding.precondition_hash = v_precondition_hash
      );
    end loop;

    if v_anchor_valid then
      select coalesce(pg_catalog.jsonb_agg(value order by value), '[]'::jsonb)
      into v_excluded_ids
      from (
        select value from pg_catalog.jsonb_array_elements_text(coalesce(v_source -> 'stock_transaction_ids', '[]'::jsonb)) original(value)
        union
        select value from pg_catalog.jsonb_array_elements_text(coalesce(v_source -> 'reversal_stock_transaction_ids', '[]'::jsonb)) reversal(value)
      ) ids;
      insert into app_private.wms_reconciliation_run_work (
        run_id, phase, source_key, source_hash, payload
      ) values (
        p_run_id, 'opening_balance', v_source ->> 'id', v_frozen.source_hash,
        pg_catalog.jsonb_build_object(
          'validAnchor', true, 'excludedTransactionIds', v_excluded_ids,
          'anchorDate', v_source ->> 'as_of_date', 'ledgerQuantities', v_ledger_quantities
        )
      ) on conflict (run_id, phase, source_key, warehouse_id, item_id) do nothing;
    end if;

    v_last_at := v_frozen.sort_at;
    v_last_id := v_frozen.sort_id;
    v_processed := v_processed + 1;
  end loop;

  v_complete := not exists (
    select 1 from app_private.wms_reconciliation_frozen_sources frozen
    where frozen.run_id = p_run_id and frozen.phase = 'opening_balance'
      and (v_last_at is null or frozen.sort_at > v_last_at or (frozen.sort_at = v_last_at and frozen.sort_id > v_last_id))
  );
  return pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'opening_balance', 'lastKey',
      case when v_last_at is null then null else pg_catalog.jsonb_build_object('date', v_last_at, 'id', v_last_id) end),
    'processed', v_processed, 'complete', v_complete
  );
end;
$$;

revoke all on function app_private.scan_wms_reconciliation_phase_opening_balance(uuid,integer,jsonb,jsonb)
  from public, anon, authenticated, service_role;

create or replace function app_private.scan_wms_reconciliation_phase_transaction_ledger(
  p_run_id uuid,
  p_batch_size integer,
  p_cursor jsonb,
  p_source_snapshot jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_run public.wms_reconciliation_runs%rowtype;
  v_frozen record;
  v_line record;
  v_movement record;
  v_ledger_only record;
  v_source jsonb;
  v_ledger_headers jsonb;
  v_ledger_entries jsonb;
  v_ledger_quantities jsonb;
  v_validation jsonb;
  v_last_at timestamptz;
  v_last_id text;
  v_processed integer := 0;
  v_complete boolean;
  v_line_valid boolean;
  v_uom_invalid boolean;
  v_header_valid boolean;
  v_exposure_valid boolean;
  v_required_warehouse text;
  v_item_id text;
  v_unit text;
  v_quantity numeric;
  v_ledger_qty numeric;
  v_ledger_unit_count integer;
  v_finding_type text;
  v_status text;
  v_confidence text;
  v_reason text;
  v_precondition_hash text;
begin
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception 'transaction ledger batch size must be between 1 and 500'
      using errcode = '22023';
  end if;
  perform app_private.assert_wms_reconciliation_b2b_fingerprints(p_run_id, p_source_snapshot);
  select run.* into v_run from public.wms_reconciliation_runs run where run.id = p_run_id;
  if pg_catalog.jsonb_typeof(p_cursor) <> 'object'
     or p_cursor ->> 'phase' is distinct from 'transaction_ledger'
     or not (p_cursor ? 'lastKey') then
    raise exception 'invalid transaction ledger cursor' using errcode = '22023';
  end if;
  if p_cursor -> 'lastKey' <> 'null'::jsonb then
    begin
      v_last_at := (p_cursor #>> '{lastKey,date}')::timestamptz;
      v_last_id := p_cursor #>> '{lastKey,id}';
      if not pg_catalog.isfinite(v_last_at) or nullif(pg_catalog.btrim(v_last_id), '') is null then
        raise exception 'invalid transaction ledger lastKey' using errcode = '22023';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid transaction ledger lastKey' using errcode = '22023';
    end;
  end if;

  for v_frozen in
    select frozen.*
    from app_private.wms_reconciliation_frozen_sources frozen
    where frozen.run_id = p_run_id and frozen.phase = 'transaction_ledger'
      and (v_last_at is null or frozen.sort_at > v_last_at or (frozen.sort_at = v_last_at and frozen.sort_id > v_last_id))
    order by frozen.sort_at, frozen.sort_id
    limit p_batch_size
  loop
    v_source := v_frozen.payload -> 'transaction';
    v_ledger_headers := v_frozen.payload -> 'ledgerHeaders';
    v_validation := app_private.validate_wms_reconciliation_frozen_transaction(
      v_source, v_frozen.payload -> 'ledgerHeaders'
    );
    -- Quarantined anchors never write run_work, and only validAnchor work may
    -- exclude its deterministic adjustment from normal transaction replay.
    if exists (
      select 1
      from app_private.wms_reconciliation_run_work anchor_work
      where anchor_work.run_id = p_run_id
        and anchor_work.phase in ('physical_anchor', 'opening_balance')
        and anchor_work.payload ->> 'validAnchor' = 'true'
        and anchor_work.payload -> 'excludedTransactionIds' ? v_frozen.source_key
    ) then
      v_last_at := v_frozen.sort_at;
      v_last_id := v_frozen.sort_id;
      v_processed := v_processed + 1;
      continue;
    end if;

    select coalesce(pg_catalog.jsonb_agg(entry.value order by entry.value ->> 'created_at', entry.value ->> 'id'), '[]'::jsonb)
    into v_ledger_entries
    from pg_catalog.jsonb_array_elements(v_ledger_headers) header(value)
    cross join lateral pg_catalog.jsonb_array_elements(header.value -> 'ledgerEntries') entry(value);
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', entry.value ->> 'id', 'itemId', entry.value ->> 'material_id',
      'warehouseId', entry.value ->> 'warehouse_id', 'unit', entry.value ->> 'unit',
      'direction', entry.value ->> 'movement_direction',
      'quantityIn', entry.value ->> 'quantity_in', 'quantityOut', entry.value ->> 'quantity_out',
      'quantityDelta', entry.value ->> 'quantity_delta'
    ) order by entry.value ->> 'id'), '[]'::jsonb)
    into v_ledger_quantities
    from pg_catalog.jsonb_array_elements(v_ledger_entries) entry(value);

    v_header_valid := (v_validation ->> 'headerValid')::boolean is true;
    v_exposure_valid := pg_catalog.jsonb_array_length(v_frozen.payload -> 'exposureWindows') = 1
      and v_frozen.payload #>> '{exposureWindows,0,legacyFunctionHash}' =
          app_private.wms_reconciliation_known_wf001_legacy_function_hash()
      and v_frozen.payload #>> '{exposureWindows,0,deploymentEvidenceHash}' ~ '^[0-9a-f]{64}$'
      and v_source ->> 'posting_engine_version' is not distinct from
          v_frozen.payload #>> '{exposureWindows,0,postingEngineVersion}'
      and v_frozen.payload ->> 'postingFunctionFingerprint' =
          app_private.wms_reconciliation_known_wf001_legacy_function_hash()
      and v_frozen.payload ->> 'postingFunctionFingerprint' =
          v_frozen.payload #>> '{exposureWindows,0,legacyFunctionHash}'
      and (v_validation ->> 'sourceValid')::boolean is true
      and (v_validation ->> 'headerValid')::boolean is true
      and (v_validation ->> 'entryIdentityValid')::boolean is true
      and (v_ledger_headers #>> '{0,header,posted_at}')::timestamptz >=
          (v_frozen.payload #>> '{exposureWindows,0,effectiveFrom}')::timestamptz
      and (v_ledger_headers #>> '{0,header,posted_at}')::timestamptz <
          (v_frozen.payload #>> '{exposureWindows,0,effectiveTo}')::timestamptz;

    -- Invalid lines are reported individually and excluded from all movement
    -- aggregates. No invalid numeric ever becomes zero.
    if pg_catalog.jsonb_typeof(v_source -> 'items') <> 'array'
       or pg_catalog.jsonb_array_length(v_source -> 'items') = 0 then
      v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
        'phase', 'transaction_ledger', 'frozenSourceHash', v_frozen.source_hash,
        'reason', 'items are not a non-empty array', 'ledgerQuantities', v_ledger_quantities,
        'policyVersion', p_source_snapshot -> 'policyVersion'
      )::text);
      insert into public.wms_reconciliation_findings (
        run_id, finding_type, severity, confidence, raw_values, evidence, blockers,
        proposed_action, precondition_hash, status, quarantine_reason
      ) select p_run_id, 'LINEAGE_GAP', 'P1', 'low', pg_catalog.jsonb_build_object('items', v_source -> 'items'),
        pg_catalog.jsonb_build_object('frozenSourceHash', v_frozen.source_hash, 'source', v_source,
          'ledgerEntries', v_ledger_entries, 'ledgerQuantities', v_ledger_quantities),
        '["transaction items are missing"]'::jsonb, 'manual_review', v_precondition_hash,
        'quarantined', 'transaction items are missing'
      where not exists (
        select 1 from public.wms_reconciliation_findings finding
        where finding.run_id = p_run_id and finding.finding_type = 'LINEAGE_GAP'
          and finding.precondition_hash = v_precondition_hash
      );
    else
      for v_line in
        select line.value, line.ordinality
        from pg_catalog.jsonb_array_elements(v_source -> 'items') with ordinality line(value, ordinality)
      loop
        v_item_id := nullif(v_line.value ->> 'itemId', '');
        v_unit := nullif(coalesce(v_line.value ->> 'unitSnapshot', v_line.value ->> 'unit'), '');
        v_quantity := app_private.try_wms_reconciliation_numeric_20_6(v_line.value ->> 'quantity');
        v_uom_invalid := v_item_id is null
          or not ((v_frozen.payload -> 'catalogItems') ? coalesce(v_item_id, ''))
          or v_unit is null
          or app_private.normalize_quantity_unit(v_unit) is distinct from
             app_private.normalize_quantity_unit(v_frozen.payload #>> array['catalogItems', coalesce(v_item_id, ''), 'unit']);
        v_required_warehouse := case v_source ->> 'type'
          when 'IMPORT' then v_source ->> 'target_warehouse_id'
          when 'EXPORT' then v_source ->> 'source_warehouse_id'
          when 'LIQUIDATION' then v_source ->> 'source_warehouse_id'
          when 'TRANSFER' then coalesce(v_source ->> 'source_warehouse_id', v_source ->> 'target_warehouse_id')
          when 'ADJUSTMENT' then coalesce(v_source ->> 'target_warehouse_id', v_source ->> 'source_warehouse_id')
        end;
        v_line_valid := v_quantity is not null and not v_uom_invalid
          and (v_source ->> 'type' = 'ADJUSTMENT' or v_quantity >= 0)
          and nullif(v_required_warehouse, '') is not null
          and case
            when v_source ->> 'type' in ('EXPORT','LIQUIDATION','TRANSFER') then
              coalesce((v_frozen.payload #>> '{warehouseExistence,source}')::boolean, false)
            else true
          end
          and case
            when v_source ->> 'type' in ('IMPORT','TRANSFER')
              or (v_source ->> 'type' = 'ADJUSTMENT' and v_source ->> 'target_warehouse_id' is not null) then
              coalesce((v_frozen.payload #>> '{warehouseExistence,target}')::boolean, false)
            else true
          end;
        if not v_line_valid then
          v_reason := case
            when v_uom_invalid then 'invalid UOM or item catalog snapshot'
            when nullif(v_required_warehouse, '') is null then 'required warehouse is missing'
            when v_quantity is null then 'quantity is invalid, over-scale, huge exponent or numeric(20,6) overflow'
            else 'warehouse is missing from frozen catalog or quantity sign is invalid for this transaction type'
          end;
          v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
            'phase', 'transaction_ledger', 'frozenSourceHash', v_frozen.source_hash,
            'lineOrdinality', v_line.ordinality, 'line', v_line.value,
            'reason', v_reason, 'ledgerQuantities', v_ledger_quantities,
            'policyVersion', p_source_snapshot -> 'policyVersion'
          )::text);
          insert into public.wms_reconciliation_findings (
            run_id, finding_type, severity, confidence, item_id, warehouse_id, unit,
            raw_value_text, raw_values, evidence, blockers, proposed_action,
            precondition_hash, status, quarantine_reason
          ) select p_run_id, case when v_uom_invalid then 'UOM_PRECISION' else 'LINEAGE_GAP' end,
            'P1', 'low', v_item_id, v_required_warehouse, v_unit, v_line.value::text,
            pg_catalog.jsonb_build_object('quantity', v_line.value ->> 'quantity'),
            pg_catalog.jsonb_build_object('frozenSourceHash', v_frozen.source_hash,
              'validLine', false, 'source', v_source, 'ledgerEntries', v_ledger_entries,
              'ledgerQuantities', v_ledger_quantities),
            pg_catalog.jsonb_build_array(v_reason), 'manual_review', v_precondition_hash,
            'quarantined', v_reason
          where not exists (
            select 1 from public.wms_reconciliation_findings finding
            where finding.run_id = p_run_id
              and finding.finding_type = case when v_uom_invalid then 'UOM_PRECISION' else 'LINEAGE_GAP' end
              and finding.item_id is not distinct from v_item_id
              and finding.warehouse_id is not distinct from v_required_warehouse
              and finding.precondition_hash = v_precondition_hash
          );
        end if;
      end loop;

      for v_movement in
        with expected_entry as (
          select expected.value
          from pg_catalog.jsonb_array_elements(v_validation -> 'expectedEntries') expected(value)
        )
        select
          expected_entry.value ->> 'itemId' as item_id,
          expected_entry.value ->> 'warehouseId' as warehouse_id,
          expected_entry.value ->> 'direction' as movement_direction,
          expected_entry.value ->> 'unit' as unit,
          pg_catalog.sum(case when expected_entry.value ->> 'direction' = 'in'
            then app_private.try_wms_reconciliation_numeric_20_6(expected_entry.value ->> 'quantityIn')
            else app_private.try_wms_reconciliation_numeric_20_6(expected_entry.value ->> 'quantityOut')
          end)::numeric(20,6) as expected_qty,
          pg_catalog.sum(case when expected_entry.value ->> 'direction' = 'in'
            then app_private.try_wms_reconciliation_numeric_20_6(expected_entry.value ->> 'roundedQuantityIn')
            else app_private.try_wms_reconciliation_numeric_20_6(expected_entry.value ->> 'roundedQuantityOut')
          end)::numeric(20,6) as rounded_qty,
          pg_catalog.count(*) as source_line_count
        from expected_entry
        group by expected_entry.value ->> 'itemId', expected_entry.value ->> 'warehouseId',
          expected_entry.value ->> 'direction', expected_entry.value ->> 'unit'
      loop
        select
          coalesce(pg_catalog.sum(case when v_movement.movement_direction = 'in'
            then app_private.try_wms_reconciliation_numeric_20_6(entry.value ->> 'quantity_in')
            else app_private.try_wms_reconciliation_numeric_20_6(entry.value ->> 'quantity_out') end), 0)::numeric(20,6),
          pg_catalog.count(distinct app_private.normalize_quantity_unit(entry.value ->> 'unit'))
        into v_ledger_qty, v_ledger_unit_count
        from pg_catalog.jsonb_array_elements(v_ledger_entries) entry(value)
        where entry.value ->> 'material_id' = v_movement.item_id
          and entry.value ->> 'warehouse_id' = v_movement.warehouse_id
          and entry.value ->> 'movement_direction' = v_movement.movement_direction;

        if (v_validation ->> 'headerExists')::boolean is not true then
          v_finding_type := 'TX_LEDGER_MISSING';
          v_status := 'quarantined'; v_confidence := 'low';
          v_reason := 'immutable posted ledger header is missing';
        elsif (v_validation ->> 'headerValid')::boolean is not true
           or (v_validation ->> 'entryIdentityValid')::boolean is not true then
          v_finding_type := 'LINEAGE_GAP';
          v_status := 'quarantined'; v_confidence := 'low';
          v_reason := 'immutable header or entry identity differs from exact frozen source lineage';
        elsif v_ledger_unit_count > 1 then
          v_finding_type := 'UOM_PRECISION'; v_status := 'quarantined'; v_confidence := 'low';
          v_reason := 'mixed ledger units require quarantine';
        elsif (v_validation ->> 'quantityExact')::boolean is true then
          v_finding_type := null;
        elsif (v_validation ->> 'quantityRounded')::boolean is true then
          v_finding_type := 'DECIMAL_APPLY';
          if v_exposure_valid then
            v_status := 'open'; v_confidence := 'high';
            v_reason := 'PostgreSQL per-line numeric::integer rounding matches operator-attested legacy function fingerprint';
          else
            v_status := 'quarantined'; v_confidence := 'low';
            v_reason := 'rounding fingerprint lacks matching posted/completion evidence inside an active WF-001 exposure window';
          end if;
        else
          v_finding_type := case when (v_validation ->> 'quantityExact')::boolean is false
            then 'TX_LEDGER_MISMATCH' else 'LINEAGE_GAP' end;
          v_status := 'quarantined'; v_confidence := 'medium';
          v_reason := 'frozen source quantity and immutable ledger quantity differ';
        end if;

        if v_finding_type is not null then
          v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
            'phase', 'transaction_ledger', 'frozenSourceHash', v_frozen.source_hash,
            'itemId', v_movement.item_id, 'warehouseId', v_movement.warehouse_id,
            'direction', v_movement.movement_direction, 'expectedQty', v_movement.expected_qty,
            'roundedQty', v_movement.rounded_qty, 'ledgerQuantities', v_ledger_quantities,
            'validation', v_validation,
            'exposureWindows', v_frozen.payload -> 'exposureWindows',
            'frozenCanonicalFingerprint', v_frozen.payload #>> '{postingFunctionFingerprint}',
            'canonicalWf001LegacyFunctionHash', app_private.wms_reconciliation_known_wf001_legacy_function_hash(),
            'immutableHeaderPostedAt', v_ledger_headers #>> '{0,header,posted_at}',
            'policyVersion', p_source_snapshot -> 'policyVersion'
          )::text);
          insert into public.wms_reconciliation_findings (
            run_id, finding_type, severity, confidence, item_id, warehouse_id, unit,
            raw_value_text, raw_values, before_qty, expected_qty, delta_qty,
            evidence, blockers, proposed_action, precondition_hash, status, quarantine_reason
          ) select p_run_id, v_finding_type,
            case when v_finding_type in ('TX_LEDGER_MISSING','LINEAGE_GAP') then 'P1' else 'P2' end,
            v_confidence, v_movement.item_id, v_movement.warehouse_id, v_movement.unit,
            v_source -> 'items' ->> 0,
            pg_catalog.jsonb_build_object('sourceItems', v_source -> 'items'),
            v_ledger_qty, v_movement.expected_qty, v_movement.expected_qty - v_ledger_qty,
            pg_catalog.jsonb_build_object(
              'frozenSourceHash', v_frozen.source_hash, 'validLine', true,
              'source', v_source, 'movementDirection', v_movement.movement_direction,
              'ledgerHeaders', v_ledger_headers, 'ledgerEntries', v_ledger_entries,
              'ledgerQuantities', v_ledger_quantities,
              'validation', v_validation,
              'roundedQty', app_private.wms_reconciliation_decimal_text(v_movement.rounded_qty),
              'exposureWindows', v_frozen.payload -> 'exposureWindows',
              'legacyFunctionHash', v_frozen.payload #>> '{exposureWindows,0,legacyFunctionHash}',
              'deploymentEvidenceHash', v_frozen.payload #>> '{exposureWindows,0,deploymentEvidenceHash}',
              'frozenCanonicalFingerprint', v_frozen.payload #>> '{postingFunctionFingerprint}',
              'canonicalWf001LegacyFunctionHash', app_private.wms_reconciliation_known_wf001_legacy_function_hash(),
              'postingEngineVersion', v_source ->> 'posting_engine_version',
              'immutableHeaderPostedAt', v_ledger_headers #>> '{0,header,posted_at}'
            ),
            case when v_status = 'quarantined' then pg_catalog.jsonb_build_array(v_reason) else '[]'::jsonb end,
            case when v_status = 'open' then 'review_decimal_repair' else 'manual_review' end,
            v_precondition_hash, v_status,
            case when v_status = 'quarantined' then v_reason else null end
          where not exists (
            select 1 from public.wms_reconciliation_findings finding
            where finding.run_id = p_run_id and finding.finding_type = v_finding_type
              and finding.item_id is not distinct from v_movement.item_id
              and finding.warehouse_id is not distinct from v_movement.warehouse_id
              and finding.precondition_hash = v_precondition_hash
          );
        end if;
      end loop;

      -- Ledger-only evidence is scoped before classification. Mixed units are
      -- quarantined; no arbitrary min(unit) is selected.
      for v_ledger_only in
        with ledger_group as (
          select
            entry.value ->> 'material_id' as item_id,
            entry.value ->> 'warehouse_id' as warehouse_id,
            entry.value ->> 'movement_direction' as movement_direction,
            pg_catalog.count(distinct app_private.normalize_quantity_unit(entry.value ->> 'unit')) as unit_count,
            pg_catalog.jsonb_agg(distinct pg_catalog.to_jsonb(entry.value ->> 'unit')) as units,
            coalesce(pg_catalog.sum(case when entry.value ->> 'movement_direction' = 'in'
              then app_private.try_wms_reconciliation_numeric_20_6(entry.value ->> 'quantity_in')
              else app_private.try_wms_reconciliation_numeric_20_6(entry.value ->> 'quantity_out') end), 0)::numeric(20,6) as ledger_qty
          from pg_catalog.jsonb_array_elements(v_ledger_entries) entry(value)
          where (
            v_run.scope -> 'warehouseIds' = '["*"]'::jsonb
            or (v_run.scope -> 'warehouseIds') ? (entry.value ->> 'warehouse_id')
          )
            and (
              pg_catalog.jsonb_array_length(v_run.scope -> 'itemIds') = 0
              or (v_run.scope -> 'itemIds') ? (entry.value ->> 'material_id')
            )
          group by entry.value ->> 'material_id', entry.value ->> 'warehouse_id', entry.value ->> 'movement_direction'
        )
        select ledger_group.*
        from ledger_group
        where not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_source -> 'items') line(value)
          where line.value ->> 'itemId' = ledger_group.item_id
            and app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'quantity') is not null
            and (
              (v_source ->> 'type' = 'ADJUSTMENT'
                and ledger_group.warehouse_id = coalesce(
                  v_source ->> 'target_warehouse_id', v_source ->> 'source_warehouse_id'
                )
                and ledger_group.movement_direction = case
                  when app_private.try_wms_reconciliation_numeric_20_6(line.value ->> 'quantity') < 0
                    then 'out' else 'in' end)
              or
              (ledger_group.movement_direction = 'in' and ledger_group.warehouse_id = v_source ->> 'target_warehouse_id'
                and v_source ->> 'type' in ('IMPORT','TRANSFER'))
              or (ledger_group.movement_direction = 'out' and ledger_group.warehouse_id = v_source ->> 'source_warehouse_id'
                and v_source ->> 'type' in ('EXPORT','LIQUIDATION','TRANSFER'))
            )
        )
      loop
        v_finding_type := case when v_ledger_only.unit_count > 1 then 'UOM_PRECISION' else 'TX_LEDGER_MISMATCH' end;
        v_reason := case when v_ledger_only.unit_count > 1 then 'mixed ledger units require quarantine'
          else 'immutable ledger movement has no matching valid source aggregate' end;
        v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
          'phase', 'transaction_ledger', 'frozenSourceHash', v_frozen.source_hash,
          'ledgerOnlyItem', v_ledger_only.item_id, 'ledgerOnlyWarehouse', v_ledger_only.warehouse_id,
          'direction', v_ledger_only.movement_direction, 'units', v_ledger_only.units,
          'ledgerQuantities', v_ledger_quantities, 'policyVersion', p_source_snapshot -> 'policyVersion'
        )::text);
        insert into public.wms_reconciliation_findings (
          run_id, finding_type, severity, confidence, item_id, warehouse_id,
          raw_values, before_qty, expected_qty, delta_qty, evidence, blockers,
          proposed_action, precondition_hash, status, quarantine_reason
        ) select p_run_id, v_finding_type, 'P1', 'low', v_ledger_only.item_id,
          v_ledger_only.warehouse_id, pg_catalog.jsonb_build_object('units', v_ledger_only.units),
          v_ledger_only.ledger_qty, 0, -v_ledger_only.ledger_qty,
          pg_catalog.jsonb_build_object('frozenSourceHash', v_frozen.source_hash,
            'source', v_source, 'movementDirection', v_ledger_only.movement_direction,
            'ledgerEntries', v_ledger_entries, 'ledgerQuantities', v_ledger_quantities),
          pg_catalog.jsonb_build_array(v_reason), 'manual_review', v_precondition_hash,
          'quarantined', v_reason
        where not exists (
          select 1 from public.wms_reconciliation_findings finding
          where finding.run_id = p_run_id and finding.finding_type = v_finding_type
            and finding.item_id is not distinct from v_ledger_only.item_id
            and finding.warehouse_id is not distinct from v_ledger_only.warehouse_id
            and finding.precondition_hash = v_precondition_hash
        );
      end loop;
    end if;

    v_last_at := v_frozen.sort_at;
    v_last_id := v_frozen.sort_id;
    v_processed := v_processed + 1;
  end loop;

  v_complete := not exists (
    select 1 from app_private.wms_reconciliation_frozen_sources frozen
    where frozen.run_id = p_run_id and frozen.phase = 'transaction_ledger'
      and (v_last_at is null or frozen.sort_at > v_last_at or (frozen.sort_at = v_last_at and frozen.sort_id > v_last_id))
  );
  return pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'transaction_ledger', 'lastKey',
      case when v_last_at is null then null else pg_catalog.jsonb_build_object('date', v_last_at, 'id', v_last_id) end),
    'processed', v_processed, 'complete', v_complete
  );
end;
$$;

revoke all on function app_private.scan_wms_reconciliation_phase_transaction_ledger(uuid,integer,jsonb,jsonb)
  from public, anon, authenticated, service_role;

reset statement_timeout;
