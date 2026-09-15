-- Cloud main only. No business writes; temporary catalog edit rolls back.
begin;
create temporary table wms_catalog_actor on commit drop as
select id, auth_id from public.users
where role::text = 'ADMIN' and is_active and account_status = 'ACTIVE'
  and auth_id is not null
order by id limit 1;
do $$ begin
  if not exists (select 1 from wms_catalog_actor) then
    raise exception 'WMS catalog smoke requires an active admin fixture';
  end if;
end $$;
select set_config('request.jwt.claim.sub', auth_id::text, true) from wms_catalog_actor;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$ begin
  if app_private.wms_has_action('wms.inventory.view') is not true then
    raise exception 'Known active WMS action regressed';
  end if;
  if app_private.wms_has_action('wms.unknown_action.for_smoke') is not false then
    raise exception 'Unknown WMS action was authorized through a legacy fallback';
  end if;
  if app_private.wms_has_action(null) is not false then
    raise exception 'Null WMS action did not fail closed';
  end if;
  if app_private.wms_has_action('request.template.manage') is not false then
    raise exception 'Non-WMS action was authorized by the WMS helper';
  end if;
end $$;
reset role;
update public.permission_actions set is_active = false
where permission_code = 'wms.inventory.view';
set local role authenticated;
do $$ begin
  if app_private.wms_has_action('wms.inventory.view') is not false then
    raise exception 'Inactive WMS action was authorized through a legacy fallback';
  end if;
end $$;
reset role;
rollback;
