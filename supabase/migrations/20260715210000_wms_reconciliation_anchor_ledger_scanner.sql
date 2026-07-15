-- Release B2b: concrete read-only anchor and WMS transaction/ledger scanners.
-- Only reconciliation findings and the private run-work table are written.

set lock_timeout = '5s';
set statement_timeout = '60s';

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
  v_source record;
  v_command record;
  v_adjustment public.transactions%rowtype;
  v_ledger_header public.inventory_transactions%rowtype;
  v_item record;
  v_last_date timestamptz;
  v_last_id text;
  v_cutoff_at timestamptz;
  v_cutoff_id uuid;
  v_processed integer := 0;
  v_complete boolean;
  v_provenance_reason text;
  v_item_reason text;
  v_finding_type text;
  v_item_id text;
  v_unit text;
  v_raw_actual text;
  v_raw_system text;
  v_raw_delta text;
  v_actual numeric;
  v_system numeric;
  v_delta numeric;
  v_max_fraction_digits smallint;
  v_precondition_hash text;
  v_evidence jsonb;
  v_excluded_ids jsonb;
  v_boundary jsonb;
begin
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception 'physical anchor batch size must be between 1 and 500'
      using errcode = '22023';
  end if;

  select run.* into v_run
  from public.wms_reconciliation_runs run
  where run.id = p_run_id;
  if not found then
    raise exception 'WMS reconciliation run does not exist' using errcode = 'P0002';
  end if;
  if p_source_snapshot is distinct from v_run.source_snapshot
     or pg_catalog.jsonb_typeof(p_source_snapshot) <> 'object' then
    raise exception 'physical anchor source snapshot differs from the frozen run boundary'
      using errcode = '40001';
  end if;
  if pg_catalog.jsonb_typeof(p_cursor) <> 'object'
     or p_cursor ->> 'phase' is distinct from 'physical_anchor'
     or not (p_cursor ? 'lastKey') then
    raise exception 'invalid physical anchor cursor' using errcode = '22023';
  end if;
  if p_cursor -> 'lastKey' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_cursor -> 'lastKey') <> 'object'
       or not ((p_cursor -> 'lastKey') ?& array['date', 'id'])
       or pg_catalog.jsonb_typeof(p_cursor -> 'lastKey' -> 'date') <> 'string'
       or pg_catalog.jsonb_typeof(p_cursor -> 'lastKey' -> 'id') <> 'string' then
      raise exception 'physical anchor lastKey must contain date and id'
        using errcode = '22023';
    end if;
    begin
      v_last_date := (p_cursor -> 'lastKey' ->> 'date')::timestamptz;
      v_last_id := p_cursor -> 'lastKey' ->> 'id';
      if not pg_catalog.isfinite(v_last_date) or nullif(pg_catalog.btrim(v_last_id), '') is null then
        raise exception 'invalid physical anchor lastKey' using errcode = '22023';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid physical anchor lastKey' using errcode = '22023';
    end;
  end if;

  if p_source_snapshot -> 'auditCommandCutoff' is not null
     and p_source_snapshot -> 'auditCommandCutoff' <> 'null'::jsonb then
    begin
      v_cutoff_at := (p_source_snapshot -> 'auditCommandCutoff' ->> 'createdAt')::timestamptz;
      v_cutoff_id := (p_source_snapshot -> 'auditCommandCutoff' ->> 'id')::uuid;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception 'invalid frozen auditCommandCutoff' using errcode = '55000';
    end;
  end if;

  for v_source in
    select audit.*
    from public.audit_sessions audit
    where audit.date <= v_run.as_of
      and (v_run.affected_from is null or audit.date >= v_run.affected_from)
      and (
        (v_run.scope -> 'warehouseIds') = '["*"]'::jsonb
        or (v_run.scope -> 'warehouseIds') ? audit."warehouseId"
      )
      and (
        pg_catalog.jsonb_array_length(v_run.scope -> 'sourceTypes') = 0
        or (v_run.scope -> 'sourceTypes') ? 'physical_anchor'
        or (v_run.scope -> 'sourceTypes') ? 'inventory_audit'
      )
      and (
        pg_catalog.jsonb_array_length(v_run.scope -> 'itemIds') = 0
        or case when pg_catalog.jsonb_typeof(audit.items) = 'array' then exists (
          select 1
          from pg_catalog.jsonb_array_elements(audit.items) scoped_item(value)
          where (v_run.scope -> 'itemIds') ? (scoped_item.value ->> 'itemId')
        ) else false end
      )
      and (
        audit.command_id is null
        or not exists (
          select 1
          from app_private.inventory_audit_command_results any_command
          where any_command.command_id = audit.command_id
        )
        or exists (
          select 1
          from app_private.inventory_audit_command_results frozen_command
          where frozen_command.command_id = audit.command_id
            and v_cutoff_at is not null
            and (
              frozen_command.created_at < v_cutoff_at
              or (frozen_command.created_at = v_cutoff_at and frozen_command.command_id <= v_cutoff_id)
            )
        )
      )
      and (
        v_last_date is null
        or audit.date > v_last_date
        or (audit.date = v_last_date and audit.id > v_last_id)
      )
    order by audit.date, audit.id
    limit p_batch_size
  loop
    v_provenance_reason := null;
    v_excluded_ids := '[]'::jsonb;
    v_boundary := null;

    if v_source.command_id is null
       or v_source.request_hash !~ '^[0-9a-f]{64}$'
       or v_source.posting_engine_version is distinct from 'wf001-audit-v1' then
      v_provenance_reason := 'audit session is not controlled wf001-audit-v1 lineage';
    else
      select command_result.* into v_command
      from app_private.inventory_audit_command_results command_result
      where command_result.command_id = v_source.command_id
        and (
          v_cutoff_at is null
          or command_result.created_at < v_cutoff_at
          or (command_result.created_at = v_cutoff_at and command_result.command_id <= v_cutoff_id)
        );
      if not found
         or v_command.request_hash is distinct from v_source.request_hash
         or v_command.warehouse_id is distinct from v_source."warehouseId"
         or v_command.result -> 'audit_session' ->> 'id' is distinct from v_source.id
         or v_command.result -> 'audit_session' -> 'items' is distinct from v_source.items
         or v_command.result -> 'audit_session' ->> 'request_hash' is distinct from v_source.request_hash
         or v_command.result -> 'audit_session' ->> 'posting_engine_version'
              is distinct from v_source.posting_engine_version then
        v_provenance_reason := 'immutable audit command result does not match the session';
      end if;
    end if;

    if v_source."transactionId" is not null then
      if v_source.command_id is null
         or v_source."transactionId" is distinct from 'audit-adjustment-' || v_source.command_id::text then
        v_provenance_reason := coalesce(v_provenance_reason, 'audit adjustment identity is not deterministic');
      else
        select transaction_row.* into v_adjustment
        from public.transactions transaction_row
        where transaction_row.id = v_source."transactionId";
        if not found
           or v_adjustment.type::text <> 'ADJUSTMENT'
           or v_adjustment.status::text <> 'COMPLETED'
           or v_adjustment.source_type is distinct from 'inventory_audit'
           or v_adjustment.source_id is distinct from v_source.command_id::text
           or v_adjustment.target_warehouse_id is distinct from v_source."warehouseId" then
          v_provenance_reason := coalesce(v_provenance_reason, 'linked audit adjustment provenance is invalid');
        else
          v_excluded_ids := pg_catalog.jsonb_build_array(v_adjustment.id);
          select header.* into v_ledger_header
          from public.inventory_transactions header
          where header.source_type = 'wms_transaction'
            and header.source_id = v_adjustment.id;
          if not found then
            v_provenance_reason := coalesce(
              v_provenance_reason,
              'linked audit adjustment has no immutable ledger header'
            );
          end if;
          v_boundary := pg_catalog.jsonb_build_object(
            'transactionId', v_adjustment.id,
            'ledgerHeaderId', v_ledger_header.id,
            'lastLedgerEntry', (
              select pg_catalog.jsonb_build_object('createdAt', entry.created_at, 'id', entry.id)
              from public.inventory_ledger_entries entry
              where entry.inventory_transaction_id = v_ledger_header.id
              order by entry.created_at desc, entry.id desc
              limit 1
            ),
            'excludeFromReplay', true
          );
        end if;
      end if;
    end if;

    if pg_catalog.jsonb_typeof(v_source.items) <> 'array'
       or pg_catalog.jsonb_array_length(v_source.items) = 0 then
      v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
        'phase', 'physical_anchor', 'source', pg_catalog.to_jsonb(v_source),
        'policyVersion', p_source_snapshot -> 'policyVersion',
        'auditCommandCutoff', p_source_snapshot -> 'auditCommandCutoff'
      )::text);
      insert into public.wms_reconciliation_findings (
        run_id, finding_type, severity, confidence, warehouse_id,
        raw_value_text, raw_values, evidence, blockers, proposed_action,
        precondition_hash, status, quarantine_reason
      )
      select p_run_id, 'LINEAGE_GAP', 'P1', 'low', v_source."warehouseId",
        v_source.items::text, pg_catalog.jsonb_build_object('items', v_source.items),
        pg_catalog.jsonb_build_object('phase', 'physical_anchor', 'sourceId', v_source.id),
        pg_catalog.jsonb_build_array('audit items must be a non-empty JSON array'),
        'quarantine', v_precondition_hash, 'quarantined',
        'audit items are malformed'
      where not exists (
        select 1 from public.wms_reconciliation_findings finding
        where finding.run_id = p_run_id
          and finding.finding_type = 'LINEAGE_GAP'
          and finding.item_id is null
          and finding.warehouse_id is not distinct from v_source."warehouseId"
          and finding.precondition_hash = v_precondition_hash
      );
    else
      for v_item in
        select item.value, item.ordinality
        from pg_catalog.jsonb_array_elements(v_source.items) with ordinality item(value, ordinality)
        order by item.ordinality
      loop
        v_item_id := nullif(pg_catalog.btrim(v_item.value ->> 'itemId'), '');
        if pg_catalog.jsonb_array_length(v_run.scope -> 'itemIds') > 0
           and (v_item_id is null or not ((v_run.scope -> 'itemIds') ? v_item_id)) then
          continue;
        end if;
        v_unit := nullif(pg_catalog.btrim(v_item.value ->> 'unit'), '');
        v_raw_actual := v_item.value ->> 'actualStock';
        v_raw_system := v_item.value ->> 'systemStock';
        v_raw_delta := v_item.value ->> 'delta';
        v_item_reason := v_provenance_reason;
        v_actual := null;
        v_system := null;
        v_delta := null;

        if pg_catalog.jsonb_typeof(v_item.value) <> 'object' or v_item_id is null then
          v_item_reason := coalesce(v_item_reason, 'audit item identity is missing');
        elsif v_unit is null then
          v_item_reason := coalesce(v_item_reason, 'audit item unit snapshot is missing');
        elsif v_raw_actual is null
           or v_raw_system is null
           or v_raw_delta is null
           or v_raw_actual !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$'
           or v_raw_system !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$'
           or v_raw_delta !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$' then
          v_item_reason := coalesce(v_item_reason, 'audit quantity is not canonical numeric text');
        else
          begin
            v_actual := v_raw_actual::numeric;
            v_system := v_raw_system::numeric;
            v_delta := v_raw_delta::numeric;
          exception when invalid_text_representation or numeric_value_out_of_range then
            v_item_reason := coalesce(v_item_reason, 'audit quantity cannot be represented as numeric');
          end;
        end if;

        if v_item_reason is null then
          if pg_catalog.abs(v_actual) >= 100000000000000::numeric
             or pg_catalog.abs(v_system) >= 100000000000000::numeric
             or pg_catalog.abs(v_delta) >= 100000000000000::numeric then
            v_item_reason := 'audit quantity is outside numeric(20,6) range';
          elsif v_actual is distinct from v_system + v_delta then
            v_item_reason := 'audit actual/system/delta quantities are incoherent';
          elsif v_delta <> 0 and v_source."transactionId" is null then
            v_item_reason := 'non-zero audit observation has no deterministic adjustment';
          elsif not exists (select 1 from public.items item where item.id = v_item_id) then
            v_item_reason := 'audit item no longer exists in the catalog';
          elsif not app_private.quantity_units_are_equivalent(
            (select item.unit from public.items item where item.id = v_item_id), v_unit
          ) then
            v_item_reason := 'audit unit snapshot differs from the authoritative stock unit';
          else
            begin
              select policy.max_fraction_digits into v_max_fraction_digits
              from app_private.resolve_quantity_precision_policy(v_unit) policy;
              if v_actual <> pg_catalog.round(v_actual, v_max_fraction_digits)
                 or v_system <> pg_catalog.round(v_system, v_max_fraction_digits)
                 or v_delta <> pg_catalog.round(v_delta, v_max_fraction_digits) then
                v_item_reason := 'audit quantity exceeds the unit precision policy';
              end if;
            exception when others then
              v_item_reason := 'audit unit precision policy is ambiguous';
            end;
          end if;
        end if;

        v_finding_type := case
          when v_item_reason is null then 'PHYSICAL_ANCHOR'
          when v_item_reason like '%unit%' or v_item_reason like '%precision%' then 'UOM_PRECISION'
          else 'LINEAGE_GAP'
        end;
        v_evidence := pg_catalog.jsonb_build_object(
          'phase', 'physical_anchor',
          'anchorType', 'physical_audit',
          'sourceId', v_source.id,
          'sourceDate', v_source.date,
          'ordinality', v_item.ordinality,
          'commandId', v_source.command_id,
          'requestHash', v_source.request_hash,
          'postingEngineVersion', v_source.posting_engine_version,
          'commandResult', case when v_source.command_id is null then null else pg_catalog.to_jsonb(v_command) end,
          'linkedAdjustment', v_boundary,
          'excludedTransactionIds', v_excluded_ids,
          'source', pg_catalog.to_jsonb(v_source),
          'sourceSnapshot', p_source_snapshot
        );
        v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
          'source', pg_catalog.to_jsonb(v_source),
          'item', v_item.value,
          'ordinality', v_item.ordinality,
          'commandResult', case when v_source.command_id is null then null else pg_catalog.to_jsonb(v_command) end,
          'linkedAdjustment', v_boundary,
          'policyVersion', p_source_snapshot -> 'policyVersion',
          'auditCommandCutoff', p_source_snapshot -> 'auditCommandCutoff'
        )::text);

        insert into public.wms_reconciliation_findings (
          run_id, finding_type, severity, confidence, item_id, warehouse_id, unit,
          raw_value_text, before_qty, expected_qty, delta_qty, raw_values,
          evidence, blockers, proposed_action, precondition_hash, status,
          quarantine_reason
        )
        select p_run_id, v_finding_type,
          case when v_item_reason is null then 'P2' else 'P1' end,
          case when v_item_reason is null then 'high' else 'low' end,
          v_item_id, v_source."warehouseId", v_unit, v_raw_actual,
          v_system::numeric(20,6), v_actual::numeric(20,6), v_delta::numeric(20,6),
          pg_catalog.jsonb_build_object(
            'actualStock', v_raw_actual, 'systemStock', v_raw_system,
            'delta', v_raw_delta, 'item', v_item.value
          ),
          v_evidence,
          case when v_item_reason is null then '[]'::jsonb
            else pg_catalog.jsonb_build_array(v_item_reason) end,
          case when v_item_reason is null then 'anchor_replay' else 'quarantine' end,
          v_precondition_hash,
          case when v_item_reason is null then 'open' else 'quarantined' end,
          v_item_reason
        where not exists (
          select 1 from public.wms_reconciliation_findings finding
          where finding.run_id = p_run_id
            and finding.finding_type = v_finding_type
            and finding.item_id is not distinct from v_item_id
            and finding.warehouse_id is not distinct from v_source."warehouseId"
            and finding.precondition_hash = v_precondition_hash
        );

        insert into app_private.wms_reconciliation_run_work (
          run_id, phase, source_key, warehouse_id, item_id, source_hash, payload
        ) values (
          p_run_id, 'physical_anchor',
          'audit:' || v_source.id || ':' || v_item.ordinality::text,
          coalesce(v_source."warehouseId", ''), coalesce(v_item_id, ''),
          v_precondition_hash,
          pg_catalog.jsonb_build_object(
            'anchorQty', app_private.wms_reconciliation_decimal_text(v_actual),
            'anchorAt', v_source.date,
            'excludedTransactionIds', v_excluded_ids,
            'linkedAdjustment', v_boundary
          )
        ) on conflict (run_id, phase, source_key, warehouse_id, item_id)
          do update set source_hash = excluded.source_hash,
                        payload = excluded.payload,
                        updated_at = pg_catalog.clock_timestamp();
      end loop;
    end if;

    v_last_date := v_source.date;
    v_last_id := v_source.id;
    v_processed := v_processed + 1;
  end loop;

  v_complete := v_processed < p_batch_size;
  return pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object(
      'phase', 'physical_anchor',
      'lastKey', case when v_last_id is null then p_cursor -> 'lastKey' else
        pg_catalog.jsonb_build_object('date', v_last_date, 'id', v_last_id) end
    ),
    'processed', v_processed,
    'complete', v_complete
  );
end;
$$;

revoke all on function app_private.scan_wms_reconciliation_phase_physical_anchor(uuid, integer, jsonb, jsonb)
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
  v_source record;
  v_line record;
  v_command record;
  v_reversal record;
  v_original_tx public.transactions%rowtype;
  v_last_as_of date;
  v_last_id uuid;
  v_run_cutoff timestamptz;
  v_created_cutoff_at timestamptz;
  v_created_cutoff_id uuid;
  v_locked_cutoff_at timestamptz;
  v_locked_cutoff_id uuid;
  v_processed integer := 0;
  v_complete boolean;
  v_provenance_reason text;
  v_line_reason text;
  v_finding_type text;
  v_max_fraction_digits smallint;
  v_precondition_hash text;
  v_evidence jsonb;
  v_original_ids jsonb;
  v_reversal_ids jsonb;
  v_excluded_ids jsonb;
begin
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception 'opening anchor batch size must be between 1 and 500'
      using errcode = '22023';
  end if;
  select run.* into v_run
  from public.wms_reconciliation_runs run
  where run.id = p_run_id;
  if not found then
    raise exception 'WMS reconciliation run does not exist' using errcode = 'P0002';
  end if;
  if p_source_snapshot is distinct from v_run.source_snapshot
     or pg_catalog.jsonb_typeof(p_source_snapshot) <> 'object' then
    raise exception 'opening source snapshot differs from the frozen run boundary'
      using errcode = '40001';
  end if;
  if pg_catalog.jsonb_typeof(p_cursor) <> 'object'
     or p_cursor ->> 'phase' is distinct from 'opening_balance'
     or not (p_cursor ? 'lastKey') then
    raise exception 'invalid opening anchor cursor' using errcode = '22023';
  end if;
  if p_cursor -> 'lastKey' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_cursor -> 'lastKey') <> 'object'
       or not ((p_cursor -> 'lastKey') ?& array['asOfDate', 'id'])
       or pg_catalog.jsonb_typeof(p_cursor -> 'lastKey' -> 'asOfDate') <> 'string'
       or pg_catalog.jsonb_typeof(p_cursor -> 'lastKey' -> 'id') <> 'string' then
      raise exception 'opening anchor lastKey must contain asOfDate and id'
        using errcode = '22023';
    end if;
    begin
      v_last_as_of := (p_cursor -> 'lastKey' ->> 'asOfDate')::date;
      v_last_id := (p_cursor -> 'lastKey' ->> 'id')::uuid;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception 'invalid opening anchor lastKey' using errcode = '22023';
    end;
  end if;

  begin
    v_run_cutoff := (p_source_snapshot ->> 'createdAt')::timestamptz;
    if p_source_snapshot -> 'openingCutoff' -> 'createdBoundary' <> 'null'::jsonb then
      v_created_cutoff_at := (p_source_snapshot -> 'openingCutoff' -> 'createdBoundary' ->> 'createdAt')::timestamptz;
      v_created_cutoff_id := (p_source_snapshot -> 'openingCutoff' -> 'createdBoundary' ->> 'id')::uuid;
    end if;
    if p_source_snapshot -> 'openingCutoff' -> 'lockedBoundary' <> 'null'::jsonb then
      v_locked_cutoff_at := (p_source_snapshot -> 'openingCutoff' -> 'lockedBoundary' ->> 'lockedAt')::timestamptz;
      v_locked_cutoff_id := (p_source_snapshot -> 'openingCutoff' -> 'lockedBoundary' ->> 'id')::uuid;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'invalid frozen openingCutoff' using errcode = '55000';
  end;

  for v_source in
    select opening.*
    from public.project_opening_balances opening
    where opening.as_of_date <= v_run.as_of::date
      and (v_run.affected_from is null or opening.as_of_date >= v_run.affected_from::date)
      and opening.status in ('locked', 'void')
      and opening.locked_at is not null
      and opening.locked_at <= v_run_cutoff
      and v_created_cutoff_at is not null
      and v_locked_cutoff_at is not null
      and (
        opening.status = 'locked'
        or (opening.status = 'void' and opening.reversed_at > v_run_cutoff)
      )
      and (
        v_created_cutoff_at is null
        or opening.created_at < v_created_cutoff_at
        or (opening.created_at = v_created_cutoff_at and opening.id <= v_created_cutoff_id)
      )
      and (
        v_locked_cutoff_at is null
        or opening.locked_at < v_locked_cutoff_at
        or (opening.locked_at = v_locked_cutoff_at and opening.id <= v_locked_cutoff_id)
      )
      and (
        pg_catalog.jsonb_array_length(v_run.scope -> 'sourceTypes') = 0
        or (v_run.scope -> 'sourceTypes') ? 'opening_balance'
        or (v_run.scope -> 'sourceTypes') ? 'project_opening_balance'
      )
      and exists (
        select 1
        from public.project_opening_balance_lines scoped_line
        where scoped_line.opening_balance_id = opening.id
          and (
            (v_run.scope -> 'warehouseIds') = '["*"]'::jsonb
            or (v_run.scope -> 'warehouseIds') ? scoped_line.warehouse_id
          )
          and (
            pg_catalog.jsonb_array_length(v_run.scope -> 'itemIds') = 0
            or (v_run.scope -> 'itemIds') ? scoped_line.inventory_item_id
          )
      )
      and (
        v_last_as_of is null
        or opening.as_of_date > v_last_as_of
        or (opening.as_of_date = v_last_as_of and opening.id > v_last_id)
      )
    order by opening.as_of_date, opening.id
    limit p_batch_size
  loop
    v_provenance_reason := null;
    v_original_ids := v_source.stock_transaction_ids;
    v_reversal_ids := v_source.reversal_stock_transaction_ids;
    if v_source.lock_command_id is null
       or nullif(pg_catalog.btrim(v_source.lock_request_hash), '') is null
       or v_source.posting_engine_version is distinct from 'wf001-opening-v1'
       or pg_catalog.jsonb_typeof(v_original_ids) <> 'array'
       or pg_catalog.jsonb_typeof(v_reversal_ids) <> 'array' then
      v_provenance_reason := 'opening balance has incomplete controlled lock metadata';
    else
      select command_result.* into v_command
      from app_private.project_opening_command_results command_result
      where command_result.command_id = v_source.lock_command_id
        and command_result.created_at <= v_run_cutoff;
      if not found
         or v_command.opening_balance_id is distinct from v_source.id
         or v_command.request_hash is distinct from v_source.lock_request_hash
         or v_command.result -> 'opening_balance' ->> 'id' is distinct from v_source.id::text
         or v_command.result -> 'opening_balance' ->> 'lock_request_hash'
              is distinct from v_source.lock_request_hash
         or v_command.result -> 'opening_balance' ->> 'posting_engine_version'
              is distinct from 'wf001-opening-v1' then
        v_provenance_reason := 'immutable opening command result does not match the locked document';
      end if;
    end if;

    if v_source.status = 'void' then
      select reversal_result.* into v_reversal
      from app_private.project_opening_reversal_results reversal_result
      where reversal_result.command_id = v_source.reversal_command_id
        and reversal_result.created_at <= v_source.reversed_at;
      if not found
         or v_source.reversal_command_id is null
         or nullif(pg_catalog.btrim(v_source.reversal_request_hash), '') is null
         or v_reversal.opening_balance_id is distinct from v_source.id
         or v_reversal.request_hash is distinct from v_source.reversal_request_hash
         or v_reversal.result -> 'opening_balance' ->> 'id' is distinct from v_source.id::text
         or v_reversal.result -> 'opening_balance' ->> 'status' is distinct from 'void' then
        v_provenance_reason := coalesce(v_provenance_reason, 'controlled opening reversal lineage is incoherent');
      end if;
    elsif pg_catalog.jsonb_array_length(v_reversal_ids) <> 0 then
      v_provenance_reason := coalesce(v_provenance_reason, 'locked opening unexpectedly contains reversal transactions');
    end if;

    v_excluded_ids := coalesce(v_original_ids, '[]'::jsonb) || coalesce(v_reversal_ids, '[]'::jsonb);
    for v_line in
      select line.*
      from public.project_opening_balance_lines line
      where line.opening_balance_id = v_source.id
        and (
          (v_run.scope -> 'warehouseIds') = '["*"]'::jsonb
          or (v_run.scope -> 'warehouseIds') ? line.warehouse_id
        )
        and (
          pg_catalog.jsonb_array_length(v_run.scope -> 'itemIds') = 0
          or (v_run.scope -> 'itemIds') ? line.inventory_item_id
        )
      order by line.id
    loop
      v_line_reason := v_provenance_reason;
      if v_line.inventory_item_id is null
         or nullif(pg_catalog.btrim(v_line.warehouse_id), '') is null then
        v_line_reason := coalesce(v_line_reason, 'opening line item or warehouse identity is missing');
      elsif nullif(pg_catalog.btrim(v_line.unit), '') is null then
        v_line_reason := coalesce(v_line_reason, 'opening line unit snapshot is missing');
      elsif v_line.remaining_qty < 0
         or pg_catalog.abs(v_line.remaining_qty) >= 100000000000000::numeric then
        v_line_reason := coalesce(v_line_reason, 'opening remaining quantity is outside numeric(20,6) range');
      elsif not exists (select 1 from public.items item where item.id = v_line.inventory_item_id) then
        v_line_reason := coalesce(v_line_reason, 'opening item no longer exists in the catalog');
      elsif not exists (select 1 from public.warehouses warehouse where warehouse.id = v_line.warehouse_id) then
        v_line_reason := coalesce(v_line_reason, 'opening warehouse no longer exists in the catalog');
      elsif not app_private.quantity_units_are_equivalent(
        (select item.unit from public.items item where item.id = v_line.inventory_item_id),
        v_line.unit
      ) then
        v_line_reason := coalesce(v_line_reason, 'opening unit snapshot differs from the authoritative stock unit');
      else
        begin
          select policy.max_fraction_digits into v_max_fraction_digits
          from app_private.resolve_quantity_precision_policy(v_line.unit) policy;
          if v_line.remaining_qty <> pg_catalog.round(v_line.remaining_qty, v_max_fraction_digits) then
            v_line_reason := 'opening remaining quantity exceeds the unit precision policy';
          end if;
        exception when others then
          v_line_reason := 'opening unit precision policy is ambiguous';
        end;
      end if;

      if v_line_reason is null and v_line.remaining_qty > 0 then
        select transaction_row.* into v_original_tx
        from public.transactions transaction_row
        where transaction_row.id in (
          select original_id.value
          from pg_catalog.jsonb_array_elements_text(v_original_ids) original_id(value)
        )
          and transaction_row.id = 'opening-balance:' || v_source.id::text || ':'
            || pg_catalog.left(app_private.sha256_text(v_line.warehouse_id), 16)
          and transaction_row.target_warehouse_id = v_line.warehouse_id
          and transaction_row.source_type = 'project_opening_balance'
          and transaction_row.source_id = v_source.id::text || ':' || v_line.warehouse_id
          and transaction_row.posting_engine_version = 'wf001-opening-v1';
        if not found
           or v_original_tx.status::text <> 'COMPLETED'
           or v_original_tx.type::text <> 'ADJUSTMENT'
           or not exists (
             select 1
             from public.inventory_transactions ledger_header
             where ledger_header.source_type = 'wms_transaction'
               and ledger_header.source_id = v_original_tx.id
               and ledger_header.status = 'posted'
           ) then
          v_line_reason := 'opening adjustment for the line warehouse is missing or invalid';
        end if;
      end if;

      v_finding_type := case
        when v_line_reason is null then 'PHYSICAL_ANCHOR'
        when v_line_reason like '%unit%' or v_line_reason like '%precision%' then 'UOM_PRECISION'
        else 'LINEAGE_GAP'
      end;
      v_evidence := pg_catalog.jsonb_build_object(
        'phase', 'opening_balance',
        'anchorType', 'project_opening_balance',
        'sourceId', v_source.id,
        'lineId', v_line.id,
        'asOfDate', v_source.as_of_date,
        'lockedAt', v_source.locked_at,
        'reversedAt', v_source.reversed_at,
        'commandId', v_source.lock_command_id,
        'requestHash', v_source.lock_request_hash,
        'postingEngineVersion', v_source.posting_engine_version,
        'originalTransactionIds', v_original_ids,
        'reversalTransactionIds', v_reversal_ids,
        'excludedTransactionIds', v_excluded_ids,
        'source', pg_catalog.to_jsonb(v_source),
        'line', pg_catalog.to_jsonb(v_line),
        'commandResult', case when v_source.lock_command_id is null then null else pg_catalog.to_jsonb(v_command) end,
        'reversalResult', case when v_source.status <> 'void' then null else pg_catalog.to_jsonb(v_reversal) end,
        'sourceSnapshot', p_source_snapshot
      );
      v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
        'source', pg_catalog.to_jsonb(v_source),
        'line', pg_catalog.to_jsonb(v_line),
        'commandResult', case when v_source.lock_command_id is null then null else pg_catalog.to_jsonb(v_command) end,
        'reversalResult', case when v_source.status <> 'void' then null else pg_catalog.to_jsonb(v_reversal) end,
        'originalTransaction', case when v_line.remaining_qty <= 0 then null else pg_catalog.to_jsonb(v_original_tx) end,
        'policyVersion', p_source_snapshot -> 'policyVersion',
        'openingCutoff', p_source_snapshot -> 'openingCutoff'
      )::text);

      insert into public.wms_reconciliation_findings (
        run_id, finding_type, severity, confidence, item_id, warehouse_id, unit,
        raw_value_text, before_qty, expected_qty, delta_qty, raw_values,
        evidence, blockers, proposed_action, precondition_hash, status,
        quarantine_reason
      )
      select p_run_id, v_finding_type,
        case when v_line_reason is null then 'P2' else 'P1' end,
        case when v_line_reason is null then 'high' else 'low' end,
        v_line.inventory_item_id, v_line.warehouse_id, v_line.unit,
        v_line.remaining_qty::text, null,
        v_line.remaining_qty::numeric(20,6), null,
        pg_catalog.jsonb_build_object('remainingQty', v_line.remaining_qty::text),
        v_evidence,
        case when v_line_reason is null then '[]'::jsonb
          else pg_catalog.jsonb_build_array(v_line_reason) end,
        case when v_line_reason is null then 'anchor_replay' else 'quarantine' end,
        v_precondition_hash,
        case when v_line_reason is null then 'open' else 'quarantined' end,
        v_line_reason
      where not exists (
        select 1 from public.wms_reconciliation_findings finding
        where finding.run_id = p_run_id
          and finding.finding_type = v_finding_type
          and finding.item_id is not distinct from v_line.inventory_item_id
          and finding.warehouse_id is not distinct from v_line.warehouse_id
          and finding.precondition_hash = v_precondition_hash
      );

      insert into app_private.wms_reconciliation_run_work (
        run_id, phase, source_key, warehouse_id, item_id, source_hash, payload
      ) values (
        p_run_id, 'opening_balance', 'opening:' || v_source.id::text || ':' || v_line.id::text,
        coalesce(v_line.warehouse_id, ''), coalesce(v_line.inventory_item_id, ''),
        v_precondition_hash,
        pg_catalog.jsonb_build_object(
          'anchorQty', app_private.wms_reconciliation_decimal_text(v_line.remaining_qty),
          'anchorAt', v_source.as_of_date,
          'excludedTransactionIds', v_excluded_ids,
          'originalTransactionIds', v_original_ids,
          'reversalTransactionIds', v_reversal_ids
        )
      ) on conflict (run_id, phase, source_key, warehouse_id, item_id)
        do update set source_hash = excluded.source_hash,
                      payload = excluded.payload,
                      updated_at = pg_catalog.clock_timestamp();
    end loop;

    v_last_as_of := v_source.as_of_date;
    v_last_id := v_source.id;
    v_processed := v_processed + 1;
  end loop;

  v_complete := v_processed < p_batch_size;
  return pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object(
      'phase', 'opening_balance',
      'lastKey', case when v_last_id is null then p_cursor -> 'lastKey' else
        pg_catalog.jsonb_build_object('asOfDate', v_last_as_of, 'id', v_last_id) end
    ),
    'processed', v_processed,
    'complete', v_complete
  );
end;
$$;

revoke all on function app_private.scan_wms_reconciliation_phase_opening_balance(uuid, integer, jsonb, jsonb)
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
  v_source record;
  v_line record;
  v_movement record;
  v_header public.inventory_transactions%rowtype;
  v_last_date timestamptz;
  v_last_id text;
  v_header_cutoff_at timestamptz;
  v_header_cutoff_id uuid;
  v_entry_cutoff_at timestamptz;
  v_entry_cutoff_id uuid;
  v_processed integer := 0;
  v_complete boolean;
  v_line_reason text;
  v_finding_type text;
  v_item_id text;
  v_unit text;
  v_raw_qty text;
  v_qty numeric;
  v_max_fraction_digits smallint;
  v_actual_qty numeric;
  v_actual_unit text;
  v_ledger_evidence jsonb;
  v_precondition_hash text;
  v_evidence jsonb;
  v_expected_qty numeric;
  v_rounded_qty numeric;
  v_delta_qty numeric;
begin
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception 'transaction-ledger batch size must be between 1 and 500'
      using errcode = '22023';
  end if;
  select run.* into v_run
  from public.wms_reconciliation_runs run
  where run.id = p_run_id;
  if not found then
    raise exception 'WMS reconciliation run does not exist' using errcode = 'P0002';
  end if;
  if p_source_snapshot is distinct from v_run.source_snapshot
     or pg_catalog.jsonb_typeof(p_source_snapshot) <> 'object' then
    raise exception 'transaction-ledger source snapshot differs from the frozen run boundary'
      using errcode = '40001';
  end if;
  if pg_catalog.jsonb_typeof(p_cursor) <> 'object'
     or p_cursor ->> 'phase' is distinct from 'transaction_ledger'
     or not (p_cursor ? 'lastKey') then
    raise exception 'invalid transaction-ledger cursor' using errcode = '22023';
  end if;
  if p_cursor -> 'lastKey' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_cursor -> 'lastKey') <> 'object'
       or not ((p_cursor -> 'lastKey') ?& array['date', 'id'])
       or pg_catalog.jsonb_typeof(p_cursor -> 'lastKey' -> 'date') <> 'string'
       or pg_catalog.jsonb_typeof(p_cursor -> 'lastKey' -> 'id') <> 'string' then
      raise exception 'transaction-ledger lastKey must contain date and id'
        using errcode = '22023';
    end if;
    begin
      v_last_date := (p_cursor -> 'lastKey' ->> 'date')::timestamptz;
      v_last_id := p_cursor -> 'lastKey' ->> 'id';
      if not pg_catalog.isfinite(v_last_date) or nullif(pg_catalog.btrim(v_last_id), '') is null then
        raise exception 'invalid transaction-ledger lastKey' using errcode = '22023';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid transaction-ledger lastKey' using errcode = '22023';
    end;
  end if;
  begin
    if p_source_snapshot -> 'ledgerHeader' -> 'createdBoundary' <> 'null'::jsonb then
      v_header_cutoff_at := (p_source_snapshot -> 'ledgerHeader' -> 'createdBoundary' ->> 'createdAt')::timestamptz;
      v_header_cutoff_id := (p_source_snapshot -> 'ledgerHeader' -> 'createdBoundary' ->> 'id')::uuid;
    end if;
    if p_source_snapshot -> 'ledgerEntry' <> 'null'::jsonb then
      v_entry_cutoff_at := (p_source_snapshot -> 'ledgerEntry' ->> 'createdAt')::timestamptz;
      v_entry_cutoff_id := (p_source_snapshot -> 'ledgerEntry' ->> 'id')::uuid;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'invalid frozen ledger high-water boundary' using errcode = '55000';
  end;

  for v_source in
    select transaction_row.*
    from public.transactions transaction_row
    where transaction_row.status::text = 'COMPLETED'
      and transaction_row.type::text in ('IMPORT', 'EXPORT', 'TRANSFER', 'LIQUIDATION', 'ADJUSTMENT')
      and transaction_row.date <= v_run.as_of
      and (v_run.affected_from is null or transaction_row.date >= v_run.affected_from)
      and (
        pg_catalog.jsonb_array_length(v_run.scope -> 'sourceTypes') = 0
        or (v_run.scope -> 'sourceTypes') ? 'transaction_ledger'
        or (v_run.scope -> 'sourceTypes') ? 'wms_transaction'
        or (v_run.scope -> 'sourceTypes') ? pg_catalog.lower(transaction_row.type::text)
      )
      and (
        (v_run.scope -> 'warehouseIds') = '["*"]'::jsonb
        or (v_run.scope -> 'warehouseIds') ? transaction_row.source_warehouse_id
        or (v_run.scope -> 'warehouseIds') ? transaction_row.target_warehouse_id
      )
      and (
        pg_catalog.jsonb_array_length(v_run.scope -> 'itemIds') = 0
        or case when pg_catalog.jsonb_typeof(transaction_row.items) = 'array' then exists (
          select 1
          from pg_catalog.jsonb_array_elements(transaction_row.items) scoped_item(value)
          where (v_run.scope -> 'itemIds') ? (scoped_item.value ->> 'itemId')
        ) else false end
      )
      and not exists (
        select 1
        from app_private.wms_reconciliation_run_work anchor_work
        cross join lateral pg_catalog.jsonb_array_elements_text(
          case when pg_catalog.jsonb_typeof(anchor_work.payload -> 'excludedTransactionIds') = 'array'
            then anchor_work.payload -> 'excludedTransactionIds' else '[]'::jsonb end
        ) excluded_transaction(value)
        where anchor_work.run_id = p_run_id
          and anchor_work.phase in ('physical_anchor', 'opening_balance')
          and excluded_transaction.value = transaction_row.id
      )
      and not exists (
        select 1
        from public.inventory_transactions future_header
        where future_header.source_type = 'wms_transaction'
          and future_header.source_id = transaction_row.id
          and (
            v_header_cutoff_at is null
            or future_header.created_at > v_header_cutoff_at
            or (future_header.created_at = v_header_cutoff_at and future_header.id > v_header_cutoff_id)
          )
      )
      and (
        v_last_date is null
        or transaction_row.date > v_last_date
        or (transaction_row.date = v_last_date and transaction_row.id > v_last_id)
      )
    order by transaction_row.date, transaction_row.id
    limit p_batch_size
  loop
    select header.* into v_header
    from public.inventory_transactions header
    where header.source_type = 'wms_transaction'
      and header.source_id = v_source.id
      and (
        v_header_cutoff_at is null
        or header.created_at < v_header_cutoff_at
        or (header.created_at = v_header_cutoff_at and header.id <= v_header_cutoff_id)
      );

    if pg_catalog.jsonb_typeof(v_source.items) <> 'array'
       or pg_catalog.jsonb_array_length(v_source.items) = 0 then
      v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
        'phase', 'transaction_ledger', 'source', pg_catalog.to_jsonb(v_source),
        'ledgerHeader', case when v_header.id is null then null else pg_catalog.to_jsonb(v_header) end,
        'policyVersion', p_source_snapshot -> 'policyVersion',
        'ledgerHighWater', p_source_snapshot -> 'ledgerHeader'
      )::text);
      insert into public.wms_reconciliation_findings (
        run_id, finding_type, severity, confidence, raw_value_text, raw_values,
        evidence, blockers, proposed_action, precondition_hash, status, quarantine_reason
      )
      select p_run_id, 'LINEAGE_GAP', 'P1', 'low', v_source.items::text,
        pg_catalog.jsonb_build_object('items', v_source.items),
        pg_catalog.jsonb_build_object('phase', 'transaction_ledger', 'sourceId', v_source.id),
        pg_catalog.jsonb_build_array('completed WMS items must be a non-empty JSON array'),
        'quarantine', v_precondition_hash, 'quarantined', 'completed WMS items are malformed'
      where not exists (
        select 1 from public.wms_reconciliation_findings finding
        where finding.run_id = p_run_id
          and finding.finding_type = 'LINEAGE_GAP'
          and finding.item_id is null and finding.warehouse_id is null
          and finding.precondition_hash = v_precondition_hash
      );
    else
      -- Validate every source line before aggregate comparison. Invalid values
      -- are evidence, never zero-filled inputs to an aggregate.
      for v_line in
        select source_item.value, source_item.ordinality
        from pg_catalog.jsonb_array_elements(v_source.items) with ordinality source_item(value, ordinality)
        order by source_item.ordinality
      loop
        v_item_id := nullif(pg_catalog.btrim(v_line.value ->> 'itemId'), '');
        if pg_catalog.jsonb_array_length(v_run.scope -> 'itemIds') > 0
           and (v_item_id is null or not ((v_run.scope -> 'itemIds') ? v_item_id)) then
          continue;
        end if;
        v_unit := nullif(pg_catalog.btrim(coalesce(
          v_line.value ->> 'unitSnapshot', v_line.value ->> 'unit_snapshot', v_line.value ->> 'unit'
        )), '');
        v_raw_qty := v_line.value ->> 'quantity';
        v_line_reason := null;
        v_qty := null;
        if pg_catalog.jsonb_typeof(v_line.value) <> 'object' or v_item_id is null then
          v_line_reason := 'WMS item identity is missing';
        elsif v_raw_qty is null
           or v_raw_qty !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$' then
          v_line_reason := 'WMS quantity is invalid canonical numeric text';
        else
          begin
            v_qty := v_raw_qty::numeric;
          exception when invalid_text_representation or numeric_value_out_of_range then
            v_line_reason := 'WMS quantity cannot be represented as numeric';
          end;
        end if;
        if v_line_reason is null and (
          (v_source.type::text = 'ADJUSTMENT' and v_qty = 0)
          or (v_source.type::text <> 'ADJUSTMENT' and v_qty <= 0)
          or pg_catalog.abs(v_qty) >= 100000000000000::numeric
        ) then
          v_line_reason := 'WMS quantity sign or numeric(20,6) range is invalid';
        end if;
        if v_line_reason is null and v_unit is null then
          v_line_reason := 'WMS unit snapshot is missing';
        elsif v_line_reason is null and not exists (
          select 1 from public.items item where item.id = v_item_id
        ) then
          v_line_reason := 'WMS item no longer exists in the catalog';
        elsif v_line_reason is null and not app_private.quantity_units_are_equivalent(
          (select item.unit from public.items item where item.id = v_item_id), v_unit
        ) then
          v_line_reason := 'WMS unit snapshot differs from the authoritative stock unit';
        elsif v_line_reason is null then
          begin
            select policy.max_fraction_digits into v_max_fraction_digits
            from app_private.resolve_quantity_precision_policy(v_unit) policy;
            if v_qty <> pg_catalog.round(v_qty, v_max_fraction_digits) then
              v_line_reason := 'WMS quantity exceeds the unit precision policy';
            end if;
          exception when others then
            v_line_reason := 'WMS unit precision policy is ambiguous';
          end;
        end if;

        if v_line_reason is not null then
          v_finding_type := case when v_line_reason like '%unit%' or v_line_reason like '%precision%'
            then 'UOM_PRECISION' else 'LINEAGE_GAP' end;
          v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
            'source', pg_catalog.to_jsonb(v_source), 'item', v_line.value,
            'ordinality', v_line.ordinality,
            'ledgerHeader', case when v_header.id is null then null else pg_catalog.to_jsonb(v_header) end,
            'policyVersion', p_source_snapshot -> 'policyVersion',
            'ledgerHighWater', p_source_snapshot -> 'ledgerHeader'
          )::text);
          insert into public.wms_reconciliation_findings (
            run_id, finding_type, severity, confidence, item_id, unit,
            raw_value_text, raw_values, evidence, blockers, proposed_action,
            precondition_hash, status, quarantine_reason
          )
          select p_run_id, v_finding_type, 'P1', 'low', v_item_id, v_unit,
            v_raw_qty, pg_catalog.jsonb_build_object('quantity', v_raw_qty, 'item', v_line.value),
            pg_catalog.jsonb_build_object(
              'phase', 'transaction_ledger', 'sourceId', v_source.id,
              'ordinality', v_line.ordinality, 'source', pg_catalog.to_jsonb(v_source),
              'sourceSnapshot', p_source_snapshot
            ),
            pg_catalog.jsonb_build_array(v_line_reason), 'quarantine',
            v_precondition_hash, 'quarantined', v_line_reason
          where not exists (
            select 1 from public.wms_reconciliation_findings finding
            where finding.run_id = p_run_id
              and finding.finding_type = v_finding_type
              and finding.item_id is not distinct from v_item_id
              and finding.warehouse_id is null
              and finding.precondition_hash = v_precondition_hash
          );
        end if;
      end loop;

      for v_movement in
        with parsed_lines as (
          select
            source_item.value ->> 'itemId' as item_id,
            nullif(pg_catalog.btrim(coalesce(
              source_item.value ->> 'unitSnapshot',
              source_item.value ->> 'unit_snapshot',
              source_item.value ->> 'unit'
            )), '') as unit,
            case when source_item.value ->> 'quantity' ~
              '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$'
              then (source_item.value ->> 'quantity')::numeric else null end as qty,
            source_item.value as raw_item,
            source_item.ordinality
          from pg_catalog.jsonb_array_elements(v_source.items) with ordinality
            source_item(value, ordinality)
        ), valid_lines as (
          select * from parsed_lines line
          where line.item_id is not null and line.unit is not null and line.qty is not null
            and pg_catalog.abs(line.qty) < 100000000000000::numeric
            and ((v_source.type::text = 'ADJUSTMENT' and line.qty <> 0)
              or (v_source.type::text <> 'ADJUSTMENT' and line.qty > 0))
            and (pg_catalog.jsonb_array_length(v_run.scope -> 'itemIds') = 0
              or (v_run.scope -> 'itemIds') ? line.item_id)
        ), expected_movements as (
          select item_id, unit, v_source.target_warehouse_id as warehouse_id,
                 'in'::text as movement_direction, qty,
                 (qty::integer)::numeric as rounded_qty, raw_item, ordinality
          from valid_lines where v_source.type::text = 'IMPORT'
          union all
          select item_id, unit, v_source.source_warehouse_id, 'out', qty,
                 (qty::integer)::numeric, raw_item, ordinality
          from valid_lines where v_source.type::text in ('EXPORT', 'LIQUIDATION')
          union all
          select item_id, unit, v_source.source_warehouse_id, 'out', qty,
                 (qty::integer)::numeric, raw_item, ordinality
          from valid_lines where v_source.type::text = 'TRANSFER'
          union all
          select item_id, unit, v_source.target_warehouse_id, 'in', qty,
                 (qty::integer)::numeric, raw_item, ordinality
          from valid_lines where v_source.type::text = 'TRANSFER'
          union all
          select item_id, unit, coalesce(v_source.target_warehouse_id, v_source.source_warehouse_id),
                 case when qty > 0 then 'in' else 'out' end,
                 pg_catalog.abs(qty), pg_catalog.abs((qty::integer)::numeric), raw_item, ordinality
          from valid_lines where v_source.type::text = 'ADJUSTMENT'
        )
        select movement.item_id, movement.warehouse_id, movement.movement_direction,
               pg_catalog.min(movement.unit) as unit,
               pg_catalog.sum(movement.qty) as expected_qty,
               pg_catalog.sum(movement.rounded_qty) as rounded_qty,
               pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'ordinality', movement.ordinality,
                 'quantity', movement.qty::text,
                 'raw', movement.raw_item
               ) order by movement.ordinality) as raw_values
        from expected_movements movement
        where movement.warehouse_id is not null
          and ((v_run.scope -> 'warehouseIds') = '["*"]'::jsonb
            or (v_run.scope -> 'warehouseIds') ? movement.warehouse_id)
        group by movement.item_id, movement.warehouse_id, movement.movement_direction
        order by movement.warehouse_id, movement.item_id, movement.movement_direction
      loop
        v_expected_qty := v_movement.expected_qty;
        v_rounded_qty := v_movement.rounded_qty;
        select
          pg_catalog.sum(case when entry.movement_direction = 'in'
            then entry.quantity_in else entry.quantity_out end),
          pg_catalog.min(entry.unit),
          coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', entry.id, 'entryNo', entry.entry_no,
            'direction', entry.movement_direction,
            'quantityIn', entry.quantity_in::text,
            'quantityOut', entry.quantity_out::text,
            'unit', entry.unit, 'sourceLineId', entry.source_line_id,
            'metadata', entry.metadata
          ) order by entry.entry_no, entry.id), '[]'::jsonb)
        into v_actual_qty, v_actual_unit, v_ledger_evidence
        from public.inventory_ledger_entries entry
        where entry.inventory_transaction_id = v_header.id
          and entry.source_type = 'wms_transaction'
          and entry.source_id = v_source.id
          and entry.material_id = v_movement.item_id
          and entry.warehouse_id = v_movement.warehouse_id
          and entry.movement_direction = v_movement.movement_direction
          and (
            v_entry_cutoff_at is null
            or entry.created_at < v_entry_cutoff_at
            or (entry.created_at = v_entry_cutoff_at and entry.id <= v_entry_cutoff_id)
          );

        if v_header.id is null then
          v_finding_type := 'TX_LEDGER_MISSING';
          v_delta_qty := v_expected_qty;
        elsif v_header.status is distinct from 'posted'
           or v_header.source_code is distinct from v_source.id
           or v_header.transaction_date is distinct from v_source.date
           or v_actual_qty is distinct from v_expected_qty
           or (v_actual_unit is not null and not app_private.quantity_units_are_equivalent(v_movement.unit, v_actual_unit)) then
          v_finding_type := 'TX_LEDGER_MISMATCH';
          v_delta_qty := v_expected_qty - coalesce(v_actual_qty, 0);
        elsif v_source.posting_engine_version is distinct from 'wf001-a3-v1'
           and v_expected_qty is distinct from v_rounded_qty then
          -- PostgreSQL numeric -> integer rounds each historical line. This is
          -- the WF-001 fingerprint; it deliberately does not use trunc().
          v_finding_type := 'DECIMAL_APPLY';
          v_actual_qty := v_rounded_qty;
          v_delta_qty := v_expected_qty - v_rounded_qty;
        else
          continue;
        end if;

        v_evidence := pg_catalog.jsonb_build_object(
          'phase', 'transaction_ledger',
          'sourceId', v_source.id,
          'transactionType', v_source.type::text,
          'movementDirection', v_movement.movement_direction,
          'sourceOrdinals', v_movement.raw_values,
          'source', pg_catalog.to_jsonb(v_source),
          'ledgerHeader', case when v_header.id is null then null else pg_catalog.to_jsonb(v_header) end,
          'ledgerEntries', v_ledger_evidence,
          'postgresRoundedLineTotal', app_private.wms_reconciliation_decimal_text(v_rounded_qty),
          'sourceSnapshot', p_source_snapshot,
          'completionTimestampReliable', v_header.id is not null
        );
        v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
          'source', pg_catalog.to_jsonb(v_source),
          'movement', pg_catalog.jsonb_build_object(
            'itemId', v_movement.item_id, 'warehouseId', v_movement.warehouse_id,
            'direction', v_movement.movement_direction,
            'quantity', v_expected_qty::text, 'ordinals', v_movement.raw_values
          ),
          'ledgerHeader', case when v_header.id is null then null else pg_catalog.to_jsonb(v_header) end,
          'ledgerEntries', v_ledger_evidence,
          'policyVersion', p_source_snapshot -> 'policyVersion',
          'ledgerHeaderHighWater', p_source_snapshot -> 'ledgerHeader',
          'ledgerEntryHighWater', p_source_snapshot -> 'ledgerEntry'
        )::text);

        insert into public.wms_reconciliation_findings (
          run_id, finding_type, severity, confidence, item_id, warehouse_id, unit,
          raw_value_text, before_qty, expected_qty, delta_qty, raw_values,
          evidence, blockers, proposed_action, precondition_hash, status,
          quarantine_reason
        )
        select p_run_id, v_finding_type,
          case when v_finding_type = 'DECIMAL_APPLY' then 'P1' else 'P0' end,
          case when v_finding_type = 'TX_LEDGER_MISSING' then 'low' else 'high' end,
          v_movement.item_id, v_movement.warehouse_id, v_movement.unit,
          v_movement.raw_values::text,
          v_actual_qty::numeric(20,6), v_expected_qty::numeric(20,6), v_delta_qty::numeric(20,6),
          pg_catalog.jsonb_build_object('sourceLines', v_movement.raw_values),
          v_evidence,
          case when v_finding_type = 'TX_LEDGER_MISSING'
            then pg_catalog.jsonb_build_array('completed source has no reliable completion timestamp')
            else '[]'::jsonb end,
          case when v_finding_type = 'DECIMAL_APPLY' then 'reconcile_cache'
            when v_finding_type = 'TX_LEDGER_MISSING' then 'quarantine'
            else 'business_review' end,
          v_precondition_hash,
          case when v_finding_type = 'TX_LEDGER_MISSING' then 'quarantined' else 'open' end,
          case when v_finding_type = 'TX_LEDGER_MISSING'
            then 'missing ledger cannot be historically attributed without a reliable completion timestamp'
            else null end
        where not exists (
          select 1 from public.wms_reconciliation_findings finding
          where finding.run_id = p_run_id
            and finding.finding_type = v_finding_type
            and finding.item_id is not distinct from v_movement.item_id
            and finding.warehouse_id is not distinct from v_movement.warehouse_id
            and finding.precondition_hash = v_precondition_hash
        );
      end loop;

      -- Ledger-only aggregates under a matched header are mismatches too; they
      -- must not disappear merely because the source JSON lacks that movement.
      if v_header.id is not null then
        for v_movement in
          select entry.material_id as item_id, entry.warehouse_id,
                 entry.movement_direction, pg_catalog.min(entry.unit) as unit,
                 pg_catalog.sum(case when entry.movement_direction = 'in'
                   then entry.quantity_in else entry.quantity_out end) as actual_qty,
                 pg_catalog.jsonb_agg(pg_catalog.to_jsonb(entry) order by entry.entry_no, entry.id) as entries
          from public.inventory_ledger_entries entry
          where entry.inventory_transaction_id = v_header.id
            and entry.source_type = 'wms_transaction'
            and entry.source_id = v_source.id
            and (
              v_entry_cutoff_at is null
              or entry.created_at < v_entry_cutoff_at
              or (entry.created_at = v_entry_cutoff_at and entry.id <= v_entry_cutoff_id)
            )
            and not exists (
              select 1
              from pg_catalog.jsonb_array_elements(v_source.items) source_item(value)
              where source_item.value ->> 'itemId' = entry.material_id
                and (
                  (v_source.type::text = 'IMPORT'
                    and entry.warehouse_id = v_source.target_warehouse_id
                    and entry.movement_direction = 'in')
                  or (v_source.type::text in ('EXPORT', 'LIQUIDATION')
                    and entry.warehouse_id = v_source.source_warehouse_id
                    and entry.movement_direction = 'out')
                  or (v_source.type::text = 'TRANSFER' and (
                    (entry.warehouse_id = v_source.source_warehouse_id and entry.movement_direction = 'out')
                    or (entry.warehouse_id = v_source.target_warehouse_id and entry.movement_direction = 'in')
                  ))
                  or (v_source.type::text = 'ADJUSTMENT'
                    and entry.warehouse_id = coalesce(v_source.target_warehouse_id, v_source.source_warehouse_id)
                    and source_item.value ->> 'quantity' ~
                      '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$'
                    and entry.movement_direction = case
                      when (source_item.value ->> 'quantity')::numeric > 0 then 'in' else 'out' end)
                )
            )
          group by entry.material_id, entry.warehouse_id, entry.movement_direction
          order by entry.warehouse_id, entry.material_id, entry.movement_direction
        loop
          v_precondition_hash := app_private.sha256_text(pg_catalog.jsonb_build_object(
            'source', pg_catalog.to_jsonb(v_source), 'ledgerHeader', pg_catalog.to_jsonb(v_header),
            'unexpectedLedgerEntries', v_movement.entries,
            'policyVersion', p_source_snapshot -> 'policyVersion',
            'ledgerEntryHighWater', p_source_snapshot -> 'ledgerEntry'
          )::text);
          insert into public.wms_reconciliation_findings (
            run_id, finding_type, severity, confidence, item_id, warehouse_id, unit,
            before_qty, expected_qty, delta_qty, raw_values, evidence, blockers,
            proposed_action, precondition_hash, status
          )
          select p_run_id, 'TX_LEDGER_MISMATCH', 'P0', 'high',
            v_movement.item_id, v_movement.warehouse_id, v_movement.unit,
            v_movement.actual_qty::numeric(20,6), 0::numeric(20,6),
            (-v_movement.actual_qty)::numeric(20,6),
            pg_catalog.jsonb_build_object('ledgerEntries', v_movement.entries),
            pg_catalog.jsonb_build_object(
              'phase', 'transaction_ledger', 'sourceId', v_source.id,
              'movementDirection', v_movement.movement_direction,
              'source', pg_catalog.to_jsonb(v_source), 'ledgerHeader', pg_catalog.to_jsonb(v_header),
              'ledgerEntries', v_movement.entries, 'sourceSnapshot', p_source_snapshot
            ), '[]'::jsonb, 'business_review', v_precondition_hash, 'open'
          where not exists (
            select 1 from public.wms_reconciliation_findings finding
            where finding.run_id = p_run_id
              and finding.finding_type = 'TX_LEDGER_MISMATCH'
              and finding.item_id is not distinct from v_movement.item_id
              and finding.warehouse_id is not distinct from v_movement.warehouse_id
              and finding.precondition_hash = v_precondition_hash
          );
        end loop;
      end if;
    end if;

    v_last_date := v_source.date;
    v_last_id := v_source.id;
    v_processed := v_processed + 1;
  end loop;

  v_complete := v_processed < p_batch_size;
  return pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object(
      'phase', 'transaction_ledger',
      'lastKey', case when v_last_id is null then p_cursor -> 'lastKey' else
        pg_catalog.jsonb_build_object('date', v_last_date, 'id', v_last_id) end
    ),
    'processed', v_processed,
    'complete', v_complete
  );
end;
$$;

revoke all on function app_private.scan_wms_reconciliation_phase_transaction_ledger(uuid, integer, jsonb, jsonb)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
