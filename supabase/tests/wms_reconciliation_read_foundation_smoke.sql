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

create temporary table reconciliation_smoke_context (
  actor_id uuid not null,
  auth_id uuid not null,
  run_id uuid
) on commit drop;

insert into reconciliation_smoke_context (actor_id, auth_id)
select user_row.id, user_row.auth_id
from public.users user_row
where coalesce(user_row.is_active, false)
  and user_row.auth_id is not null
order by user_row.id
limit 1;

do $$
begin
  if not exists (select 1 from reconciliation_smoke_context) then
    raise exception 'B2a smoke requires one active application user with auth_id'
      using errcode = 'P0002';
  end if;
end;
$$;

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, granted_by
)
select context.actor_id, permission.permission_code, 'global', '*', true, context.actor_id
from reconciliation_smoke_context context
cross join (
  values ('wms.reconciliation.generate'), ('wms.reconciliation.view')
) as permission(permission_code)
on conflict (user_id, permission_code, scope_type, scope_id)
do update set is_active = true, expires_at = null;

update app_private.wms_reconciliation_settings
set value = true
where key = 'scan_enabled';

grant select, update on table reconciliation_smoke_context to authenticated;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  (select auth_id::text from reconciliation_smoke_context),
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', (select auth_id::text from reconciliation_smoke_context),
    'role', 'authenticated'
  )::text,
  true
);
select pg_catalog.set_config(
  'app.actor_id',
  (select actor_id::text from reconciliation_smoke_context),
  true
);

set local role authenticated;
do $$
declare
  v_run jsonb;
  v_scan jsonb;
  v_verified jsonb;
  v_scan_step integer;
begin
  v_run := public.create_wms_reconciliation_run(
    '{"warehouseIds":["*"]}'::jsonb,
    pg_catalog.now(),
    'smoke'
  );
  update reconciliation_smoke_context
  set run_id = (v_run ->> 'id')::uuid;

  for v_scan_step in 1..9 loop
    v_scan := public.scan_wms_reconciliation_run(
      (select run_id from reconciliation_smoke_context),
      500
    );
    if (v_scan ->> 'processed')::integer <> 0 then
      raise exception 'B2a shell scan unexpectedly processed source rows';
    end if;
  end loop;

  if v_scan ->> 'status' <> 'scanned'
     or not coalesce((v_scan ->> 'complete')::boolean, false) then
    raise exception 'B2a scan lifecycle did not complete after nine phases: %', v_scan;
  end if;

  v_verified := public.verify_wms_reconciliation_run(
    (select run_id from reconciliation_smoke_context)
  );
  if v_verified ->> 'status' <> 'verified'
     or v_verified ->> 'verifiedAt' is null then
    raise exception 'B2a empty run did not verify successfully: %', v_verified;
  end if;
end;
$$;
reset role;

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
