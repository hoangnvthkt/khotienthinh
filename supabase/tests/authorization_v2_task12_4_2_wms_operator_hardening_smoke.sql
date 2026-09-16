-- E29: WAREHOUSE_OPERATOR exact action/scope smoke. All fixture writes roll back.
begin;

create temporary table wms_operator_fixture on commit drop as
select
  u.id as actor_id,
  u.auth_id,
  other_user.id as other_user_id,
  warehouse_a.id::text as warehouse_a_id,
  warehouse_b.id::text as warehouse_b_id,
  'e29-request-' || gen_random_uuid()::text as request_id,
  'e29-transition-' || gen_random_uuid()::text as transition_request_id,
  'e29-scope-' || gen_random_uuid()::text as scope_request_id,
  'e29-tx-' || gen_random_uuid()::text as transaction_id
from public.users u
cross join lateral (
  select id from public.users candidate
  where candidate.id <> u.id
  order by id limit 1
) other_user
cross join lateral (
  select id from public.warehouses order by id limit 1
) warehouse_a
cross join lateral (
  select id from public.warehouses where id <> warehouse_a.id order by id limit 1
) warehouse_b
where u.role::text = 'EMPLOYEE'
  and u.is_active
  and u.account_status = 'ACTIVE'
  and u.auth_id is not null
  and not ('WMS' = any(coalesce(u.allowed_modules, '{}'::text[])))
  and not ('WMS' = any(coalesce(u.admin_modules, '{}'::text[])))
  and not (coalesce(u.allowed_sub_modules, '{}'::jsonb) ? 'WMS')
  and not (coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'WMS')
order by u.id
limit 1;

do $$ begin
  if not exists (select 1 from wms_operator_fixture) then
    raise exception 'E29 smoke requires an isolated employee, two warehouses, and another user';
  end if;
end $$;

grant select on wms_operator_fixture to authenticated;
select set_config('app.authorization_permission_command', 'on', true);

insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, expires_at, grant_reason
)
select fixture.actor_id, action.permission_code, 'warehouse', fixture.warehouse_a_id,
       true, now() + interval '1 hour', 'Task 12.4.2 E29 warehouse-operator fixture'
from wms_operator_fixture fixture
cross join (values
  ('wms.inventory.view'),
  ('wms.request.view'),
  ('wms.request.create'),
  ('wms.request.approve'),
  ('wms.request.export'),
  ('wms.request.receive'),
  ('wms.transaction.view'),
  ('wms.transaction.create'),
  ('wms.transaction.approve'),
  ('wms.transaction.complete')
) action(permission_code);

-- Seed lifecycle records as the migration owner before installing the actor JWT.
insert into public.requests(
  id, code, title, site_warehouse_id, source_warehouse_id, requester_id,
  status, items, created_date, expected_date, logs, request_origin
)
select request_id, null::text, 'E29 operator draft', warehouse_a_id, warehouse_a_id,
       other_user_id, 'DRAFT'::public.request_status, '[]'::jsonb, now(), now(), '[]'::jsonb, 'wms'
from wms_operator_fixture
union all
select transition_request_id, null::text, 'E29 action transition', warehouse_a_id, warehouse_a_id,
       other_user_id, 'APPROVED'::public.request_status, '[]'::jsonb, now(), now(), '[]'::jsonb, 'wms'
from wms_operator_fixture
union all
select scope_request_id, null::text, 'E29 wrong scope', warehouse_b_id, warehouse_b_id,
       other_user_id, 'APPROVED'::public.request_status, '[]'::jsonb, now(), now(), '[]'::jsonb, 'wms'
from wms_operator_fixture;

select set_config('request.jwt.claim.sub', auth_id::text, true) from wms_operator_fixture;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  fixture wms_operator_fixture%rowtype;
begin
  select * into fixture from wms_operator_fixture;

  if not app_private.can_read_inventory_scope(fixture.warehouse_a_id, fixture.other_user_id, fixture.other_user_id) then
    raise exception 'inventory.view did not authorize the assigned warehouse';
  end if;
  if app_private.can_read_inventory_scope(fixture.warehouse_b_id, fixture.other_user_id, fixture.other_user_id) then
    raise exception 'inventory.view leaked into an unassigned warehouse';
  end if;

  if (select count(*) from public.requests where id = fixture.request_id) <> 1 then
    raise exception 'request.view did not expose the assigned warehouse request';
  end if;
  if (select count(*) from public.requests where id = fixture.scope_request_id) <> 0 then
    raise exception 'request.view exposed an unassigned warehouse request';
  end if;
end $$;

-- Create is allowed only in the assigned warehouse.
insert into public.requests(
  id, code, title, site_warehouse_id, source_warehouse_id, requester_id,
  status, items, created_date, expected_date, logs, request_origin
)
select 'e29-created-' || gen_random_uuid()::text, null::text, 'E29 create allow',
       warehouse_a_id, warehouse_a_id, actor_id, 'DRAFT', '[]'::jsonb,
       now(), now(), '[]'::jsonb, 'wms'
from wms_operator_fixture;

do $$
declare fixture wms_operator_fixture%rowtype;
begin
  select * into fixture from wms_operator_fixture;
  begin
    insert into public.requests(
      id, code, title, site_warehouse_id, source_warehouse_id, requester_id,
      status, items, created_date, expected_date, logs, request_origin
    ) values (
      'e29-denied-' || gen_random_uuid()::text, null, 'E29 create deny',
      fixture.warehouse_b_id, fixture.warehouse_b_id, fixture.actor_id,
      'DRAFT', '[]'::jsonb, now(), now(), '[]'::jsonb, 'wms'
    );
    raise exception 'request.create unexpectedly crossed warehouse scope';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The happy path uses four distinct request capabilities.
update public.requests set status = 'PENDING' where id = (select request_id from wms_operator_fixture);
update public.requests set status = 'APPROVED' where id = (select request_id from wms_operator_fixture);

reset role;
delete from public.user_permission_grants
where user_id = (select actor_id from wms_operator_fixture)
  and permission_code = 'wms.request.export'
  and scope_type = 'warehouse'
  and scope_id = (select warehouse_a_id from wms_operator_fixture);
set local role authenticated;

do $$
begin
  begin
    update public.requests
    set status = 'IN_TRANSIT'
    where id = (select transition_request_id from wms_operator_fixture);
    raise exception 'request export succeeded without wms.request.export';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, expires_at, grant_reason
)
select actor_id, 'wms.request.export', 'warehouse', warehouse_a_id, true,
       now() + interval '1 hour', 'Task 12.4.2 E29 export restore'
from wms_operator_fixture;
set local role authenticated;

update public.requests
set status = 'IN_TRANSIT'
where id = (select transition_request_id from wms_operator_fixture);

reset role;
delete from public.user_permission_grants
where user_id = (select actor_id from wms_operator_fixture)
  and permission_code = 'wms.request.create'
  and scope_type = 'warehouse'
  and scope_id = (select warehouse_a_id from wms_operator_fixture);
set local role authenticated;

-- AppContext persists request edits with upsert. Existing rows must be checked as
-- UPDATE (receive here), not require create again in the pre-conflict INSERT hook.
insert into public.requests(
  id, code, title, site_warehouse_id, source_warehouse_id, requester_id,
  status, items, created_date, expected_date, note, logs, request_origin,
  fulfillment_mode
)
select id, code, title, site_warehouse_id, source_warehouse_id, requester_id,
       status, items, created_date, expected_date, 'E29 upsert checked by update action',
       logs, request_origin, fulfillment_mode
from public.requests
where id = (select transition_request_id from wms_operator_fixture)
on conflict (id) do update set note = excluded.note;

reset role;
delete from public.user_permission_grants
where user_id = (select actor_id from wms_operator_fixture)
  and permission_code = 'wms.request.receive'
  and scope_type = 'warehouse'
  and scope_id = (select warehouse_a_id from wms_operator_fixture);
set local role authenticated;

do $$
begin
  begin
    update public.requests
    set status = 'COMPLETED'
    where id = (select transition_request_id from wms_operator_fixture);
    raise exception 'request receive succeeded without wms.request.receive';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, expires_at, grant_reason
)
select actor_id, 'wms.request.receive', 'warehouse', warehouse_a_id, true,
       now() + interval '1 hour', 'Task 12.4.2 E29 receive restore'
from wms_operator_fixture;
set local role authenticated;

update public.requests
set status = 'COMPLETED'
where id = (select transition_request_id from wms_operator_fixture);

-- Linked transaction creation requires both transaction.create and request.export.
insert into public.transactions(
  id, type, date, items, source_warehouse_id, target_warehouse_id,
  requester_id, approver_id, status, related_request_id
)
select transaction_id, 'TRANSFER'::public.transaction_type, now(), '[]'::jsonb, warehouse_a_id, warehouse_a_id,
       actor_id, actor_id, 'PENDING'::public.transaction_status, transition_request_id
from wms_operator_fixture;

do $$
declare fixture wms_operator_fixture%rowtype;
begin
  select * into fixture from wms_operator_fixture;
  if (select count(*) from public.transactions where id = fixture.transaction_id) <> 1 then
    raise exception 'transaction.view did not expose the assigned warehouse transaction';
  end if;

  perform public.process_transaction_status(fixture.transaction_id, 'APPROVED', fixture.actor_id);
  perform public.process_transaction_status(fixture.transaction_id, 'COMPLETED', fixture.actor_id);

  if (select status::text from public.transactions where id = fixture.transaction_id) <> 'COMPLETED' then
    raise exception 'transaction approve/complete commands did not complete';
  end if;
end $$;

reset role;

do $$
begin
  if exists (
    select 1 from public.permission_actions
    where permission_code in (
      'wms.inventory.view', 'wms.request.view', 'wms.request.create',
      'wms.request.approve', 'wms.request.export', 'wms.request.receive',
      'wms.transaction.view', 'wms.transaction.create',
      'wms.transaction.approve', 'wms.transaction.complete'
    )
      and grant_readiness not in ('enforced', 'verified')
  ) then
    raise exception 'WAREHOUSE_OPERATOR still contains a non-executable action';
  end if;
end $$;

rollback;
