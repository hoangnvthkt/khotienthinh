-- Pre-deploy duplicate locked scope preflight for the A3.1 atomic opening command.
-- Keep this inline expression identical to
-- app_private.normalize_project_opening_scope_key so the query can run before
-- the migration creates that function.

begin;
set transaction read only;

with normalized_locked_scope as (
  select
    opening.id,
    pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(coalesce(opening.scope_key, '')),
        '[[:space:]]+',
        '',
        'g'
      )
    ) as normalized_scope_key
  from public.project_opening_balances opening
  where opening.status = 'locked'
),
duplicate_locked_scope as (
  select
    normalized_scope_key,
    pg_catalog.count(*) as row_count,
    pg_catalog.array_agg(id order by id) as opening_balance_ids
  from normalized_locked_scope
  group by normalized_scope_key
  having pg_catalog.count(*) > 1
)
select normalized_scope_key, row_count, opening_balance_ids
from duplicate_locked_scope
order by normalized_scope_key;

rollback;
