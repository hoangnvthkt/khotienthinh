-- The supplier-return command must use its own warehouse-scoped capability.
-- Generic WMS transaction creation must not imply supplier return authority.
begin;

create temporary table supplier_return_capability_context (
  warehouse_id text not null,
  other_warehouse_id text not null,
  item_id text not null,
  purchase_order_id text not null,
  purchase_order_line_id text not null
) on commit drop;

insert into supplier_return_capability_context
values (
  'task12-4-2-supplier-return-wh-' || gen_random_uuid()::text,
  'task12-4-2-supplier-return-other-wh-' || gen_random_uuid()::text,
  'task12-4-2-supplier-return-item-' || gen_random_uuid()::text,
  'task12-4-2-supplier-return-po-' || gen_random_uuid()::text,
  'task12-4-2-supplier-return-line-' || gen_random_uuid()::text
);

create temporary table supplier_return_capability_actor (
  actor_kind text primary key,
  actor_id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

create temporary table supplier_return_capability_result (
  supplier_return_id uuid not null,
  transaction_id text not null,
  actor_id uuid not null,
  warehouse_id text not null
) on commit drop;

insert into supplier_return_capability_actor
select actor_kind, gen_random_uuid(), gen_random_uuid(),
       'task12-4-2-supplier-return-' || actor_kind || '-'
         || gen_random_uuid()::text || '@vioo.local'
from (values
  ('return_capability'),
  ('wrong_scope'),
  ('generic_transaction_create')
) actor(actor_kind);

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'Task 12.4.2 supplier return warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from supplier_return_capability_context
union all
select other_warehouse_id,
       'Task 12.4.2 supplier return other warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from supplier_return_capability_context;

insert into public.users (
  id, name, email, username, role, is_active, account_status
)
select actor_id, 'Task 12.4.2 supplier return ' || actor_kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from supplier_return_capability_actor;

do $$
begin
  if not exists (
    select 1
    from public.permission_actions
    where permission_code = 'wms.purchase_order.return_supplier'
      and module_code = 'wms.purchase_order'
      and is_active
      and scope_modes = array['global', 'warehouse']::text[]
      and grant_readiness = 'enforced'
      and direct_grant_allowed
  ) then
    raise exception 'Missing dedicated supplier-return capability';
  end if;
end $$;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor.actor_id, grant_row.permission_code, 'warehouse', grant_row.scope_id,
       true, 'Task 12.4.2 supplier-return capability fixture'
from supplier_return_capability_actor actor
join supplier_return_capability_context context_row on true
cross join lateral (
  values
    ('return_capability', 'wms.purchase_order.return_supplier', context_row.warehouse_id),
    ('wrong_scope', 'wms.purchase_order.return_supplier', context_row.other_warehouse_id),
    ('generic_transaction_create', 'wms.transaction.create', context_row.warehouse_id)
) grant_row(actor_kind, permission_code, scope_id)
where grant_row.actor_kind = actor.actor_kind;

insert into public.items (
  id, sku, name, category, unit, price_in, price_out, min_stock,
  stock_by_warehouse
)
select item_id, 'TASK1242-SUPPLIER-RETURN',
       'Task 12.4.2 supplier return item', 'Smoke', 'Cái', 100, 100, 0,
       jsonb_build_object(warehouse_id, 20)
from supplier_return_capability_context;

insert into public.purchase_orders (
  id, vendor_id, vendor_name, po_number, items, total_amount, order_date,
  status, target_warehouse_id, source_mode
)
select purchase_order_id, 'task12-4-2-supplier-return-vendor',
       'Task 12.4.2 supplier',
       public.next_purchase_order_number_v2(),
       jsonb_build_array(jsonb_build_object(
         'lineId', purchase_order_line_id,
         'itemId', item_id,
         'sku', 'TASK1242-SUPPLIER-RETURN',
         'name', 'Task 12.4.2 supplier return item',
         'unit', 'Cái',
         'receivedQty', 10,
         'returnedQty', 0,
         'unitPrice', 100
       )),
       1000, current_date::text, 'delivered', warehouse_id, 'proactive_stock'
from supplier_return_capability_context;

grant select on supplier_return_capability_context to authenticated;
grant select on supplier_return_capability_actor to authenticated;
grant insert on supplier_return_capability_result to authenticated;

set local role authenticated;

do $$
declare
  context_row supplier_return_capability_context%rowtype;
  actor supplier_return_capability_actor%rowtype;
  created_return public.purchase_order_supplier_returns%rowtype;
  blocked boolean;
begin
  select * into context_row from supplier_return_capability_context;

  select * into actor from supplier_return_capability_actor
  where actor_kind = 'return_capability';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  created_return := public.create_purchase_order_supplier_return(
    context_row.purchase_order_id,
    context_row.warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', context_row.purchase_order_line_id,
      'quantity', 2
    )),
    'Dedicated supplier-return capability smoke',
    'Task 12.4.2'
  );
  if created_return.status <> 'pending'
     or created_return.source_warehouse_id <> context_row.warehouse_id
     or created_return.created_by <> actor.actor_id then
    raise exception 'Dedicated supplier-return capability did not create pending WMS export';
  end if;
  insert into supplier_return_capability_result
  values (
    created_return.id,
    created_return.transaction_id,
    actor.actor_id,
    context_row.warehouse_id
  );

  select * into actor from supplier_return_capability_actor
  where actor_kind = 'wrong_scope';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.create_purchase_order_supplier_return(
      context_row.purchase_order_id,
      context_row.warehouse_id,
      jsonb_build_array(jsonb_build_object(
        'purchaseOrderLineId', context_row.purchase_order_line_id,
        'quantity', 1
      )),
      'Wrong warehouse must be denied',
      'Task 12.4.2'
    );
  exception when others then
    blocked := position('không có quyền trả hàng ncc' in lower(sqlerrm)) > 0;
  end;
  if not blocked then
    raise exception 'Wrong-scope supplier-return capability unexpectedly created return';
  end if;

  select * into actor from supplier_return_capability_actor
  where actor_kind = 'generic_transaction_create';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.create_purchase_order_supplier_return(
      context_row.purchase_order_id,
      context_row.warehouse_id,
      jsonb_build_array(jsonb_build_object(
        'purchaseOrderLineId', context_row.purchase_order_line_id,
        'quantity', 1
      )),
      'Generic transaction create must be denied',
      'Task 12.4.2'
    );
  exception when others then
    blocked := position('không có quyền trả hàng ncc' in lower(sqlerrm)) > 0;
  end;
  if not blocked then
    raise exception 'Generic WMS create unexpectedly implied supplier-return capability';
  end if;
end $$;

reset role;

do $$
begin
  if not exists (
    select 1
    from supplier_return_capability_result result_row
    join public.purchase_order_supplier_returns supplier_return
      on supplier_return.id = result_row.supplier_return_id
    join public.transactions transaction_row
      on transaction_row.id = result_row.transaction_id
    where supplier_return.status = 'pending'
      and transaction_row.requester_id = result_row.actor_id
      and transaction_row.source_warehouse_id = result_row.warehouse_id
      and transaction_row.status = 'PENDING'::public.transaction_status
  ) then
    raise exception 'Supplier-return capability command did not persist its pending WMS export atomically';
  end if;
end $$;

rollback;
