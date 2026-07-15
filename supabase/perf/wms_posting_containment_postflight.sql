-- Release A3 live postflight. This is read-only and is expected to be saved
-- together with the preflight output and migration log.

begin;
set transaction read only;

select
  procedure.oid::regprocedure as function_signature,
  pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
  procedure.prosecdef as security_definer,
  procedure.proconfig as function_config,
  procedure.proacl as explicit_acl,
  pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_can_execute,
  pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_can_execute,
  case
    when exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')
      then pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    else null
  end as service_role_can_execute,
  pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)) as definition_hash,
  pg_catalog.pg_get_functiondef(procedure.oid) as function_definition
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
where (namespace.nspname, procedure.proname) in (
  ('public', 'process_transaction_status'),
  ('public', 'post_wms_transaction'),
  ('public', 'apply_stock_change'),
  ('app_private', 'apply_stock_change_internal'),
  ('app_private', 'authorize_wms_write'),
  ('app_private', 'guard_wms_transaction_write'),
  ('app_private', 'guard_item_stock_cache_write'),
  ('app_private', 'enrich_inventory_transaction_metadata'),
  ('app_private', 'enrich_inventory_ledger_entry_metadata')
)
order by namespace.nspname, procedure.proname;

select
  namespace.nspname as table_schema,
  relation.relname as table_name,
  trigger.tgname as trigger_name,
  trigger.tgenabled as trigger_enabled_mode,
  pg_catalog.pg_get_triggerdef(trigger.oid, true) as trigger_definition
from pg_catalog.pg_trigger trigger
join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
where not trigger.tgisinternal
  and namespace.nspname = 'public'
  and trigger.tgname in (
    'trg_guard_wms_transaction_write',
    'trg_guard_item_stock_cache_insert',
    'trg_guard_item_stock_cache_update',
    'trg_enrich_inventory_transaction_metadata',
    'trg_enrich_inventory_ledger_entry_metadata',
    'trg_guard_inventory_transaction_immutable',
    'trg_guard_inventory_ledger_entry_immutable'
  )
order by relation.relname, trigger.tgname;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'transactions'
  and column_name in ('posting_request_hash', 'posting_engine_version')
order by column_name;

select
  policy.policyname,
  policy.cmd,
  policy.roles,
  policy.with_check,
  policy.with_check ilike '%status%PENDING%' as forces_pending_insert
from pg_catalog.pg_policies policy
where policy.schemaname = 'public'
  and policy.tablename = 'transactions'
  and policy.policyname = 'transactions_phase4_insert';

select
  pg_catalog.has_table_privilege('anon', 'app_private.wms_write_authorizations', 'SELECT,INSERT,UPDATE,DELETE')
    as anon_has_authorization_table_dml,
  pg_catalog.has_table_privilege('authenticated', 'app_private.wms_write_authorizations', 'SELECT,INSERT,UPDATE,DELETE')
    as authenticated_has_authorization_table_dml,
  case
    when exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')
      then pg_catalog.has_table_privilege('service_role', 'app_private.wms_write_authorizations', 'SELECT,INSERT,UPDATE,DELETE')
    else null
  end as service_role_has_authorization_table_dml,
  (
    select count(*)
    from app_private.wms_write_authorizations
  ) as outstanding_one_use_authorizations;

select
  count(*) filter (where transaction_row.status::text = 'COMPLETED') as completed_transactions,
  count(*) filter (
    where transaction_row.status::text = 'COMPLETED'
      and inventory_transaction.id is null
  ) as completed_without_ledger_header
from public.transactions transaction_row
left join public.inventory_transactions inventory_transaction
  on inventory_transaction.source_type = 'wms_transaction'
 and inventory_transaction.source_id = transaction_row.id;

select
  inventory_transaction.source_id,
  inventory_transaction.metadata->>'posting_engine_version' as posting_engine_version,
  inventory_transaction.metadata->'quantity_policy_snapshots' as quantity_policy_snapshots,
  inventory_transaction.metadata->>'actor_id' as actor_id,
  inventory_transaction.metadata->>'posted_at' as posted_at
from public.inventory_transactions inventory_transaction
where inventory_transaction.source_type = 'wms_transaction'
order by inventory_transaction.posted_at desc
limit 20;

-- A3.3 lock/ACL/catalog evidence (read-only; remains inside rollback-only smoke).
select p.oid::regprocedure as function_name, r.rolname as owner,
       p.prosecdef as security_definer, p.proconfig as configuration,
       p.proacl as acl
from pg_catalog.pg_proc p
join pg_catalog.pg_roles r on r.oid = p.proowner
where p.oid in (
  to_regprocedure('app_private.wms_business_lock_key(text)'),
  to_regprocedure('app_private.lock_wms_business_transaction_items(text,text,text[])'),
  to_regprocedure('public.create_purchase_order_supplier_return(text,text,jsonb,text,text)')
);

select tg.tgname, tg.tgenabled, tg.tgisinternal
from pg_catalog.pg_trigger tg
where tg.tgrelid in ('public.transactions'::regclass, 'public.items'::regclass)
order by tg.tgrelid::text, tg.tgname;

select indexrelid::regclass as index_name, indexrelid::regclass::text as relation_name
from pg_catalog.pg_index
where indrelid in ('public.transactions'::regclass, 'public.items'::regclass,
                   'public.purchase_order_supplier_returns'::regclass);

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('transactions', 'items', 'inventory_transactions', 'inventory_ledger_entries')
  and grantee in ('anon', 'authenticated')
order by grantee, table_name, privilege_type;

rollback;
