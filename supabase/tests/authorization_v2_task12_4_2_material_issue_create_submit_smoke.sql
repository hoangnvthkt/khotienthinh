-- Canonical wms.transaction.create must authorize material issue creation and
-- submission only at the granted source warehouse. All fixtures roll back.
begin;

create temporary table material_issue_create_submit_actor (
  actor_id uuid not null,
  actor_email text not null,
  wrong_actor_id uuid not null,
  wrong_actor_email text not null,
  warehouse_id text not null,
  other_warehouse_id text not null,
  item_id text not null
) on commit drop;

insert into material_issue_create_submit_actor
values (
  gen_random_uuid(),
  'task12-4-2-issue-create-' || gen_random_uuid()::text || '@vioo.local',
  gen_random_uuid(),
  'task12-4-2-issue-wrong-' || gen_random_uuid()::text || '@vioo.local',
  'task12-4-2-issue-wh-' || gen_random_uuid()::text,
  'task12-4-2-issue-other-wh-' || gen_random_uuid()::text,
  'task12-4-2-issue-item-' || gen_random_uuid()::text
);

grant select on material_issue_create_submit_actor to authenticated;

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'Task 12.4.2 material issue warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from material_issue_create_submit_actor
union all
select other_warehouse_id, 'Task 12.4.2 material issue other warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from material_issue_create_submit_actor;

insert into public.users (
  id, name, email, username, role, is_active, account_status
)
select actor_id, 'Task 12.4.2 material issue actor', actor_email,
       actor_email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from material_issue_create_submit_actor
union all
select wrong_actor_id, 'Task 12.4.2 material issue wrong actor',
       wrong_actor_email, wrong_actor_email, 'EMPLOYEE'::public.user_role,
       true, 'ACTIVE'
from material_issue_create_submit_actor;

insert into public.items (
  id, sku, name, category, unit, price_in, price_out, min_stock,
  stock_by_warehouse
)
select item_id, 'TASK1242-ISSUE', 'Task 12.4.2 material issue item', 'Smoke',
       'Cái', 100, 100, 0, jsonb_build_object(warehouse_id, 100)
from material_issue_create_submit_actor;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, expires_at,
  grant_reason
)
select actor_id, 'wms.transaction.create', 'warehouse', warehouse_id, true,
       now() + interval '1 hour', 'Task 12.4.2 material issue create fixture'
from material_issue_create_submit_actor
union all
select wrong_actor_id, 'wms.transaction.create', 'warehouse', other_warehouse_id,
       true, now() + interval '1 hour',
       'Task 12.4.2 material issue wrong-scope fixture'
from material_issue_create_submit_actor;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'app_private.wms_has_canonical_action(text,text,text,uuid,uuid,uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'app_private.material_issue_can_create(text,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'app_private.material_issue_can_submit(text,text,text,uuid)',
    'execute'
  ) then
    raise exception 'Authenticated can invoke a private material-issue helper';
  end if;
end $$;

set local role authenticated;

do $$
declare
  fixture material_issue_create_submit_actor%rowtype;
  created_order public.material_issue_orders%rowtype;
  submitted_order public.material_issue_orders%rowtype;
begin
  select * into fixture from material_issue_create_submit_actor;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', gen_random_uuid(),
      'email', fixture.actor_email,
      'role', 'authenticated'
    )::text,
    true
  );

  created_order := public.create_material_issue_order(
    null,
    null,
    fixture.warehouse_id,
    'employee',
    fixture.actor_id::text,
    'Task 12.4.2 recipient',
    fixture.actor_id,
    null,
    null,
    null,
    current_date,
    'Canonical create smoke',
    jsonb_build_array(jsonb_build_object(
      'itemId', fixture.item_id,
      'quantity', 2,
      'unit', 'Cái',
      'unitPrice', 100
    )),
    null,
    null
  );

  if created_order.created_by is distinct from fixture.actor_id
     or created_order.status <> 'draft' then
    raise exception 'Canonical create returned an invalid material issue order';
  end if;

  submitted_order := public.submit_material_issue_order(
    created_order.id,
    null
  );

  if submitted_order.status <> 'wms_pending'
     or submitted_order.transaction_id is null then
    raise exception 'Canonical create grant did not submit the material issue order';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', gen_random_uuid(),
      'email', fixture.wrong_actor_email,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.create_material_issue_order(
      null,
      null,
      fixture.warehouse_id,
      'employee',
      fixture.wrong_actor_id::text,
      'Task 12.4.2 wrong-scope recipient',
      fixture.wrong_actor_id,
      null,
      null,
      null,
      current_date,
      'Wrong scope smoke',
      jsonb_build_array(jsonb_build_object(
        'itemId', fixture.item_id,
        'quantity', 1,
        'unit', 'Cái',
        'unitPrice', 100
      )),
      null,
      null
    );
    raise exception 'Wrong-warehouse create grant unexpectedly created an order';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

reset role;
rollback;
