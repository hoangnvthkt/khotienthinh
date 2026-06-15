-- Phase 1 index drop preflight.
-- Read-only: this file does not change schema.
-- Run with:
--   npx supabase db query --linked -f supabase/perf/index_drop_preflight.sql
--
-- Gate rule:
--   Before applying phase 1, every row with target_exists = true must have
--   safe_to_drop = true and apply_blocker = false.
--   After applying phase 1, target_exists should be false and post_apply_ok true.

with targets(target_index, replacement_indexes) as (
  values
    ('idx_audit_trail_module', array['idx_audit_trail_module_created_at']),
    ('idx_acceptance_records_site', array['idx_acceptance_records_site_period']),
    ('idx_asset_maintenances_status', array['idx_asset_maintenances_status_start_date']),
    ('idx_assets_status', array['idx_assets_status_updated_at']),
    ('idx_material_budget_items_site', array['idx_material_budget_items_site_category_id', 'idx_material_budget_items_site_category']),
    ('idx_payment_schedules_site', array['idx_payment_schedules_site_due_date']),
    ('idx_project_documents_site', array['idx_project_documents_site_created_at']),
    ('idx_project_material_requests_site', array['idx_project_material_requests_site_created_at']),
    ('idx_project_vendors_site', array['idx_project_vendors_site_name']),
    ('idx_purchase_orders_site', array['idx_purchase_orders_site_created_at']),
    ('idx_request_instances_created_by', array['idx_request_instances_created_by_created_at']),
    ('idx_request_instances_status', array['idx_request_instances_status_created_at']),
    ('idx_workflow_instances_created_at', array['idx_workflow_instances_created_at_desc']),
    ('idx_boq_reconciliation_groups_step_handler', array['idx_boq_reconciliation_groups_submitted_to']),
    ('idx_contract_variations_step_handler', array['idx_contract_variations_submitted_to']),
    ('idx_payment_certificates_step_handler', array['idx_payment_certificates_submitted_to']),
    ('idx_project_material_requests_step_handler', array['idx_project_material_requests_submitted_to']),
    ('idx_purchase_orders_step_handler', array['idx_purchase_orders_submitted_to']),
    ('idx_quantity_acceptances_step_handler', array['idx_quantity_acceptances_submitted_to'])
),
index_stats as (
  select
    s.schemaname,
    s.relname as table_name,
    s.indexrelname as index_name,
    s.relid,
    s.indexrelid,
    coalesce(s.idx_scan, 0) as idx_scan,
    coalesce(s.idx_tup_read, 0) as idx_tup_read,
    coalesce(s.idx_tup_fetch, 0) as idx_tup_fetch,
    pg_relation_size(s.indexrelid) as index_size_bytes,
    pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
    i.indisprimary,
    i.indisunique,
    i.indisvalid,
    i.indisready,
    i.indpred is not null as is_partial,
    exists (
      select 1
      from pg_constraint c
      where c.conindid = s.indexrelid
    ) as backs_constraint,
    pg_get_indexdef(s.indexrelid) as indexdef,
    (
      select array_agg(att.attname order by ord.n)
      from unnest(i.indkey) with ordinality as ord(attnum, n)
      join pg_attribute att
        on att.attrelid = s.relid
       and att.attnum = ord.attnum
      where ord.attnum > 0
    ) as index_columns
  from pg_stat_user_indexes s
  join pg_index i on i.indexrelid = s.indexrelid
  where s.schemaname = 'public'
),
evaluated as (
  select
    now() as captured_at,
    t.target_index,
    target.index_name is not null as target_exists,
    target.table_name,
    target.idx_scan,
    target.idx_tup_read,
    target.idx_tup_fetch,
    target.index_size,
    target.index_size_bytes,
    coalesce(target.indisprimary, false) as is_primary,
    coalesce(target.indisunique, false) as is_unique,
    coalesce(target.backs_constraint, false) as backs_constraint,
    coalesce(target.indisvalid, false) as is_valid,
    coalesce(target.indisready, false) as is_ready,
    target.is_partial,
    target.index_columns,
    target.indexdef,
    replacements.replacement_exists,
    replacements.replacement_indexes_found,
    replacements.replacement_indexdefs,
    replacements.covered_by_replacement,
    case
      when target.indexdef is null then null
      else regexp_replace(
        target.indexdef,
        '^CREATE INDEX ([^ ]+) ON ',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS \1 ON '
      ) || ';'
    end as rollback_sql
  from targets t
  left join index_stats target
    on target.index_name = t.target_index
  left join lateral (
    select
      count(repl.index_name) > 0 as replacement_exists,
      array_agg(repl.index_name order by repl.index_name) filter (where repl.index_name is not null) as replacement_indexes_found,
      array_agg(repl.indexdef order by repl.index_name) filter (where repl.index_name is not null) as replacement_indexdefs,
      coalesce(bool_or(
        repl.index_name is not null
        and target.index_name is not null
        and cardinality(repl.index_columns) >= cardinality(target.index_columns)
        and repl.index_columns[1:cardinality(target.index_columns)] = target.index_columns
      ), false) as covered_by_replacement
    from unnest(t.replacement_indexes) as candidate(index_name)
    left join index_stats repl
      on repl.index_name = candidate.index_name
  ) replacements on true
)
select
  captured_at,
  target_index,
  target_exists,
  table_name,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  index_size,
  is_primary,
  is_unique,
  backs_constraint,
  is_valid,
  is_ready,
  is_partial,
  index_columns,
  replacement_exists,
  replacement_indexes_found,
  covered_by_replacement,
  (
    target_exists
    and replacement_exists
    and covered_by_replacement
    and not is_primary
    and not is_unique
    and not backs_constraint
    and is_valid
    and is_ready
  ) as safe_to_drop,
  (
    target_exists
    and not (
      replacement_exists
      and covered_by_replacement
      and not is_primary
      and not is_unique
      and not backs_constraint
      and is_valid
      and is_ready
    )
  ) as apply_blocker,
  (
    not target_exists
    and replacement_exists
  ) as post_apply_ok,
  case
    when not target_exists then 'target_missing_or_already_dropped'
    when is_primary or is_unique or backs_constraint then 'protected_index'
    when not is_valid or not is_ready then 'index_not_ready'
    when not replacement_exists then 'missing_replacement_index'
    when not covered_by_replacement then 'replacement_does_not_cover_leftmost_prefix'
    else 'safe_to_drop'
  end as decision,
  rollback_sql,
  indexdef,
  replacement_indexdefs
from evaluated
order by target_index;
