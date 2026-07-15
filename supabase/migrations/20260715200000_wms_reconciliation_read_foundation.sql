-- Release B2a: read-only WMS reconciliation run lifecycle and scanner shell.
-- Scanner algorithms are populated by B2b; this migration deliberately keeps
-- every phase source-read-only while freezing the catalog/source boundary.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table public.wms_reconciliation_runs
  add column if not exists source_snapshot jsonb;

update public.wms_reconciliation_runs
set source_snapshot = '{}'::jsonb
where source_snapshot is null;

alter table public.wms_reconciliation_runs
  alter column source_snapshot set default '{}'::jsonb,
  alter column source_snapshot set not null;

create or replace function app_private.guard_wms_reconciliation_run_fingerprints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_hash is not null
     and old.schema_hash is distinct from new.schema_hash then
    raise exception 'WMS reconciliation schema fingerprint is immutable'
      using errcode = '22023';
  end if;
  if old.function_hash is not null
     and old.function_hash is distinct from new.function_hash then
    raise exception 'WMS reconciliation function fingerprint is immutable'
      using errcode = '22023';
  end if;
  if old.source_snapshot is distinct from new.source_snapshot then
    raise exception 'WMS reconciliation source snapshot is immutable'
      using errcode = '22023';
  end if;
  if old.scope is distinct from new.scope
     or old.scope_hash is distinct from new.scope_hash
     or old.as_of is distinct from new.as_of
     or old.policy_version is distinct from new.policy_version then
    raise exception 'WMS reconciliation run identity is immutable'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_wms_reconciliation_run_fingerprints()
  from public, anon, authenticated, service_role;

create table app_private.wms_reconciliation_run_work (
  run_id uuid not null
    references public.wms_reconciliation_runs(id) on delete cascade,
  phase text not null check (phase in (
    'physical_anchor', 'opening_balance', 'transaction_ledger',
    'ledger_balance', 'stock_cache', 'reservation', 'batch',
    'po_mr_uom', 'lineage'
  )),
  source_key text not null,
  warehouse_id text not null default '',
  item_id text not null default '',
  source_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (run_id, phase, source_key, warehouse_id, item_id),
  check (pg_catalog.btrim(source_key) <> '')
);

revoke all privileges on table app_private.wms_reconciliation_run_work
  from public, anon, authenticated, service_role;

create or replace function app_private.wms_reconciliation_decimal_text(p_value numeric)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_value = 0 then '0'
    else pg_catalog.trim_scale(p_value)::text
  end;
$$;

create or replace function app_private.canonicalize_wms_reconciliation_json_numbers(
  p_value jsonb
)
returns jsonb
language plpgsql
immutable
parallel safe
security invoker
set search_path = ''
as $$
declare
  v_type text := pg_catalog.jsonb_typeof(p_value);
  v_result jsonb;
begin
  if p_value is null then
    return null;
  end if;
  if v_type = 'number' then
    return pg_catalog.to_jsonb(
      app_private.wms_reconciliation_decimal_text((p_value #>> '{}')::numeric)
    );
  end if;
  if v_type = 'array' then
    select coalesce(
      pg_catalog.jsonb_agg(
        app_private.canonicalize_wms_reconciliation_json_numbers(element.value)
        order by element.ordinality
      ),
      '[]'::jsonb
    )
    into v_result
    from pg_catalog.jsonb_array_elements(p_value) with ordinality as element(value, ordinality);
    return v_result;
  end if;
  if v_type = 'object' then
    select coalesce(
      pg_catalog.jsonb_object_agg(
        member.key,
        app_private.canonicalize_wms_reconciliation_json_numbers(member.value)
      ),
      '{}'::jsonb
    )
    into v_result
    from pg_catalog.jsonb_each(p_value) as member(key, value);
    return v_result;
  end if;
  return p_value;
end;
$$;

create or replace function app_private.normalize_wms_reconciliation_scope(p_scope jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_warehouse_ids text[];
  v_item_ids text[] := '{}'::text[];
  v_source_types text[] := '{}'::text[];
  v_affected_from timestamptz;
begin
  if p_scope is null or pg_catalog.jsonb_typeof(p_scope) <> 'object' then
    raise exception 'reconciliation scope must be a JSON object'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_scope) as key_name(key)
    where key not in ('warehouseIds', 'itemIds', 'sourceTypes', 'affectedFrom')
  ) then
    raise exception 'reconciliation scope contains unknown fields'
      using errcode = '22023';
  end if;
  if not (p_scope ? 'warehouseIds')
     or pg_catalog.jsonb_typeof(p_scope -> 'warehouseIds') <> 'array'
     or pg_catalog.jsonb_array_length(p_scope -> 'warehouseIds') = 0
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_scope -> 'warehouseIds') value
       where pg_catalog.jsonb_typeof(value) <> 'string'
     ) then
    raise exception 'warehouseIds must be a non-empty string array'
      using errcode = '22023';
  end if;
  select pg_catalog.array_agg(pg_catalog.btrim(value) order by pg_catalog.btrim(value))
  into v_warehouse_ids
  from pg_catalog.jsonb_array_elements_text(p_scope -> 'warehouseIds') value;
  if exists (select 1 from pg_catalog.unnest(v_warehouse_ids) value where value = '')
     or pg_catalog.cardinality(v_warehouse_ids) <>
       (select pg_catalog.count(distinct value) from pg_catalog.unnest(v_warehouse_ids) value)
     or ('*' = any(v_warehouse_ids) and v_warehouse_ids <> array['*']::text[]) then
    raise exception 'warehouseIds contains blanks, duplicates, or an invalid wildcard'
      using errcode = '22023';
  end if;

  if p_scope ? 'itemIds' then
    if pg_catalog.jsonb_typeof(p_scope -> 'itemIds') <> 'array'
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(p_scope -> 'itemIds') value
         where pg_catalog.jsonb_typeof(value) <> 'string'
       ) then
      raise exception 'itemIds must be a string array'
        using errcode = '22023';
    end if;
    select coalesce(
      pg_catalog.array_agg(pg_catalog.btrim(value) order by pg_catalog.btrim(value)),
      '{}'::text[]
    )
    into v_item_ids
    from pg_catalog.jsonb_array_elements_text(p_scope -> 'itemIds') value;
    if exists (select 1 from pg_catalog.unnest(v_item_ids) value where value = '')
       or pg_catalog.cardinality(v_item_ids) <>
         (select pg_catalog.count(distinct value) from pg_catalog.unnest(v_item_ids) value) then
      raise exception 'itemIds contains blanks or duplicates'
        using errcode = '22023';
    end if;
  end if;

  if p_scope ? 'sourceTypes' then
    if pg_catalog.jsonb_typeof(p_scope -> 'sourceTypes') <> 'array'
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(p_scope -> 'sourceTypes') value
         where pg_catalog.jsonb_typeof(value) <> 'string'
       ) then
      raise exception 'sourceTypes must be a string array'
        using errcode = '22023';
    end if;
    select coalesce(
      pg_catalog.array_agg(pg_catalog.btrim(value) order by pg_catalog.btrim(value)),
      '{}'::text[]
    )
    into v_source_types
    from pg_catalog.jsonb_array_elements_text(p_scope -> 'sourceTypes') value;
    if exists (select 1 from pg_catalog.unnest(v_source_types) value where value = '')
       or pg_catalog.cardinality(v_source_types) <>
         (select pg_catalog.count(distinct value) from pg_catalog.unnest(v_source_types) value) then
      raise exception 'sourceTypes contains blanks or duplicates'
        using errcode = '22023';
    end if;
  end if;

  if p_scope ? 'affectedFrom' and p_scope -> 'affectedFrom' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_scope -> 'affectedFrom') <> 'string' then
      raise exception 'affectedFrom must be an ISO timestamp string'
        using errcode = '22023';
    end if;
    if (p_scope ->> 'affectedFrom') !~
       '^\d{4}-\d{2}-\d{2}[Tt ][0-2]\d:[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-][0-2]\d:[0-5]\d)$' then
      raise exception 'affectedFrom must include an ISO date, time, and timezone'
        using errcode = '22023';
    end if;
    begin
      v_affected_from := (p_scope ->> 'affectedFrom')::timestamptz;
      if not pg_catalog.isfinite(v_affected_from) then
        raise exception 'affectedFrom must be finite' using errcode = '22023';
      end if;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'affectedFrom must be an ISO timestamp string'
          using errcode = '22023';
    end;
  end if;

  return pg_catalog.jsonb_build_object(
    'warehouseIds', pg_catalog.to_jsonb(v_warehouse_ids),
    'itemIds', pg_catalog.to_jsonb(v_item_ids),
    'sourceTypes', pg_catalog.to_jsonb(v_source_types),
    'affectedFrom', pg_catalog.to_jsonb(v_affected_from)
  );
end;
$$;

create or replace function app_private.require_wms_reconciliation_permission(
  p_actor uuid,
  p_permission_code text,
  p_scope jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope jsonb;
  v_warehouse_id text;
  v_item_id text;
begin
  if p_actor is null or not exists (
    select 1 from public.users user_row
    where user_row.id = p_actor and coalesce(user_row.is_active, false)
  ) then
    raise exception 'active application user is required'
      using errcode = '42501';
  end if;
  if p_permission_code not in (
    'wms.reconciliation.view', 'wms.reconciliation.generate',
    'wms.reconciliation.approve_cache', 'wms.reconciliation.approve_business',
    'wms.reconciliation.apply', 'wms.reconciliation.rollback'
  ) then
    raise exception 'unsupported reconciliation permission code'
      using errcode = '22023';
  end if;

  v_scope := app_private.normalize_wms_reconciliation_scope(p_scope);

  if (v_scope -> 'warehouseIds') = '["*"]'::jsonb then
    if not app_private.has_permission(p_actor, p_permission_code, 'global', '*') then
      raise exception 'global reconciliation permission is required for wildcard scope'
        using errcode = '42501';
    end if;
  else
    for v_warehouse_id in
      select value from pg_catalog.jsonb_array_elements_text(v_scope -> 'warehouseIds') value
    loop
      if not exists (select 1 from public.warehouses warehouse where warehouse.id = v_warehouse_id) then
        raise exception 'warehouse does not exist: %', v_warehouse_id
          using errcode = 'P0002';
      end if;
      if not app_private.has_permission(
        p_actor, p_permission_code, 'warehouse', v_warehouse_id
      ) then
        raise exception 'missing reconciliation permission for warehouse %', v_warehouse_id
          using errcode = '42501';
      end if;
    end loop;
  end if;

  for v_item_id in
    select value from pg_catalog.jsonb_array_elements_text(v_scope -> 'itemIds') value
  loop
    if not exists (select 1 from public.items item where item.id = v_item_id) then
      raise exception 'item does not exist: %', v_item_id
        using errcode = 'P0002';
    end if;
  end loop;
end;
$$;

create or replace function app_private.can_view_wms_reconciliation_scope(
  p_actor uuid,
  p_scope jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_wms_reconciliation_permission(
    p_actor, 'wms.reconciliation.view', p_scope
  );
  return true;
exception
  when insufficient_privilege or no_data_found then
    return false;
end;
$$;

create or replace function app_private.preflight_wms_reconciliation_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required record;
  v_actual_type text;
  v_catalog jsonb;
begin
  for v_required in
    select *
    from (values
      ('public', 'transactions', 'id', 'text'),
      ('public', 'transactions', 'date', 'timestamp with time zone'),
      ('public', 'transactions', 'items', 'jsonb'),
      ('public', 'transactions', 'source_warehouse_id', 'text'),
      ('public', 'transactions', 'target_warehouse_id', 'text'),
      ('public', 'transactions', 'source_type', 'text'),
      ('public', 'transactions', 'source_id', 'text'),
      ('public', 'items', 'id', 'text'),
      ('public', 'items', 'stock_by_warehouse', 'jsonb'),
      ('public', 'warehouses', 'id', 'text'),
      ('public', 'requests', 'id', 'text'),
      ('public', 'requests', 'items', 'jsonb'),
      ('public', 'requests', 'source_warehouse_id', 'text'),
      ('public', 'requests', 'created_date', 'timestamp with time zone'),
      ('public', 'purchase_orders', 'id', 'text'),
      ('public', 'purchase_orders', 'items', 'jsonb'),
      ('public', 'purchase_orders', 'received_transaction_ids', 'jsonb'),
      ('public', 'audit_sessions', 'id', 'text'),
      ('public', 'audit_sessions', 'warehouseId', 'text'),
      ('public', 'audit_sessions', 'date', 'timestamp with time zone'),
      ('public', 'audit_sessions', 'items', 'jsonb'),
      ('public', 'audit_sessions', 'transactionId', 'text'),
      ('public', 'audit_sessions', 'command_id', 'uuid'),
      ('public', 'audit_sessions', 'request_hash', 'text'),
      ('public', 'audit_sessions', 'posting_engine_version', 'text'),
      ('public', 'inventory_transactions', 'id', 'uuid'),
      ('public', 'inventory_transactions', 'posted_at', 'timestamp with time zone'),
      ('public', 'inventory_transactions', 'created_at', 'timestamp with time zone'),
      ('public', 'inventory_ledger_entries', 'id', 'uuid'),
      ('public', 'inventory_ledger_entries', 'inventory_transaction_id', 'uuid'),
      ('public', 'inventory_ledger_entries', 'quantity_delta', 'numeric(20,6)'),
      ('public', 'inventory_ledger_entries', 'created_at', 'timestamp with time zone'),
      ('public', 'inventory_balances', 'id', 'uuid'),
      ('public', 'inventory_balances', 'on_hand_qty', 'numeric(20,6)'),
      ('public', 'project_opening_balances', 'id', 'uuid'),
      ('public', 'project_opening_balances', 'created_at', 'timestamp with time zone'),
      ('public', 'project_opening_balances', 'locked_at', 'timestamp with time zone'),
      ('public', 'project_opening_balances', 'reversed_at', 'timestamp with time zone'),
      ('public', 'project_opening_balance_lines', 'id', 'uuid'),
      ('public', 'project_opening_balance_lines', 'opening_balance_id', 'uuid'),
      ('public', 'project_opening_balance_lines', 'warehouse_id', 'text'),
      ('public', 'project_opening_balance_lines', 'remaining_qty', 'numeric'),
      ('public', 'material_request_fulfillment_batches', 'id', 'uuid'),
      ('public', 'material_request_fulfillment_batches', 'batch_date', 'timestamp with time zone'),
      ('public', 'material_request_fulfillment_batches', 'transaction_id', 'text'),
      ('public', 'material_request_fulfillment_batches', 'source_warehouse_id', 'text'),
      ('public', 'material_request_fulfillment_batches', 'target_warehouse_id', 'text'),
      ('public', 'material_request_fulfillment_lines', 'id', 'uuid'),
      ('public', 'material_request_fulfillment_lines', 'batch_id', 'uuid'),
      ('public', 'material_request_fulfillment_lines', 'item_id', 'text'),
      ('public', 'material_request_fulfillment_lines', 'po_id', 'text'),
      ('public', 'material_request_fulfillment_lines', 'po_line_id', 'text'),
      ('public', 'material_request_fulfillment_lines', 'issued_qty', 'numeric'),
      ('public', 'material_request_fulfillment_lines', 'received_qty', 'numeric'),
      ('public', 'material_request_fulfillment_lines', 'delivery_unit', 'text'),
      ('public', 'material_request_fulfillment_lines', 'delivery_unit_price', 'numeric'),
      ('public', 'material_request_fulfillment_lines', 'po_delivery_line_id', 'uuid'),
      ('public', 'purchase_order_delivery_batches', 'id', 'uuid'),
      ('public', 'purchase_order_delivery_batches', 'purchase_order_id', 'text'),
      ('public', 'purchase_order_delivery_batches', 'created_at', 'timestamp with time zone'),
      ('public', 'purchase_order_delivery_lines', 'id', 'uuid'),
      ('public', 'purchase_order_delivery_lines', 'delivery_batch_id', 'uuid'),
      ('public', 'purchase_order_delivery_lines', 'purchase_order_line_id', 'text'),
      ('public', 'purchase_order_delivery_lines', 'item_id', 'text'),
      ('public', 'purchase_order_delivery_lines', 'planned_qty', 'numeric'),
      ('public', 'purchase_order_delivery_lines', 'stock_planned_qty', 'numeric'),
      ('public', 'loss_norms', 'id', 'text'),
      ('public', 'loss_norms', 'item_id', 'text'),
      ('public', 'loss_norms', 'category_id', 'text'),
      ('public', 'loss_norms', 'allowed_percentage', 'numeric'),
      ('public', 'categories', 'id', 'text'),
      ('public', 'categories', 'name', 'text'),
      ('app_private', 'inventory_audit_command_results', 'command_id', 'uuid'),
      ('app_private', 'inventory_audit_command_results', 'created_at', 'timestamp with time zone')
    ) as required_column(schema_name, table_name, column_name, expected_type)
  loop
    if pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', v_required.schema_name, v_required.table_name)
    ) is null then
      raise exception 'required reconciliation source relation is missing: %.%',
        v_required.schema_name, v_required.table_name
        using errcode = 'P0002';
    end if;

    select pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
    into v_actual_type
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = pg_catalog.to_regclass(
        pg_catalog.format('%I.%I', v_required.schema_name, v_required.table_name)
      )
      and attribute.attname = v_required.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if v_actual_type is null then
      raise exception 'required reconciliation source column is missing: %.%.%',
        v_required.schema_name, v_required.table_name, v_required.column_name
        using errcode = 'P0002';
    end if;
    if v_actual_type is distinct from v_required.expected_type then
      raise exception 'reconciliation catalog drift at %.%.%: expected %, found %',
        v_required.schema_name, v_required.table_name, v_required.column_name,
        v_required.expected_type, v_actual_type
        using errcode = '55000';
    end if;
  end loop;

  if pg_catalog.to_regprocedure('app_private.sha256_text(text)') is null
     or pg_catalog.to_regprocedure('app_private.has_permission(uuid,text,text,text)') is null
     or pg_catalog.to_regprocedure('public.current_app_user_id()') is null
     or pg_catalog.to_regprocedure('public.process_transaction_status(text,public.transaction_status,uuid)') is null
     or pg_catalog.to_regprocedure('public.post_inventory_audit(uuid,text,timestamptz,jsonb)') is null
     or pg_catalog.to_regprocedure('public.lock_project_opening_balance(jsonb)') is null
     or pg_catalog.to_regprocedure('public.sync_fulfillment_receipt_for_transaction(text,uuid)') is null then
    raise exception 'required reconciliation source function is missing'
      using errcode = 'P0002';
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'relation', namespace.nspname || '.' || relation.relname,
      'column', attribute.attname,
      'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      'notNull', attribute.attnotnull
    ) order by namespace.nspname, relation.relname, attribute.attnum
  )
  into v_catalog
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  join pg_catalog.pg_attribute attribute on attribute.attrelid = relation.oid
  where namespace.nspname in ('public', 'app_private')
    and relation.relname in (
      'transactions', 'items', 'warehouses', 'requests', 'purchase_orders',
      'audit_sessions', 'inventory_transactions', 'inventory_ledger_entries',
      'inventory_balances', 'project_opening_balances',
      'project_opening_balance_lines', 'material_request_fulfillment_batches',
      'material_request_fulfillment_lines', 'purchase_order_delivery_batches',
      'purchase_order_delivery_lines', 'loss_norms', 'categories',
      'inventory_audit_command_results'
    )
    and attribute.attnum > 0
    and not attribute.attisdropped;

  return pg_catalog.jsonb_build_object(
    'schemaHash', app_private.sha256_text(coalesce(v_catalog, '[]'::jsonb)::text),
    'catalog', coalesce(v_catalog, '[]'::jsonb)
  );
end;
$$;

create or replace function app_private.wms_reconciliation_function_hash(
  p_function regprocedure
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.sha256_text(pg_catalog.pg_get_functiondef(p_function::oid));
$$;

create or replace function app_private.scan_wms_reconciliation_phase_physical_anchor(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'physical_anchor', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.scan_wms_reconciliation_phase_opening_balance(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'opening_balance', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.scan_wms_reconciliation_phase_transaction_ledger(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'transaction_ledger', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.scan_wms_reconciliation_phase_ledger_balance(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'ledger_balance', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.scan_wms_reconciliation_phase_stock_cache(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'stock_cache', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.scan_wms_reconciliation_phase_reservation(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'reservation', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.scan_wms_reconciliation_phase_batch(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'batch', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.scan_wms_reconciliation_phase_po_mr_uom(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'po_mr_uom', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.scan_wms_reconciliation_phase_lineage(
  p_run_id uuid, p_batch_size integer, p_cursor jsonb, p_source_snapshot jsonb
)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'cursor', pg_catalog.jsonb_build_object('phase', 'lineage', 'lastKey', p_cursor -> 'lastKey'),
    'processed', 0, 'complete', true
  );
$$;

create or replace function app_private.recheck_wms_reconciliation_finding(
  p_finding_id uuid,
  p_evidence jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'safe', false,
    'stale', false,
    'reason', 'verification algorithm pending B2b'
  );
$$;

create or replace function public.create_wms_reconciliation_run(
  p_scope jsonb,
  p_as_of timestamptz,
  p_policy_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_scope jsonb;
  v_created_at timestamptz := pg_catalog.clock_timestamp();
  v_catalog jsonb;
  v_function_hashes jsonb;
  v_policy_fingerprint text;
  v_source_snapshot jsonb;
  v_scope_hash text;
  v_function_hash text;
  v_run public.wms_reconciliation_runs%rowtype;
begin
  if p_as_of is null
     or not pg_catalog.isfinite(p_as_of)
     or p_as_of > pg_catalog.clock_timestamp() then
    raise exception 'as_of must be finite and cannot be in the future'
      using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(p_policy_version), '') is null then
    raise exception 'policy_version is required'
      using errcode = '22023';
  end if;
  if not coalesce((
    select setting.value
    from app_private.wms_reconciliation_settings setting
    where setting.key = 'scan_enabled'
  ), false) then
    raise exception 'WMS reconciliation scanning is disabled'
      using errcode = '55000';
  end if;

  v_catalog := app_private.preflight_wms_reconciliation_catalog();
  perform app_private.require_wms_reconciliation_permission(
    v_actor, 'wms.reconciliation.generate', p_scope
  );
  v_scope := app_private.normalize_wms_reconciliation_scope(p_scope);
  if (v_scope ->> 'affectedFrom')::timestamptz > p_as_of then
    raise exception 'affectedFrom cannot be later than as_of'
      using errcode = '22023';
  end if;

  select app_private.sha256_text(coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'unitKey', policy.unit_key,
        'version', policy.version,
        'maxFractionDigits', policy.max_fraction_digits,
        'roundingMode', policy.conversion_rounding_mode,
        'effectiveFrom', policy.effective_from,
        'effectiveTo', policy.effective_to
      ) order by policy.unit_key, policy.version
    ),
    '[]'::jsonb
  )::text)
  into v_policy_fingerprint
  from public.quantity_precision_policies policy
  where policy.lifecycle_status = 'active'
    and policy.effective_from <= v_created_at
    and (policy.effective_to is null or policy.effective_to > v_created_at);

  v_function_hashes := pg_catalog.jsonb_build_object(
    'posting', app_private.wms_reconciliation_function_hash(
      'public.process_transaction_status(text,public.transaction_status,uuid)'::regprocedure
    ),
    'audit', app_private.wms_reconciliation_function_hash(
      'public.post_inventory_audit(uuid,text,timestamptz,jsonb)'::regprocedure
    ),
    'opening', app_private.wms_reconciliation_function_hash(
      'public.lock_project_opening_balance(jsonb)'::regprocedure
    ),
    'fulfillmentReceipt', app_private.wms_reconciliation_function_hash(
      'public.sync_fulfillment_receipt_for_transaction(text,uuid)'::regprocedure
    ),
    'scanner', app_private.wms_reconciliation_function_hash(
      'public.scan_wms_reconciliation_run(uuid,integer)'::regprocedure
    ),
    'verify', app_private.wms_reconciliation_function_hash(
      'public.verify_wms_reconciliation_run(uuid)'::regprocedure
    )
  );
  v_function_hash := app_private.sha256_text(v_function_hashes::text);
  v_scope_hash := app_private.sha256_text(v_scope::text);

  v_source_snapshot := pg_catalog.jsonb_build_object(
    'createdAt', pg_catalog.to_jsonb(v_created_at),
    'asOf', pg_catalog.to_jsonb(p_as_of),
    'ledgerHeader', (
      select pg_catalog.jsonb_build_object(
        'maxCreatedAt', pg_catalog.max(header.created_at),
        'maxPostedAt', pg_catalog.max(header.posted_at),
        'maxId', pg_catalog.max(header.id::text)
      )
      from public.inventory_transactions header
      where header.created_at <= v_created_at
    ),
    'ledgerEntry', (
      select pg_catalog.jsonb_build_object(
        'maxCreatedAt', pg_catalog.max(entry.created_at),
        'maxId', pg_catalog.max(entry.id::text)
      )
      from public.inventory_ledger_entries entry
      where entry.created_at <= v_created_at
    ),
    'auditCommandCutoff', (
      select pg_catalog.jsonb_build_object(
        'maxCreatedAt', pg_catalog.max(command.created_at),
        'maxCommandId', pg_catalog.max(command.command_id::text)
      )
      from app_private.inventory_audit_command_results command
      where command.created_at <= v_created_at
    ),
    'openingCutoff', (
      select pg_catalog.jsonb_build_object(
        'maxCreatedAt', pg_catalog.max(opening.created_at),
        'maxLockedAt', pg_catalog.max(opening.locked_at),
        'maxReversedAt', pg_catalog.max(opening.reversed_at),
        'maxId', pg_catalog.max(opening.id::text)
      )
      from public.project_opening_balances opening
      where opening.created_at <= v_created_at
    ),
    'policyVersion', pg_catalog.btrim(p_policy_version),
    'activePolicyFingerprint', v_policy_fingerprint,
    'policyVersionExists', exists (
      select 1
      from public.quantity_precision_policies policy
      where policy.version::text = pg_catalog.btrim(p_policy_version)
    ),
    'schemaHash', v_catalog ->> 'schemaHash',
    'functionHashes', v_function_hashes
  );

  insert into public.wms_reconciliation_runs (
    scope, scope_hash, affected_from, as_of, policy_version,
    schema_hash, function_hash, source_snapshot, cursor,
    status, created_by, created_at, updated_at
  )
  values (
    v_scope,
    v_scope_hash,
    (v_scope ->> 'affectedFrom')::timestamptz,
    p_as_of,
    pg_catalog.btrim(p_policy_version),
    v_catalog ->> 'schemaHash',
    v_function_hash,
    v_source_snapshot,
    pg_catalog.jsonb_build_object('phase', 'physical_anchor', 'lastKey', null),
    'created',
    v_actor,
    v_created_at,
    v_created_at
  )
  returning * into v_run;

  return pg_catalog.jsonb_build_object(
    'id', v_run.id,
    'status', v_run.status,
    'scope', v_run.scope,
    'scopeHash', v_run.scope_hash,
    'asOf', v_run.as_of,
    'policyVersion', v_run.policy_version,
    'cursor', v_run.cursor,
    'sourceSnapshot', v_run.source_snapshot,
    'createdAt', v_run.created_at
  );
end;
$$;

create or replace function public.scan_wms_reconciliation_run(
  p_run_id uuid,
  p_batch_size integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_run public.wms_reconciliation_runs%rowtype;
  v_phase text;
  v_next_phase text;
  v_result jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception 'scan batch size must be between 1 and 500'
      using errcode = '22023';
  end if;
  if not coalesce((
    select setting.value
    from app_private.wms_reconciliation_settings setting
    where setting.key = 'scan_enabled'
  ), false) then
    raise exception 'WMS reconciliation scanning is disabled'
      using errcode = '55000';
  end if;

  select run.* into v_run
  from public.wms_reconciliation_runs run
  where run.id = p_run_id
  for update;
  if not found then
    raise exception 'WMS reconciliation run does not exist'
      using errcode = 'P0002';
  end if;

  perform app_private.require_wms_reconciliation_permission(
    v_actor, 'wms.reconciliation.generate', v_run.scope
  );
  if v_run.created_by is distinct from v_actor
     and not app_private.has_permission(
       v_actor, 'wms.reconciliation.generate', 'global', '*'
     ) then
    raise exception 'only the run owner or a global generator may resume this run'
      using errcode = '42501';
  end if;
  if v_run.status in ('scanned', 'verified') then
    return pg_catalog.jsonb_build_object(
      'id', v_run.id,
      'status', v_run.status,
      'cursor', v_run.cursor,
      'processed', 0,
      'complete', true
    );
  end if;
  if v_run.status not in ('created', 'scanning') then
    raise exception 'run cannot be scanned from status %', v_run.status
      using errcode = '55000';
  end if;

  v_phase := v_run.cursor ->> 'phase';
  case v_phase
    when 'physical_anchor' then
      v_result := app_private.scan_wms_reconciliation_phase_physical_anchor(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    when 'opening_balance' then
      v_result := app_private.scan_wms_reconciliation_phase_opening_balance(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    when 'transaction_ledger' then
      v_result := app_private.scan_wms_reconciliation_phase_transaction_ledger(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    when 'ledger_balance' then
      v_result := app_private.scan_wms_reconciliation_phase_ledger_balance(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    when 'stock_cache' then
      v_result := app_private.scan_wms_reconciliation_phase_stock_cache(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    when 'reservation' then
      v_result := app_private.scan_wms_reconciliation_phase_reservation(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    when 'batch' then
      v_result := app_private.scan_wms_reconciliation_phase_batch(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    when 'po_mr_uom' then
      v_result := app_private.scan_wms_reconciliation_phase_po_mr_uom(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    when 'lineage' then
      v_result := app_private.scan_wms_reconciliation_phase_lineage(
        v_run.id, p_batch_size, v_run.cursor, v_run.source_snapshot
      );
    else
      raise exception 'unknown reconciliation scan phase: %', coalesce(v_phase, '<null>')
        using errcode = '55000';
  end case;

  if coalesce((v_result ->> 'complete')::boolean, false) then
    v_next_phase := case v_phase
      when 'physical_anchor' then 'opening_balance'
      when 'opening_balance' then 'transaction_ledger'
      when 'transaction_ledger' then 'ledger_balance'
      when 'ledger_balance' then 'stock_cache'
      when 'stock_cache' then 'reservation'
      when 'reservation' then 'batch'
      when 'batch' then 'po_mr_uom'
      when 'po_mr_uom' then 'lineage'
      when 'lineage' then 'complete'
    end;
  else
    v_next_phase := v_phase;
  end if;

  if v_next_phase = 'complete' then
    update public.wms_reconciliation_runs run
    set cursor = pg_catalog.jsonb_build_object('phase', 'complete', 'lastKey', null),
        status = 'scanned',
        scan_started_at = coalesce(run.scan_started_at, v_now),
        scan_completed_at = v_now,
        updated_at = v_now
    where run.id = v_run.id
    returning * into v_run;
  else
    update public.wms_reconciliation_runs run
    set cursor = case
          when v_next_phase = v_phase then v_result -> 'cursor'
          else pg_catalog.jsonb_build_object('phase', v_next_phase, 'lastKey', null)
        end,
        status = 'scanning',
        scan_started_at = coalesce(run.scan_started_at, v_now),
        updated_at = v_now
    where run.id = v_run.id
    returning * into v_run;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_run.id,
    'status', v_run.status,
    'cursor', v_run.cursor,
    'processed', coalesce((v_result ->> 'processed')::integer, 0),
    'complete', v_run.status = 'scanned'
  );
end;
$$;

create or replace function public.verify_wms_reconciliation_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_run public.wms_reconciliation_runs%rowtype;
  v_finding record;
  v_recheck jsonb;
  v_run_hash text;
  v_verification_pending integer := 0;
  v_stale_count integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select run.* into v_run
  from public.wms_reconciliation_runs run
  where run.id = p_run_id
  for update;
  if not found then
    raise exception 'WMS reconciliation run does not exist'
      using errcode = 'P0002';
  end if;
  perform app_private.require_wms_reconciliation_permission(
    v_actor, 'wms.reconciliation.view', v_run.scope
  );
  if v_run.status not in ('scanned', 'approved', 'applied', 'verified') then
    raise exception 'run cannot be verified from status %', v_run.status
      using errcode = '55000';
  end if;

  for v_finding in
    select finding.id, finding.evidence
    from public.wms_reconciliation_findings finding
    where finding.run_id = v_run.id
      and finding.status not in ('rejected', 'quarantined')
    order by finding.id
  loop
    v_recheck := app_private.recheck_wms_reconciliation_finding(
      v_finding.id, v_finding.evidence
    );
    if coalesce((v_recheck ->> 'safe')::boolean, false) then
      if coalesce((v_recheck ->> 'stale')::boolean, false) then
        update public.wms_reconciliation_findings finding
        set status = 'stale'
        where finding.id = v_finding.id
          and finding.status <> 'stale';
        v_stale_count := v_stale_count + 1;
      end if;
    else
      v_verification_pending := v_verification_pending + 1;
    end if;
  end loop;

  select app_private.sha256_text(coalesce(
    pg_catalog.string_agg(
      finding.id::text || ':' || finding.precondition_hash,
      '|' order by finding.id
    ),
    ''
  ))
  into v_run_hash
  from public.wms_reconciliation_findings finding
  where finding.run_id = v_run.id;

  update public.wms_reconciliation_runs run
  set run_hash = v_run_hash,
      status = case
        when v_verification_pending = 0 and v_stale_count = 0 then 'verified'
        else run.status
      end,
      verified_at = case
        when v_verification_pending = 0 and v_stale_count = 0 then v_now
        else run.verified_at
      end,
      updated_at = v_now
  where run.id = v_run.id
  returning * into v_run;

  return pg_catalog.jsonb_build_object(
    'id', v_run.id,
    'status', v_run.status,
    'runHash', v_run.run_hash,
    'staleCount', v_stale_count,
    'verification_pending', v_verification_pending,
    'verifiedAt', v_run.verified_at
  );
end;
$$;

create or replace function public.list_wms_reconciliation_runs(
  p_scope jsonb default null,
  p_limit integer default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_scope jsonb;
  v_runs jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'run list limit must be between 1 and 100'
      using errcode = '22023';
  end if;
  if v_actor is null or not exists (
    select 1 from public.users user_row
    where user_row.id = v_actor and coalesce(user_row.is_active, false)
  ) then
    raise exception 'active application user is required'
      using errcode = '42501';
  end if;
  if p_before is not null and not pg_catalog.isfinite(p_before) then
    raise exception 'before cursor must be finite'
      using errcode = '22023';
  end if;

  if p_scope is not null then
    perform app_private.require_wms_reconciliation_permission(
      v_actor, 'wms.reconciliation.view', p_scope
    );
    v_scope := app_private.normalize_wms_reconciliation_scope(p_scope);
  end if;

  select coalesce(pg_catalog.jsonb_agg(row_payload order by created_at desc, id desc), '[]'::jsonb)
  into v_runs
  from (
    select
      run.id,
      run.created_at,
      pg_catalog.jsonb_build_object(
        'id', run.id,
        'scope', run.scope,
        'scopeHash', run.scope_hash,
        'asOf', run.as_of,
        'policyVersion', run.policy_version,
        'status', run.status,
        'cursor', run.cursor,
        'runHash', run.run_hash,
        'createdBy', run.created_by,
        'createdAt', run.created_at,
        'updatedAt', run.updated_at
      ) as row_payload
    from public.wms_reconciliation_runs run
    where app_private.can_view_wms_reconciliation_scope(v_actor, run.scope)
      and (p_before is null or run.created_at < p_before)
      and (
        v_scope is null
        or (v_scope -> 'warehouseIds') = '["*"]'::jsonb
        or (run.scope -> 'warehouseIds') = '["*"]'::jsonb
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements_text(run.scope -> 'warehouseIds') run_warehouse(value)
          join pg_catalog.jsonb_array_elements_text(v_scope -> 'warehouseIds') requested_warehouse(value)
            using (value)
        )
      )
      and (
        v_scope is null
        or pg_catalog.jsonb_array_length(v_scope -> 'itemIds') = 0
        or pg_catalog.jsonb_array_length(run.scope -> 'itemIds') = 0
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements_text(run.scope -> 'itemIds') run_item(value)
          join pg_catalog.jsonb_array_elements_text(v_scope -> 'itemIds') requested_item(value)
            using (value)
          )
      )
      and (
        v_scope is null
        or pg_catalog.jsonb_array_length(v_scope -> 'sourceTypes') = 0
        or pg_catalog.jsonb_array_length(run.scope -> 'sourceTypes') = 0
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements_text(run.scope -> 'sourceTypes') run_source(value)
          join pg_catalog.jsonb_array_elements_text(v_scope -> 'sourceTypes') requested_source(value)
            using (value)
        )
      )
    order by run.created_at desc, run.id desc
    limit p_limit
  ) bounded_runs;

  return pg_catalog.jsonb_build_object(
    'runs', v_runs,
    'count', pg_catalog.jsonb_array_length(v_runs),
    'nextBefore', case
      when pg_catalog.jsonb_array_length(v_runs) = p_limit
      then v_runs -> (pg_catalog.jsonb_array_length(v_runs) - 1) -> 'createdAt'
      else null
    end
  );
end;
$$;

create or replace function public.get_wms_reconciliation_workspace(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_run public.wms_reconciliation_runs%rowtype;
  v_findings jsonb;
  v_actions jsonb;
  v_approvals jsonb;
  v_finding_count integer;
  v_action_count integer;
begin
  select run.* into v_run
  from public.wms_reconciliation_runs run
  where run.id = p_run_id;
  if not found then
    raise exception 'WMS reconciliation run does not exist'
      using errcode = 'P0002';
  end if;
  perform app_private.require_wms_reconciliation_permission(
    v_actor, 'wms.reconciliation.view', v_run.scope
  );

  select pg_catalog.count(*)::integer
  into v_finding_count
  from public.wms_reconciliation_findings finding
  where finding.run_id = v_run.id;

  select coalesce(pg_catalog.jsonb_agg(payload order by created_at, id), '[]'::jsonb)
  into v_findings
  from (
    select
      finding.id,
      finding.created_at,
      pg_catalog.jsonb_build_object(
        'id', finding.id,
        'type', finding.finding_type,
        'severity', finding.severity,
        'confidence', finding.confidence,
        'itemId', finding.item_id,
        'warehouseId', finding.warehouse_id,
        'unit', finding.unit,
        'rawValueText', finding.raw_value_text,
        'beforeQty', app_private.wms_reconciliation_decimal_text(finding.before_qty),
        'expectedQty', app_private.wms_reconciliation_decimal_text(finding.expected_qty),
        'deltaQty', app_private.wms_reconciliation_decimal_text(finding.delta_qty),
        'evidence', app_private.canonicalize_wms_reconciliation_json_numbers(finding.evidence),
        'rawValues', app_private.canonicalize_wms_reconciliation_json_numbers(finding.raw_values),
        'blockers', app_private.canonicalize_wms_reconciliation_json_numbers(finding.blockers),
        'proposedAction', finding.proposed_action,
        'preconditionHash', finding.precondition_hash,
        'status', finding.status,
        'resolutionOwner', finding.resolution_owner,
        'quarantineReason', finding.quarantine_reason,
        'createdAt', finding.created_at
      ) as payload
    from public.wms_reconciliation_findings finding
    where finding.run_id = v_run.id
    order by finding.created_at, finding.id
    limit 500
  ) bounded_findings;

  select pg_catalog.count(*)::integer
  into v_action_count
  from public.wms_reconciliation_actions action
  join public.wms_reconciliation_findings finding on finding.id = action.finding_id
  where finding.run_id = v_run.id;

  select coalesce(pg_catalog.jsonb_agg(payload order by created_at, id), '[]'::jsonb)
  into v_actions
  from (
    select
      action.id,
      action.created_at,
      pg_catalog.jsonb_build_object(
        'id', action.id,
        'findingId', action.finding_id,
        'idempotencyKey', action.idempotency_key,
        'beforeState', app_private.canonicalize_wms_reconciliation_json_numbers(action.before_state),
        'afterState', app_private.canonicalize_wms_reconciliation_json_numbers(action.after_state),
        'preconditionHash', action.precondition_hash,
        'actorId', action.actor_id,
        'result', action.result,
        'errorText', action.error_text,
        'createdAt', action.created_at,
        'updatedAt', action.updated_at
      ) as payload
    from public.wms_reconciliation_actions action
    join public.wms_reconciliation_findings finding on finding.id = action.finding_id
    where finding.run_id = v_run.id
    order by action.created_at, action.id
    limit 500
  ) bounded_actions;

  select coalesce(pg_catalog.jsonb_agg(payload order by created_at, id), '[]'::jsonb)
  into v_approvals
  from (
    select
      approval.id,
      approval.created_at,
      pg_catalog.jsonb_build_object(
        'id', approval.id,
        'findingId', approval.finding_id,
        'kind', approval.kind,
        'decision', approval.decision,
        'reason', approval.reason,
        'actorId', approval.actor_id,
        'createdAt', approval.created_at
      ) as payload
    from public.wms_reconciliation_approvals approval
    join public.wms_reconciliation_findings finding on finding.id = approval.finding_id
    where finding.run_id = v_run.id
    order by approval.created_at, approval.id
    limit 500
  ) bounded_approvals;

  return pg_catalog.jsonb_build_object(
    'run', pg_catalog.jsonb_build_object(
      'id', v_run.id,
      'scope', v_run.scope,
      'scopeHash', v_run.scope_hash,
      'asOf', v_run.as_of,
      'policyVersion', v_run.policy_version,
      'status', v_run.status,
      'cursor', v_run.cursor,
      'runHash', v_run.run_hash,
      'sourceSnapshot', app_private.canonicalize_wms_reconciliation_json_numbers(v_run.source_snapshot),
      'createdBy', v_run.created_by,
      'createdAt', v_run.created_at,
      'updatedAt', v_run.updated_at
    ),
    'findings', v_findings,
    'findingCount', v_finding_count,
    'hasMoreFindings', v_finding_count > 500,
    'actions', v_actions,
    'actionCount', v_action_count,
    'hasMoreActions', v_action_count > 500,
    'approvals', v_approvals
  );
end;
$$;

revoke all on function
  app_private.wms_reconciliation_decimal_text(numeric),
  app_private.canonicalize_wms_reconciliation_json_numbers(jsonb),
  app_private.normalize_wms_reconciliation_scope(jsonb),
  app_private.require_wms_reconciliation_permission(uuid,text,jsonb),
  app_private.can_view_wms_reconciliation_scope(uuid,jsonb),
  app_private.preflight_wms_reconciliation_catalog(),
  app_private.wms_reconciliation_function_hash(regprocedure),
  app_private.scan_wms_reconciliation_phase_physical_anchor(uuid,integer,jsonb,jsonb),
  app_private.scan_wms_reconciliation_phase_opening_balance(uuid,integer,jsonb,jsonb),
  app_private.scan_wms_reconciliation_phase_transaction_ledger(uuid,integer,jsonb,jsonb),
  app_private.scan_wms_reconciliation_phase_ledger_balance(uuid,integer,jsonb,jsonb),
  app_private.scan_wms_reconciliation_phase_stock_cache(uuid,integer,jsonb,jsonb),
  app_private.scan_wms_reconciliation_phase_reservation(uuid,integer,jsonb,jsonb),
  app_private.scan_wms_reconciliation_phase_batch(uuid,integer,jsonb,jsonb),
  app_private.scan_wms_reconciliation_phase_po_mr_uom(uuid,integer,jsonb,jsonb),
  app_private.scan_wms_reconciliation_phase_lineage(uuid,integer,jsonb,jsonb),
  app_private.recheck_wms_reconciliation_finding(uuid,jsonb)
from public, anon, authenticated, service_role;

revoke all on function public.create_wms_reconciliation_run(jsonb,timestamptz,text)
  from public, anon, authenticated, service_role;
revoke all on function public.scan_wms_reconciliation_run(uuid,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.verify_wms_reconciliation_run(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_wms_reconciliation_runs(jsonb,integer,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.get_wms_reconciliation_workspace(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_wms_reconciliation_run(jsonb,timestamptz,text)
  to authenticated;
grant execute on function public.scan_wms_reconciliation_run(uuid,integer)
  to authenticated;
grant execute on function public.verify_wms_reconciliation_run(uuid)
  to authenticated;
grant execute on function public.list_wms_reconciliation_runs(jsonb,integer,timestamptz)
  to authenticated;
grant execute on function public.get_wms_reconciliation_workspace(uuid)
  to authenticated;

comment on function public.scan_wms_reconciliation_run(uuid,integer) is
  'B2a read-only scanner orchestration. Phase algorithms are introduced by B2b.';
comment on table app_private.wms_reconciliation_run_work is
  'Private run-scoped accumulators/evidence. No API or service role access.';
