-- Canonical WMS transaction command grants must reach the status RPC without widening warehouse scope.
-- All fixture writes are rolled back.
begin;

create temporary table wms_transaction_command_actor (
  actor_id uuid not null,
  requester_id uuid not null,
  actor_email text not null,
  warehouse_a_id text not null,
  warehouse_b_id text not null,
  approve_transaction_id text not null,
  complete_transaction_id text not null,
  wrong_scope_transaction_id text not null,
  unauthorized_complete_transaction_id text not null,
  wrong_side_transfer_approve_id text not null,
  wrong_side_transfer_complete_id text not null
) on commit drop;

insert into wms_transaction_command_actor
values (
  gen_random_uuid(),
  gen_random_uuid(),
  'task12-4-2-wms-command-' || gen_random_uuid()::text || '@vioo.local',
  'task12-4-2-wms-command-a-' || gen_random_uuid()::text,
  'task12-4-2-wms-command-b-' || gen_random_uuid()::text,
  'task12-4-2-wms-command-approve-' || gen_random_uuid()::text,
  'task12-4-2-wms-command-complete-' || gen_random_uuid()::text,
  'task12-4-2-wms-command-wrong-scope-' || gen_random_uuid()::text,
  'task12-4-2-wms-command-unauthorized-complete-' || gen_random_uuid()::text,
  'task12-4-2-wms-command-transfer-approve-' || gen_random_uuid()::text,
  'task12-4-2-wms-command-transfer-complete-' || gen_random_uuid()::text
);

grant select on wms_transaction_command_actor to authenticated;

insert into public.warehouses (id, name, address, type)
select warehouse_a_id, 'Task 12.4.2 WMS command warehouse A', 'Smoke A', 'GENERAL'::public.warehouse_type
from wms_transaction_command_actor
union all
select warehouse_b_id, 'Task 12.4.2 WMS command warehouse B', 'Smoke B', 'GENERAL'::public.warehouse_type
from wms_transaction_command_actor;

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  assigned_warehouse_id
)
select actor_id, 'Task 12.4.2 WMS command actor', actor_email, actor_email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', warehouse_b_id
from wms_transaction_command_actor
union all
select requester_id, 'Task 12.4.2 WMS command requester',
       'task12-4-2-wms-requester-' || requester_id::text || '@vioo.local',
       'task12-4-2-wms-requester-' || requester_id::text,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', warehouse_a_id
from wms_transaction_command_actor;

insert into public.transactions (
  id, type, date, items, target_warehouse_id, requester_id, status, pending_items,
  business_event_type, business_event_reason
)
select approve_transaction_id, 'IMPORT'::public.transaction_type, now(), '[]'::jsonb,
       warehouse_a_id, requester_id, 'PENDING'::public.transaction_status, '[]'::jsonb,
       'direct_manual_receipt', 'Task 12.4.2 authorization smoke'
from wms_transaction_command_actor
union all
select complete_transaction_id, 'IMPORT'::public.transaction_type, now(), '[]'::jsonb,
       warehouse_a_id, requester_id, 'APPROVED'::public.transaction_status, '[]'::jsonb,
       'direct_manual_receipt', 'Task 12.4.2 authorization smoke'
from wms_transaction_command_actor
union all
select wrong_scope_transaction_id, 'IMPORT'::public.transaction_type, now(), '[]'::jsonb,
       warehouse_b_id, requester_id, 'PENDING'::public.transaction_status, '[]'::jsonb,
       'direct_manual_receipt', 'Task 12.4.2 authorization smoke'
from wms_transaction_command_actor
union all
select unauthorized_complete_transaction_id, 'IMPORT'::public.transaction_type, now(), '[]'::jsonb,
       warehouse_a_id, requester_id, 'APPROVED'::public.transaction_status, '[]'::jsonb,
       'direct_manual_receipt', 'Task 12.4.2 authorization smoke'
from wms_transaction_command_actor
union all
select wrong_side_transfer_approve_id, 'TRANSFER'::public.transaction_type, now(), '[]'::jsonb,
       warehouse_a_id, requester_id, 'PENDING'::public.transaction_status, '[]'::jsonb,
       'warehouse_transfer', 'Task 12.4.2 authorization smoke'
from wms_transaction_command_actor
union all
select wrong_side_transfer_complete_id, 'TRANSFER'::public.transaction_type, now(), '[]'::jsonb,
       warehouse_b_id, requester_id, 'APPROVED'::public.transaction_status, '[]'::jsonb,
       'warehouse_transfer', 'Task 12.4.2 authorization smoke'
from wms_transaction_command_actor;

update public.transactions
set source_warehouse_id = (
  select warehouse_b_id from wms_transaction_command_actor
)
where id = (select wrong_side_transfer_approve_id from wms_transaction_command_actor);

update public.transactions
set source_warehouse_id = (
  select warehouse_a_id from wms_transaction_command_actor
)
where id = (select wrong_side_transfer_complete_id from wms_transaction_command_actor);

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor_id, permission_code, 'warehouse', warehouse_a_id, true,
       'Task 12.4.2 canonical WMS transaction command fixture'
from wms_transaction_command_actor
cross join (values
  ('wms.transaction.approve'),
  ('wms.transaction.complete')
) permission(permission_code);

select set_config('request.jwt.claim.email', actor_email, true)
from wms_transaction_command_actor;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', actor_email,
    'sub', gen_random_uuid()::text,
    'role', 'authenticated'
  )::text,
  true
)
from wms_transaction_command_actor;

set local role authenticated;

do $$
declare
  fixture wms_transaction_command_actor%rowtype;
begin
  select * into fixture from wms_transaction_command_actor;

  if not app_private.wms_has_action(
    'wms.transaction.approve', null, fixture.warehouse_a_id,
    fixture.requester_id, null, fixture.actor_id
  ) then
    raise exception 'Fixture canonical approve grant was not effective';
  end if;

  perform public.process_transaction_status(
    fixture.approve_transaction_id,
    'APPROVED'::public.transaction_status,
    fixture.actor_id
  );

  if (select status from public.transactions where id = fixture.approve_transaction_id)
     <> 'APPROVED'::public.transaction_status then
    raise exception 'Canonical approve grant did not update transaction status';
  end if;

  perform public.process_transaction_status(
    fixture.complete_transaction_id,
    'COMPLETED'::public.transaction_status,
    fixture.actor_id
  );

  if (select status from public.transactions where id = fixture.complete_transaction_id)
     <> 'COMPLETED'::public.transaction_status then
    raise exception 'Canonical complete grant did not update transaction status';
  end if;

  begin
    perform public.process_transaction_status(
      fixture.wrong_scope_transaction_id,
      'APPROVED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Warehouse A approve grant unexpectedly authorized warehouse B';
  exception
    when insufficient_privilege then
      null;
  end;

  perform set_config(
    'request.jwt.claim.email',
    (select email from public.users where id = fixture.requester_id),
    true
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'email', (select email from public.users where id = fixture.requester_id),
      'sub', gen_random_uuid()::text,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.process_transaction_status(
      fixture.wrong_scope_transaction_id,
      'APPROVED'::public.transaction_status,
      fixture.requester_id
    );
    raise exception 'Requester without approve permission unexpectedly approved own transaction';
  exception
    when insufficient_privilege then
      null;
  end;

  perform public.process_transaction_status(
    fixture.wrong_scope_transaction_id,
    'CANCELLED'::public.transaction_status,
    fixture.requester_id
  );

  if (select status from public.transactions where id = fixture.wrong_scope_transaction_id)
     <> 'CANCELLED'::public.transaction_status then
    raise exception 'Requester could not cancel own transaction';
  end if;

  begin
    perform public.process_transaction_status(
      fixture.unauthorized_complete_transaction_id,
      'COMPLETED'::public.transaction_status,
      fixture.requester_id
    );
    raise exception 'Employee without complete permission unexpectedly completed transaction';
  exception
    when insufficient_privilege then
      null;
  end;

  perform set_config('request.jwt.claim.email', fixture.actor_email, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'email', fixture.actor_email,
      'sub', gen_random_uuid()::text,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.process_transaction_status(
      fixture.wrong_side_transfer_approve_id,
      'APPROVED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Target-side approve grant unexpectedly approved a standard transfer';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.process_transaction_status(
      fixture.wrong_side_transfer_complete_id,
      'COMPLETED'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Source-side complete grant unexpectedly completed a transfer';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.process_transaction_status(
      fixture.approve_transaction_id,
      'APPROVED'::public.transaction_status,
      fixture.requester_id
    );
    raise exception 'Transaction status command accepted a spoofed approver id';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.process_transaction_status(
      fixture.approve_transaction_id,
      'PENDING'::public.transaction_status,
      fixture.actor_id
    );
    raise exception 'Transaction status command accepted an unsupported PENDING target';
  exception
    when invalid_parameter_value then
      null;
  end;
end $$;

reset role;
rollback;
