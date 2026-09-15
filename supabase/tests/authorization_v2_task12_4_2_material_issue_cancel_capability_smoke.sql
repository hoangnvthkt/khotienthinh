-- A pre-issue cancellation follows the approval/rejection boundary. It must
-- not inherit the post-issue reversal capability. All fixtures roll back.
begin;

create temporary table material_issue_cancel_context (
  warehouse_id text not null,
  other_warehouse_id text not null,
  item_id text not null,
  canonical_order_id uuid not null,
  canonical_transaction_id text not null,
  wrong_scope_order_id uuid not null,
  reverse_only_order_id uuid not null,
  creator_order_id uuid not null
) on commit drop;

insert into material_issue_cancel_context
values (
  'task12-4-2-cancel-wh-' || gen_random_uuid()::text,
  'task12-4-2-cancel-other-wh-' || gen_random_uuid()::text,
  'task12-4-2-cancel-item-' || gen_random_uuid()::text,
  gen_random_uuid(),
  'task12-4-2-cancel-tx-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

create temporary table material_issue_cancel_actor (
  actor_kind text primary key,
  actor_id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into material_issue_cancel_actor
select actor_kind, gen_random_uuid(), gen_random_uuid(),
       'task12-4-2-cancel-' || actor_kind || '-' || gen_random_uuid()::text
         || '@vioo.local'
from (values
  ('approve_capability'),
  ('wrong_scope'),
  ('reverse_only'),
  ('creator'),
  ('outsider')
) actor(actor_kind);

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'Task 12.4.2 cancel warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from material_issue_cancel_context
union all
select other_warehouse_id, 'Task 12.4.2 cancel other warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from material_issue_cancel_context;

insert into public.users (
  id, name, email, username, role, is_active, account_status
)
select actor_id, 'Task 12.4.2 cancel ' || actor_kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from material_issue_cancel_actor;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, expires_at,
  grant_reason
)
select actor.actor_id, grant_row.permission_code, 'warehouse', grant_row.scope_id,
       true, now() + interval '1 hour',
       'Task 12.4.2 material issue cancel capability fixture'
from material_issue_cancel_actor actor
join material_issue_cancel_context context_row on true
cross join lateral (
  values
    ('approve_capability', 'wms.transaction.approve', context_row.warehouse_id),
    ('wrong_scope', 'wms.transaction.approve', context_row.other_warehouse_id),
    ('reverse_only', 'wms.transaction.reverse', context_row.warehouse_id),
    ('outsider', 'wms.transaction.create', context_row.warehouse_id),
    ('outsider', 'wms.transaction.complete', context_row.warehouse_id)
) grant_row(actor_kind, permission_code, scope_id)
where grant_row.actor_kind = actor.actor_kind;

insert into public.items (
  id, sku, name, category, unit, price_in, price_out, min_stock,
  stock_by_warehouse
)
select item_id, 'TASK1242-CANCEL', 'Task 12.4.2 cancel item', 'Smoke',
       'Cái', 100, 100, 0, jsonb_build_object(warehouse_id, 100)
from material_issue_cancel_context;

insert into public.material_issue_orders (
  id, issue_no, source_warehouse_id, recipient_type, recipient_name,
  status, created_by
)
select order_row.order_id,
       'TASK1242-' || upper(left(replace(order_row.order_id::text, '-', ''), 10)),
       context_row.warehouse_id,
       'manual',
       'Task 12.4.2 cancel recipient',
       order_row.order_status,
       creator.actor_id
from material_issue_cancel_context context_row
join material_issue_cancel_actor creator on creator.actor_kind = 'creator'
cross join lateral (
  values
    (context_row.canonical_order_id, 'wms_pending'),
    (context_row.wrong_scope_order_id, 'submitted'),
    (context_row.reverse_only_order_id, 'submitted'),
    (context_row.creator_order_id, 'draft')
) order_row(order_id, order_status);

insert into public.transactions (
  id, type, date, items, source_warehouse_id, requester_id, status,
  pending_items, source_type, source_id, business_event_type
)
select context_row.canonical_transaction_id,
       'EXPORT'::public.transaction_type,
       now(),
       jsonb_build_array(jsonb_build_object(
         'itemId', context_row.item_id,
         'quantity', 1,
         'price', 100,
         'materialIssueOrderId', context_row.canonical_order_id
       )),
       context_row.warehouse_id,
       creator.actor_id,
       'PENDING'::public.transaction_status,
       '[]'::jsonb,
       'material_issue_order',
       context_row.canonical_order_id::text,
       'construction_issue'
from material_issue_cancel_context context_row
join material_issue_cancel_actor creator on creator.actor_kind = 'creator';

update public.material_issue_orders issue_order
set transaction_id = context_row.canonical_transaction_id
from material_issue_cancel_context context_row
where issue_order.id = context_row.canonical_order_id;

do $$
begin
  if to_regprocedure(
    'app_private.material_issue_can_cancel(text,uuid)'
  ) is null then
    raise exception 'Missing action-specific material issue cancel helper';
  end if;
  if has_function_privilege(
    'authenticated',
    'app_private.material_issue_can_cancel(text,uuid)',
    'execute'
  ) then
    raise exception 'Authenticated can invoke private cancel helper';
  end if;
  if position(
    'app_private.material_issue_can_cancel' in
    pg_get_functiondef(
      'public.cancel_material_issue_order(uuid,text)'::regprocedure
    )
  ) = 0 then
    raise exception 'Cancel command is not wired to its action-specific helper';
  end if;
end $$;

grant select on material_issue_cancel_context to authenticated;
grant select on material_issue_cancel_actor to authenticated;
grant execute on function app_private.material_issue_can_cancel(text, uuid)
  to authenticated;

set local role authenticated;

do $$
declare
  context_row material_issue_cancel_context%rowtype;
  actor material_issue_cancel_actor%rowtype;
  creator_id uuid;
  expected boolean;
  actual boolean;
  blocked boolean;
begin
  select * into context_row from material_issue_cancel_context;
  select actor_id into creator_id
  from material_issue_cancel_actor where actor_kind = 'creator';

  for actor in select * from material_issue_cancel_actor order by actor_kind loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', actor.auth_id,
        'email', actor.email,
        'role', 'authenticated'
      )::text,
      true
    );
    expected := actor.actor_kind in ('approve_capability', 'creator');
    actual := app_private.material_issue_can_cancel(
      context_row.warehouse_id,
      creator_id
    );
    if actual is distinct from expected then
      raise exception 'Unexpected cancel helper decision for actor %', actor.actor_kind;
    end if;
  end loop;

  select * into actor
  from material_issue_cancel_actor
  where actor_kind = 'approve_capability';
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor.auth_id, 'email', actor.email,
      'role', 'authenticated')::text,
    true
  );
  perform public.cancel_material_issue_order(
    context_row.canonical_order_id,
    'Canonical approve rejects pre-issue document'
  );
  select * into actor
  from material_issue_cancel_actor
  where actor_kind = 'wrong_scope';
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor.auth_id, 'email', actor.email,
      'role', 'authenticated')::text,
    true
  );
  blocked := false;
  begin
    perform public.cancel_material_issue_order(
      context_row.wrong_scope_order_id,
      'Wrong warehouse must be denied'
    );
  exception when others then
    blocked := position('không có quyền huỷ phiếu' in sqlerrm) > 0;
  end;
  if not blocked then
    raise exception 'Wrong-warehouse approve unexpectedly cancelled order';
  end if;

  select * into actor
  from material_issue_cancel_actor
  where actor_kind = 'reverse_only';
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor.auth_id, 'email', actor.email,
      'role', 'authenticated')::text,
    true
  );
  blocked := false;
  begin
    perform public.cancel_material_issue_order(
      context_row.reverse_only_order_id,
      'Reverse capability must not cancel pre-issue order'
    );
  exception when others then
    blocked := position('không có quyền huỷ phiếu' in sqlerrm) > 0;
  end;
  if not blocked then
    raise exception 'Reverse-only actor unexpectedly cancelled pre-issue order';
  end if;

  select * into actor
  from material_issue_cancel_actor
  where actor_kind = 'creator';
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor.auth_id, 'email', actor.email,
      'role', 'authenticated')::text,
    true
  );
  perform public.cancel_material_issue_order(
    context_row.creator_order_id,
    'Creator retains cancellation access'
  );
end $$;

reset role;

do $$
declare
  context_row material_issue_cancel_context%rowtype;
  canonical_actor_id uuid;
begin
  select * into context_row from material_issue_cancel_context;
  select actor_id into canonical_actor_id
  from material_issue_cancel_actor
  where actor_kind = 'approve_capability';

  if (
    select status from public.material_issue_orders
    where id = context_row.canonical_order_id
  ) <> 'cancelled' then
    raise exception 'Canonical approve did not cancel material issue order';
  end if;
  if (
    select status from public.transactions
    where id = context_row.canonical_transaction_id
  ) <> 'CANCELLED' then
    raise exception 'Canonical approve did not cancel pending WMS transaction';
  end if;
  if (
    select approver_id from public.transactions
    where id = context_row.canonical_transaction_id
  ) is distinct from canonical_actor_id then
    raise exception 'Cancel command did not record the authenticated actor';
  end if;
  if (
    select cancelled_by from public.material_issue_orders
    where id = context_row.creator_order_id
  ) is distinct from (
    select actor_id from material_issue_cancel_actor where actor_kind = 'creator'
  ) then
    raise exception 'Creator cancellation did not preserve self access';
  end if;
end $$;

rollback;
