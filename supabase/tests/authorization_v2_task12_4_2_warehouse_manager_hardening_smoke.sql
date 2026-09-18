-- E31 runtime proof for warehouse-scoped inventory editing and warehouse management.
-- All fixtures and mutations roll back.
begin;

do $$
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code in ('wms.inventory.edit', 'wms.master_data.manage')
      and grant_readiness = 'enforced'
      and scope_modes @> array['global', 'warehouse']::text[]
  ) <> 2 then
    raise exception 'E31 manager actions are not technically ready for global and warehouse scope';
  end if;
end;
$$;

create temporary table e31_manager_context (
  kind text primary key,
  user_id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into e31_manager_context
select kind, gen_random_uuid(), gen_random_uuid(),
       'e31-' || kind || '-' || gen_random_uuid()::text || '@vioo.local'
from (values ('manager'), ('operator'), ('global_admin')) actor(kind);

create temporary table e31_manager_resource (
  warehouse_a text not null,
  warehouse_b text not null,
  item_id text not null
) on commit drop;

insert into e31_manager_resource
values (
  'e31-warehouse-a-' || gen_random_uuid()::text,
  'e31-warehouse-b-' || gen_random_uuid()::text,
  'e31-item-' || gen_random_uuid()::text
);

insert into public.warehouses(id, name, address, type)
select warehouse_a, 'E31 Warehouse A', 'E31 A', 'GENERAL'
from e31_manager_resource
union all
select warehouse_b, 'E31 Warehouse B', 'E31 B', 'GENERAL'
from e31_manager_resource;

insert into public.items(
  id, sku, name, category, unit, price_in, price_out, min_stock, stock_by_warehouse
)
select item_id, item_id, 'E31 Item', 'E31', 'cai', 1, 1, 0,
       jsonb_build_object(warehouse_a, 10, warehouse_b, 20)
from e31_manager_resource;

insert into public.users(id, name, email, username, role, is_active, account_status)
select user_id, 'E31 ' || kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from e31_manager_context;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor.user_id, permission.permission_code, permission.scope_type,
       case when permission.scope_type = 'global' then '*' else resource.warehouse_a end,
       true, 'E31 warehouse manager hardening smoke'
from e31_manager_context actor
cross join e31_manager_resource resource
join (values
  ('manager', 'wms.inventory.view', 'warehouse'),
  ('manager', 'wms.inventory.edit', 'warehouse'),
  ('manager', 'wms.master_data.manage', 'warehouse'),
  ('operator', 'wms.inventory.view', 'warehouse'),
  ('global_admin', 'wms.inventory.edit', 'global'),
  ('global_admin', 'wms.master_data.manage', 'global')
) permission(kind, permission_code, scope_type)
  on permission.kind = actor.kind;

grant select on e31_manager_context, e31_manager_resource to authenticated;

set local role authenticated;

do $$
declare
  manager_row e31_manager_context%rowtype;
  operator_row e31_manager_context%rowtype;
  global_row e31_manager_context%rowtype;
  resource_row e31_manager_resource%rowtype;
  receipt jsonb;
  affected integer;
  blocked boolean;
begin
  select * into manager_row from e31_manager_context where kind = 'manager';
  select * into operator_row from e31_manager_context where kind = 'operator';
  select * into global_row from e31_manager_context where kind = 'global_admin';
  select * into resource_row from e31_manager_resource;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', manager_row.auth_id, 'email', manager_row.email, 'role', 'authenticated'
  )::text, true);

  if (select count(*) from public.warehouses
      where id in (resource_row.warehouse_a, resource_row.warehouse_b)) <> 1
     or not exists (
       select 1 from public.warehouses where id = resource_row.warehouse_a
     ) then
    raise exception 'E31 manager warehouse visibility is not scoped to warehouse A';
  end if;

  receipt := public.adjust_inventory_stock(
    resource_row.item_id, resource_row.warehouse_a, 15, 10,
    'E31 bounded stock correction for warehouse A'
  );
  if (receipt->>'quantity')::numeric <> 15
     or (select (stock_by_warehouse->>resource_row.warehouse_a)::numeric
         from public.items where id = resource_row.item_id) <> 15
     or (select (stock_by_warehouse->>resource_row.warehouse_b)::numeric
         from public.items where id = resource_row.item_id) <> 20
     or not exists (
       select 1 from public.permission_audit_events
       where actor_user_id = manager_row.user_id
         and event_type = 'wms_inventory_stock_adjusted'
         and metadata->>'scopeId' = resource_row.warehouse_a
     ) then
    raise exception 'E31 scoped stock adjustment or audit failed';
  end if;

  blocked := false;
  begin
    perform public.adjust_inventory_stock(
      resource_row.item_id, resource_row.warehouse_b, 25, 20,
      'E31 wrong warehouse adjustment must fail'
    );
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'E31 manager adjusted warehouse B'; end if;

  blocked := false;
  begin
    perform public.adjust_inventory_stock(
      resource_row.item_id, resource_row.warehouse_a, 16, 10,
      'E31 stale expected quantity must fail'
    );
  exception when serialization_failure then blocked := true;
  end;
  if not blocked then raise exception 'E31 stale inventory adjustment was accepted'; end if;

  blocked := false;
  begin
    perform public.apply_stock_change(resource_row.item_id, resource_row.warehouse_a, 1::numeric);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'E31 raw stock primitive remains executable'; end if;

  update public.warehouses set address = 'E31 A updated'
  where id = resource_row.warehouse_a;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'E31 manager could not update warehouse A'; end if;

  update public.warehouses set address = 'E31 B forbidden'
  where id = resource_row.warehouse_b;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'E31 manager updated warehouse B'; end if;

  update public.items set name = 'E31 crafted global metadata change'
  where id = resource_row.item_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'E31 warehouse manager edited global item metadata'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', operator_row.auth_id, 'email', operator_row.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.adjust_inventory_stock(
      resource_row.item_id, resource_row.warehouse_a, 16, 15,
      'E31 operator stock adjustment must fail'
    );
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'E31 operator received manager inventory edit'; end if;

  update public.warehouses set address = 'E31 operator forbidden'
  where id = resource_row.warehouse_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'E31 operator updated warehouse metadata'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', global_row.auth_id, 'email', global_row.email, 'role', 'authenticated'
  )::text, true);

  update public.items set name = 'E31 global catalog update'
  where id = resource_row.item_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'E31 global inventory editor could not update item metadata'; end if;

  update public.warehouses set address = 'E31 global warehouse update'
  where id = resource_row.warehouse_b;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'E31 global master-data admin could not update warehouse B'; end if;
end;
$$;

reset role;

select 'authorization_v2_task12_4_2_warehouse_manager_hardening_smoke_passed' result;
rollback;
