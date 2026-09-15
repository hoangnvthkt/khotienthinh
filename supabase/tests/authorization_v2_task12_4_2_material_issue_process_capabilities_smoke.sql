-- Verify that each material-issue processing boundary has its own authorization
-- contract. All fixture writes and temporary EXECUTE grants roll back.
begin;

create temporary table material_issue_process_actor (
  actor_kind text primary key,
  actor_id uuid not null,
  auth_id uuid not null,
  email text not null,
  actor_role public.user_role not null,
  assigned_warehouse_id text
) on commit drop;

create temporary table material_issue_process_context (
  warehouse_id text not null,
  other_warehouse_id text not null,
  item_id text not null,
  receipt_order_id uuid not null,
  receipt_line_id uuid not null,
  denied_receipt_order_id uuid not null,
  denied_receipt_line_id uuid not null,
  return_order_id uuid not null,
  return_line_id uuid not null,
  denied_return_order_id uuid not null,
  denied_return_line_id uuid not null
) on commit drop;

insert into material_issue_process_context
values (
  'task12-4-2-process-wh-' || gen_random_uuid()::text,
  'task12-4-2-process-other-wh-' || gen_random_uuid()::text,
  'task12-4-2-process-item-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid()
);

insert into material_issue_process_actor (
  actor_kind, actor_id, auth_id, email, actor_role, assigned_warehouse_id
)
select actor_kind,
       gen_random_uuid(),
       gen_random_uuid(),
       'task12-4-2-process-' || actor_kind || '-' || gen_random_uuid()::text || '@vioo.local',
       actor_role,
       assigned_warehouse_id
from material_issue_process_context context_row
cross join lateral (
  values
    ('complete_capability', 'EMPLOYEE'::public.user_role, null::text),
    ('create_capability', 'EMPLOYEE'::public.user_role, null::text),
    ('wrong_scope', 'EMPLOYEE'::public.user_role, null::text),
    ('creator', 'EMPLOYEE'::public.user_role, null::text),
    ('responsible', 'EMPLOYEE'::public.user_role, null::text),
    ('employee_recipient', 'EMPLOYEE'::public.user_role, null::text),
    ('keeper', 'WAREHOUSE_KEEPER'::public.user_role, context_row.warehouse_id),
    ('wrong_keeper', 'WAREHOUSE_KEEPER'::public.user_role, context_row.other_warehouse_id),
    ('outsider', 'EMPLOYEE'::public.user_role, null::text)
) actor(actor_kind, actor_role, assigned_warehouse_id);

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'Task 12.4.2 process warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from material_issue_process_context
union all
select other_warehouse_id, 'Task 12.4.2 process other warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from material_issue_process_context;

insert into public.users (
  id, name, email, username, role, assigned_warehouse_id,
  is_active, account_status
)
select actor_id, 'Task 12.4.2 process ' || actor_kind, email, email,
       actor_role, assigned_warehouse_id, true, 'ACTIVE'
from material_issue_process_actor;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, expires_at,
  grant_reason
)
select actor.actor_id, grant_row.permission_code, 'warehouse', grant_row.scope_id,
       true, now() + interval '1 hour',
       'Task 12.4.2 material issue process capability fixture'
from material_issue_process_actor actor
join material_issue_process_context context_row on true
cross join lateral (
  values
    ('complete_capability', 'wms.transaction.complete', context_row.warehouse_id),
    ('create_capability', 'wms.transaction.create', context_row.warehouse_id),
    ('wrong_scope', 'wms.transaction.complete', context_row.other_warehouse_id),
    ('wrong_scope', 'wms.transaction.create', context_row.other_warehouse_id),
    ('outsider', 'wms.transaction.approve', context_row.warehouse_id),
  ('outsider', 'wms.transaction.reverse', context_row.warehouse_id)
) grant_row(actor_kind, permission_code, scope_id)
where grant_row.actor_kind = actor.actor_kind;

insert into public.items (
  id, sku, name, category, unit, price_in, price_out, min_stock,
  stock_by_warehouse
)
select item_id, 'TASK1242-PROCESS', 'Task 12.4.2 process item', 'Smoke',
       'Cái', 100, 100, 0, jsonb_build_object(warehouse_id, 100)
from material_issue_process_context;

insert into public.material_issue_orders (
  id, issue_no, source_warehouse_id, recipient_type, recipient_id,
  recipient_name, responsible_user_id, status, created_by
)
select order_row.order_id,
       'TASK1242-' || upper(left(replace(order_row.order_id::text, '-', ''), 10)),
       context_row.warehouse_id,
       'employee',
       recipient.actor_id::text,
       'Task 12.4.2 process recipient',
       responsible.actor_id,
       'issued',
       creator.actor_id
from material_issue_process_context context_row
join material_issue_process_actor creator on creator.actor_kind = 'creator'
join material_issue_process_actor responsible on responsible.actor_kind = 'responsible'
join material_issue_process_actor recipient on recipient.actor_kind = 'employee_recipient'
cross join lateral (
  values
    (context_row.receipt_order_id),
    (context_row.denied_receipt_order_id),
    (context_row.return_order_id),
    (context_row.denied_return_order_id)
) order_row(order_id);

insert into public.material_issue_lines (
  id, issue_order_id, item_id, item_name_snapshot, unit, requested_qty,
  approved_qty, issued_qty, unit_price
)
select line_row.line_id, line_row.order_id, context_row.item_id,
       'Task 12.4.2 process item', 'Cái', 5, 5, 5, 100
from material_issue_process_context context_row
cross join lateral (
  values
    (context_row.receipt_line_id, context_row.receipt_order_id),
    (context_row.denied_receipt_line_id, context_row.denied_receipt_order_id),
    (context_row.return_line_id, context_row.return_order_id),
    (context_row.denied_return_line_id, context_row.denied_return_order_id)
) line_row(line_id, order_id);

do $$
declare
  helper_name text;
begin
  foreach helper_name in array array[
    'app_private.material_issue_has_process_compatibility_access(text,uuid,uuid,text,text)',
    'app_private.material_issue_can_confirm_receipt(text,uuid,uuid,text,text)',
    'app_private.material_issue_can_create_return(text,uuid,uuid,text,text)',
    'app_private.material_issue_can_post_settlement(text,uuid,uuid,text,text)',
    'app_private.material_issue_can_reverse_settlement(text,uuid,uuid,text,text)'
  ] loop
    if to_regprocedure(helper_name) is null then
      raise exception 'Missing action-specific helper: %', helper_name;
    end if;
    if has_function_privilege('authenticated', helper_name, 'execute') then
      raise exception 'Authenticated can invoke private helper: %', helper_name;
    end if;
  end loop;

  if to_regprocedure(
    'app_private.material_issue_can_process(text,uuid,uuid,text,text)'
  ) is not null then
    raise exception 'Shared material_issue_can_process helper was not retired';
  end if;

  if position(
    'app_private.material_issue_can_confirm_receipt' in
    pg_get_functiondef(
      'public.confirm_material_issue_receipt(uuid,jsonb,text,jsonb,text)'::regprocedure
    )
  ) = 0 then
    raise exception 'Receipt command is not wired to its action-specific helper';
  end if;

  if position(
    'app_private.material_issue_can_create_return' in
    pg_get_functiondef(
      'app_private.create_material_issue_return_v2_impl(uuid,uuid,text,jsonb,text,text,text)'::regprocedure
    )
  ) = 0 then
    raise exception 'Return command is not wired to its action-specific helper';
  end if;

  if position(
    'app_private.material_issue_can_post_settlement' in
    pg_get_functiondef(
      'public.post_material_issue_settlement_v1(uuid,text,date,jsonb,text,text,jsonb)'::regprocedure
    )
  ) = 0 then
    raise exception 'Settlement command is not wired to its action-specific helper';
  end if;

  if position(
    'app_private.material_issue_can_reverse_settlement' in
    pg_get_functiondef(
      'public.reverse_material_issue_settlement_v1(uuid,text,text)'::regprocedure
    )
  ) = 0 then
    raise exception 'Settlement reversal is not wired to its action-specific helper';
  end if;
end $$;

grant select on material_issue_process_actor to authenticated;
grant select on material_issue_process_context to authenticated;
grant execute on function app_private.material_issue_can_confirm_receipt(
  text, uuid, uuid, text, text
) to authenticated;
grant execute on function app_private.material_issue_can_create_return(
  text, uuid, uuid, text, text
) to authenticated;
grant execute on function app_private.material_issue_can_post_settlement(
  text, uuid, uuid, text, text
) to authenticated;
grant execute on function app_private.material_issue_can_reverse_settlement(
  text, uuid, uuid, text, text
) to authenticated;

set local role authenticated;

do $$
declare
  context_row material_issue_process_context%rowtype;
  actor material_issue_process_actor%rowtype;
  creator_id uuid;
  responsible_id uuid;
  recipient_id uuid;
  expected_compatibility boolean;
  expected_receipt boolean;
  expected_return boolean;
  actual_receipt boolean;
  actual_return boolean;
  actual_post boolean;
  actual_reverse boolean;
begin
  select * into context_row from material_issue_process_context;
  select actor_id into creator_id
  from material_issue_process_actor where actor_kind = 'creator';
  select actor_id into responsible_id
  from material_issue_process_actor where actor_kind = 'responsible';
  select actor_id into recipient_id
  from material_issue_process_actor where actor_kind = 'employee_recipient';

  for actor in
    select * from material_issue_process_actor order by actor_kind
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', actor.auth_id,
        'email', actor.email,
        'role', 'authenticated'
      )::text,
      true
    );

    expected_compatibility := actor.actor_kind in (
      'creator', 'responsible', 'employee_recipient', 'keeper'
    );
    expected_receipt := expected_compatibility
      or actor.actor_kind = 'complete_capability';
    expected_return := expected_compatibility
      or actor.actor_kind = 'create_capability';

    actual_receipt := app_private.material_issue_can_confirm_receipt(
      context_row.warehouse_id,
      creator_id,
      responsible_id,
      'employee',
      recipient_id::text
    );
    actual_return := app_private.material_issue_can_create_return(
      context_row.warehouse_id,
      creator_id,
      responsible_id,
      'employee',
      recipient_id::text
    );
    actual_post := app_private.material_issue_can_post_settlement(
      context_row.warehouse_id,
      creator_id,
      responsible_id,
      'employee',
      recipient_id::text
    );
    actual_reverse := app_private.material_issue_can_reverse_settlement(
      context_row.warehouse_id,
      creator_id,
      responsible_id,
      'employee',
      recipient_id::text
    );

    if actual_receipt is distinct from expected_receipt then
      raise exception 'Unexpected receipt decision for actor %', actor.actor_kind;
    end if;
    if actual_return is distinct from expected_return then
      raise exception 'Unexpected return decision for actor %', actor.actor_kind;
    end if;
    if actual_post is distinct from expected_compatibility then
      raise exception 'Unexpected settlement decision for actor %', actor.actor_kind;
    end if;
    if actual_reverse is distinct from expected_compatibility then
      raise exception 'Unexpected settlement reversal decision for actor %', actor.actor_kind;
    end if;
  end loop;
end $$;

do $$
declare
  context_row material_issue_process_context%rowtype;
  actor material_issue_process_actor%rowtype;
  blocked boolean;
  created_return public.material_issue_returns%rowtype;
begin
  select * into context_row from material_issue_process_context;

  select * into actor
  from material_issue_process_actor
  where actor_kind = 'complete_capability';
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', actor.auth_id,
      'email', actor.email,
      'role', 'authenticated'
    )::text,
    true
  );
  perform public.confirm_material_issue_receipt(
    context_row.receipt_order_id,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', context_row.receipt_line_id,
      'receivedQty', 1
    )),
    'Canonical complete receipt',
    '[]'::jsonb,
    null
  );
  if (
    select received_qty
    from public.material_issue_lines
    where id = context_row.receipt_line_id
  ) <> 1 then
    raise exception 'Canonical complete did not execute the receipt command';
  end if;

  select * into actor
  from material_issue_process_actor
  where actor_kind = 'wrong_scope';
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', actor.auth_id,
      'email', actor.email,
      'role', 'authenticated'
    )::text,
    true
  );
  blocked := false;
  begin
    perform public.confirm_material_issue_receipt(
      context_row.denied_receipt_order_id,
      jsonb_build_array(jsonb_build_object(
        'issueLineId', context_row.denied_receipt_line_id,
        'receivedQty', 1
      )),
      'Wrong scope receipt',
      '[]'::jsonb,
      null
    );
  exception when others then
    blocked := position('không có quyền xác nhận' in sqlerrm) > 0;
  end;
  if not blocked then
    raise exception 'Wrong-warehouse complete unexpectedly executed receipt';
  end if;

  select * into actor
  from material_issue_process_actor
  where actor_kind = 'create_capability';
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', actor.auth_id,
      'email', actor.email,
      'role', 'authenticated'
    )::text,
    true
  );
  created_return := public.create_material_issue_return_v2(
    context_row.return_order_id,
    context_row.warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', context_row.return_line_id,
      'returnQty', 1,
      'reason', 'Canonical create return'
    )),
    'Canonical create return',
    null,
    'task12-4-2-process-create-return'
  );
  if created_return.created_by is distinct from actor.actor_id
     or created_return.status <> 'pending' then
    raise exception 'Canonical create did not execute the return command';
  end if;

  select * into actor
  from material_issue_process_actor
  where actor_kind = 'wrong_scope';
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', actor.auth_id,
      'email', actor.email,
      'role', 'authenticated'
    )::text,
    true
  );
  blocked := false;
  begin
    perform public.create_material_issue_return_v2(
      context_row.denied_return_order_id,
      context_row.warehouse_id,
      jsonb_build_array(jsonb_build_object(
        'issueLineId', context_row.denied_return_line_id,
        'returnQty', 1,
        'reason', 'Wrong scope return'
      )),
      'Wrong scope return',
      null,
      'task12-4-2-process-denied-return'
    );
  exception when others then
    blocked := position('không có quyền tạo phiếu hoàn trả' in sqlerrm) > 0;
  end;
  if not blocked then
    raise exception 'Wrong-warehouse create unexpectedly executed return';
  end if;
end $$;

reset role;
rollback;
