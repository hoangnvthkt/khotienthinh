-- WMS decimal stop-loss live preflight (read-only).
-- Run with psql or the Supabase SQL editor before applying Release A1.
-- This script intentionally does not create temp objects or mutate data.

begin;
set transaction read only;

-- 1. Effective definitions and ACLs for the outer RPC and stock helper.
select
  p.oid::regprocedure as function_signature,
  pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  p.proacl as explicit_acl,
  exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid in (
    to_regprocedure('public.process_transaction_status(text,public.transaction_status,uuid)'),
    to_regprocedure('public.apply_stock_change(text,text,numeric)')
  )
order by p.proname;

-- 2. Storage types that bound the temporary four-decimal stop-loss.
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.numeric_precision,
  c.numeric_scale,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and (
    (c.table_name = 'transactions' and c.column_name = 'items')
    or (c.table_name = 'items' and c.column_name = 'stock_by_warehouse')
    or (
      c.table_name = 'inventory_ledger_entries'
      and c.column_name in (
        'quantity_in',
        'quantity_out',
        'quantity_delta',
        'balance_after_qty'
      )
    )
    or (
      c.table_name = 'inventory_balances'
      and c.column_name in ('on_hand_qty', 'total_value', 'average_unit_cost')
    )
  )
order by c.table_name, c.ordinal_position;

-- 3. Triggers that can fan transaction completion into stock/ledger updates.
select
  n.nspname as table_schema,
  rel.relname as table_name,
  trg.tgname as trigger_name,
  pg_get_triggerdef(trg.oid, true) as trigger_definition,
  fn.oid::regprocedure as trigger_function
from pg_trigger trg
join pg_class rel on rel.oid = trg.tgrelid
join pg_namespace n on n.oid = rel.relnamespace
join pg_proc fn on fn.oid = trg.tgfoid
where not trg.tgisinternal
  and n.nspname = 'public'
  and rel.relname in (
    'transactions',
    'items',
    'inventory_transactions',
    'inventory_ledger_entries',
    'inventory_balances'
  )
order by rel.relname, trg.tgname;

-- 4. Fractional transaction lines, including candidates A1 would reject.
with transaction_lines as (
  select
    t.id as transaction_id,
    t.type::text as transaction_type,
    t.status::text as transaction_status,
    line.ordinality as line_number,
    line.value->>'itemId' as item_id,
    line.value->>'quantity' as quantity_text
  from public.transactions t
  cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb))
    with ordinality as line(value, ordinality)
), parsed as (
  select
    tl.*,
    case
      when tl.quantity_text ~ '^[+-]?[0-9]+([.][0-9]+)?$'
        then tl.quantity_text::numeric
      else null
    end as quantity
  from transaction_lines tl
)
select
  p.transaction_id,
  p.transaction_type,
  p.transaction_status,
  p.line_number,
  p.item_id,
  p.quantity_text,
  p.quantity,
  p.quantity <> round(p.quantity, 4) as exceeds_four_fractional_digits
from parsed p
where p.quantity is not null
  and p.quantity <> trunc(p.quantity)
order by p.transaction_id, p.line_number;

-- 5. Malformed quantity/cache text that cannot participate in numeric checks.
with raw_quantity as (
  select
    t.id as transaction_id,
    line.ordinality as line_number,
    line.value->>'itemId' as item_id,
    line.value->>'quantity' as quantity_text
  from public.transactions t
  cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb))
    with ordinality as line(value, ordinality)
)
select 'transaction_item' as source, transaction_id, line_number::text as location, item_id, quantity_text as value
from raw_quantity
where quantity_text is null
   or quantity_text !~ '^[+-]?[0-9]+([.][0-9]+)?$'
union all
select 'stock_cache', i.id, cache.key, i.id, cache.value
from public.items i
cross join lateral jsonb_each_text(coalesce(i.stock_by_warehouse, '{}'::jsonb)) cache
where cache.value !~ '^[+-]?[0-9]+([.][0-9]+)?$'
order by source, transaction_id, location;

-- 6. Item JSON cache vs immutable ledger vs balance-cache mismatches.
with cache as (
  select
    i.id as material_id,
    stock.key as warehouse_id,
    sum(stock.value::numeric) as cache_qty
  from public.items i
  cross join lateral jsonb_each_text(coalesce(i.stock_by_warehouse, '{}'::jsonb)) stock
  where stock.value ~ '^[+-]?[0-9]+([.][0-9]+)?$'
  group by i.id, stock.key
), ledger as (
  select
    e.material_id,
    e.warehouse_id,
    sum(e.quantity_delta) as ledger_qty
  from public.inventory_ledger_entries e
  group by e.material_id, e.warehouse_id
), balance as (
  select
    b.material_id,
    b.warehouse_id,
    sum(b.on_hand_qty) as balance_qty
  from public.inventory_balances b
  group by b.material_id, b.warehouse_id
), keys as (
  select material_id, warehouse_id from cache
  union
  select material_id, warehouse_id from ledger
  union
  select material_id, warehouse_id from balance
)
select
  k.material_id,
  k.warehouse_id,
  coalesce(c.cache_qty, 0) as cache_qty,
  coalesce(l.ledger_qty, 0) as ledger_qty,
  coalesce(b.balance_qty, 0) as balance_qty,
  coalesce(c.cache_qty, 0) - coalesce(l.ledger_qty, 0) as cache_minus_ledger,
  coalesce(c.cache_qty, 0) - coalesce(b.balance_qty, 0) as cache_minus_balance,
  coalesce(l.ledger_qty, 0) - coalesce(b.balance_qty, 0) as ledger_minus_balance
from keys k
left join cache c using (material_id, warehouse_id)
left join ledger l using (material_id, warehouse_id)
left join balance b using (material_id, warehouse_id)
where coalesce(c.cache_qty, 0) is distinct from coalesce(l.ledger_qty, 0)
   or coalesce(c.cache_qty, 0) is distinct from coalesce(b.balance_qty, 0)
   or coalesce(l.ledger_qty, 0) is distinct from coalesce(b.balance_qty, 0)
order by k.material_id, k.warehouse_id;

rollback;
