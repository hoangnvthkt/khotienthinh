begin;

do $$
declare
  candidate record;
  actor_row record;
  denied_actor uuid;
  allowed_found boolean := false;
begin
  for candidate in
    select request_row.project_id, request_row.construction_site_id,
      request_row.site_warehouse_id, line.value ->> 'itemId' item_id
    from public.requests request_row
    join public.warehouses warehouse on warehouse.id = request_row.site_warehouse_id
      and warehouse.type = 'SITE' and warehouse.project_id = request_row.project_id
      and (request_row.construction_site_id is null
        or warehouse.construction_site_id::text = request_row.construction_site_id)
    cross join lateral jsonb_array_elements(coalesce(request_row.items, '[]'::jsonb)) line(value)
    where request_row.request_origin = 'project'
      and line.value ->> 'itemId' is not null
    limit 100
  loop
    for actor_row in
      select auth_id from public.users
      where auth_id is not null and is_active and account_status = 'ACTIVE'
      order by id limit 200
    loop
      perform set_config('request.jwt.claim.sub', actor_row.auth_id::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object(
        'sub', actor_row.auth_id, 'role', 'authenticated'
      )::text, true);
      if app_private.current_actor_has_effective_room_action(
        candidate.project_id, candidate.construction_site_id,
        'material_request', 'view_available_stock'
      ) then
        perform set_config('smoke.project_id', candidate.project_id, true);
        perform set_config('smoke.site_id', coalesce(candidate.construction_site_id, ''), true);
        perform set_config('smoke.warehouse_id', candidate.site_warehouse_id, true);
        perform set_config('smoke.item_id', candidate.item_id, true);
        perform set_config('smoke.allowed_auth_id', actor_row.auth_id::text, true);
        allowed_found := true;
        exit;
      end if;
      if denied_actor is null then denied_actor := actor_row.auth_id; end if;
    end loop;
    exit when allowed_found;
  end loop;
  if not allowed_found then raise exception 'No permitted real actor/site request found'; end if;
  perform set_config('smoke.denied_auth_id', coalesce(denied_actor::text, ''), true);
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('smoke.allowed_auth_id'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('smoke.allowed_auth_id'), 'role', 'authenticated'
)::text, true);
set local role authenticated;

do $$
declare
  result jsonb;
  denied boolean := false;
begin
  result := public.get_project_material_request_site_stock_context_v1(
    current_setting('smoke.project_id'), nullif(current_setting('smoke.site_id'), ''),
    current_setting('smoke.warehouse_id'), array[current_setting('smoke.item_id')]
  );
  if result ->> 'metricVersion' <> 'project.site-stock.g6.v1'
     or jsonb_array_length(result -> 'rows') <> 1 then
    raise exception 'Permitted stock read returned an invalid response';
  end if;
  begin
    perform public.get_project_material_request_site_stock_context_v1(
      'outside-project', null, current_setting('smoke.warehouse_id'),
      array[current_setting('smoke.item_id')]
    );
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Cross-project stock read was not denied'; end if;
end;
$$;

reset role;
insert into public.wms_inventory_reconciliation_issues(
  material_id, warehouse_id, classification, ledger_qty, status
)
values (
  current_setting('smoke.item_id'), current_setting('smoke.warehouse_id'),
  'cache', 0, 'open'
)
on conflict do nothing;
set local role authenticated;

do $$
declare
  result jsonb;
begin
  result := public.get_project_material_request_site_stock_context_v1(
    current_setting('smoke.project_id'), nullif(current_setting('smoke.site_id'), ''),
    current_setting('smoke.warehouse_id'), array[current_setting('smoke.item_id')]
  );
  if result -> 'rows' -> 0 ->> 'availableQty' is not null then
    raise exception 'Open reconciliation issue did not make availability unknown';
  end if;
end;
$$;

reset role;
do $$
begin
  if has_function_privilege('anon',
    'public.get_project_material_request_site_stock_context_v1(text,text,text,text[])',
    'EXECUTE') then
    raise exception 'Anonymous stock access was not denied';
  end if;
end;
$$;

select 'permitted_read_cross_project_denial_unknown_and_anon_acl_passed' as result;
rollback;
