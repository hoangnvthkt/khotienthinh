begin;

create temporary table reconciliation_source_counts_before on commit drop as
select
  (select pg_catalog.count(*) from public.transactions) as wms_transactions,
  (select pg_catalog.count(*) from public.inventory_transactions) as ledger_headers,
  (select pg_catalog.count(*) from public.inventory_ledger_entries) as ledger_entries,
  (select pg_catalog.count(*) from public.inventory_balances) as balances,
  (select pg_catalog.count(*) from public.items) as items;

do $$
begin
  if pg_catalog.has_function_privilege(
    'anon', 'public.create_wms_reconciliation_run(jsonb,timestamptz,text)', 'EXECUTE'
  ) then
    raise exception 'anon must not execute reconciliation create';
  end if;
  if not pg_catalog.has_function_privilege(
    'authenticated', 'public.scan_wms_reconciliation_run(uuid,integer)', 'EXECUTE'
  ) then
    raise exception 'authenticated must execute the scan RPC';
  end if;
  if pg_catalog.has_function_privilege(
    'authenticated', 'app_private.require_wms_reconciliation_permission(uuid,text,jsonb)', 'EXECUTE'
  ) then
    raise exception 'authenticated must not execute reconciliation private helpers';
  end if;
  if pg_catalog.has_table_privilege(
    'service_role', 'app_private.wms_reconciliation_run_work', 'SELECT'
  ) then
    raise exception 'service_role must not read reconciliation work rows';
  end if;
end;
$$;

set local role anon;
do $$
begin
  perform public.verify_wms_reconciliation_run(pg_catalog.gen_random_uuid());
  raise exception 'anon unexpectedly executed reconciliation verify';
exception
  when insufficient_privilege then null;
end;
$$;
reset role;

set local role authenticated;
do $$
begin
  perform app_private.normalize_wms_reconciliation_scope(
    '{"warehouseIds":["*"]}'::jsonb
  );
  raise exception 'authenticated unexpectedly executed a private scope helper';
exception
  when insufficient_privilege then null;
end;
$$;
reset role;

do $$
begin
  begin
    perform app_private.normalize_wms_reconciliation_scope(
      '{"warehouseIds":["WH-1","WH-1"]}'::jsonb
    );
    raise exception 'duplicate warehouseIds unexpectedly accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform app_private.normalize_wms_reconciliation_scope(
      '{"warehouseIds":["*","WH-1"]}'::jsonb
    );
    raise exception 'mixed wildcard warehouseIds unexpectedly accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.scan_wms_reconciliation_run(pg_catalog.gen_random_uuid(), 501);
    raise exception 'p_batch_size 501 unexpectedly accepted';
  exception when sqlstate '22023' then null;
  end;
end;
$$;

update app_private.wms_reconciliation_settings
set value = false
where key = 'scan_enabled';

do $$
begin
  begin
    perform public.create_wms_reconciliation_run(
      '{"warehouseIds":["*"]}'::jsonb,
      pg_catalog.now(),
      'smoke'
    );
    raise exception 'disabled scan gate unexpectedly allowed create';
  exception when sqlstate '55000' then null;
  end;
end;
$$;

do $$
declare
  v_default text;
  v_not_null boolean;
begin
  select pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid), attribute.attnotnull
  into v_default, v_not_null
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
  where attribute.attrelid = 'public.wms_reconciliation_runs'::regclass
    and attribute.attname = 'source_snapshot';

  if not coalesce(v_not_null, false) or v_default is null then
    raise exception 'frozen source_snapshot must be NOT NULL with a default';
  end if;
end;
$$;

do $$
declare
  v_before reconciliation_source_counts_before%rowtype;
  v_after reconciliation_source_counts_before%rowtype;
begin
  select * into v_before from reconciliation_source_counts_before;
  select
    (select pg_catalog.count(*) from public.transactions),
    (select pg_catalog.count(*) from public.inventory_transactions),
    (select pg_catalog.count(*) from public.inventory_ledger_entries),
    (select pg_catalog.count(*) from public.inventory_balances),
    (select pg_catalog.count(*) from public.items)
  into v_after;

  if v_before is distinct from v_after then
    raise exception 'B2a smoke mutated a WMS source table';
  end if;
end;
$$;

rollback;
