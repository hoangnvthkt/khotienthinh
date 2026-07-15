-- Read-only operator preflight. Run before promotion and preserve the result.
select app_private.preflight_wms_reconciliation_catalog() as catalog_preflight;

select
  namespace.nspname as function_schema,
  procedure.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments,
  owner_role.rolname as owner,
  procedure.prosecdef,
  procedure.proconfig,
  procedure.proacl
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles owner_role on owner_role.oid = procedure.proowner
where (
  namespace.nspname = 'public'
  and procedure.proname in (
    'create_wms_reconciliation_run',
    'scan_wms_reconciliation_run',
    'verify_wms_reconciliation_run',
    'list_wms_reconciliation_runs',
    'get_wms_reconciliation_workspace'
  )
) or (
  namespace.nspname = 'app_private'
  and procedure.proname like '%wms_reconciliation%'
)
order by namespace.nspname, procedure.proname, arguments;

select
  table_schema,
  table_name,
  privilege_type,
  grantee
from information_schema.role_table_grants
where (table_schema, table_name) in (
  ('app_private', 'wms_reconciliation_run_work'),
  ('app_private', 'wms_reconciliation_settings'),
  ('public', 'wms_reconciliation_runs'),
  ('public', 'wms_reconciliation_findings'),
  ('public', 'wms_reconciliation_approvals'),
  ('public', 'wms_reconciliation_actions')
)
order by table_schema, table_name, grantee, privilege_type;

select
  key,
  value,
  updated_at
from app_private.wms_reconciliation_settings
order by key;
