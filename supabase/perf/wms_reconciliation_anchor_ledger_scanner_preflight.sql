-- Read-only B2b promotion preflight. Preserve output with clone EXPLAIN evidence.
select app_private.preflight_wms_reconciliation_catalog() as catalog_preflight;

select
  namespace.nspname as function_schema,
  procedure.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments,
  owner_role.rolname as owner,
  procedure.prosecdef,
  procedure.proconfig,
  procedure.proacl,
  pg_catalog.pg_get_functiondef(procedure.oid) as definition
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles owner_role on owner_role.oid = procedure.proowner
where namespace.nspname = 'app_private'
  and procedure.proname in (
    'scan_wms_reconciliation_phase_physical_anchor',
    'scan_wms_reconciliation_phase_opening_balance',
    'scan_wms_reconciliation_phase_transaction_ledger'
  )
order by procedure.proname;

select
  namespace.nspname as schema_name,
  relation.relname as table_name,
  index_relation.relname as index_name,
  source_index.indisunique,
  pg_catalog.pg_get_indexdef(source_index.indexrelid) as index_definition
from pg_catalog.pg_index source_index
join pg_catalog.pg_class relation on relation.oid = source_index.indrelid
join pg_catalog.pg_class index_relation on index_relation.oid = source_index.indexrelid
join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname in ('public', 'app_private')
  and relation.relname in (
    'audit_sessions', 'inventory_audit_command_results',
    'project_opening_balances', 'project_opening_balance_lines',
    'project_opening_command_results', 'project_opening_reversal_results',
    'transactions', 'inventory_transactions', 'inventory_ledger_entries',
    'wms_reconciliation_findings', 'wms_reconciliation_run_work'
  )
order by namespace.nspname, relation.relname, index_relation.relname;

select
  (select pg_catalog.count(*) from public.audit_sessions
    where pg_catalog.jsonb_typeof(items) <> 'array') as malformed_audits,
  (select pg_catalog.count(*) from public.project_opening_balances
    where status in ('locked', 'void') and (
      lock_command_id is null or lock_request_hash is null
      or posting_engine_version is distinct from 'wf001-opening-v1'
    )) as malformed_openings,
  (select pg_catalog.count(*) from public.transactions
    where status::text = 'COMPLETED' and pg_catalog.jsonb_typeof(items) <> 'array')
    as malformed_completed_transactions,
  (select pg_catalog.count(*) from public.transactions transaction_row
    where transaction_row.status::text = 'COMPLETED'
      and not exists (
        select 1 from public.inventory_transactions header
        where header.source_type = 'wms_transaction'
          and header.source_id = transaction_row.id
      )) as completed_without_ledger;

-- Clone-only plan evidence. Do not promote an index from this artifact alone.
explain (analyze false, costs true, verbose true, buffers false)
select audit.id, audit.date
from public.audit_sessions audit
where audit.date <= pg_catalog.now()
  and audit."warehouseId" = '__clone_warehouse__'
order by audit.date, audit.id
limit 500;

explain (analyze false, costs true, verbose true, buffers false)
select opening.id, opening.as_of_date
from public.project_opening_balances opening
where opening.status in ('locked', 'void')
  and opening.as_of_date <= pg_catalog.current_date
order by opening.as_of_date, opening.id
limit 500;

explain (analyze false, costs true, verbose true, buffers false)
select transaction_row.id, transaction_row.date
from public.transactions transaction_row
where transaction_row.status::text = 'COMPLETED'
  and transaction_row.type::text in ('IMPORT', 'EXPORT', 'TRANSFER', 'LIQUIDATION', 'ADJUSTMENT')
  and transaction_row.date <= pg_catalog.now()
order by transaction_row.date, transaction_row.id
limit 500;
