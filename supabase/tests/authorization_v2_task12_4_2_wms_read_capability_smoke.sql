-- Canonical WMS read grants must reach their resource helpers. All writes roll back.
begin;

create temporary table wms_read_actor on commit drop as
select u.id, u.auth_id, warehouse.id::text as warehouse_id
from public.users u
cross join lateral (
  select id from public.warehouses order by id limit 1
) warehouse
where u.role::text = 'EMPLOYEE'
  and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
  and not ('WMS' = any(coalesce(u.allowed_modules, '{}'::text[])))
  and not ('WMS' = any(coalesce(u.admin_modules, '{}'::text[])))
  and not (coalesce(u.allowed_sub_modules, '{}'::jsonb) ? 'WMS')
  and not (coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'WMS')
  and not exists (
    select 1 from public.user_permission_grants grant_row
    where grant_row.user_id = u.id
      and grant_row.permission_code in ('wms.inventory.view', 'wms.transaction.view')
      and grant_row.scope_type = 'warehouse'
      and grant_row.scope_id = warehouse.id::text
  )
order by u.id limit 1;

do $$ begin
  if not exists (select 1 from wms_read_actor) then
    raise exception 'WMS read capability smoke requires an isolated employee fixture';
  end if;
end $$;

grant select on wms_read_actor to authenticated;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select id, permission_code, 'warehouse', warehouse_id, true,
       'Task 12.4.2 canonical WMS read fixture'
from wms_read_actor
cross join (values ('wms.inventory.view'), ('wms.transaction.view')) permission(permission_code);

select set_config('request.jwt.claim.sub', auth_id::text, true) from wms_read_actor;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  actor wms_read_actor%rowtype;
  unrelated_user uuid := gen_random_uuid();
begin
  select * into actor from wms_read_actor;
  if app_private.can_read_inventory_scope(actor.warehouse_id, unrelated_user, unrelated_user) is not true then
    raise exception 'Canonical inventory view did not reach inventory scope helper';
  end if;
  if app_private.material_issue_can_view(
    gen_random_uuid()::text, gen_random_uuid()::text, actor.warehouse_id,
    unrelated_user, unrelated_user, 'team', gen_random_uuid()::text
  ) is not true then
    raise exception 'Canonical transaction view did not reach material issue helper';
  end if;
end $$;

reset role;
rollback;
