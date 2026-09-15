-- Dedicated settlement capabilities must remain independent and warehouse
-- scoped. The command fixtures and temporary grants are rolled back.
begin;

create temporary table material_issue_settlement_capability_context (
  warehouse_id text not null,
  other_warehouse_id text not null,
  item_id text not null,
  order_id uuid not null,
  line_id uuid not null,
  denied_order_id uuid not null,
  denied_line_id uuid not null
) on commit drop;

insert into material_issue_settlement_capability_context
values (
  'task12-4-2-settle-wh-' || gen_random_uuid()::text,
  'task12-4-2-settle-other-wh-' || gen_random_uuid()::text,
  'task12-4-2-settle-item-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);

create temporary table material_issue_settlement_capability_actor (
  actor_kind text primary key,
  actor_id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into material_issue_settlement_capability_actor
select actor_kind, gen_random_uuid(), gen_random_uuid(),
       'task12-4-2-settle-' || actor_kind || '-' || gen_random_uuid()::text
         || '@vioo.local'
from (values
  ('settle_capability'),
  ('reverse_capability'),
  ('wrong_scope'),
  ('document_owner')
) actor(actor_kind);

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'Task 12.4.2 settlement warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from material_issue_settlement_capability_context
union all
select other_warehouse_id, 'Task 12.4.2 settlement other warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from material_issue_settlement_capability_context;

insert into public.users (
  id, name, email, username, role, is_active, account_status
)
select actor_id, 'Task 12.4.2 settlement ' || actor_kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from material_issue_settlement_capability_actor;

do $$
begin
  if not exists (
    select 1 from public.permission_actions
    where permission_code = 'wms.material_issue.settle'
      and module_code = 'wms.material_issue'
      and is_active
      and scope_modes = array['global', 'warehouse']::text[]
  ) then
    raise exception 'Missing settlement capability catalog action';
  end if;
  if not exists (
    select 1 from public.permission_actions
    where permission_code = 'wms.material_issue.reverse_settlement'
      and module_code = 'wms.material_issue'
      and is_active
      and scope_modes = array['global', 'warehouse']::text[]
      and direct_grant_requires_expiry
  ) then
    raise exception 'Missing sensitive settlement reversal catalog action';
  end if;
end $$;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, expires_at,
  grant_reason
)
select actor.actor_id, grant_row.permission_code, 'warehouse', grant_row.scope_id,
       true, now() + interval '1 hour',
       'Task 12.4.2 material issue settlement capability fixture'
from material_issue_settlement_capability_actor actor
join material_issue_settlement_capability_context context_row on true
cross join lateral (
  values
    ('settle_capability', 'wms.material_issue.settle', context_row.warehouse_id),
    ('reverse_capability', 'wms.material_issue.reverse_settlement', context_row.warehouse_id),
    ('wrong_scope', 'wms.material_issue.settle', context_row.other_warehouse_id),
    ('wrong_scope', 'wms.material_issue.reverse_settlement', context_row.other_warehouse_id)
) grant_row(actor_kind, permission_code, scope_id)
where grant_row.actor_kind = actor.actor_kind;

insert into public.items (
  id, sku, name, category, unit, price_in, price_out, min_stock,
  stock_by_warehouse
)
select item_id, 'TASK1242-SETTLE', 'Task 12.4.2 settlement item', 'Smoke',
       'Cái', 100, 100, 0, jsonb_build_object(warehouse_id, 100)
from material_issue_settlement_capability_context;

insert into public.material_issue_orders (
  id, issue_no, source_warehouse_id, recipient_type, recipient_name,
  status, created_by
)
select order_row.order_id,
       'TASK1242-' || upper(left(replace(order_row.order_id::text, '-', ''), 10)),
       context_row.warehouse_id,
       'manual',
       'External settlement recipient',
       'issued',
       owner.actor_id
from material_issue_settlement_capability_context context_row
join material_issue_settlement_capability_actor owner
  on owner.actor_kind = 'document_owner'
cross join lateral (values
  (context_row.order_id),
  (context_row.denied_order_id)
) order_row(order_id);

insert into public.material_issue_lines (
  id, issue_order_id, item_id, item_name_snapshot, unit, requested_qty,
  approved_qty, issued_qty, unit_price
)
select line_row.line_id, line_row.order_id, context_row.item_id,
       'Task 12.4.2 settlement item', 'Cái', 5, 5, 5, 100
from material_issue_settlement_capability_context context_row
cross join lateral (values
  (context_row.line_id, context_row.order_id),
  (context_row.denied_line_id, context_row.denied_order_id)
) line_row(line_id, order_id);

grant select on material_issue_settlement_capability_context to authenticated;
grant select on material_issue_settlement_capability_actor to authenticated;

set local role authenticated;

do $$
declare
  context_row material_issue_settlement_capability_context%rowtype;
  actor material_issue_settlement_capability_actor%rowtype;
  posted public.material_issue_settlements%rowtype;
  reversed public.material_issue_settlements%rowtype;
  blocked boolean;
begin
  select * into context_row from material_issue_settlement_capability_context;

  select * into actor from material_issue_settlement_capability_actor
  where actor_kind = 'settle_capability';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  posted := public.post_material_issue_settlement_v1(
    context_row.order_id,
    'consume',
    current_date,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', context_row.line_id,
      'quantity', 2
    )),
    'Canonical settlement capability',
    'task12-4-2-settle-' || gen_random_uuid()::text,
    '[]'::jsonb
  );
  if posted.status <> 'posted' then
    raise exception 'Canonical settlement capability did not post command';
  end if;

  blocked := false;
  begin
    perform public.reverse_material_issue_settlement_v1(
      posted.id,
      'Settle capability must not reverse',
      'task12-4-2-settle-wrong-reverse-' || gen_random_uuid()::text
    );
  exception when others then
    blocked := position('không có quyền hoàn tác quyết toán' in sqlerrm) > 0;
  end;
  if not blocked then
    raise exception 'Settlement capability unexpectedly reversed settlement';
  end if;

  select * into actor from material_issue_settlement_capability_actor
  where actor_kind = 'reverse_capability';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.post_material_issue_settlement_v1(
      context_row.denied_order_id,
      'loss',
      current_date,
      jsonb_build_array(jsonb_build_object(
        'issueLineId', context_row.denied_line_id,
        'quantity', 1
      )),
      'Reverse capability must not settle',
      'task12-4-2-reverse-wrong-settle-' || gen_random_uuid()::text,
      '[]'::jsonb
    );
  exception when others then
    blocked := position('không có quyền quyết toán phiếu' in sqlerrm) > 0;
  end;
  if not blocked then
    raise exception 'Settlement reversal capability unexpectedly posted settlement';
  end if;

  reversed := public.reverse_material_issue_settlement_v1(
    posted.id,
    'Canonical settlement reversal capability',
    'task12-4-2-reverse-' || gen_random_uuid()::text
  );
  if reversed.reversal_of_settlement_id is distinct from posted.id then
    raise exception 'Canonical settlement reversal did not create compensating record';
  end if;

  select * into actor from material_issue_settlement_capability_actor
  where actor_kind = 'wrong_scope';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.post_material_issue_settlement_v1(
      context_row.denied_order_id,
      'consume',
      current_date,
      jsonb_build_array(jsonb_build_object(
        'issueLineId', context_row.denied_line_id,
        'quantity', 1
      )),
      'Wrong warehouse must be denied',
      'task12-4-2-wrong-scope-' || gen_random_uuid()::text,
      '[]'::jsonb
    );
  exception when others then
    blocked := position('không có quyền quyết toán phiếu' in sqlerrm) > 0;
  end;
  if not blocked then
    raise exception 'Wrong-scope settlement capability unexpectedly posted';
  end if;
end $$;

rollback;
