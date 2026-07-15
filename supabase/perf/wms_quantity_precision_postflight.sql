-- Release A2 WMS quantity precision post-migration verification.
--
-- Run after applying the migration and before reopening WMS completion. This
-- report is read-only and verifies the installed policy, typmod, generated
-- expression, function-security and exact unit-resolution contracts.

begin;
set transaction read only;
set local statement_timeout = '5min';

do $prerequisites$
begin
  if to_regclass('public.quantity_precision_policies') is null then
    raise exception 'Release A2 quantity_precision_policies is not installed';
  end if;
  if to_regprocedure('public.resolve_quantity_precision_policy(text)') is null
     or to_regprocedure('app_private.resolve_quantity_precision_policy(text)') is null
     or to_regprocedure('app_private.quantity_units_are_equivalent(text,text)') is null
     or to_regprocedure('app_private.assert_quantity_precision(text,text)') is null then
    raise exception 'Release A2 quantity precision functions are incomplete';
  end if;
end;
$prerequisites$;

-- 1. Installed catalog and lifecycle windows.
select
  p.id,
  p.unit_key,
  p.display_name,
  p.aliases,
  p.max_fraction_digits,
  p.conversion_rounding_mode,
  p.comparison_tolerance,
  p.version,
  p.lifecycle_status,
  p.effective_from,
  p.effective_to,
  p.updated_at
from public.quantity_precision_policies p
order by p.unit_key, p.version desc;

-- 2. Every observed inventory unit resolved through the installed public
-- wrapper. Unconfigured units remain visible with is_default = true.
with inventory_units as (
  select
    pg_catalog.lower(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          coalesce(i.unit, ''),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    ) as normalized_unit,
    count(*) as item_count
  from public.items i
  group by 1
)
select
  units.normalized_unit,
  units.item_count,
  policy.policy_id,
  policy.unit_key as canonical_unit_key,
  policy.display_name,
  policy.max_fraction_digits,
  policy.comparison_tolerance,
  policy.policy_version,
  policy.is_default,
  case
    when units.normalized_unit = '' then 'default: blank catalog unit'
    when policy.is_default then 'default: explicit policy still required'
    else 'configured exact key or declared alias'
  end as resolution
from inventory_units units
cross join lateral public.resolve_quantity_precision_policy(units.normalized_unit) policy
order by policy.is_default desc, units.item_count desc, units.normalized_unit;

-- 3. Quantity and monetary typmods plus final generated expressions.
select
  n.nspname as table_schema,
  rel.relname as table_name,
  a.attname as column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as catalog_type,
  a.attgenerated,
  pg_catalog.pg_get_expr(d.adbin, d.adrelid) as generation_expression
from pg_catalog.pg_attribute a
join pg_catalog.pg_class rel on rel.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
left join pg_catalog.pg_attrdef d
  on d.adrelid = a.attrelid
 and d.adnum = a.attnum
where n.nspname = 'public'
  and not a.attisdropped
  and (
    (
      rel.relname = 'inventory_ledger_entries'
      and a.attname in (
        'quantity_in',
        'quantity_out',
        'quantity_delta',
        'balance_after_qty',
        'unit_price',
        'amount',
        'balance_after_value'
      )
    )
    or (
      rel.relname = 'inventory_balances'
      and a.attname in ('on_hand_qty', 'total_value', 'average_unit_cost')
    )
  )
order by rel.relname, a.attnum;

do $typmod_contract$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where (
      (a.attrelid = 'public.inventory_ledger_entries'::regclass
       and a.attname in ('quantity_in', 'quantity_out', 'quantity_delta', 'balance_after_qty'))
      or
      (a.attrelid = 'public.inventory_balances'::regclass
       and a.attname = 'on_hand_qty')
    )
      and not a.attisdropped
      and pg_catalog.format_type(a.atttypid, a.atttypmod) <> 'numeric(20,6)'
  ) then
    raise exception 'Release A2 quantity typmod contract is not numeric(20,6)';
  end if;
end;
$typmod_contract$;

-- 4. Owner, SECURITY DEFINER/INVOKER, search_path and ACL evidence.
select
  p.oid::regprocedure as function_signature,
  owner_role.rolname as owner_name,
  p.prosecdef as security_definer,
  p.proconfig,
  p.proacl,
  pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
where (n.nspname, p.proname) in (
  ('public', 'process_transaction_status'),
  ('public', 'resolve_quantity_precision_policy'),
  ('public', 'apply_stock_change'),
  ('app_private', 'resolve_quantity_precision_policy'),
  ('app_private', 'quantity_units_are_equivalent'),
  ('app_private', 'assert_quantity_precision')
)
order by n.nspname, p.proname, p.oid::regprocedure::text;

select
  has_function_privilege(
    'authenticated',
    'public.process_transaction_status(text,public.transaction_status,uuid)',
    'EXECUTE'
  ) as authenticated_can_process_transaction,
  has_function_privilege(
    'authenticated',
    'public.resolve_quantity_precision_policy(text)',
    'EXECUTE'
  ) as authenticated_can_resolve_policy,
  has_function_privilege(
    'authenticated',
    'public.apply_stock_change(text,text,numeric)',
    'EXECUTE'
  ) as authenticated_can_call_stock_helper,
  has_function_privilege(
    'authenticated',
    'app_private.assert_quantity_precision(text,text)',
    'EXECUTE'
  ) as authenticated_can_call_private_assertion;

rollback;
