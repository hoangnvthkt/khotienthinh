-- Receipt quantity and fulfillment sync RPCs must honor the same canonical
-- approve/complete grants as the transaction status command. All writes roll back.
begin;

create temporary table wms_receipt_command_actor (
  actor_id uuid not null,
  requester_id uuid not null,
  actor_email text not null,
  warehouse_a_id text not null,
  warehouse_b_id text not null,
  pending_a_id text not null,
  approved_a_id text not null,
  pending_b_id text not null,
  completed_a_id text not null,
  completed_b_id text not null
) on commit drop;

insert into wms_receipt_command_actor
values (
  gen_random_uuid(), gen_random_uuid(),
  'task12-4-2-wms-receipt-' || gen_random_uuid()::text || '@vioo.local',
  'task12-4-2-wms-receipt-a-' || gen_random_uuid()::text,
  'task12-4-2-wms-receipt-b-' || gen_random_uuid()::text,
  'task12-4-2-wms-receipt-pending-a-' || gen_random_uuid()::text,
  'task12-4-2-wms-receipt-approved-a-' || gen_random_uuid()::text,
  'task12-4-2-wms-receipt-pending-b-' || gen_random_uuid()::text,
  'task12-4-2-wms-receipt-completed-a-' || gen_random_uuid()::text,
  'task12-4-2-wms-receipt-completed-b-' || gen_random_uuid()::text
);

grant select on wms_receipt_command_actor to authenticated;

insert into public.warehouses (id, name, address, type)
select warehouse_a_id, 'Task 12.4.2 WMS receipt warehouse A', 'Smoke A', 'GENERAL'::public.warehouse_type
from wms_receipt_command_actor
union all
select warehouse_b_id, 'Task 12.4.2 WMS receipt warehouse B', 'Smoke B', 'GENERAL'::public.warehouse_type
from wms_receipt_command_actor;

insert into public.users (
  id, name, email, username, role, is_active, account_status, assigned_warehouse_id
)
select actor_id, 'Task 12.4.2 WMS receipt actor', actor_email, actor_email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', warehouse_b_id
from wms_receipt_command_actor
union all
select requester_id, 'Task 12.4.2 WMS receipt requester',
       'task12-4-2-wms-receipt-requester-' || requester_id::text || '@vioo.local',
       'task12-4-2-wms-receipt-requester-' || requester_id::text,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', null
from wms_receipt_command_actor;

insert into public.transactions (
  id, type, date, items, target_warehouse_id, requester_id, status, pending_items,
  business_event_type, business_event_reason
)
select transaction_id, 'IMPORT'::public.transaction_type, now(),
       jsonb_build_array(jsonb_build_object(
         'itemId', 'task12-4-2-wms-receipt-item',
         'quantity', 1,
         'orderedQty', 1
       )),
       warehouse_id, requester_id, transaction_status, '[]'::jsonb,
       'direct_manual_receipt', 'Task 12.4.2 receipt authorization smoke'
from wms_receipt_command_actor
cross join lateral (values
  (pending_a_id, warehouse_a_id, 'PENDING'::public.transaction_status),
  (approved_a_id, warehouse_a_id, 'APPROVED'::public.transaction_status),
  (pending_b_id, warehouse_b_id, 'PENDING'::public.transaction_status),
  (completed_a_id, warehouse_a_id, 'COMPLETED'::public.transaction_status),
  (completed_b_id, warehouse_b_id, 'COMPLETED'::public.transaction_status)
) fixture(transaction_id, warehouse_id, transaction_status);

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor_id, permission_code, 'warehouse', warehouse_a_id, true,
       'Task 12.4.2 canonical WMS receipt command fixture'
from wms_receipt_command_actor
cross join (values
  ('wms.transaction.approve'),
  ('wms.transaction.complete')
) permission(permission_code);

select set_config('request.jwt.claim.email', actor_email, true)
from wms_receipt_command_actor;
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
from wms_receipt_command_actor;

set local role authenticated;

do $$
declare
  fixture wms_receipt_command_actor%rowtype;
  result jsonb;
begin
  select * into fixture from wms_receipt_command_actor;

  perform public.update_transaction_items_for_receipt(
    fixture.pending_a_id,
    jsonb_build_array(jsonb_build_object(
      'itemId', 'task12-4-2-wms-receipt-item',
      'quantity', 2,
      'orderedQty', 2
    ))
  );

  perform public.update_transaction_items_for_receipt(
    fixture.approved_a_id,
    jsonb_build_array(jsonb_build_object(
      'itemId', 'task12-4-2-wms-receipt-item',
      'quantity', 3,
      'orderedQty', 3
    ))
  );

  begin
    perform public.update_transaction_items_for_receipt(
      fixture.pending_b_id,
      jsonb_build_array(jsonb_build_object(
        'itemId', 'task12-4-2-wms-receipt-item',
        'quantity', 2,
        'orderedQty', 2
      ))
    );
    raise exception 'Warehouse A grants unexpectedly adjusted warehouse B receipt';
  exception
    when insufficient_privilege then
      null;
  end;

  result := public.sync_fulfillment_receipt_for_transaction(
    fixture.completed_a_id,
    fixture.actor_id
  );
  if result->>'reason' is distinct from 'batch_not_found' then
    raise exception 'Canonical complete grant did not reach fulfillment lookup: %', result;
  end if;

  begin
    perform public.sync_fulfillment_receipt_for_transaction(
      fixture.completed_b_id,
      fixture.actor_id
    );
    raise exception 'Warehouse A complete grant unexpectedly synced warehouse B';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.sync_fulfillment_receipt_for_transaction(
      fixture.completed_a_id,
      fixture.requester_id
    );
    raise exception 'Fulfillment sync accepted a spoofed actor user id';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

reset role;
rollback;
