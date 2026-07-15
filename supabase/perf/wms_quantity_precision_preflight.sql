-- Release A2 WMS quantity precision read-only preflight report.
--
-- Run against the intended database before scheduling the migration. This
-- reports live facts only; it does not lock target tables, alter schema, write
-- temporary objects, or pretend to perform a production rehearsal.

begin;
set transaction read only;
set local statement_timeout = '5min';

-- 1. Exact live counts plus planner estimates used by the < 1,000,000-row
-- direct-ALTER guard. A stale estimate never authorizes ALTER by itself; the
-- migration takes AccessExclusive locks and checks exact counts again.
with relation_counts as (
  select
    'public.inventory_ledger_entries'::text as relation_name,
    (select count(*) from public.inventory_ledger_entries) as live_row_count,
    greatest(c.reltuples::bigint, 0) as estimated_row_count
  from pg_catalog.pg_class c
  where c.oid = 'public.inventory_ledger_entries'::regclass

  union all

  select
    'public.inventory_balances'::text,
    (select count(*) from public.inventory_balances),
    greatest(c.reltuples::bigint, 0)
  from pg_catalog.pg_class c
  where c.oid = 'public.inventory_balances'::regclass
)
select
  relation_name,
  live_row_count,
  estimated_row_count,
  1000000::bigint as direct_alter_limit,
  case
    when live_row_count < 1000000 and estimated_row_count < 1000000
      then 'eligible_by_size_only; still schedule lock window and review dependencies'
    else 'direct ALTER prohibited; use expand/backfill/swap'
  end as migration_path
from relation_counts
order by relation_name;

-- 2. Existing typmods/defaults/nullability/generated state. Monetary columns
-- are included beside quantity columns to make unintended precision changes
-- visible during review.
select
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.numeric_precision,
  c.numeric_scale,
  c.is_nullable,
  c.column_default,
  c.is_generated,
  c.generation_expression,
  a.attgenerated,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as catalog_type
from information_schema.columns c
join pg_catalog.pg_class rel
  on rel.relname = c.table_name
join pg_catalog.pg_namespace n
  on n.oid = rel.relnamespace
 and n.nspname = c.table_schema
join pg_catalog.pg_attribute a
  on a.attrelid = rel.oid
 and a.attname = c.column_name
 and not a.attisdropped
where c.table_schema = 'public'
  and (
    (
      c.table_name = 'inventory_ledger_entries'
      and c.column_name in (
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
      c.table_name = 'inventory_balances'
      and c.column_name in (
        'on_hand_qty',
        'total_value',
        'average_unit_cost'
      )
    )
  )
order by c.table_name, c.ordinal_position;

-- 3. Maximum absolute stored quantities. The new numeric(20,6) typmod keeps
-- the existing 14 integer digits, so values at or above 10^14 must block the
-- rollout even though the scale is widening.
select
  max(abs(quantity_in)) as max_abs_quantity_in,
  max(abs(quantity_out)) as max_abs_quantity_out,
  max(abs(quantity_delta)) as max_abs_quantity_delta,
  max(abs(balance_after_qty)) as max_abs_balance_after_qty,
  bool_or(
    abs(quantity_in) >= 100000000000000::numeric
    or abs(quantity_out) >= 100000000000000::numeric
    or abs(quantity_delta) >= 100000000000000::numeric
    or abs(balance_after_qty) >= 100000000000000::numeric
  ) as exceeds_numeric_20_6_integer_capacity
from public.inventory_ledger_entries;

select
  max(abs(on_hand_qty)) as max_abs_on_hand_qty,
  bool_or(abs(on_hand_qty) >= 100000000000000::numeric)
    as exceeds_numeric_20_6_integer_capacity
from public.inventory_balances;

-- 4. Observed fractional scale after removing insignificant trailing zeros.
-- This confirms current data shape without assuming the declared typmod is
-- the actual precision used by every row.
select
  observed.source_relation,
  observed.column_name,
  count(*) filter (where observed.quantity_value <> trunc(observed.quantity_value))
    as fractional_row_count,
  max(pg_catalog.scale(pg_catalog.trim_scale(observed.quantity_value)))
    as observed_fractional_scale
from (
  select
    'public.inventory_ledger_entries'::text as source_relation,
    quantities.column_name,
    quantities.quantity_value
  from public.inventory_ledger_entries e
  cross join lateral (
    values
      ('quantity_in'::text, e.quantity_in),
      ('quantity_out'::text, e.quantity_out),
      ('quantity_delta'::text, e.quantity_delta),
      ('balance_after_qty'::text, e.balance_after_qty)
  ) quantities(column_name, quantity_value)

  union all

  select
    'public.inventory_balances'::text,
    'on_hand_qty'::text,
    b.on_hand_qty
  from public.inventory_balances b
) observed
group by observed.source_relation, observed.column_name
order by observed.source_relation, observed.column_name;

-- 5. Dependency report for all five quantity columns plus the generated
-- amount column whose expression also depends on quantity_in/out. Review any
-- view/rule/materialized-view dependency before migration; functions written
-- in PL/pgSQL may not appear as catalog dependencies and require code review.
with target_columns as (
  select
    a.attrelid,
    a.attnum,
    n.nspname as table_schema,
    rel.relname as table_name,
    a.attname as column_name
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class rel on rel.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
  where not a.attisdropped
    and n.nspname = 'public'
    and (
      (
        rel.relname = 'inventory_ledger_entries'
        and a.attname in (
          'quantity_in',
          'quantity_out',
          'quantity_delta',
          'balance_after_qty',
          'amount'
        )
      )
      or (
        rel.relname = 'inventory_balances'
        and a.attname = 'on_hand_qty'
      )
    )
)
select
  target.table_schema,
  target.table_name,
  target.column_name,
  dependency.deptype,
  pg_catalog.pg_describe_object(
    dependency.classid,
    dependency.objid,
    dependency.objsubid
  ) as dependent_object
from target_columns target
join pg_catalog.pg_depend dependency
  on dependency.refclassid = 'pg_catalog.pg_class'::regclass
 and dependency.refobjid = target.attrelid
 and dependency.refobjsubid = target.attnum
order by target.table_name, target.column_name, dependent_object;

-- 6. Normalized inventory units that require an explicit policy decision.
-- This is intentionally catalog-only: the policy table does not exist before
-- Release A2. Compare this output with the proposed seed/alias manifest.
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
    i.unit as raw_unit
  from public.items i
)
select
  normalized_unit,
  count(*) as item_count,
  pg_catalog.array_agg(distinct raw_unit order by raw_unit)
    filter (where raw_unit is not null) as observed_raw_units
from inventory_units units
group by normalized_unit
order by item_count desc, normalized_unit;

-- 7. Raw transaction quantity/unit snapshot shape. Malformed and non-finite
-- values are rejected server-side; this report quantifies them before rollout.
with raw_lines as (
  select
    t.id as transaction_id,
    t.status::text as transaction_status,
    line.ordinality as line_number,
    line.value->>'itemId' as item_id,
    line.value->>'quantity' as quantity_text,
    coalesce(
      nullif(pg_catalog.btrim(i.unit), ''),
      (
        select nullif(pg_catalog.btrim(pending.value->>'unit'), '')
        from jsonb_array_elements(coalesce(t.pending_items, '[]'::jsonb)) pending(value)
        where pending.value->>'id' = line.value->>'itemId'
        limit 1
      ),
      nullif(pg_catalog.btrim(line.value->>'unit'), ''),
      nullif(pg_catalog.btrim(line.value->>'unitSnapshot'), ''),
      nullif(pg_catalog.btrim(line.value->>'unit_snapshot'), ''),
      ''
    ) as resolved_unit_text
  from public.transactions t
  cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb))
    with ordinality as line(value, ordinality)
  left join public.items i on i.id = line.value->>'itemId'
), classified as (
  select
    raw.*,
    pg_catalog.pg_input_is_valid(raw.quantity_text, 'numeric') as parses_as_numeric,
    case
      when pg_catalog.pg_input_is_valid(raw.quantity_text, 'numeric')
        then raw.quantity_text::numeric
      else null
    end as quantity_value
  from raw_lines raw
)
select
  transaction_id,
  transaction_status,
  line_number,
  item_id,
  quantity_text,
  resolved_unit_text,
  case
    when quantity_text is null or not parses_as_numeric then 'malformed'
    when pg_catalog.lower(pg_catalog.btrim(quantity_value::text))
      in ('nan', 'infinity', '-infinity') then 'non-finite'
    when quantity_value <> round(quantity_value, 6) then 'over default scale 6'
    else 'finite and within default scale 6'
  end as quantity_classification
from classified
where quantity_text is null
   or not parses_as_numeric
   or pg_catalog.lower(pg_catalog.btrim(quantity_value::text))
     in ('nan', 'infinity', '-infinity')
   or quantity_value <> round(quantity_value, 6)
order by transaction_id, line_number;

rollback;
