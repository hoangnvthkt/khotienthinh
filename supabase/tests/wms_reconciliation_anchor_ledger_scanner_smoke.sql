begin;

create temporary table reconciliation_source_counts_before on commit drop as
select
  (select pg_catalog.count(*) from public.transactions) as wms_transactions,
  (select pg_catalog.count(*) from public.audit_sessions) as audit_sessions,
  (select pg_catalog.count(*) from public.project_opening_balances) as openings,
  (select pg_catalog.count(*) from public.inventory_transactions) as ledger_headers,
  (select pg_catalog.count(*) from public.inventory_ledger_entries) as ledger_entries,
  (select pg_catalog.count(*) from public.inventory_balances) as balances,
  (select pg_catalog.count(*) from public.items) as items;

do $$
declare
  v_physical_definition text;
  v_opening_definition text;
  v_ledger_definition text;
begin
  -- PostgreSQL numeric-to-integer rounds; these are the WF-001 fingerprints.
  if 0.25::numeric::integer <> 0
     or 1.75::numeric::integer <> 2
     or 2.375::numeric::integer <> 2 then
    raise exception 'PostgreSQL rounding fingerprint changed unexpectedly';
  end if;

  select pg_catalog.pg_get_functiondef(
    'app_private.scan_wms_reconciliation_phase_physical_anchor(uuid,integer,jsonb,jsonb)'::regprocedure
  ) into v_physical_definition;
  select pg_catalog.pg_get_functiondef(
    'app_private.scan_wms_reconciliation_phase_opening_balance(uuid,integer,jsonb,jsonb)'::regprocedure
  ) into v_opening_definition;
  select pg_catalog.pg_get_functiondef(
    'app_private.scan_wms_reconciliation_phase_transaction_ledger(uuid,integer,jsonb,jsonb)'::regprocedure
  ) into v_ledger_definition;

  if v_physical_definition !~ 'audit-adjustment-'
     or v_physical_definition !~ 'excludeFromReplay' then
    raise exception 'audit adjustment exclusion is absent';
  end if;
  if v_opening_definition !~ 'opening-balance:'
     or v_opening_definition !~ 'excludedTransactionIds' then
    raise exception 'opening adjustment exclusion is absent';
  end if;
  if v_ledger_definition !~ 'TX_LEDGER_MISSING'
     or v_ledger_definition !~ 'TX_LEDGER_MISMATCH'
     or v_ledger_definition !~ 'DECIMAL_APPLY'
     or v_ledger_definition !~ 'LINEAGE_GAP'
     or v_ledger_definition ~* 'math[.]trunc|pg_catalog[.]trunc[(]' then
    raise exception 'transaction-ledger finding or rounding contract is absent';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'app_private.scan_wms_reconciliation_phase_physical_anchor(uuid,integer,jsonb,jsonb)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'app_private.scan_wms_reconciliation_phase_transaction_ledger(uuid,integer,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'private scanner phase is executable by an API role';
  end if;
end;
$$;

-- The same empty source boundary and cursor must resume/idempotently return an
-- empty completed phase; this also proves canonical response types.
do $$
declare
  v_run_id uuid := pg_catalog.gen_random_uuid();
  v_snapshot jsonb := pg_catalog.jsonb_build_object(
    'createdAt', pg_catalog.clock_timestamp(),
    'asOf', '1900-01-01T00:00:00Z',
    'auditCommandCutoff', null,
    'openingCutoff', pg_catalog.jsonb_build_object(
      'createdBoundary', null, 'lockedBoundary', null, 'reversedBoundary', null
    ),
    'ledgerHeader', pg_catalog.jsonb_build_object('createdBoundary', null, 'postedBoundary', null),
    'ledgerEntry', null,
    'policyVersion', 'smoke'
  );
  v_first jsonb;
  v_retry jsonb;
begin
  insert into public.wms_reconciliation_runs (
    id, scope, scope_hash, as_of, policy_version, source_snapshot,
    cursor, status, created_by
  ) values (
    v_run_id,
    '{"warehouseIds":["*"],"itemIds":[],"sourceTypes":[],"affectedFrom":null}'::jsonb,
    app_private.sha256_text('smoke'),
    '1900-01-01T00:00:00Z', 'smoke', v_snapshot,
    '{"phase":"physical_anchor","lastKey":null}'::jsonb,
    'created', (select id from public.users order by id limit 1)
  );

  v_first := app_private.scan_wms_reconciliation_phase_physical_anchor(
    v_run_id, 1, '{"phase":"physical_anchor","lastKey":null}'::jsonb, v_snapshot
  );
  v_retry := app_private.scan_wms_reconciliation_phase_physical_anchor(
    v_run_id, 1, '{"phase":"physical_anchor","lastKey":null}'::jsonb, v_snapshot
  );
  if v_first is distinct from v_retry
     or (v_first ->> 'processed')::integer <> 0
     or not (v_first ->> 'complete')::boolean then
    raise exception 'empty physical scanner resume/idempotency failed: %, %', v_first, v_retry;
  end if;
end;
$$;

do $$
declare
  v_before reconciliation_source_counts_before%rowtype;
  v_after reconciliation_source_counts_before%rowtype;
begin
  select * into v_before from reconciliation_source_counts_before;
  select
    (select pg_catalog.count(*) from public.transactions),
    (select pg_catalog.count(*) from public.audit_sessions),
    (select pg_catalog.count(*) from public.project_opening_balances),
    (select pg_catalog.count(*) from public.inventory_transactions),
    (select pg_catalog.count(*) from public.inventory_ledger_entries),
    (select pg_catalog.count(*) from public.inventory_balances),
    (select pg_catalog.count(*) from public.items)
  into v_after;
  if v_before is distinct from v_after then
    raise exception 'B2b scanner mutated a WMS source/cache table';
  end if;
end;
$$;

rollback;
