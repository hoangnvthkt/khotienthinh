begin;

set local timezone = 'UTC';

-- Destructive fixture writes are isolated by this transaction. Operator smoke
-- runs as the database owner on a clone; replica mode bypasses immutable source
-- guards only for these rollback-only fixtures.
set local session_replication_role = replica;

-- The disposable runner uses a deliberately minimal legacy ledger shape.
-- These compatibility columns are transaction-local and roll back with every
-- fixture; deployed databases already carry source_code in the real ledger.
alter table public.inventory_ledger_entries
  add column if not exists source_code text;
alter table public.inventory_transactions
  add column if not exists posting_engine_version text;

do $$
declare
  v_actor uuid;
  v_warehouse text;
  v_item text;
  v_item_unit text;
  v_item_sku text;
  v_item_name text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_audit_command uuid := 'b2b00000-0000-4000-8000-000000000001';
  v_opening_id uuid := 'b2b00000-0000-4000-8000-000000000002';
  v_opening_command uuid := 'b2b00000-0000-4000-8000-000000000003';
  v_opening_line uuid := 'b2b00000-0000-4000-8000-000000000004';
  v_run_id uuid := 'b2b00000-0000-4000-8000-000000000005';
  v_audit_tx text := 'audit-adjustment-b2b00000-0000-4000-8000-000000000001';
  v_opening_tx text := 'opening-balance:b2b00000-0000-4000-8000-000000000002:smoke';
  v_void_original_tx text;
  v_void_reversal_tx text;
  v_decimal_tx text := 'b2b-smoke-decimal';
  v_missing_tx text := 'b2b-smoke-missing';
  v_mismatch_tx text := 'b2b-smoke-mismatch';
  v_invalid_tx text := 'b2b-smoke-invalid';
  v_transfer_tx text := 'b2b-smoke-transfer';
  v_late_tx text := 'b2b-smoke-late-backdated';
  v_audit_header uuid := 'b2b10000-0000-4000-8000-000000000001';
  v_opening_header uuid := 'b2b10000-0000-4000-8000-000000000002';
  v_decimal_header uuid := 'b2b10000-0000-4000-8000-000000000003';
  v_mismatch_header uuid := 'b2b10000-0000-4000-8000-000000000004';
  v_transfer_header uuid := 'b2b10000-0000-4000-8000-000000000005';
  v_snapshot jsonb;
  v_physical jsonb;
  v_physical_retry jsonb;
  v_opening jsonb;
  v_ledger jsonb;
  reconciliation_source_counts_before jsonb;
  reconciliation_source_counts_after jsonb;
  v_negative_validation jsonb;
  v_source_hashes_before jsonb;
  v_source_hashes_after jsonb;
  v_cursor_first jsonb;
  v_cursor_second jsonb;
  v_cursor_seed jsonb := '{"phase":"transaction_ledger","lastKey":null}'::jsonb;
  v_retry_before bigint;
  v_retry_after bigint;
  v_retry_first jsonb;
  v_retry_second jsonb;
  v_stale_snapshot jsonb;
  v_finding_count bigint;
begin
  select app_user.id into v_actor
  from public.users app_user
  where app_user.is_active
  order by app_user.id
  limit 1;
  select warehouse.id into v_warehouse
  from public.warehouses warehouse
  order by warehouse.id
  limit 1;
  select item.id, item.unit, coalesce(item.sku, item.id), coalesce(item.name, item.id)
  into v_item, v_item_unit, v_item_sku, v_item_name
  from public.items item
  where nullif(pg_catalog.btrim(item.unit), '') is not null
  order by item.id
  limit 1;
  if v_actor is null or v_warehouse is null or v_item is null then
    raise exception 'B2b smoke requires one active user, warehouse and item with unit';
  end if;
  v_void_original_tx := 'opening-balance:b2b00000-0000-4000-8000-000000000014:'
    || pg_catalog.left(app_private.sha256_text(v_warehouse), 16);
  v_void_reversal_tx := 'opening-reversal:b2b00000-0000-4000-8000-000000000014:'
    || pg_catalog.left(app_private.sha256_text(v_warehouse), 16);

  v_snapshot := pg_catalog.jsonb_build_object(
    'policyVersion', 'b2b-smoke',
    'functionHashes', pg_catalog.jsonb_build_object(
      'scanPhases', pg_catalog.jsonb_build_object(
        'physicalAnchor', app_private.wms_reconciliation_function_hash(
          'app_private.scan_wms_reconciliation_phase_physical_anchor(uuid,integer,jsonb,jsonb)'::regprocedure),
        'openingBalance', app_private.wms_reconciliation_function_hash(
          'app_private.scan_wms_reconciliation_phase_opening_balance(uuid,integer,jsonb,jsonb)'::regprocedure),
        'transactionLedger', app_private.wms_reconciliation_function_hash(
          'app_private.scan_wms_reconciliation_phase_transaction_ledger(uuid,integer,jsonb,jsonb)'::regprocedure)
      ),
      'recheck', app_private.wms_reconciliation_function_hash(
        'app_private.recheck_wms_reconciliation_finding(uuid,jsonb)'::regprocedure)
    )
  );

  insert into app_private.wms_reconciliation_wf001_exposure_windows (
    id, effective_from, effective_to, posting_engine_version,
    legacy_function_hash, deployment_evidence_hash, status, reason, configured_by
  ) values (
    'b2b20000-0000-4000-8000-000000000001', v_now - interval '10 minutes',
    v_now + interval '10 minutes', 'wf001-legacy-canonical',
    '036fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc',
    app_private.sha256_text('canonical smoke deployment evidence'), 'active',
    'b2b-smoke-fingerprint-canonical', v_actor
  );

  insert into app_private.wms_reconciliation_wf001_exposure_windows (
    id, effective_from, effective_to, posting_engine_version,
    legacy_function_hash, deployment_evidence_hash, status, reason, configured_by
  ) values (
    'b2b20000-0000-4000-8000-000000000002', v_now - interval '10 minutes',
    v_now + interval '10 minutes', 'wf001-legacy-fake',
    '136fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc',
    app_private.sha256_text('fake smoke deployment evidence'), 'active',
    'b2b-smoke-fingerprint-fake', v_actor
  );

  insert into app_private.wms_reconciliation_wf001_exposure_windows (
    id, effective_from, effective_to, posting_engine_version,
    legacy_function_hash, deployment_evidence_hash, status, reason, configured_by
  ) values (
    'b2b20000-0000-4000-8000-000000000003', v_now - interval '30 minutes',
    v_now - interval '20 minutes', 'wf001-legacy-outside',
    '036fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc',
    app_private.sha256_text('outside smoke deployment evidence'), 'active',
    'b2b-smoke-window-outside', v_actor
  );

  insert into app_private.wms_reconciliation_wf001_exposure_windows (
    id, effective_from, effective_to, posting_engine_version,
    legacy_function_hash, deployment_evidence_hash, status, reason, configured_by
  ) values
    ('b2b20000-0000-4000-8000-000000000004', v_now - interval '10 minutes',
      v_now + interval '10 minutes', 'wf001-legacy-overlap',
      '036fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc',
      app_private.sha256_text('overlap smoke deployment evidence one'), 'active',
      'b2b-smoke-window-overlap', v_actor),
    ('b2b20000-0000-4000-8000-000000000005', v_now - interval '5 minutes',
      v_now + interval '15 minutes', 'wf001-legacy-overlap',
      '036fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc',
      app_private.sha256_text('overlap smoke deployment evidence two'), 'active',
      'b2b-smoke-window-overlap', v_actor);

  insert into public.transactions (
    id, type, status, date, items, source_warehouse_id, target_warehouse_id,
    source_type, source_id, posting_engine_version
  ) values
    ('b2b-smoke-fingerprint-canonical', 'IMPORT', 'COMPLETED', v_now - interval '53 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, 'wf001-legacy-canonical'),
    ('b2b-smoke-fingerprint-fake', 'IMPORT', 'COMPLETED', v_now - interval '52 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, 'wf001-legacy-fake'),
    ('b2b-smoke-window-outside', 'IMPORT', 'COMPLETED', v_now - interval '51 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, 'wf001-legacy-outside'),
    ('b2b-smoke-window-overlap', 'IMPORT', 'COMPLETED', v_now - interval '50 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, 'wf001-legacy-overlap'),
    (v_audit_tx, 'ADJUSTMENT', 'COMPLETED', v_now - interval '50 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '0.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), v_warehouse, v_warehouse, 'inventory_audit', v_audit_command::text, 'wf001-a3-v1'),
    (v_opening_tx, 'ADJUSTMENT', 'COMPLETED', v_now - interval '45 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.75', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, 'project_opening_balance', v_opening_id::text || ':' || v_warehouse, 'wf001-opening-v1'),
    (v_decimal_tx, 'IMPORT', 'COMPLETED', v_now - interval '40 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '0.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, 'wf001-legacy-smoke'),
    (v_missing_tx, 'IMPORT', 'COMPLETED', v_now - interval '35 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.75', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, null),
    (v_mismatch_tx, 'EXPORT', 'COMPLETED', v_now - interval '30 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '2.375', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), v_warehouse, null, null, null, 'wf001-a3-v1'),
    (v_invalid_tx, 'IMPORT', 'COMPLETED', v_now - interval '25 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1e999999999', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, null),
    (v_transfer_tx, 'TRANSFER', 'COMPLETED', v_now - interval '20 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '0.4', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), v_warehouse, v_warehouse, null, null, 'wf001-a3-v1');

  insert into public.transactions (
    id, type, status, date, items, source_warehouse_id, target_warehouse_id,
    source_type, source_id, posting_request_hash, posting_engine_version
  ) values
    ('b2b-smoke-aggregate-equal-identity', 'IMPORT', 'COMPLETED', v_now - interval '19 seconds',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('lineId', 'aggregate-line-1', 'itemId', v_item,
          'quantity', '1', 'unit', v_item_unit, 'unitSnapshot', v_item_unit),
        pg_catalog.jsonb_build_object('lineId', 'aggregate-line-2', 'itemId', v_item,
          'quantity', '1', 'unit', v_item_unit, 'unitSnapshot', v_item_unit)
      ), null, v_warehouse, null, null, null, 'wf001-a3-v1'),
    ('b2b-smoke-negative-adjustment', 'ADJUSTMENT', 'COMPLETED', v_now - interval '18 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'negative-adjustment-line', 'itemId', v_item, 'quantity', -0.75,
        'unit', v_item_unit, 'unitSnapshot', v_item_unit, 'quantity_delta', -0.75
      )), null, v_warehouse, null, null, null, 'wf001-a3-v1'),
    ('b2b-smoke-tampered-header', 'IMPORT', 'COMPLETED', v_now - interval '17 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'tampered-header-line', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, null, 'wf001-a3-v1'),
    ('b2b-smoke-tampered-items', 'IMPORT', 'COMPLETED', v_now - interval '16 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'tampered-items-line', 'itemId', v_item, 'quantity', '9',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit, 'tampered', true
      )), null, v_warehouse, null, null, null, 'wf001-a3-v1'),
    ('b2b-smoke-tampered-posting-hash', 'ADJUSTMENT', 'COMPLETED', v_now - interval '15 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'tampered-posting-line', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, 'project_opening_balance',
      'b2b00000-0000-4000-8000-000000000012:' || v_warehouse,
      'b2b-smoke-tampered-posting-hash', 'wf001-opening-v1'),
    ('b2b-smoke-hostile-exponent', 'IMPORT', 'COMPLETED', v_now - interval '14 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1e999999999', 'unit', v_item_unit,
        'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, null, null),
    ('b2b-smoke-numeric-overflow', 'IMPORT', 'COMPLETED', v_now - interval '13 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '999999999999999999999999999999999999999',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, null, null),
    ('b2b-smoke-missing-warehouse', 'IMPORT', 'COMPLETED', v_now - interval '12 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, null, null, null, null, null),
    ('b2b-smoke-missing-uom', 'IMPORT', 'COMPLETED', v_now - interval '11 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1'
      )), null, v_warehouse, null, null, null, null),
    ('b2b-smoke-missing-catalog', 'IMPORT', 'COMPLETED', v_now - interval '10 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', 'b2b-smoke-item-not-in-catalog', 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit
      )), null, v_warehouse, null, null, null, null),
    ('b2b-smoke-mixed-unit-ledger-only', 'IMPORT', 'COMPLETED', v_now - interval '9 seconds',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('lineId', 'mixed-unit-line-1', 'itemId', v_item,
          'quantity', '1', 'unit', v_item_unit, 'unitSnapshot', v_item_unit),
        pg_catalog.jsonb_build_object('lineId', 'mixed-unit-line-2', 'itemId', v_item,
          'quantity', '1', 'unit', v_item_unit || '-alternate',
          'unitSnapshot', v_item_unit || '-alternate')
      ), null, v_warehouse, null, null, null, 'wf001-a3-v1');

  insert into public.inventory_transactions (
    id, code, transaction_type, status, transaction_date, source_type,
    source_id, source_code, metadata, posted_at, created_at
  ) values
    ('b2b30000-0000-4000-8000-000000000001', 'B2B-CANONICAL', 'purchase_receipt', 'posted',
      v_now - interval '53 seconds', 'wms_transaction', 'b2b-smoke-fingerprint-canonical',
      'b2b-smoke-fingerprint-canonical', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-fingerprint-canonical', 'wmsType', 'IMPORT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
        ))), v_now - interval '52 seconds', v_now - interval '52 seconds'),
    ('b2b30000-0000-4000-8000-000000000002', 'B2B-FAKE', 'purchase_receipt', 'posted',
      v_now - interval '52 seconds', 'wms_transaction', 'b2b-smoke-fingerprint-fake',
      'b2b-smoke-fingerprint-fake', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-fingerprint-fake', 'wmsType', 'IMPORT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
        ))), v_now - interval '51 seconds', v_now - interval '51 seconds'),
    ('b2b30000-0000-4000-8000-000000000003', 'B2B-OUTSIDE', 'purchase_receipt', 'posted',
      v_now - interval '51 seconds', 'wms_transaction', 'b2b-smoke-window-outside',
      'b2b-smoke-window-outside', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-window-outside', 'wmsType', 'IMPORT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
        ))), v_now - interval '50 seconds', v_now - interval '50 seconds'),
    ('b2b30000-0000-4000-8000-000000000004', 'B2B-OVERLAP', 'purchase_receipt', 'posted',
      v_now - interval '50 seconds', 'wms_transaction', 'b2b-smoke-window-overlap',
      'b2b-smoke-window-overlap', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-window-overlap', 'wmsType', 'IMPORT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
        ))), v_now - interval '49 seconds', v_now - interval '49 seconds');

  insert into public.inventory_ledger_entries (
    inventory_transaction_id, entry_no, transaction_date, transaction_type,
    movement_direction, material_id, warehouse_id, source_type, source_id, source_code,
    source_line_id, quantity_in, quantity_out, unit, metadata, created_at
  ) values
    ('b2b30000-0000-4000-8000-000000000001', 1, v_now - interval '53 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-fingerprint-canonical', 'b2b-smoke-fingerprint-canonical', null,
      1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      ), v_now - interval '52 seconds'),
    ('b2b30000-0000-4000-8000-000000000002', 1, v_now - interval '52 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-fingerprint-fake', 'b2b-smoke-fingerprint-fake', null,
      1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      ), v_now - interval '51 seconds'),
    ('b2b30000-0000-4000-8000-000000000003', 1, v_now - interval '51 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-window-outside', 'b2b-smoke-window-outside', null,
      1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      ), v_now - interval '50 seconds'),
    ('b2b30000-0000-4000-8000-000000000004', 1, v_now - interval '50 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-window-overlap', 'b2b-smoke-window-overlap', null,
      1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '1.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      ), v_now - interval '49 seconds');

  update public.inventory_transactions header_row
  set posting_engine_version = transaction_row.posting_engine_version
  from public.transactions transaction_row
  where header_row.source_type = 'wms_transaction'
    and header_row.source_id = transaction_row.id
    and transaction_row.id in (
      'b2b-smoke-fingerprint-canonical', 'b2b-smoke-fingerprint-fake',
      'b2b-smoke-window-outside', 'b2b-smoke-window-overlap'
    );

  if exists (
    select 1
    from app_private.wms_reconciliation_wf001_exposure_windows outside_window
    join public.inventory_transactions outside_header
      on outside_header.posted_at >= outside_window.effective_from
     and outside_header.posted_at < outside_window.effective_to
     and outside_header.posting_engine_version is not distinct from outside_window.posting_engine_version
    where outside_window.reason = 'b2b-smoke-window-outside'
      and outside_header.source_id = 'b2b-smoke-window-outside'
  ) then
    raise exception 'b2b-smoke-window-outside header unexpectedly falls inside its real window';
  end if;

  if not exists (
    select 1
    from app_private.wms_reconciliation_wf001_exposure_windows overlap_one
    join app_private.wms_reconciliation_wf001_exposure_windows overlap_two
      on overlap_one.id <> overlap_two.id
     and overlap_one.effective_from < overlap_two.effective_to
     and overlap_two.effective_from < overlap_one.effective_to
    where overlap_one.reason = 'b2b-smoke-window-overlap'
      and overlap_two.reason = 'b2b-smoke-window-overlap'
      and overlap_one.status = 'active'
      and overlap_two.status = 'active'
  ) then
    raise exception 'b2b-smoke-window-overlap rows do not actually intersect';
  end if;

  insert into public.inventory_transactions (
    id, code, transaction_type, status, transaction_date, source_type,
    source_id, source_code, metadata, posted_at, created_at
  ) values
    ('b2b30000-0000-4000-8000-000000000011', 'B2B-AGGREGATE', 'purchase_receipt', 'posted',
      v_now - interval '19 seconds', 'wms_transaction', 'b2b-smoke-aggregate-equal-identity',
      'b2b-smoke-aggregate-equal-identity', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-aggregate-equal-identity', 'wmsType', 'IMPORT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('lineId', 'aggregate-line-1', 'itemId', v_item,
            'quantity', '1', 'unit', v_item_unit, 'unitSnapshot', v_item_unit),
          pg_catalog.jsonb_build_object('lineId', 'aggregate-line-2', 'itemId', v_item,
            'quantity', '1', 'unit', v_item_unit, 'unitSnapshot', v_item_unit)
        )), v_now - interval '18 seconds', v_now - interval '18 seconds'),
    ('b2b30000-0000-4000-8000-000000000012', 'B2B-NEGATIVE', 'adjustment_out', 'posted',
      v_now - interval '18 seconds', 'wms_transaction', 'b2b-smoke-negative-adjustment',
      'b2b-smoke-negative-adjustment', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-negative-adjustment', 'wmsType', 'ADJUSTMENT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'lineId', 'negative-adjustment-line', 'itemId', v_item, 'quantity', -0.75,
          'unit', v_item_unit, 'unitSnapshot', v_item_unit, 'quantity_delta', -0.75
        ))), v_now - interval '17 seconds', v_now - interval '17 seconds'),
    ('b2b30000-0000-4000-8000-000000000013', 'B2B-TAMPERED-HEADER', 'purchase_receipt', 'posted',
      v_now - interval '17 seconds', 'wms_transaction', 'b2b-smoke-tampered-header',
      'b2b-smoke-tampered-header-wrong', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-tampered-header', 'wmsType', 'IMPORT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'lineId', 'tampered-header-line', 'itemId', v_item, 'quantity', '1',
          'unit', v_item_unit, 'unitSnapshot', v_item_unit
        )), 'tampered', true), v_now - interval '16 seconds', v_now - interval '16 seconds'),
    ('b2b30000-0000-4000-8000-000000000014', 'B2B-TAMPERED-ITEMS', 'purchase_receipt', 'posted',
      v_now - interval '16 seconds', 'wms_transaction', 'b2b-smoke-tampered-items',
      'b2b-smoke-tampered-items', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-tampered-items', 'wmsType', 'IMPORT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'lineId', 'tampered-items-line', 'itemId', v_item, 'quantity', '1',
          'unit', v_item_unit, 'unitSnapshot', v_item_unit
        ))), v_now - interval '15 seconds', v_now - interval '15 seconds'),
    ('b2b30000-0000-4000-8000-000000000015', 'B2B-MIXED-UNIT', 'purchase_receipt', 'posted',
      v_now - interval '9 seconds', 'wms_transaction', 'b2b-smoke-mixed-unit-ledger-only',
      'b2b-smoke-mixed-unit-ledger-only', pg_catalog.jsonb_build_object(
        'wmsTransactionId', 'b2b-smoke-mixed-unit-ledger-only', 'wmsType', 'IMPORT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse,
        'supplierId', null, 'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('lineId', 'mixed-unit-line-1', 'itemId', v_item,
            'quantity', '1', 'unit', v_item_unit, 'unitSnapshot', v_item_unit),
          pg_catalog.jsonb_build_object('lineId', 'mixed-unit-line-2', 'itemId', v_item,
            'quantity', '1', 'unit', v_item_unit || '-alternate',
            'unitSnapshot', v_item_unit || '-alternate')
        )), v_now - interval '8 seconds', v_now - interval '8 seconds');

  insert into public.inventory_ledger_entries (
    inventory_transaction_id, entry_no, transaction_date, transaction_type,
    movement_direction, material_id, warehouse_id, source_type, source_id, source_code,
    source_line_id, quantity_in, quantity_out, unit, metadata, created_at
  ) values
    ('b2b30000-0000-4000-8000-000000000011', 1, v_now - interval '19 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-aggregate-equal-identity', 'b2b-smoke-aggregate-equal-identity',
      'aggregate-line-2', 1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'lineId', 'aggregate-line-1', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit), v_now - interval '18 seconds'),
    ('b2b30000-0000-4000-8000-000000000011', 2, v_now - interval '19 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-aggregate-equal-identity', 'b2b-smoke-aggregate-equal-identity',
      'aggregate-line-1', 1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'lineId', 'aggregate-line-2', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit), v_now - interval '18 seconds'),
    ('b2b30000-0000-4000-8000-000000000012', 1, v_now - interval '18 seconds',
      'adjustment_out', 'out', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-negative-adjustment', 'b2b-smoke-negative-adjustment',
      'negative-adjustment-line', 0, 0.75, v_item_unit, pg_catalog.jsonb_build_object(
        'lineId', 'negative-adjustment-line', 'itemId', v_item, 'quantity', -0.75,
        'unit', v_item_unit, 'unitSnapshot', v_item_unit,
        'quantity_delta', -0.75), v_now - interval '17 seconds'),
    ('b2b30000-0000-4000-8000-000000000013', 1, v_now - interval '17 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-tampered-header', 'b2b-smoke-tampered-header', 'tampered-header-line',
      1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'lineId', 'tampered-header-line', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit), v_now - interval '16 seconds'),
    ('b2b30000-0000-4000-8000-000000000014', 1, v_now - interval '16 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-tampered-items', 'b2b-smoke-tampered-items', 'tampered-items-line',
      1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'lineId', 'tampered-items-line', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit), v_now - interval '15 seconds'),
    ('b2b30000-0000-4000-8000-000000000015', 1, v_now - interval '9 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-mixed-unit-ledger-only', 'b2b-smoke-mixed-unit-ledger-only',
      'mixed-unit-line-1', 1, 0, v_item_unit, pg_catalog.jsonb_build_object(
        'lineId', 'mixed-unit-line-1', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit), v_now - interval '8 seconds'),
    ('b2b30000-0000-4000-8000-000000000015', 2, v_now - interval '9 seconds',
      'purchase_receipt', 'in', v_item, v_warehouse, 'wms_transaction',
      'b2b-smoke-mixed-unit-ledger-only', 'b2b-smoke-mixed-unit-ledger-only',
      'mixed-unit-line-2', 1, 0, v_item_unit || '-alternate', pg_catalog.jsonb_build_object(
        'lineId', 'mixed-unit-line-2', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit || '-alternate', 'unitSnapshot', v_item_unit || '-alternate'
      ), v_now - interval '8 seconds');

  insert into public.inventory_transactions (
    id, code, transaction_type, status, transaction_date, source_type,
    source_id, source_code, posted_at, created_at
  ) values
    (v_audit_header, 'B2B-AUDIT', 'adjustment_in', 'posted', v_now - interval '50 seconds',
      'wms_transaction', v_audit_tx, v_audit_tx, v_now - interval '49 seconds', v_now - interval '49 seconds'),
    (v_opening_header, 'B2B-OPENING', 'adjustment_in', 'posted', v_now - interval '45 seconds',
      'wms_transaction', v_opening_tx, v_opening_tx, v_now - interval '44 seconds', v_now - interval '44 seconds'),
    (v_decimal_header, 'B2B-DECIMAL', 'purchase_receipt', 'posted', v_now - interval '40 seconds',
      'wms_transaction', v_decimal_tx, v_decimal_tx, v_now - interval '39 seconds', v_now - interval '39 seconds'),
    (v_mismatch_header, 'B2B-MISMATCH', 'project_issue', 'posted', v_now - interval '30 seconds',
      'wms_transaction', v_mismatch_tx, v_mismatch_tx, v_now - interval '29 seconds', v_now - interval '29 seconds'),
    (v_transfer_header, 'B2B-TRANSFER', 'transfer', 'posted', v_now - interval '20 seconds',
      'wms_transaction', v_transfer_tx, v_transfer_tx, v_now - interval '19 seconds', v_now - interval '19 seconds');

  insert into public.inventory_ledger_entries (
    inventory_transaction_id, entry_no, transaction_date, transaction_type,
    movement_direction, material_id, warehouse_id, source_type, source_id,
    quantity_in, quantity_out, unit, created_at
  ) values
    (v_audit_header, 1, v_now - interval '50 seconds', 'adjustment_in', 'in',
      v_item, v_warehouse, 'wms_transaction', v_audit_tx, 0.25, 0, v_item_unit, v_now - interval '49 seconds'),
    (v_opening_header, 1, v_now - interval '45 seconds', 'adjustment_in', 'in',
      v_item, v_warehouse, 'wms_transaction', v_opening_tx, 1.75, 0, v_item_unit, v_now - interval '44 seconds'),
    (v_mismatch_header, 1, v_now - interval '30 seconds', 'project_issue', 'out',
      v_item, v_warehouse, 'wms_transaction', v_mismatch_tx, 0, 2.1, v_item_unit, v_now - interval '29 seconds'),
    (v_transfer_header, 1, v_now - interval '20 seconds', 'transfer_out', 'out',
      v_item, v_warehouse, 'wms_transaction', v_transfer_tx, 0, 0.4, v_item_unit, v_now - interval '19 seconds'),
    (v_transfer_header, 2, v_now - interval '20 seconds', 'transfer_in', 'in',
      v_item, v_warehouse, 'wms_transaction', v_transfer_tx, 0.4, 0, v_item_unit, v_now - interval '19 seconds');

  insert into public.transactions (
    id, type, status, date, items, source_warehouse_id, target_warehouse_id,
    source_type, source_id, posting_engine_version
  ) values (
    'audit-adjustment-b2b00000-0000-4000-8000-000000000021',
    'ADJUSTMENT', 'COMPLETED', v_now - interval '7 seconds',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'lineId', 'b2b-smoke-audit-negative-line', 'itemId', v_item,
      'quantity', '-0.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
    )), null, v_warehouse, 'inventory_audit',
    'b2b00000-0000-4000-8000-000000000021', 'wf001-a3-v1'
  );

  insert into public.inventory_transactions (
    id, code, transaction_type, status, transaction_date, source_type,
    source_id, source_code, metadata, posted_at, created_at
  ) values (
    'b2b30000-0000-4000-8000-000000000021', 'B2B-AUDIT-NEGATIVE',
    'adjustment_out', 'posted', v_now - interval '7 seconds', 'wms_transaction',
    'audit-adjustment-b2b00000-0000-4000-8000-000000000021',
    'audit-adjustment-b2b00000-0000-4000-8000-000000000021',
    pg_catalog.jsonb_build_object(
      'wmsTransactionId', 'audit-adjustment-b2b00000-0000-4000-8000-000000000021',
      'wmsType', 'ADJUSTMENT', 'wmsStatus', 'COMPLETED',
      'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse, 'supplierId', null,
      'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'b2b-smoke-audit-negative-line', 'itemId', v_item,
        'quantity', '-0.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
      ))
    ), v_now - interval '6 seconds', v_now - interval '6 seconds'
  );

  insert into public.inventory_ledger_entries (
    inventory_transaction_id, entry_no, transaction_date, transaction_type,
    movement_direction, material_id, warehouse_id, source_type, source_id, source_code,
    source_line_id, quantity_in, quantity_out, unit, metadata, created_at
  ) values (
    'b2b30000-0000-4000-8000-000000000021', 1, v_now - interval '7 seconds',
    'adjustment_out', 'out', v_item, v_warehouse, 'wms_transaction',
    'audit-adjustment-b2b00000-0000-4000-8000-000000000021',
    'audit-adjustment-b2b00000-0000-4000-8000-000000000021',
    'b2b-smoke-audit-negative-line', 0, 0.25, v_item_unit,
    pg_catalog.jsonb_build_object(
      'lineId', 'b2b-smoke-audit-negative-line', 'itemId', v_item,
      'quantity', '-0.25', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
    ), v_now - interval '6 seconds'
  );

  insert into public.audit_sessions (
    id, "warehouseId", items, date, "transactionId", command_id,
    request_hash, posting_engine_version
  ) values
    ('b2b-smoke-audit-negative', v_warehouse,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'unit', v_item_unit, 'systemStock', '1',
        'actualStock', '0.75', 'delta', '-0.25'
      )), v_now - interval '7 seconds',
      'audit-adjustment-b2b00000-0000-4000-8000-000000000021',
      'b2b00000-0000-4000-8000-000000000021', pg_catalog.repeat('b', 64),
      'wf001-audit-v1'),
    ('b2b-smoke-tampered-command', v_warehouse,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'unit', v_item_unit, 'systemStock', '1',
        'actualStock', '1', 'delta', '0'
      )), v_now - interval '6 seconds', null,
      'b2b00000-0000-4000-8000-000000000022', pg_catalog.repeat('c', 64),
      'wf001-audit-v1');

  insert into app_private.inventory_audit_command_results (
    command_id, request_hash, actor_id, warehouse_id, result, created_at
  )
  select 'b2b00000-0000-4000-8000-000000000021'::uuid, pg_catalog.repeat('b', 64),
    v_actor, v_warehouse, pg_catalog.jsonb_build_object(
      'audit_session', pg_catalog.to_jsonb(audit_row),
      'stock_transaction', pg_catalog.to_jsonb(transaction_row)
    ), v_now - interval '5 seconds'
  from public.audit_sessions audit_row
  join public.transactions transaction_row
    on transaction_row.id = audit_row."transactionId"
  where audit_row.id = 'b2b-smoke-audit-negative'
  union all
  select 'b2b00000-0000-4000-8000-000000000022'::uuid, pg_catalog.repeat('c', 64),
    v_actor, v_warehouse, pg_catalog.jsonb_build_object(
      'audit_session', pg_catalog.to_jsonb(audit_row) ||
        pg_catalog.jsonb_build_object('tampered', 'b2b-smoke-tampered-command'),
      'stock_transaction', null
    ), v_now - interval '5 seconds'
  from public.audit_sessions audit_row
  where audit_row.id = 'b2b-smoke-tampered-command';

  insert into public.audit_sessions (
    id, "warehouseId", items, date, "transactionId", command_id,
    request_hash, posting_engine_version
  ) values
    ('b2b-smoke-audit-valid', v_warehouse,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'unit', v_item_unit, 'systemStock', '1',
        'actualStock', '1.25', 'delta', '0.25'
      )), v_now - interval '50 seconds', v_audit_tx, v_audit_command,
      pg_catalog.repeat('a', 64), 'wf001-audit-v1'),
    ('b2b-smoke-audit-invalid', v_warehouse,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'itemId', v_item, 'unit', v_item_unit, 'systemStock', '1',
        'actualStock', '1e999999999', 'delta', '1e999999999'
      )), v_now - interval '48 seconds', null, null, null, null);

  insert into app_private.inventory_audit_command_results (
    command_id, request_hash, actor_id, warehouse_id, result, created_at
  )
  select v_audit_command, pg_catalog.repeat('a', 64), v_actor, v_warehouse,
    pg_catalog.jsonb_build_object('audit_session', pg_catalog.jsonb_build_object(
      'id', audit.id, 'items', audit.items, 'request_hash', audit.request_hash,
      'posting_engine_version', audit.posting_engine_version
    )), v_now - interval '47 seconds'
  from public.audit_sessions audit
  where audit.id = 'b2b-smoke-audit-valid';

  insert into public.project_opening_balances (
    id, scope_key, construction_site_id, as_of_date, status,
    stock_transaction_ids, lock_command_id, lock_request_hash,
    posting_engine_version, locked_at, created_at
  ) values (
    v_opening_id, 'b2b-smoke:' || v_run_id::text, 'b2b-smoke-site', v_now::date,
    'locked', pg_catalog.jsonb_build_array(v_opening_tx), v_opening_command,
    'b2b-opening-hash', 'wf001-opening-v1', v_now - interval '43 seconds',
    v_now - interval '46 seconds'
  );
  insert into public.project_opening_balance_lines (
    id, opening_balance_id, inventory_item_id, sku, item_name, unit,
    warehouse_id, remaining_qty, created_at
  ) values (
    v_opening_line, v_opening_id, v_item, v_item_sku, v_item_name, v_item_unit,
    v_warehouse, 1.75, v_now - interval '45 seconds'
  );
  insert into app_private.project_opening_command_results (
    command_id, opening_balance_id, actor_id, request_hash, result, created_at
  )
  select v_opening_command, v_opening_id, v_actor, 'b2b-opening-hash',
    pg_catalog.jsonb_build_object(
      'opening_balance', pg_catalog.to_jsonb(opening),
      'lines', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(line) order by line.created_at, line.id)
        from public.project_opening_balance_lines line where line.opening_balance_id = opening.id),
      'stock_transactions', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(transaction_row) order by transaction_row.id)
        from public.transactions transaction_row where transaction_row.id = v_opening_tx)
    ), v_now - interval '42 seconds'
  from public.project_opening_balances opening
  where opening.id = v_opening_id;

  insert into public.inventory_transactions (
    id, code, transaction_type, status, transaction_date, source_type,
    source_id, source_code, metadata, posted_at, created_at
  ) values (
    'b2b30000-0000-4000-8000-000000000031', 'B2B-TAMPERED-POSTING-HASH',
    'adjustment_in', 'posted', v_now - interval '15 seconds', 'wms_transaction',
    'b2b-smoke-tampered-posting-hash', 'b2b-smoke-tampered-posting-hash',
    pg_catalog.jsonb_build_object(
      'wmsTransactionId', 'b2b-smoke-tampered-posting-hash',
      'wmsType', 'ADJUSTMENT', 'wmsStatus', 'COMPLETED',
      'sourceWarehouseId', null, 'targetWarehouseId', v_warehouse, 'supplierId', null,
      'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'tampered-posting-line', 'itemId', v_item, 'quantity', '1',
        'unit', v_item_unit, 'unitSnapshot', v_item_unit
      ))
    ), v_now - interval '14 seconds', v_now - interval '14 seconds'
  );
  insert into public.inventory_ledger_entries (
    inventory_transaction_id, entry_no, transaction_date, transaction_type,
    movement_direction, material_id, warehouse_id, source_type, source_id, source_code,
    source_line_id, quantity_in, quantity_out, unit, metadata, created_at
  ) values (
    'b2b30000-0000-4000-8000-000000000031', 1, v_now - interval '15 seconds',
    'adjustment_in', 'in', v_item, v_warehouse, 'wms_transaction',
    'b2b-smoke-tampered-posting-hash', 'b2b-smoke-tampered-posting-hash',
    'tampered-posting-line', 1, 0, v_item_unit,
    pg_catalog.jsonb_build_object(
      'lineId', 'tampered-posting-line', 'itemId', v_item, 'quantity', '1',
      'unit', v_item_unit, 'unitSnapshot', v_item_unit
    ), v_now - interval '14 seconds'
  );
  insert into public.project_opening_balances (
    id, scope_key, construction_site_id, as_of_date, status,
    stock_transaction_ids, lock_command_id, lock_request_hash,
    posting_engine_version, reversal_stock_transaction_ids, locked_at, created_at
  ) values (
    'b2b00000-0000-4000-8000-000000000012', 'b2b-smoke:tampered-posting-hash',
    'b2b-smoke-site', v_now::date, 'locked',
    pg_catalog.jsonb_build_array('b2b-smoke-tampered-posting-hash'),
    'b2b00000-0000-4000-8000-000000000013', 'b2b-opening-tampered-hash',
    'wf001-opening-v1', '[]'::jsonb, v_now - interval '13 seconds',
    v_now - interval '16 seconds'
  );
  insert into public.project_opening_balance_lines (
    id, opening_balance_id, inventory_item_id, sku, item_name, unit,
    warehouse_id, remaining_qty, created_at
  ) values (
    'b2b00000-0000-4000-8000-000000000019',
    'b2b00000-0000-4000-8000-000000000012', v_item, v_item_sku,
    v_item_name, v_item_unit, v_warehouse, 1, v_now - interval '15 seconds'
  );
  insert into app_private.project_opening_command_results (
    command_id, opening_balance_id, actor_id, request_hash, result, created_at
  )
  select 'b2b00000-0000-4000-8000-000000000013'::uuid,
    'b2b00000-0000-4000-8000-000000000012'::uuid, v_actor,
    'b2b-opening-tampered-hash', pg_catalog.jsonb_build_object(
      'opening_balance', pg_catalog.to_jsonb(opening_row),
      'lines', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(line_row)
        order by line_row.created_at, line_row.id)
        from public.project_opening_balance_lines line_row
        where line_row.opening_balance_id = opening_row.id),
      'stock_transactions', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(transaction_row)
        order by transaction_row.id) from public.transactions transaction_row
        where transaction_row.id = 'b2b-smoke-tampered-posting-hash')
    ), v_now - interval '12 seconds'
  from public.project_opening_balances opening_row
  where opening_row.id = 'b2b00000-0000-4000-8000-000000000012';

  insert into public.transactions (
    id, type, status, date, items, source_warehouse_id, target_warehouse_id,
    source_type, source_id, posting_request_hash, posting_engine_version
  ) values
    (v_void_original_tx, 'ADJUSTMENT', 'COMPLETED', v_now - interval '5 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'b2b00000-0000-4000-8000-000000000014:1',
        'itemId', v_item, 'quantity', '1.75', 'unit', v_item_unit,
        'unitSnapshot', v_item_unit
      )), null, v_warehouse, 'project_opening_balance',
      'b2b00000-0000-4000-8000-000000000014:' || v_warehouse,
      null, 'wf001-opening-v1'),
    (v_void_reversal_tx, 'ADJUSTMENT', 'COMPLETED', v_now - interval '4 seconds',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lineId', 'reversal:b2b00000-0000-4000-8000-000000000014:1',
        'reversalOfLineId', 'b2b00000-0000-4000-8000-000000000014:1',
        'itemId', v_item, 'quantity', '-1.75', 'unit', v_item_unit,
        'unitSnapshot', v_item_unit
      )), null, v_warehouse, 'project_opening_balance_reversal',
      'b2b00000-0000-4000-8000-000000000014:' || v_warehouse,
      null, 'wf001-opening-reversal-v1');

  update public.transactions transaction_row
  set posting_request_hash = app_private.sha256_text(pg_catalog.jsonb_build_object(
    'id', pg_catalog.to_jsonb(transaction_row) -> 'id',
    'type', pg_catalog.to_jsonb(transaction_row) -> 'type',
    'date', pg_catalog.to_jsonb(transaction_row) -> 'date',
    'items', pg_catalog.to_jsonb(transaction_row) -> 'items',
    'sourceWarehouseId', pg_catalog.to_jsonb(transaction_row) -> 'source_warehouse_id',
    'targetWarehouseId', pg_catalog.to_jsonb(transaction_row) -> 'target_warehouse_id',
    'supplierId', pg_catalog.to_jsonb(transaction_row) -> 'supplier_id',
    'requesterId', pg_catalog.to_jsonb(transaction_row) -> 'requester_id',
    'createdBy', pg_catalog.to_jsonb(transaction_row) -> 'created_by',
    'businessPartnerId', pg_catalog.to_jsonb(transaction_row) -> 'business_partner_id',
    'businessPartnerNameSnapshot', pg_catalog.to_jsonb(transaction_row) -> 'business_partner_name_snapshot',
    'note', pg_catalog.to_jsonb(transaction_row) -> 'note',
    'sourceType', pg_catalog.to_jsonb(transaction_row) -> 'source_type',
    'sourceId', pg_catalog.to_jsonb(transaction_row) -> 'source_id',
    'relatedRequestId', pg_catalog.to_jsonb(transaction_row) -> 'related_request_id',
    'pendingItems', coalesce(pg_catalog.to_jsonb(transaction_row) -> 'pending_items', '[]'::jsonb)
  )::text)
  where transaction_row.id in (v_void_original_tx, v_void_reversal_tx);

  insert into public.inventory_transactions (
    id, code, transaction_type, status, transaction_date, source_type,
    source_id, source_code, metadata, posted_at, created_at
  ) values
    ('b2b30000-0000-4000-8000-000000000041', 'B2B-VOID-ORIGINAL',
      'adjustment_in', 'posted', v_now - interval '5 seconds', 'wms_transaction',
      v_void_original_tx, v_void_original_tx, pg_catalog.jsonb_build_object(
        'wmsTransactionId', v_void_original_tx, 'wmsType', 'ADJUSTMENT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null,
        'targetWarehouseId', v_warehouse, 'supplierId', null,
        'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'lineId', 'b2b00000-0000-4000-8000-000000000014:1',
          'itemId', v_item, 'quantity', '1.75', 'unit', v_item_unit,
          'unitSnapshot', v_item_unit
        ))
      ), v_now - interval '4 seconds', v_now - interval '4 seconds'),
    ('b2b30000-0000-4000-8000-000000000042', 'B2B-VOID-REVERSAL',
      'adjustment_out', 'posted', v_now - interval '4 seconds', 'wms_transaction',
      v_void_reversal_tx, v_void_reversal_tx, pg_catalog.jsonb_build_object(
        'wmsTransactionId', v_void_reversal_tx, 'wmsType', 'ADJUSTMENT',
        'wmsStatus', 'COMPLETED', 'sourceWarehouseId', null,
        'targetWarehouseId', v_warehouse, 'supplierId', null,
        'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'lineId', 'reversal:b2b00000-0000-4000-8000-000000000014:1',
          'reversalOfLineId', 'b2b00000-0000-4000-8000-000000000014:1',
          'itemId', v_item, 'quantity', '-1.75', 'unit', v_item_unit,
          'unitSnapshot', v_item_unit
        ))
      ), v_now - interval '3 seconds', v_now - interval '3 seconds');

  insert into public.inventory_ledger_entries (
    inventory_transaction_id, entry_no, transaction_date, transaction_type,
    movement_direction, material_id, warehouse_id, source_type, source_id, source_code,
    source_line_id, quantity_in, quantity_out, unit, metadata, created_at
  ) values
    ('b2b30000-0000-4000-8000-000000000041', 1, v_now - interval '5 seconds',
      'adjustment_in', 'in', v_item, v_warehouse, 'wms_transaction',
      v_void_original_tx, v_void_original_tx,
      'b2b00000-0000-4000-8000-000000000014:1', 1.75, 0, v_item_unit,
      pg_catalog.jsonb_build_object(
        'lineId', 'b2b00000-0000-4000-8000-000000000014:1',
        'itemId', v_item, 'quantity', '1.75', 'unit', v_item_unit,
        'unitSnapshot', v_item_unit
      ), v_now - interval '4 seconds'),
    ('b2b30000-0000-4000-8000-000000000042', 1, v_now - interval '4 seconds',
      'adjustment_out', 'out', v_item, v_warehouse, 'wms_transaction',
      v_void_reversal_tx, v_void_reversal_tx,
      'reversal:b2b00000-0000-4000-8000-000000000014:1', 0, 1.75,
      v_item_unit, pg_catalog.jsonb_build_object(
        'lineId', 'reversal:b2b00000-0000-4000-8000-000000000014:1',
        'reversalOfLineId', 'b2b00000-0000-4000-8000-000000000014:1',
        'itemId', v_item, 'quantity', '-1.75', 'unit', v_item_unit,
        'unitSnapshot', v_item_unit
      ), v_now - interval '3 seconds');

  insert into public.project_opening_balances (
    id, scope_key, construction_site_id, as_of_date, status,
    stock_transaction_ids, lock_command_id, lock_request_hash, posting_engine_version,
    reversal_command_id, reversal_request_hash, reversal_stock_transaction_ids,
    locked_at, reversed_at, created_at
  ) values (
    'b2b00000-0000-4000-8000-000000000014',
    'b2b-smoke-valid-void-reversal', 'b2b-smoke-site', v_now::date, 'void',
    pg_catalog.jsonb_build_array(v_void_original_tx),
    'b2b00000-0000-4000-8000-000000000015', pg_catalog.repeat('d', 64),
    'wf001-opening-v1', 'b2b00000-0000-4000-8000-000000000016',
    pg_catalog.repeat('e', 64), pg_catalog.jsonb_build_array(v_void_reversal_tx),
    v_now - interval '4 seconds', v_now - interval '2 seconds',
    v_now - interval '6 seconds'
  );
  insert into public.project_opening_balance_lines (
    id, opening_balance_id, inventory_item_id, sku, item_name, unit,
    warehouse_id, remaining_qty, created_at
  ) values (
    'b2b00000-0000-4000-8000-000000000017',
    'b2b00000-0000-4000-8000-000000000014', v_item, v_item_sku,
    v_item_name, v_item_unit, v_warehouse, 1.75, v_now - interval '5 seconds'
  );
  insert into app_private.project_opening_command_results (
    command_id, opening_balance_id, actor_id, request_hash, result, created_at
  )
  select 'b2b00000-0000-4000-8000-000000000015'::uuid,
    'b2b00000-0000-4000-8000-000000000014'::uuid, v_actor,
    pg_catalog.repeat('d', 64), pg_catalog.jsonb_build_object(
      'opening_balance', pg_catalog.to_jsonb(opening_row),
      'lines', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(line_row)
        order by line_row.created_at, line_row.id)
        from public.project_opening_balance_lines line_row
        where line_row.opening_balance_id = opening_row.id),
      'stock_transactions', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(transaction_row)
        order by transaction_row.id) from public.transactions transaction_row
        where transaction_row.id = v_void_original_tx)
    ), v_now - interval '3 seconds'
  from public.project_opening_balances opening_row
  where opening_row.id = 'b2b00000-0000-4000-8000-000000000014';
  insert into app_private.project_opening_reversal_results (
    command_id, opening_balance_id, actor_id, request_hash, reason,
    finance_before, finance_after, stock_transaction_map, material_transaction_map,
    result, created_at
  )
  select 'b2b00000-0000-4000-8000-000000000016'::uuid,
    'b2b00000-0000-4000-8000-000000000014'::uuid, v_actor,
    pg_catalog.repeat('e', 64), 'b2b-smoke-valid-void-reversal', '{}'::jsonb,
    '{}'::jsonb, pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'originalTransactionId', v_void_original_tx,
      'compensatingTransactionId', v_void_reversal_tx
    )), '{}'::jsonb, pg_catalog.jsonb_build_object(
      'opening_balance', pg_catalog.to_jsonb(opening_row),
      'compensating_stock_transactions', (select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(transaction_row) order by transaction_row.id)
        from public.transactions transaction_row where transaction_row.id = v_void_reversal_tx),
      'stock_transaction_map', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'originalTransactionId', v_void_original_tx,
        'compensatingTransactionId', v_void_reversal_tx
      ))
    ), v_now - interval '1 second'
  from public.project_opening_balances opening_row
  where opening_row.id = 'b2b00000-0000-4000-8000-000000000014';

  update public.inventory_transactions header_row
  set metadata = pg_catalog.jsonb_build_object(
    'wmsTransactionId', v_mismatch_tx, 'wmsType', 'EXPORT',
    'wmsStatus', 'COMPLETED', 'sourceWarehouseId', v_warehouse,
    'targetWarehouseId', null, 'supplierId', null,
    'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'itemId', v_item, 'quantity', '2.375', 'unit', v_item_unit,
      'unitSnapshot', v_item_unit
    ))
  )
  where header_row.id = v_mismatch_header;
  update public.inventory_ledger_entries entry_row
  set source_code = v_mismatch_tx,
      metadata = pg_catalog.jsonb_build_object(
        'itemId', v_item, 'quantity', '2.375', 'unit', v_item_unit,
        'unitSnapshot', v_item_unit
      )
  where entry_row.inventory_transaction_id = v_mismatch_header;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'inventory_ledger_entries'
      and column_row.column_name = 'quantity_delta'
      and column_row.is_generated = 'NEVER'
  ) then
    update public.inventory_ledger_entries entry_row
    set quantity_delta = entry_row.quantity_in - entry_row.quantity_out;
  end if;

  perform pg_catalog.set_config('session_replication_role', 'origin', true);
  insert into public.wms_reconciliation_runs (
    id, scope, scope_hash, affected_from, as_of, policy_version,
    source_snapshot, cursor, status, created_by, created_at
  ) values (
    v_run_id,
    pg_catalog.jsonb_build_object(
      'warehouseIds', '["*"]'::jsonb,
      'itemIds', '[]'::jsonb,
      'sourceTypes', '[]'::jsonb,
      'affectedFrom', v_now - interval '2 minutes'
    ),
    app_private.sha256_text('b2b-smoke-scope'), v_now - interval '2 minutes',
    v_now, 'b2b-smoke', v_snapshot,
    '{"phase":"physical_anchor","lastKey":null}'::jsonb,
    'created', v_actor, v_now
  );

  -- Backdated source committed after run creation must not join the frozen set.
  perform pg_catalog.set_config('session_replication_role', 'replica', true);
  insert into public.transactions (
    id, type, status, date, items, target_warehouse_id
  ) values (
    'b2b-smoke-late-backdated', 'IMPORT', 'COMPLETED', v_now - interval '15 seconds',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'itemId', v_item, 'quantity', '9.9', 'unit', v_item_unit, 'unitSnapshot', v_item_unit
    )), v_warehouse
  );
  if exists (
    select 1 from app_private.wms_reconciliation_frozen_sources frozen
    where frozen.run_id = v_run_id and frozen.source_key = 'b2b-smoke-late-backdated'
  ) then
    raise exception 'late backdated source entered frozen candidates';
  end if;

  select pg_catalog.jsonb_build_object(
    'transactions', (select pg_catalog.count(*) from public.transactions),
    'audits', (select pg_catalog.count(*) from public.audit_sessions),
    'openings', (select pg_catalog.count(*) from public.project_opening_balances),
    'headers', (select pg_catalog.count(*) from public.inventory_transactions),
    'entries', (select pg_catalog.count(*) from public.inventory_ledger_entries),
    'balances', (select pg_catalog.count(*) from public.inventory_balances),
    'items', (select pg_catalog.count(*) from public.items)
  ) into reconciliation_source_counts_before;

  v_physical := app_private.scan_wms_reconciliation_phase_physical_anchor(
    v_run_id, 500, '{"phase":"physical_anchor","lastKey":null}'::jsonb, v_snapshot
  );
  select pg_catalog.count(*) into v_finding_count
  from public.wms_reconciliation_findings finding where finding.run_id = v_run_id;
  v_physical_retry := app_private.scan_wms_reconciliation_phase_physical_anchor(
    v_run_id, 500, '{"phase":"physical_anchor","lastKey":null}'::jsonb, v_snapshot
  );
  if v_physical is distinct from v_physical_retry
     or v_finding_count <> (select pg_catalog.count(*) from public.wms_reconciliation_findings finding where finding.run_id = v_run_id) then
    raise exception 'physical retry/idempotency failed';
  end if;
  if not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-tampered-command'
         and finding.finding_type = 'LINEAGE_GAP'
         and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from app_private.wms_reconciliation_run_work work
       where work.run_id = v_run_id
         and work.source_key = 'b2b-smoke-audit-negative'
         and work.payload ->> 'validAnchor' = 'true'
         and (
           work.payload -> 'excludedTransactionIds' ? 'b2b-smoke-audit-negative'
           or work.payload -> 'excludedTransactionIds'
                ? 'audit-adjustment-b2b00000-0000-4000-8000-000000000021'
         ))
     or (v_physical ->> 'complete')::boolean is not true then
    raise exception 'named physical-anchor smoke outcome mismatch: findings %, work %',
      (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'source', finding.evidence #>> '{source,id}', 'type', finding.finding_type,
        'status', finding.status, 'reason', finding.quarantine_reason,
        'audit', finding.evidence -> 'source',
        'command', finding.evidence -> 'commandResult'
      ) order by finding.id)
      from public.wms_reconciliation_findings finding
      where finding.run_id = v_run_id),
      (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'sourceKey', work.source_key, 'payload', work.payload
      ) order by work.source_key)
      from app_private.wms_reconciliation_run_work work
      where work.run_id = v_run_id and work.phase = 'physical_anchor');
  end if;
  if exists (select 1 from app_private.wms_reconciliation_run_work work
       where work.run_id = v_run_id
         and work.source_key = 'b2b-smoke-tampered-command'
         and work.payload ->> 'validAnchor' = 'true') then
    raise exception 'tampered physical anchor was incorrectly admitted to replay exclusion';
  end if;
  v_opening := app_private.scan_wms_reconciliation_phase_opening_balance(
    v_run_id, 500, '{"phase":"opening_balance","lastKey":null}'::jsonb, v_snapshot
  );
  if not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and (
           finding.evidence #>> '{source,id}' = 'b2b-smoke-tampered-posting-hash'
           or finding.evidence #>> '{source,id}' = 'b2b00000-0000-4000-8000-000000000012'
         )
         and finding.finding_type = 'LINEAGE_GAP'
         and finding.confidence = 'low' and finding.status = 'quarantined')
     or (v_opening ->> 'complete')::boolean is not true then
    raise exception 'tampered opening posting-request hash was not quarantined';
  end if;
  if not exists (
       select 1
       from app_private.wms_reconciliation_run_work work
       join public.project_opening_balances opening_row
         on opening_row.id::text = work.source_key
       where work.run_id = v_run_id
         and opening_row.scope_key = 'b2b-smoke-valid-void-reversal'
         and work.payload ->> 'validAnchor' = 'true'
         and (
           work.payload -> 'excludedTransactionIds' ? 'opening-balance:'
           or work.payload -> 'excludedTransactionIds' ? v_void_original_tx
         )
         and (
           work.payload -> 'excludedTransactionIds' ? 'opening-reversal:'
           or work.payload -> 'excludedTransactionIds' ? v_void_reversal_tx
         )
     )
     or (v_opening ->> 'complete')::boolean is not true then
    raise exception 'b2b-smoke-valid-void-reversal did not exclude original and reversal';
  end if;
  v_ledger := app_private.scan_wms_reconciliation_phase_transaction_ledger(
    v_run_id, 500, '{"phase":"transaction_ledger","lastKey":null}'::jsonb, v_snapshot
  );
  if not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-fingerprint-canonical'
         and finding.finding_type = 'DECIMAL_APPLY' and finding.confidence = 'high' and finding.status = 'open')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-fingerprint-fake'
         and finding.finding_type = 'DECIMAL_APPLY' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-window-outside'
         and finding.finding_type = 'DECIMAL_APPLY' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-window-overlap'
         and finding.finding_type = 'DECIMAL_APPLY' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-aggregate-equal-identity'
         and finding.finding_type = 'LINEAGE_GAP' and finding.confidence = 'low' and finding.status = 'quarantined')
     or exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-negative-adjustment')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-tampered-header'
         and finding.finding_type = 'LINEAGE_GAP' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-tampered-items'
         and finding.finding_type = 'LINEAGE_GAP' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-hostile-exponent'
         and finding.finding_type = 'LINEAGE_GAP' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-numeric-overflow'
         and finding.finding_type = 'LINEAGE_GAP' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-missing-warehouse'
         and finding.finding_type = 'LINEAGE_GAP' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-missing-uom'
         and finding.finding_type = 'UOM_PRECISION' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-missing-catalog'
         and finding.finding_type = 'UOM_PRECISION' and finding.confidence = 'low' and finding.status = 'quarantined')
     or not exists (select 1 from public.wms_reconciliation_findings finding
       where finding.run_id = v_run_id
         and finding.evidence #>> '{source,id}' = 'b2b-smoke-mixed-unit-ledger-only'
         and finding.finding_type = 'UOM_PRECISION' and finding.confidence = 'low' and finding.status = 'quarantined')
     or (v_ledger ->> 'complete')::boolean is not true then
    raise exception 'named transaction-ledger smoke outcome mismatch: frozen windows %, findings %',
      (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'sourceKey', frozen.source_key,
        'exposureWindows', frozen.payload -> 'exposureWindows',
        'validation', app_private.validate_wms_reconciliation_frozen_transaction(
          frozen.payload -> 'transaction', frozen.payload -> 'ledgerHeaders')
      ) order by frozen.source_key)
      from app_private.wms_reconciliation_frozen_sources frozen
      where frozen.run_id = v_run_id
        and frozen.source_key in ('b2b-smoke-window-outside', 'b2b-smoke-window-overlap')),
      (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'source', finding.evidence #>> '{source,id}', 'type', finding.finding_type,
        'confidence', finding.confidence, 'status', finding.status,
        'reason', finding.quarantine_reason
      ) order by finding.evidence #>> '{source,id}', finding.finding_type)
      from public.wms_reconciliation_findings finding
      where finding.run_id = v_run_id);
  end if;

  select app_private.validate_wms_reconciliation_frozen_transaction(
    pg_catalog.to_jsonb(transaction_row),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'header', pg_catalog.to_jsonb(header_row),
      'ledgerEntries', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(entry_row)
        order by entry_row.created_at, entry_row.id), '[]'::jsonb)
        from public.inventory_ledger_entries entry_row
        where entry_row.inventory_transaction_id = header_row.id)
    ) order by header_row.created_at, header_row.id) filter (where header_row.id is not null), '[]'::jsonb)
  ) into v_negative_validation
  from public.transactions transaction_row
  left join public.inventory_transactions header_row
    on header_row.source_type = 'wms_transaction' and header_row.source_id = transaction_row.id
  where transaction_row.id = 'b2b-smoke-negative-adjustment'
  group by transaction_row.id;
  if ((v_negative_validation ->> 'sourceValid')::boolean is not true)::integer
       + ((v_negative_validation ->> 'entryIdentityValid')::boolean is not true)::integer
       + ((v_negative_validation ->> 'quantityExact')::boolean is not true)::integer
       + (pg_catalog.jsonb_path_exists(v_negative_validation -> 'expectedEntries',
           '$[*] ? (@.transactionType == "adjustment_out" && @.direction == "out")')
          is not true)::integer > 0 then
    raise exception 'b2b-smoke-negative-adjustment did not pass the exact signed validator';
  end if;

  select pg_catalog.jsonb_object_agg(frozen.source_key, frozen.source_hash
    order by frozen.phase, frozen.source_key)
  into v_source_hashes_before
  from app_private.wms_reconciliation_frozen_sources frozen
  where frozen.run_id = v_run_id;
  v_cursor_first := app_private.scan_wms_reconciliation_phase_transaction_ledger(
    v_run_id, 1, v_cursor_seed, v_snapshot
  );
  v_cursor_second := app_private.scan_wms_reconciliation_phase_transaction_ledger(
    v_run_id, 1, v_cursor_first -> 'cursor', v_snapshot
  );
  select pg_catalog.jsonb_object_agg(frozen.source_key, frozen.source_hash
    order by frozen.phase, frozen.source_key)
  into v_source_hashes_after
  from app_private.wms_reconciliation_frozen_sources frozen
  where frozen.run_id = v_run_id;
  if v_source_hashes_before is distinct from v_source_hashes_after then
    raise exception 'frozen source content hashes changed across scanner calls';
  end if;
  if (v_cursor_first ->> 'processed')::integer <> 1
     or (v_cursor_second ->> 'processed')::integer <> 1
     or v_cursor_first -> 'cursor' is not distinct from v_cursor_second -> 'cursor' then
    raise exception 'batch-size-1 cursor did not resume with real progress';
  end if;
  select pg_catalog.count(*) into v_retry_before
  from public.wms_reconciliation_findings finding
  where finding.run_id = v_run_id;
  v_retry_first := app_private.scan_wms_reconciliation_phase_transaction_ledger(
    v_run_id, 500, v_cursor_seed, v_snapshot
  );
  v_retry_second := app_private.scan_wms_reconciliation_phase_transaction_ledger(
    v_run_id, 500, v_cursor_seed, v_snapshot
  );
  select pg_catalog.count(*) into v_retry_after
  from public.wms_reconciliation_findings finding
  where finding.run_id = v_run_id;
  if v_retry_first is distinct from v_retry_second
     or v_retry_before is distinct from v_retry_after then
    raise exception 'real scanner retry result or finding count changed';
  end if;
  v_stale_snapshot := pg_catalog.jsonb_set(
    v_snapshot, '{functionHashes,canonicalWf001LegacyFunctionHash}',
    '"136fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc"'::jsonb,
    true
  );
  begin
    perform app_private.scan_wms_reconciliation_phase_transaction_ledger(
      v_run_id, 1, v_cursor_seed, v_stale_snapshot
    );
    raise exception 'stale scanner fingerprint was accepted';
  exception when sqlstate '40001' then
    null;
  end;
  if not (v_physical ->> 'complete')::boolean
     or not (v_opening ->> 'complete')::boolean
     or not (v_ledger ->> 'complete')::boolean then
    raise exception 'B2b smoke phase did not complete';
  end if;

  if not exists (select 1 from public.wms_reconciliation_findings finding
      where finding.run_id = v_run_id and finding.finding_type = 'PHYSICAL_ANCHOR')
     or not exists (select 1 from public.wms_reconciliation_findings finding
      where finding.run_id = v_run_id and finding.finding_type = 'TX_LEDGER_MISSING')
     or not exists (select 1 from public.wms_reconciliation_findings finding
      where finding.run_id = v_run_id and finding.finding_type = 'TX_LEDGER_MISMATCH')
     or not exists (select 1 from public.wms_reconciliation_findings finding
      where finding.run_id = v_run_id and finding.finding_type = 'DECIMAL_APPLY'
        and finding.confidence = 'high' and finding.status = 'open')
     or not exists (select 1 from public.wms_reconciliation_findings finding
      where finding.run_id = v_run_id and finding.finding_type = 'LINEAGE_GAP'
        and finding.status = 'quarantined') then
    raise exception 'B2b smoke missing required finding; observed %', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'type', finding.finding_type, 'status', finding.status,
        'confidence', finding.confidence, 'sourceId', finding.evidence #>> '{source,id}',
        'reason', finding.quarantine_reason
      ) order by finding.finding_type, finding.id)
      from public.wms_reconciliation_findings finding where finding.run_id = v_run_id
    );
  end if;
  if exists (
    select 1 from public.wms_reconciliation_findings finding
    where finding.run_id = v_run_id
      and finding.evidence #>> '{source,id}' in (
        'audit-adjustment-b2b00000-0000-4000-8000-000000000021',
        v_void_original_tx, v_void_reversal_tx, 'b2b-smoke-late-backdated'
      )
  ) then
    raise exception 'valid anchor adjustment or late source was replayed';
  end if;
  if not exists (
    select 1 from app_private.wms_reconciliation_run_work work
    where work.run_id = v_run_id and work.payload ->> 'validAnchor' = 'true'
      and (work.payload -> 'excludedTransactionIds'
             ? 'audit-adjustment-b2b00000-0000-4000-8000-000000000021'
        or work.payload -> 'excludedTransactionIds' ? v_void_original_tx
        or work.payload -> 'excludedTransactionIds' ? v_void_reversal_tx)
  ) then
    raise exception 'valid physical/opening exclusion work is missing';
  end if;

  select pg_catalog.jsonb_build_object(
    'transactions', (select pg_catalog.count(*) from public.transactions),
    'audits', (select pg_catalog.count(*) from public.audit_sessions),
    'openings', (select pg_catalog.count(*) from public.project_opening_balances),
    'headers', (select pg_catalog.count(*) from public.inventory_transactions),
    'entries', (select pg_catalog.count(*) from public.inventory_ledger_entries),
    'balances', (select pg_catalog.count(*) from public.inventory_balances),
    'items', (select pg_catalog.count(*) from public.items)
  ) into reconciliation_source_counts_after;
  if reconciliation_source_counts_before is distinct from reconciliation_source_counts_after then
    raise exception 'B2b scanner changed source counts: before %, after %',
      reconciliation_source_counts_before, reconciliation_source_counts_after;
  end if;
end;
$$;

rollback;
