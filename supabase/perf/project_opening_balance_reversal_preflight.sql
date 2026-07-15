-- Read-only deployment preflight for controlled project opening reversals.
-- Any returned row requires operator review/reconciliation before promotion.

begin;
set transaction read only;

with locked_opening as (
  select opening.*
  from public.project_opening_balances opening
  where opening.status = 'locked'
    and opening.posting_engine_version = 'wf001-opening-v1'
),
expected_wms as (
  select
    opening.id as opening_balance_id,
    line.warehouse_id,
    'opening-balance:' || opening.id::text || ':'
      || pg_catalog.left(app_private.sha256_text(line.warehouse_id), 16) as transaction_id,
    opening.id::text || ':' || line.warehouse_id as source_id
  from locked_opening opening
  join public.project_opening_balance_lines line
    on line.opening_balance_id = opening.id
  where line.remaining_qty > 0
  group by opening.id, line.warehouse_id
),
findings as (
  select
    'finance_missing_or_unversioned'::text as issue_type,
    opening.id as opening_balance_id,
    pg_catalog.jsonb_build_object(
      'projectFinanceId', opening.project_finance_id,
      'updatedAt', finance."updatedAt"
    ) as evidence
  from locked_opening opening
  left join public.project_finances finance on finance.id = opening.project_finance_id
  where finance.id is null or finance."updatedAt" is null

  union all

  select
    'missing_lineage_wms_transaction',
    expected.opening_balance_id,
    pg_catalog.jsonb_build_object(
      'transactionId', expected.transaction_id,
      'sourceId', expected.source_id
    )
  from expected_wms expected
  left join public.transactions transaction_row
    on transaction_row.id = expected.transaction_id
   and transaction_row.source_type = 'project_opening_balance'
   and transaction_row.source_id = expected.source_id
   and transaction_row.status::text = 'COMPLETED'
   and transaction_row.posting_engine_version = 'wf001-opening-v1'
  where transaction_row.id is null

  union all

  select
    'missing_lineage_inventory_header',
    expected.opening_balance_id,
    pg_catalog.jsonb_build_object('transactionId', expected.transaction_id)
  from expected_wms expected
  where not exists (
    select 1
    from public.inventory_transactions inventory_transaction
    where inventory_transaction.source_type = 'wms_transaction'
      and inventory_transaction.source_id = expected.transaction_id
      and inventory_transaction.status = 'posted'
  )

  union all

  select
    'missing_lineage_inventory_ledger',
    expected.opening_balance_id,
    pg_catalog.jsonb_build_object('transactionId', expected.transaction_id)
  from expected_wms expected
  where not exists (
    select 1
    from public.inventory_transactions inventory_transaction
    join public.inventory_ledger_entries ledger
      on ledger.inventory_transaction_id = inventory_transaction.id
    where inventory_transaction.source_type = 'wms_transaction'
      and inventory_transaction.source_id = expected.transaction_id
  )

  union all

  select
    'duplicate_reversal_source',
    null::uuid,
    pg_catalog.jsonb_build_object(
      'sourceId', duplicate_source.source_id,
      'transactionIds', duplicate_source.transaction_ids
    )
  from (
    select
      transaction_row.source_id,
      pg_catalog.array_agg(transaction_row.id order by transaction_row.id) as transaction_ids
    from public.transactions transaction_row
    where transaction_row.source_type = 'project_opening_balance_reversal'
    group by transaction_row.source_id
    having pg_catalog.count(*) > 1
  ) duplicate_source

  union all

  select
    'reserved_reversal_source_without_command_lineage',
    null::uuid,
    pg_catalog.jsonb_build_object(
      'transactionId', transaction_row.id,
      'sourceId', transaction_row.source_id,
      'postingEngineVersion', transaction_row.posting_engine_version
    )
  from public.transactions transaction_row
  where transaction_row.source_type = 'project_opening_balance_reversal'
    and transaction_row.posting_engine_version is distinct from 'wf001-opening-reversal-v1'

  union all

  select
    'material_source_alias_mismatch',
    null::uuid,
    pg_catalog.jsonb_build_object(
      'projectTransactionId', project_transaction.id,
      'source_ref', project_transaction.source_ref,
      'sourceRef', project_transaction."sourceRef"
    )
  from public.project_transactions project_transaction
  where (
    coalesce(project_transaction.source_ref like 'opening_balance:%:materials', false)
    or coalesce(project_transaction."sourceRef" like 'opening_balance:%:materials', false)
    or coalesce(project_transaction.source_ref like 'opening_balance_reversal:%:materials', false)
    or coalesce(project_transaction."sourceRef" like 'opening_balance_reversal:%:materials', false)
  )
    and project_transaction.source_ref is distinct from project_transaction."sourceRef"

  union all

  select
    'missing_lineage_original_material_source',
    opening.id,
    pg_catalog.jsonb_build_object(
      'projectTransactionId', project_transaction.id,
      'source_ref', project_transaction.source_ref,
      'sourceRef', project_transaction."sourceRef"
    )
  from locked_opening opening
  left join public.project_transactions project_transaction
    on project_transaction.id = opening.material_project_transaction_id
   and project_transaction.source_ref = 'opening_balance:' || opening.id::text || ':materials'
   and project_transaction."sourceRef" = 'opening_balance:' || opening.id::text || ':materials'
   and project_transaction.type = 'expense'
   and project_transaction.category = 'materials'
   and project_transaction.amount = opening.recognized_value
  where opening.recognized_value > 0
    and project_transaction.id is null

  union all

  select
    'duplicate_reversal_material_source',
    null::uuid,
    pg_catalog.jsonb_build_object(
      'sourceRef', duplicate_source.effective_source_ref,
      'projectTransactionIds', duplicate_source.project_transaction_ids
    )
  from (
    select
      coalesce(project_transaction.source_ref, project_transaction."sourceRef")
        as effective_source_ref,
      pg_catalog.array_agg(project_transaction.id order by project_transaction.id)
        as project_transaction_ids
    from public.project_transactions project_transaction
    where coalesce(project_transaction.source_ref, project_transaction."sourceRef")
      like 'opening_balance:%:materials'
       or coalesce(project_transaction.source_ref, project_transaction."sourceRef")
      like 'opening_balance_reversal:%:materials'
    group by coalesce(project_transaction.source_ref, project_transaction."sourceRef")
    having pg_catalog.count(*) > 1
  ) duplicate_source

  union all

  select
    'reserved_material_reversal_source_without_command_lineage',
    null::uuid,
    pg_catalog.jsonb_build_object(
      'projectTransactionId', project_transaction.id,
      'source_ref', project_transaction.source_ref,
      'sourceRef', project_transaction."sourceRef"
    )
  from public.project_transactions project_transaction
  where project_transaction.source_ref like 'opening_balance_reversal:%:materials'
     or project_transaction."sourceRef" like 'opening_balance_reversal:%:materials'
)
select issue_type, opening_balance_id, evidence
from findings
order by issue_type, opening_balance_id nulls last;

rollback;
