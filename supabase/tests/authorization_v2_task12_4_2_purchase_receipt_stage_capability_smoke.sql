-- Purchase receipt wrappers must enforce approve and complete independently.
-- All fixtures and temporary ACL changes roll back.
begin;

create temporary table purchase_receipt_stage_actor (
  approve_actor_id uuid not null,
  complete_actor_id uuid not null,
  approve_email text not null,
  complete_email text not null,
  warehouse_id text not null,
  transaction_id text not null
) on commit drop;

insert into purchase_receipt_stage_actor
values (
  gen_random_uuid(),
  gen_random_uuid(),
  'task12-4-2-receipt-approve-' || gen_random_uuid()::text || '@vioo.local',
  'task12-4-2-receipt-complete-' || gen_random_uuid()::text || '@vioo.local',
  'task12-4-2-receipt-stage-wh-' || gen_random_uuid()::text,
  'task12-4-2-receipt-stage-tx-' || gen_random_uuid()::text
);

grant select on purchase_receipt_stage_actor to authenticated;

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'Task 12.4.2 receipt stage warehouse', 'Smoke',
       'GENERAL'::public.warehouse_type
from purchase_receipt_stage_actor;

insert into public.users (id, name, email, username, role, is_active, account_status)
select approve_actor_id, 'Task 12.4.2 receipt approve actor', approve_email,
       approve_email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from purchase_receipt_stage_actor
union all
select complete_actor_id, 'Task 12.4.2 receipt complete actor', complete_email,
       complete_email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from purchase_receipt_stage_actor;

insert into public.transactions (
  id, type, date, items, target_warehouse_id, requester_id, status,
  pending_items, business_event_type, business_event_reason
)
select transaction_id, 'IMPORT'::public.transaction_type, now(), '[]'::jsonb,
       warehouse_id, approve_actor_id, 'PENDING'::public.transaction_status,
       '[]'::jsonb, 'direct_manual_receipt',
       'Task 12.4.2 purchase receipt stage authorization smoke'
from purchase_receipt_stage_actor;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, expires_at, grant_reason
)
select approve_actor_id, 'wms.transaction.approve', 'warehouse', warehouse_id,
       true, now() + interval '1 hour',
       'Task 12.4.2 receipt approve stage fixture'
from purchase_receipt_stage_actor
union all
select complete_actor_id, 'wms.transaction.complete', 'warehouse', warehouse_id,
       true, now() + interval '1 hour',
       'Task 12.4.2 receipt complete stage fixture'
from purchase_receipt_stage_actor;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'app_private.approve_material_po_quality(uuid,text,uuid,text,jsonb,jsonb)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'app_private.approve_receipt_quality_v2(uuid,text,uuid,text,jsonb,jsonb)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'app_private.finalize_purchase_receipt_v2(uuid,text,uuid)',
    'execute'
  ) then
    raise exception 'Authenticated can bypass public purchase receipt stage guards';
  end if;
end $$;

select set_config('request.jwt.claim.email', approve_email, true)
from purchase_receipt_stage_actor;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', approve_email,
    'sub', gen_random_uuid()::text,
    'role', 'authenticated'
  )::text,
  true
)
from purchase_receipt_stage_actor;

set local role authenticated;

do $$
declare
  fixture purchase_receipt_stage_actor%rowtype;
begin
  select * into fixture from purchase_receipt_stage_actor;

  begin
    perform public.approve_material_po_quality(
      gen_random_uuid(), fixture.transaction_id, fixture.approve_actor_id,
      'passed', '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'Approve wrapper did not reach its private implementation';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.finalize_material_po_receipt(
      gen_random_uuid(), fixture.transaction_id, fixture.approve_actor_id
    );
    raise exception 'Approve-only grant unexpectedly reached receipt finalization';
  exception
    when insufficient_privilege then
      null;
  end;

  perform set_config('request.jwt.claim.email', fixture.complete_email, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'email', fixture.complete_email,
      'sub', gen_random_uuid()::text,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.finalize_purchase_receipt_v2(
      gen_random_uuid(), fixture.transaction_id, fixture.complete_actor_id
    );
    raise exception 'Complete wrapper did not reach its private implementation';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.approve_receipt_quality_v2(
      gen_random_uuid(), fixture.transaction_id, fixture.complete_actor_id,
      'passed', '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'Complete-only grant unexpectedly reached quality approval';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.finalize_purchase_receipt_v2(
      gen_random_uuid(), fixture.transaction_id, fixture.approve_actor_id
    );
    raise exception 'Purchase receipt wrapper accepted a spoofed actor id';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

reset role;
rollback;
