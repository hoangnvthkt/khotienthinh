-- Release A3 production preflight. Run against the live catalog before the
-- migration; save the complete output with the deployment record.

begin;
set transaction read only;

select
  pg_catalog.current_database() as database_name,
  current_user as current_user_name,
  session_user as session_user_name,
  pg_catalog.current_setting('server_version') as server_version,
  pg_catalog.current_setting('server_version_num') as server_version_num;

-- Release A3 requires exactly these case-sensitive states. Any additional or
-- differently-cased label is a deployment blocker until it is reconciled.
select
  namespace.nspname as enum_schema,
  enum_type.typname as enum_name,
  pg_catalog.array_agg(enum_value.enumlabel order by enum_value.enumsortorder) as enum_labels
from pg_catalog.pg_type enum_type
join pg_catalog.pg_namespace namespace on namespace.oid = enum_type.typnamespace
join pg_catalog.pg_enum enum_value on enum_value.enumtypid = enum_type.oid
where namespace.nspname = 'public'
  and enum_type.typname = 'transaction_status'
group by namespace.nspname, enum_type.typname;

-- Effective posting/ledger function bodies, owners, configuration and ACLs.
select
  namespace.nspname as function_schema,
  procedure.proname as function_name,
  procedure.oid::regprocedure as signature,
  pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
  procedure.prosecdef as security_definer,
  procedure.proconfig as function_config,
  procedure.proacl as explicit_acl,
  pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)) as definition_hash,
  pg_catalog.pg_get_functiondef(procedure.oid) as function_definition
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
where (namespace.nspname, procedure.proname) in (
  ('public', 'process_transaction_status'),
  ('public', 'apply_stock_change'),
  ('app_private', 'assert_quantity_precision'),
  ('app_private', 'resolve_quantity_precision_policy'),
  ('app_private', 'sync_wms_transaction_to_inventory_ledger'),
  ('app_private', 'post_inventory_ledger_entry'),
  ('app_private', 'trg_sync_wms_transaction_inventory_ledger')
)
  and procedure.prokind in ('f', 'p')
order by namespace.nspname, procedure.proname, procedure.oid::regprocedure::text;

-- Every trigger that can affect the WMS document, cache or immutable ledger.
select
  namespace.nspname as table_schema,
  relation.relname as table_name,
  trigger.tgname as trigger_name,
  trigger.tgenabled as trigger_enabled_mode,
  function_namespace.nspname || '.' || function.proname as trigger_function,
  pg_catalog.pg_get_triggerdef(trigger.oid, true) as trigger_definition
from pg_catalog.pg_trigger trigger
join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
join pg_catalog.pg_proc function on function.oid = trigger.tgfoid
join pg_catalog.pg_namespace function_namespace on function_namespace.oid = function.pronamespace
where not trigger.tgisinternal
  and namespace.nspname = 'public'
  and relation.relname in (
    'transactions',
    'items',
    'inventory_transactions',
    'inventory_ledger_entries',
    'inventory_balances'
  )
order by relation.relname, trigger.tgname;

-- Live RLS and role posture. Any BYPASSRLS caller makes the A3 guard trigger
-- mandatory rather than optional defense-in-depth.
select
  policy.schemaname,
  policy.tablename,
  policy.policyname,
  policy.permissive,
  policy.roles,
  policy.cmd,
  policy.qual,
  policy.with_check
from pg_catalog.pg_policies policy
where policy.schemaname = 'public'
  and policy.tablename in ('transactions', 'items')
order by policy.tablename, policy.policyname;

select
  role.rolname,
  role.rolsuper,
  role.rolinherit,
  role.rolcreaterole,
  role.rolbypassrls
from pg_catalog.pg_roles role
where role.rolname in (
  current_user,
  session_user,
  'anon',
  'authenticated',
  'authenticator',
  'service_role',
  'postgres',
  'supabase_admin'
)
order by role.rolname;

select
  namespace.nspname as table_schema,
  relation.relname as table_name,
  pg_catalog.pg_get_userbyid(relation.relowner) as owner_name,
  relation.relrowsecurity as row_security_enabled,
  relation.relforcerowsecurity as row_security_forced,
  relation.relacl as explicit_acl
from pg_catalog.pg_class relation
join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in (
    'transactions',
    'items',
    'inventory_transactions',
    'inventory_ledger_entries',
    'inventory_balances'
  )
order by relation.relname;

-- Stored code that could bypass the intended command path must be reviewed.
select
  namespace.nspname as function_schema,
  procedure.oid::regprocedure as signature,
  pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
  procedure.prosecdef as security_definer,
  case
    when pg_catalog.pg_get_functiondef(procedure.oid) ilike '%apply_stock_change%' then true
    else false
  end as references_stock_helper,
  case
    when pg_catalog.pg_get_functiondef(procedure.oid) ilike '%stock_by_warehouse%' then true
    else false
  end as references_stock_cache,
  case
    when pg_catalog.pg_get_functiondef(procedure.oid) ~* 'insert[[:space:]]+into[[:space:]]+public[.]transactions' then true
    else false
  end as inserts_wms_transaction,
  case
    when pg_catalog.pg_get_functiondef(procedure.oid) ~* 'update[[:space:]]+public[.]transactions' then true
    else false
  end as updates_wms_transaction
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname in ('public', 'app_private')
  and procedure.prokind in ('f', 'p')
  and (
    pg_catalog.pg_get_functiondef(procedure.oid) ilike '%apply_stock_change%'
    or pg_catalog.pg_get_functiondef(procedure.oid) ilike '%stock_by_warehouse%'
    or pg_catalog.pg_get_functiondef(procedure.oid) ~* '(insert[[:space:]]+into|update)[[:space:]]+public[.]transactions'
  )
order by namespace.nspname, procedure.oid::regprocedure::text;

-- Baseline data fingerprints: direct-completion candidates, ledger gaps and
-- cache values that cannot safely participate in numeric posting.
select
  count(*) filter (where transaction_row.status::text = 'COMPLETED') as completed_transactions,
  count(*) filter (
    where transaction_row.status::text = 'COMPLETED'
      and inventory_transaction.id is null
  ) as completed_without_ledger_header,
  count(*) filter (
    where transaction_row.status::text = 'COMPLETED'
      and inventory_transaction.id is not null
  ) as completed_with_ledger_header,
  count(*) filter (
    where transaction_row.status::text <> 'COMPLETED'
      and inventory_transaction.id is not null
  ) as noncompleted_with_ledger_header
from public.transactions transaction_row
left join public.inventory_transactions inventory_transaction
  on inventory_transaction.source_type = 'wms_transaction'
 and inventory_transaction.source_id = transaction_row.id;

with cache_values as (
  select
    item.id as item_id,
    cache.key as warehouse_id,
    cache.value as quantity_text
  from public.items item
  cross join lateral pg_catalog.jsonb_each_text(
    coalesce(item.stock_by_warehouse, '{}'::jsonb)
  ) cache
)
select
  count(*) as cache_value_count,
  count(*) filter (
    where quantity_text !~ '^[+-]?[0-9]+([.][0-9]+)?$'
  ) as malformed_cache_value_count,
  count(*) filter (
    where case
      when quantity_text ~ '^[+-]?[0-9]+([.][0-9]+)?$'
        then quantity_text::numeric < 0
      else false
    end
  ) as negative_cache_value_count,
  max(
    case
      when quantity_text ~ '^[+-]?[0-9]+([.][0-9]+)?$'
        then pg_catalog.abs(quantity_text::numeric)
    end
  ) as maximum_absolute_cache_quantity
from cache_values;

rollback;
