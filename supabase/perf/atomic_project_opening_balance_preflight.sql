-- Read-only pre-deploy diagnostics for the A3.1 forward hardening migration.
-- Every result row is a blocker unless the result set is explicitly a count.
-- The authoritative pair check below supersedes the legacy duplicate locked
-- scope diagnostic based only on app_private.normalize_project_opening_scope_key.

begin;
set transaction read only;

-- Legacy nullable finance: reports exactly how many optimistic-concurrency
-- rows the migration will backfill.
select
  pg_catalog.count(*) as affected_rows,
  pg_catalog.count(*) filter (where finance."contractValue" is null) as null_contract_value_rows,
  pg_catalog.count(*) filter (where finance."progressPercent" is null) as null_progress_percent_rows,
  pg_catalog.count(*) filter (where finance."updatedAt" is null) as null_updated_at_rows
from public.project_finances finance
where finance."contractValue" is null
   or finance."progressPercent" is null
   or finance."updatedAt" is null;

-- Invalid or duplicate project opening transaction source reservations.
select
  transaction_row.id,
  transaction_row.source_id,
  transaction_row.posting_engine_version,
  'invalid reserved opening source' as diagnostic
from public.transactions transaction_row
where transaction_row.source_type = 'project_opening_balance'
  and (
    nullif(pg_catalog.btrim(transaction_row.source_id), '') is null
    or transaction_row.posting_engine_version is distinct from 'wf001-opening-v1'
  )
order by transaction_row.id;

select
  transaction_row.source_id,
  pg_catalog.count(*) as row_count,
  pg_catalog.array_agg(transaction_row.id order by transaction_row.id) as transaction_ids,
  'duplicate project opening transaction source' as diagnostic
from public.transactions transaction_row
where transaction_row.source_type = 'project_opening_balance'
group by transaction_row.source_id
having pg_catalog.count(*) > 1
order by transaction_row.source_id;

-- Authoritative scope project-site mismatch, missing identities, or a spoofed
-- normalized scope key. This expression mirrors the migration helper.
with authoritative_locked_scope as (
  select
    opening.*,
    project_row.id as resolved_project_id,
    project_row.construction_site_id::text as resolved_project_site_id,
    site_row.id as resolved_site_id,
    pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(opening.scope_key, '')),
      '[[:space:]]+',
      '',
      'g'
    )) as normalized_scope_key,
    pg_catalog.lower(pg_catalog.regexp_replace(
      case
        when nullif(pg_catalog.btrim(opening.project_id), '') is not null
         and nullif(pg_catalog.btrim(opening.construction_site_id), '') is not null
          then pg_catalog.btrim(opening.project_id) || '_' || pg_catalog.btrim(opening.construction_site_id)
        when nullif(pg_catalog.btrim(opening.project_id), '') is not null
          then pg_catalog.btrim(opening.project_id)
        else coalesce(nullif(pg_catalog.btrim(opening.construction_site_id), ''), '')
      end,
      '[[:space:]]+',
      '',
      'g'
    )) as authoritative_scope_key
  from public.project_opening_balances opening
  left join public.projects project_row
    on project_row.id = nullif(pg_catalog.btrim(opening.project_id), '')
  left join public.hrm_construction_sites site_row
    on site_row.id::text = nullif(pg_catalog.btrim(opening.construction_site_id), '')
  where opening.status = 'locked'
)
select
  opening.id,
  opening.scope_key,
  opening.project_id,
  opening.construction_site_id,
  opening.resolved_project_site_id,
  opening.normalized_scope_key,
  opening.authoritative_scope_key,
  'project-site mismatch or non-authoritative scope' as diagnostic
from authoritative_locked_scope opening
where (
    nullif(pg_catalog.btrim(opening.project_id), '') is null
    and nullif(pg_catalog.btrim(opening.construction_site_id), '') is null
  )
  or (
    nullif(pg_catalog.btrim(opening.project_id), '') is not null
    and opening.resolved_project_id is null
  )
  or (
    nullif(pg_catalog.btrim(opening.project_id), '') is not null
    and opening.resolved_project_site_id
      is distinct from nullif(pg_catalog.btrim(opening.construction_site_id), '')
  )
  or (
    nullif(pg_catalog.btrim(opening.project_id), '') is null
    and nullif(pg_catalog.btrim(opening.construction_site_id), '') is not null
    and opening.resolved_site_id is null
  )
  or opening.normalized_scope_key is distinct from opening.authoritative_scope_key
order by opening.id;

select
  coalesce(nullif(pg_catalog.btrim(opening.project_id), ''), '') as project_id,
  coalesce(nullif(pg_catalog.btrim(opening.construction_site_id), ''), '') as construction_site_id,
  pg_catalog.count(*) as row_count,
  pg_catalog.array_agg(opening.id order by opening.id) as opening_balance_ids,
  'duplicate authoritative locked scope' as diagnostic
from public.project_opening_balances opening
where opening.status = 'locked'
group by
  coalesce(nullif(pg_catalog.btrim(opening.project_id), ''), ''),
  coalesce(nullif(pg_catalog.btrim(opening.construction_site_id), ''), '')
having pg_catalog.count(*) > 1
order by project_id, construction_site_id;

-- Locked line identity coherence: conflicting SKU/account/unit/item mappings,
-- missing lines, and lines that disagree with the authoritative item.
select
  opening.id as opening_balance_id,
  'line identity coherence violation' as diagnostic
from public.project_opening_balances opening
where opening.status = 'locked'
  and (
    not exists (
      select 1
      from public.project_opening_balance_lines line
      where line.opening_balance_id = opening.id
    )
    or exists (
      select 1
      from public.project_opening_balance_lines line
      where line.opening_balance_id = opening.id
      group by pg_catalog.lower(pg_catalog.btrim(line.sku))
      having pg_catalog.count(distinct pg_catalog.jsonb_build_array(
        coalesce(nullif(pg_catalog.btrim(line.accounting_code), ''), ''),
        app_private.normalize_quantity_unit(line.unit),
        coalesce(line.inventory_item_id, '')
      )) > 1
    )
    or exists (
      select 1
      from public.project_opening_balance_lines line
      where line.opening_balance_id = opening.id
        and nullif(pg_catalog.btrim(line.accounting_code), '') is not null
      group by pg_catalog.btrim(line.accounting_code)
      having pg_catalog.count(distinct pg_catalog.jsonb_build_array(
        pg_catalog.lower(pg_catalog.btrim(line.sku)),
        app_private.normalize_quantity_unit(line.unit),
        coalesce(line.inventory_item_id, '')
      )) > 1
    )
    or exists (
      select 1
      from public.project_opening_balance_lines line
      left join public.items item on item.id = line.inventory_item_id
      where line.opening_balance_id = opening.id
        and (
          line.inventory_item_id is null
          or item.id is null
          or pg_catalog.lower(pg_catalog.btrim(line.sku))
            is distinct from pg_catalog.lower(pg_catalog.btrim(item.sku))
          or coalesce(nullif(pg_catalog.btrim(line.accounting_code), ''), '')
            is distinct from coalesce(nullif(pg_catalog.btrim(item.accounting_code), ''), '')
          or not app_private.quantity_units_are_equivalent(line.unit, item.unit)
        )
    )
  )
order by opening.id;

rollback;
