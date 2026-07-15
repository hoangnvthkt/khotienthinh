-- Read-only live-catalog/data gate before deploying A3.2.
-- Any existing `inventory_audit` source is untrusted legacy state and must be
-- reconciled before the migration reserves that namespace.

begin;
set transaction read only;

select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'audit_sessions',
    'transactions',
    'items',
    'inventory_balances',
    'inventory_ledger_entries'
  )
order by table_name;

select
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'audit_sessions'
order by ordinal_position;

select
  transaction_row.source_type,
  transaction_row.source_id,
  pg_catalog.count(*) as duplicate_count,
  pg_catalog.array_agg(transaction_row.id order by transaction_row.id) as transaction_ids
from public.transactions transaction_row
where transaction_row.source_type = 'inventory_audit'
group by transaction_row.source_type, transaction_row.source_id
order by transaction_row.source_id;

select
  table_privilege.grantee,
  table_privilege.privilege_type
from information_schema.table_privileges table_privilege
where table_privilege.table_schema = 'public'
  and table_privilege.table_name = 'audit_sessions'
  and table_privilege.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by table_privilege.grantee, table_privilege.privilege_type;

select
  routine.oid::pg_catalog.regprocedure as signature,
  pg_catalog.pg_get_userbyid(routine.proowner) as owner,
  routine.prosecdef as security_definer,
  routine.proconfig as function_config,
  pg_catalog.pg_get_functiondef(routine.oid) as definition
from pg_catalog.pg_proc routine
join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
where namespace.nspname = 'public'
  and routine.proname in ('post_wms_transaction', 'process_transaction_status')
order by signature::text;

select
  trigger_row.tgname,
  trigger_row.tgenabled,
  pg_catalog.pg_get_triggerdef(trigger_row.oid, true) as trigger_definition
from pg_catalog.pg_trigger trigger_row
where trigger_row.tgrelid in (
    'public.transactions'::pg_catalog.regclass,
    'public.audit_sessions'::pg_catalog.regclass
  )
  and not trigger_row.tgisinternal
order by trigger_row.tgrelid::pg_catalog.regclass::text, trigger_row.tgname;

-- Operator gate: this result must be empty. It exposes duplicate and even
-- singleton legacy sources because provenance cannot be inferred safely.
select
  transaction_row.id,
  transaction_row.source_id,
  transaction_row.status,
  transaction_row.posting_engine_version
from public.transactions transaction_row
where transaction_row.source_type = 'inventory_audit'
order by transaction_row.source_id, transaction_row.id;

rollback;
