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

-- Project opening transaction provenance. A reserved source is trusted only
-- when its deterministic WMS/opening/ledger chain is complete.
with parsed_reserved as (
  select
    transaction_row.*,
    transaction_row as transaction_record,
    case
      when transaction_row.source_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:.+$'
        then pg_catalog.left(transaction_row.source_id, 36)::uuid
      else null
    end as opening_id,
    case
      when transaction_row.source_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:.+$'
        then pg_catalog.substr(transaction_row.source_id, 38)
      else null
    end as source_warehouse_suffix
  from public.transactions transaction_row
  where transaction_row.source_type = 'project_opening_balance'
), reserved_with_lineage as (
  select
    reserved.*,
    opening.status as opening_status,
    opening.posting_engine_version as opening_engine,
    opening.stock_transaction_ids,
    inventory_transaction.id as inventory_transaction_id,
    inventory_transaction.status as inventory_status,
    inventory_transaction.transaction_type as inventory_transaction_type,
    pg_catalog.count(inventory_transaction.id) over (
      partition by reserved.id
    ) as inventory_header_count
  from parsed_reserved reserved
  left join public.project_opening_balances opening
    on opening.id = reserved.opening_id
  left join public.inventory_transactions inventory_transaction
    on inventory_transaction.source_type = 'wms_transaction'
   and inventory_transaction.source_id = reserved.id
)
select distinct
  reserved.id,
  reserved.source_id,
  reserved.posting_engine_version,
  'project opening transaction provenance violation' as diagnostic
from reserved_with_lineage reserved
where reserved.opening_id is null
   or nullif(pg_catalog.btrim(reserved.source_warehouse_suffix), '') is null
   or reserved.source_id is distinct from
     reserved.opening_id::text || ':' || reserved.source_warehouse_suffix
   or reserved.target_warehouse_id is distinct from reserved.source_warehouse_suffix
   or reserved.id is distinct from
     'opening-balance:' || reserved.opening_id::text || ':'
       || pg_catalog.left(app_private.sha256_text(reserved.source_warehouse_suffix), 16)
   or reserved.type::text <> 'ADJUSTMENT'
   or reserved.status::text <> 'COMPLETED'
   or reserved.source_warehouse_id is not null
   or reserved.posting_engine_version is distinct from 'wf001-opening-v1'
   or reserved.posting_request_hash is distinct from app_private.sha256_text(
     app_private.wms_transaction_intent(reserved.transaction_record)::text
   )
   or reserved.opening_status is distinct from 'locked'
   or reserved.opening_engine is distinct from 'wf001-opening-v1'
   or not coalesce(reserved.stock_transaction_ids, '[]'::jsonb)
     @> pg_catalog.jsonb_build_array(reserved.id)
   or not exists (
     select 1
     from public.project_opening_balance_lines opening_line
     where opening_line.opening_balance_id = reserved.opening_id
       and opening_line.warehouse_id = reserved.target_warehouse_id
       and opening_line.remaining_qty > 0
   )
   or pg_catalog.jsonb_typeof(reserved.items) <> 'array'
   or pg_catalog.jsonb_array_length(coalesce(reserved.items, '[]'::jsonb)) = 0
   or exists (
     select 1
     from pg_catalog.jsonb_array_elements(coalesce(reserved.items, '[]'::jsonb)) item(value)
     left join public.items catalog_item on catalog_item.id = item.value->>'itemId'
     where pg_catalog.jsonb_typeof(item.value) <> 'object'
        or nullif(pg_catalog.btrim(item.value->>'lineId'), '') is null
        or pg_catalog.jsonb_typeof(item.value->'quantity') <> 'number'
        or catalog_item.id is null
        or not app_private.quantity_units_are_equivalent(catalog_item.unit, item.value->>'unit')
        or not app_private.quantity_units_are_equivalent(catalog_item.unit, item.value->>'unitSnapshot')
   )
   or reserved.inventory_header_count <> 1
   or reserved.inventory_status is distinct from 'posted'
   or reserved.inventory_transaction_type is distinct from 'adjustment_in'
   or exists (
     select 1
     from public.inventory_ledger_entries ledger
     left join public.items catalog_item on catalog_item.id = ledger.material_id
     where ledger.inventory_transaction_id = reserved.inventory_transaction_id
       and (
         ledger.source_type is distinct from 'wms_transaction'
         or ledger.source_id is distinct from reserved.id
         or ledger.source_code is distinct from reserved.id
         or ledger.transaction_type is distinct from 'adjustment_in'
         or ledger.warehouse_id is distinct from reserved.target_warehouse_id
         or ledger.movement_direction is distinct from 'in'
         or ledger.quantity_in <= 0
         or ledger.quantity_out <> 0
         or catalog_item.id is null
         or not app_private.quantity_units_are_equivalent(catalog_item.unit, ledger.unit)
       )
   )
order by reserved.id;

with reserved as (
  select
    transaction_row.id,
    pg_catalog.left(transaction_row.source_id, 36)::uuid as opening_id,
    transaction_row.target_warehouse_id as warehouse_id,
    transaction_row.items
  from public.transactions transaction_row
  where transaction_row.source_type = 'project_opening_balance'
    and transaction_row.source_id ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:.+$'
    and pg_catalog.jsonb_typeof(transaction_row.items) = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(transaction_row.items) item(value)
      where pg_catalog.jsonb_typeof(item.value->'quantity') <> 'number'
    )
), expected as (
  select
    reserved.id as transaction_id,
    opening_line.inventory_item_id as item_id,
    pg_catalog.sum(opening_line.remaining_qty) as quantity
  from reserved
  join public.project_opening_balance_lines opening_line
    on opening_line.opening_balance_id = reserved.opening_id
   and opening_line.warehouse_id = reserved.warehouse_id
   and opening_line.remaining_qty > 0
  group by reserved.id, opening_line.inventory_item_id
), transaction_actual as (
  select
    reserved.id as transaction_id,
    item.value->>'itemId' as item_id,
    pg_catalog.sum((item.value->>'quantity')::numeric) as quantity
  from reserved
  cross join lateral pg_catalog.jsonb_array_elements(reserved.items) item(value)
  group by reserved.id, item.value->>'itemId'
), ledger_actual as (
  select
    reserved.id as transaction_id,
    ledger.material_id as item_id,
    pg_catalog.sum(ledger.quantity_in) as quantity
  from reserved
  join public.inventory_transactions inventory_transaction
    on inventory_transaction.source_type = 'wms_transaction'
   and inventory_transaction.source_id = reserved.id
  join public.inventory_ledger_entries ledger
    on ledger.inventory_transaction_id = inventory_transaction.id
  group by reserved.id, ledger.material_id
), transaction_comparison as (
  select
    coalesce(expected.transaction_id, actual.transaction_id) as transaction_id,
    coalesce(expected.item_id, actual.item_id) as item_id,
    expected.quantity as expected_quantity,
    actual.quantity as actual_quantity,
    'transaction'::text as evidence_kind
  from expected
  full join transaction_actual actual
    using (transaction_id, item_id)
), ledger_comparison as (
  select
    coalesce(expected.transaction_id, actual.transaction_id) as transaction_id,
    coalesce(expected.item_id, actual.item_id) as item_id,
    expected.quantity as expected_quantity,
    actual.quantity as actual_quantity,
    'ledger'::text as evidence_kind
  from expected
  full join ledger_actual actual
    using (transaction_id, item_id)
)
select
  comparison.*,
  'project opening transaction provenance aggregate mismatch' as diagnostic
from (
  select * from transaction_comparison
  union all
  select * from ledger_comparison
) comparison
where comparison.expected_quantity is distinct from comparison.actual_quantity
order by comparison.transaction_id, comparison.evidence_kind, comparison.item_id;

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

-- Preserve all diagnostics above, then make automation fail closed. Finance
-- nullable counts are intentionally not blockers because the migration owns
-- their deterministic zero/timestamp backfill.
do $atomic_project_opening_balance_preflight_assertions$
declare
  v_has_blocker boolean;
begin
  with parsed_reserved as (
    select
      transaction_row.*,
      transaction_row as transaction_record,
      case
        when transaction_row.source_id ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:.+$'
          then pg_catalog.left(transaction_row.source_id, 36)::uuid
        else null
      end as opening_id,
      case
        when transaction_row.source_id ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:.+$'
          then pg_catalog.substr(transaction_row.source_id, 38)
        else null
      end as source_warehouse_suffix
    from public.transactions transaction_row
    where transaction_row.source_type = 'project_opening_balance'
  ), reserved_with_lineage as (
    select
      reserved.*,
      opening.status as opening_status,
      opening.posting_engine_version as opening_engine,
      opening.stock_transaction_ids,
      inventory_transaction.id as inventory_transaction_id,
      inventory_transaction.status as inventory_status,
      inventory_transaction.transaction_type as inventory_transaction_type,
      pg_catalog.count(inventory_transaction.id) over (
        partition by reserved.id
      ) as inventory_header_count
    from parsed_reserved reserved
    left join public.project_opening_balances opening
      on opening.id = reserved.opening_id
    left join public.inventory_transactions inventory_transaction
      on inventory_transaction.source_type = 'wms_transaction'
     and inventory_transaction.source_id = reserved.id
  )
  select coalesce(pg_catalog.bool_or(
    reserved.opening_id is null
    or nullif(pg_catalog.btrim(reserved.source_warehouse_suffix), '') is null
    or reserved.source_id is distinct from
      reserved.opening_id::text || ':' || reserved.source_warehouse_suffix
    or reserved.target_warehouse_id is distinct from reserved.source_warehouse_suffix
    or reserved.id is distinct from
      'opening-balance:' || reserved.opening_id::text || ':'
        || pg_catalog.left(app_private.sha256_text(reserved.source_warehouse_suffix), 16)
    or reserved.type::text <> 'ADJUSTMENT'
    or reserved.status::text <> 'COMPLETED'
    or reserved.source_warehouse_id is not null
    or reserved.posting_engine_version is distinct from 'wf001-opening-v1'
    or reserved.posting_request_hash is distinct from app_private.sha256_text(
      app_private.wms_transaction_intent(reserved.transaction_record)::text
    )
    or reserved.opening_status is distinct from 'locked'
    or reserved.opening_engine is distinct from 'wf001-opening-v1'
    or not coalesce(reserved.stock_transaction_ids, '[]'::jsonb)
      @> pg_catalog.jsonb_build_array(reserved.id)
    or not exists (
      select 1
      from public.project_opening_balance_lines opening_line
      where opening_line.opening_balance_id = reserved.opening_id
        and opening_line.warehouse_id = reserved.target_warehouse_id
        and opening_line.remaining_qty > 0
    )
    or pg_catalog.jsonb_typeof(reserved.items) <> 'array'
    or pg_catalog.jsonb_array_length(coalesce(reserved.items, '[]'::jsonb)) = 0
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(coalesce(reserved.items, '[]'::jsonb)) item(value)
      left join public.items catalog_item on catalog_item.id = item.value->>'itemId'
      where pg_catalog.jsonb_typeof(item.value) <> 'object'
         or nullif(pg_catalog.btrim(item.value->>'lineId'), '') is null
         or pg_catalog.jsonb_typeof(item.value->'quantity') <> 'number'
         or catalog_item.id is null
         or not app_private.quantity_units_are_equivalent(catalog_item.unit, item.value->>'unit')
         or not app_private.quantity_units_are_equivalent(catalog_item.unit, item.value->>'unitSnapshot')
    )
    or reserved.inventory_header_count <> 1
    or reserved.inventory_status is distinct from 'posted'
    or reserved.inventory_transaction_type is distinct from 'adjustment_in'
    or exists (
      select 1
      from public.inventory_ledger_entries ledger
      left join public.items catalog_item on catalog_item.id = ledger.material_id
      where ledger.inventory_transaction_id = reserved.inventory_transaction_id
        and (
          ledger.source_type is distinct from 'wms_transaction'
          or ledger.source_id is distinct from reserved.id
          or ledger.source_code is distinct from reserved.id
          or ledger.transaction_type is distinct from 'adjustment_in'
          or ledger.warehouse_id is distinct from reserved.target_warehouse_id
          or ledger.movement_direction is distinct from 'in'
          or ledger.quantity_in <= 0
          or ledger.quantity_out <> 0
          or catalog_item.id is null
          or not app_private.quantity_units_are_equivalent(catalog_item.unit, ledger.unit)
        )
    )
  ), false)
  into v_has_blocker
  from reserved_with_lineage reserved;
  if v_has_blocker then
    raise exception 'project opening transaction provenance blockers require reconciliation'
      using errcode = '55000';
  end if;

  with reserved as (
    select
      transaction_row.id,
      pg_catalog.left(transaction_row.source_id, 36)::uuid as opening_id,
      transaction_row.target_warehouse_id as warehouse_id,
      transaction_row.items
    from public.transactions transaction_row
    where transaction_row.source_type = 'project_opening_balance'
      and transaction_row.source_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:.+$'
      and pg_catalog.jsonb_typeof(transaction_row.items) = 'array'
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(transaction_row.items) item(value)
        where pg_catalog.jsonb_typeof(item.value->'quantity') <> 'number'
      )
  ), expected as (
    select reserved.id as transaction_id,
           opening_line.inventory_item_id as item_id,
           pg_catalog.sum(opening_line.remaining_qty) as quantity
    from reserved
    join public.project_opening_balance_lines opening_line
      on opening_line.opening_balance_id = reserved.opening_id
     and opening_line.warehouse_id = reserved.warehouse_id
     and opening_line.remaining_qty > 0
    group by reserved.id, opening_line.inventory_item_id
  ), transaction_actual as (
    select reserved.id as transaction_id,
           item.value->>'itemId' as item_id,
           pg_catalog.sum((item.value->>'quantity')::numeric) as quantity
    from reserved
    cross join lateral pg_catalog.jsonb_array_elements(reserved.items) item(value)
    group by reserved.id, item.value->>'itemId'
  ), ledger_actual as (
    select reserved.id as transaction_id,
           ledger.material_id as item_id,
           pg_catalog.sum(ledger.quantity_in) as quantity
    from reserved
    join public.inventory_transactions inventory_transaction
      on inventory_transaction.source_type = 'wms_transaction'
     and inventory_transaction.source_id = reserved.id
    join public.inventory_ledger_entries ledger
      on ledger.inventory_transaction_id = inventory_transaction.id
    group by reserved.id, ledger.material_id
  ), mismatches as (
    select 1
    from expected
    full join transaction_actual actual using (transaction_id, item_id)
    where expected.quantity is distinct from actual.quantity
    union all
    select 1
    from expected
    full join ledger_actual actual using (transaction_id, item_id)
    where expected.quantity is distinct from actual.quantity
  )
  select exists (select 1 from mismatches)
  into v_has_blocker;
  if v_has_blocker then
    raise exception 'project opening transaction/ledger aggregate blockers require reconciliation'
      using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.transactions transaction_row
    where transaction_row.source_type = 'project_opening_balance'
    group by transaction_row.source_id
    having pg_catalog.count(*) > 1
  ) into v_has_blocker;
  if v_has_blocker then
    raise exception 'duplicate project opening transaction source blockers require reconciliation'
      using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.project_opening_balances opening
    left join public.projects project_row
      on project_row.id = nullif(pg_catalog.btrim(opening.project_id), '')
    left join public.hrm_construction_sites site_row
      on site_row.id::text = nullif(pg_catalog.btrim(opening.construction_site_id), '')
    where opening.status = 'locked'
      and (
        (nullif(pg_catalog.btrim(opening.project_id), '') is null
          and nullif(pg_catalog.btrim(opening.construction_site_id), '') is null)
        or (nullif(pg_catalog.btrim(opening.project_id), '') is not null
          and project_row.id is null)
        or (nullif(pg_catalog.btrim(opening.project_id), '') is not null
          and project_row.construction_site_id::text is distinct from
            nullif(pg_catalog.btrim(opening.construction_site_id), ''))
        or (nullif(pg_catalog.btrim(opening.project_id), '') is null
          and nullif(pg_catalog.btrim(opening.construction_site_id), '') is not null
          and site_row.id is null)
        or app_private.normalize_project_opening_scope_key(opening.scope_key)
          is distinct from app_private.normalize_project_opening_scope_key(
            case
              when nullif(pg_catalog.btrim(opening.project_id), '') is not null
               and nullif(pg_catalog.btrim(opening.construction_site_id), '') is not null
                then pg_catalog.btrim(opening.project_id) || '_'
                  || pg_catalog.btrim(opening.construction_site_id)
              when nullif(pg_catalog.btrim(opening.project_id), '') is not null
                then pg_catalog.btrim(opening.project_id)
              else coalesce(nullif(pg_catalog.btrim(opening.construction_site_id), ''), '')
            end
          )
      )
  ) into v_has_blocker;
  if v_has_blocker then
    raise exception 'authoritative locked scope blockers require reconciliation'
      using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.project_opening_balances opening
    where opening.status = 'locked'
    group by
      coalesce(nullif(pg_catalog.btrim(opening.project_id), ''), ''),
      coalesce(nullif(pg_catalog.btrim(opening.construction_site_id), ''), '')
    having pg_catalog.count(*) > 1
  ) into v_has_blocker;
  if v_has_blocker then
    raise exception 'duplicate authoritative locked scope blockers require reconciliation'
      using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.project_opening_balances opening
    where opening.status = 'locked'
      and (
        not exists (
          select 1 from public.project_opening_balance_lines line
          where line.opening_balance_id = opening.id
        )
        or exists (
          select 1
          from public.project_opening_balance_lines line
          left join public.items item on item.id = line.inventory_item_id
          where line.opening_balance_id = opening.id
            and (
              line.inventory_item_id is null
              or item.id is null
              or pg_catalog.lower(pg_catalog.btrim(line.sku)) is distinct from
                pg_catalog.lower(pg_catalog.btrim(item.sku))
              or coalesce(nullif(pg_catalog.btrim(line.accounting_code), ''), '')
                is distinct from coalesce(nullif(pg_catalog.btrim(item.accounting_code), ''), '')
              or not app_private.quantity_units_are_equivalent(line.unit, item.unit)
            )
        )
      )
  ) into v_has_blocker;
  if v_has_blocker then
    raise exception 'locked line identity coherence blockers require reconciliation'
      using errcode = '55000';
  end if;
end;
$atomic_project_opening_balance_preflight_assertions$;

rollback;
