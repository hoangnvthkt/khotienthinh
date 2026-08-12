-- Vehicle Booking Phase 1.1 authenticated integration/security smoke.
-- Cloud-only. All fixtures, audit records, outbox rows and sequence effects except
-- nextval itself are wrapped in this transaction and rolled back.

begin;

create temporary table vehicle_booking_test_context (
  requester_user_id uuid not null,
  requester_auth_id uuid not null,
  requester_email text not null,
  manager_user_id uuid not null,
  manager_auth_id uuid not null,
  manager_email text not null,
  dispatcher_user_id uuid not null,
  dispatcher_auth_id uuid not null,
  dispatcher_email text not null,
  driver_user_id uuid not null,
  driver_auth_id uuid not null,
  driver_email text not null,
  handover_user_id uuid not null,
  handover_auth_id uuid not null,
  handover_email text not null,
  outsider_user_id uuid not null,
  outsider_auth_id uuid not null,
  outsider_email text not null,
  fleet_location_id uuid not null,
  vehicle_asset_id text not null,
  unauthorized_booking_id uuid not null,
  manager_reject_booking_id uuid not null,
  external_booking_id uuid not null,
  internal_booking_id uuid not null,
  self_drive_booking_id uuid not null,
  no_show_booking_id uuid not null,
  reassign_booking_id uuid not null,
  custody_cancel_booking_id uuid not null
) on commit drop;

do $fixture$
declare
  v_users record;
  v_requester record;
  v_manager record;
  v_dispatcher record;
  v_driver record;
  v_handover record;
  v_outsider record;
  v_location_id uuid := gen_random_uuid();
  v_asset_id text;
  v_unauthorized uuid := gen_random_uuid();
  v_manager_reject uuid := gen_random_uuid();
  v_external uuid := gen_random_uuid();
  v_internal uuid := gen_random_uuid();
  v_self_drive uuid := gen_random_uuid();
  v_no_show uuid := gen_random_uuid();
  v_reassign uuid := gen_random_uuid();
  v_custody_cancel uuid := gen_random_uuid();
begin
  for v_users in
    select u.id, u.auth_id, u.email,
      row_number() over (order by u.created_at, u.id) as row_number
    from public.users u
    where u.auth_id is not null
      and coalesce(u.is_active, true)
      and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
      and u.role <> 'ADMIN'
    order by u.created_at, u.id
    limit 6
  loop
    case v_users.row_number
      when 1 then v_requester := v_users;
      when 2 then v_manager := v_users;
      when 3 then v_dispatcher := v_users;
      when 4 then v_driver := v_users;
      when 5 then v_handover := v_users;
      when 6 then v_outsider := v_users;
    end case;
  end loop;

  if v_outsider.id is null then
    raise exception 'BOOKING_TEST_FIXTURE_MISSING: six active non-admin authenticated users are required';
  end if;

  select asset.id into v_asset_id
  from public.assets asset
  left join public.fleet_vehicle_profiles profile on profile.asset_id = asset.id
  where profile.asset_id is null
  order by asset.created_at, asset.id
  limit 1;
  if v_asset_id is null then
    raise exception 'BOOKING_TEST_FIXTURE_MISSING: an asset without fleet profile is required';
  end if;

  insert into public.user_permission_grants(
    user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, grant_reason
  ) values
    (v_dispatcher.id, 'booking.vehicle.dispatch', 'global', '*', true, v_dispatcher.id, now(), 'Vehicle booking smoke'),
    (v_dispatcher.id, 'booking.vehicle.manage_fleet', 'global', '*', true, v_dispatcher.id, now(), 'Vehicle booking smoke'),
    (v_dispatcher.id, 'booking.vehicle.manage_authorizations', 'global', '*', true, v_dispatcher.id, now(), 'Vehicle booking smoke'),
    (v_dispatcher.id, 'booking.vehicle.view_sensitive_feedback', 'global', '*', true, v_dispatcher.id, now(), 'Vehicle booking smoke')
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true, revoked_at = null, expires_at = null, updated_at = now();

  insert into public.fleet_locations(id, name, source_type, active)
  values (v_location_id, 'Vehicle booking smoke home base', 'CUSTOM', true);

  insert into public.fleet_vehicle_profiles(
    asset_id, home_base_id, vehicle_type, seat_count, availability_status,
    allow_self_drive, current_odometer, custody_status, inspection_expiry_date,
    insurance_expiry_date, active
  ) values (
    v_asset_id, v_location_id, 'TEST_VEHICLE', 5, 'AVAILABLE',
    true, 100, 'AVAILABLE', current_date + 365, current_date + 365, true
  );

  insert into public.vehicle_driver_authorizations(
    user_id, authorization_type, license_number, license_class, license_expiry,
    health_check_expiry_date, allowed_vehicle_types, status,
    approved_by_user_id, approved_at
  ) values
    (v_driver.id, 'PROFESSIONAL_DRIVER', 'SMOKE-PRO-' || substr(v_driver.id::text, 1, 8), 'TEST', current_date + 365, current_date + 365, array['TEST_VEHICLE'], 'ACTIVE', v_dispatcher.id, now()),
    (v_requester.id, 'SELF_DRIVE', 'SMOKE-SELF-' || substr(v_requester.id::text, 1, 8), 'TEST', current_date + 365, current_date + 365, array['TEST_VEHICLE'], 'ACTIVE', v_dispatcher.id, now())
  on conflict (user_id, authorization_type) do update
  set status = 'ACTIVE', license_expiry = excluded.license_expiry,
      health_check_expiry_date = excluded.health_check_expiry_date,
      allowed_vehicle_types = excluded.allowed_vehicle_types, updated_at = now();

  insert into vehicle_booking_test_context values (
    v_requester.id, v_requester.auth_id, v_requester.email,
    v_manager.id, v_manager.auth_id, v_manager.email,
    v_dispatcher.id, v_dispatcher.auth_id, v_dispatcher.email,
    v_driver.id, v_driver.auth_id, v_driver.email,
    v_handover.id, v_handover.auth_id, v_handover.email,
    v_outsider.id, v_outsider.auth_id, v_outsider.email,
    v_location_id, v_asset_id, v_unauthorized, v_manager_reject,
    v_external, v_internal, v_self_drive, v_no_show, v_reassign, v_custody_cancel
  );

  insert into public.vehicle_bookings(
    id, booking_code, requester_user_id, trip_owner_user_id,
    manager_user_id_snapshot, manager_resolution_status,
    requested_pickup_at, expected_return_at, trip_type,
    pickup_location_text, destination_text, purpose, passenger_count,
    requested_mode, status, submitted_at, approved_at, approval_source
  ) values
    (v_unauthorized, 'CAR-TEST-' || substr(v_unauthorized::text, 1, 8), v_requester.id, v_requester.id, v_manager.id, 'NORMAL', now() + interval '1 day', now() + interval '1 day 2 hours', 'ROUND_TRIP', 'A', 'B', 'Unauthorized reject', 1, 'FLEXIBLE', 'PENDING_APPROVAL', now(), null, null),
    (v_manager_reject, 'CAR-TEST-' || substr(v_manager_reject::text, 1, 8), v_requester.id, v_requester.id, v_manager.id, 'NORMAL', now() + interval '2 days', now() + interval '2 days 2 hours', 'ROUND_TRIP', 'A', 'B', 'Manager reject', 1, 'FLEXIBLE', 'PENDING_APPROVAL', now(), null, null),
    (v_external, 'CAR-TEST-' || substr(v_external::text, 1, 8), v_requester.id, v_requester.id, v_manager.id, 'NORMAL', now() + interval '3 days', now() + interval '3 days 2 hours', 'ROUND_TRIP', 'A', 'B', 'External', 1, 'FLEXIBLE', 'PENDING_APPROVAL', now(), null, null),
    (v_internal, 'CAR-TEST-' || substr(v_internal::text, 1, 8), v_requester.id, v_requester.id, v_manager.id, 'NORMAL', now() + interval '5 days', now() + interval '5 days 2 hours', 'ROUND_TRIP', 'A', 'B', 'Internal', 1, 'WITH_DRIVER', 'WAITING_DISPATCH', now(), now(), 'MANAGER'),
    (v_self_drive, 'CAR-TEST-' || substr(v_self_drive::text, 1, 8), v_requester.id, v_requester.id, v_manager.id, 'NORMAL', now() + interval '8 days', now() + interval '8 days 2 hours', 'ROUND_TRIP', 'A', 'B', 'Self drive', 1, 'SELF_DRIVE', 'WAITING_DISPATCH', now(), now(), 'MANAGER'),
    (v_no_show, 'CAR-TEST-' || substr(v_no_show::text, 1, 8), v_requester.id, v_requester.id, v_manager.id, 'NORMAL', now() + interval '11 days', now() + interval '11 days 2 hours', 'ROUND_TRIP', 'A', 'B', 'No show', 1, 'WITH_DRIVER', 'WAITING_DISPATCH', now(), now(), 'MANAGER'),
    (v_reassign, 'CAR-TEST-' || substr(v_reassign::text, 1, 8), v_requester.id, v_requester.id, v_manager.id, 'NORMAL', now() + interval '14 days', now() + interval '14 days 2 hours', 'ROUND_TRIP', 'A', 'B', 'Reassign', 1, 'FLEXIBLE', 'WAITING_DISPATCH', now(), now(), 'MANAGER'),
    (v_custody_cancel, 'CAR-TEST-' || substr(v_custody_cancel::text, 1, 8), v_requester.id, v_requester.id, v_manager.id, 'NORMAL', now() + interval '17 days', now() + interval '17 days 2 hours', 'ROUND_TRIP', 'A', 'B', 'Custody cancel', 1, 'SELF_DRIVE', 'WAITING_DISPATCH', now(), now(), 'MANAGER');

  insert into storage.objects(bucket_id, name, owner_id)
  values (
    'vehicle-trip-evidence',
    v_internal::text || '/trips/server-seeded-smoke.jpg',
    v_driver.auth_id::text
  );
end;
$fixture$;

grant select on vehicle_booking_test_context to authenticated;

do $required_rpc_surface$
begin
  if to_regprocedure('public.reassign_vehicle_booking(uuid,text,text,text,uuid,uuid,boolean,text,text,text,text,text,text,numeric,text,text)') is null
     or to_regprocedure('public.respond_to_vehicle_assignment(uuid,text,text)') is null
     or to_regprocedure('public.complete_external_transport(uuid,numeric,text,text)') is null
     or to_regprocedure('public.mark_vehicle_booking_no_show(uuid,text)') is null
     or to_regprocedure('public.create_operator_unavailability(uuid,timestamptz,timestamptz,text,text)') is null
     or to_regprocedure('public.cancel_operator_unavailability(uuid,text)') is null
     or to_regprocedure('public.cancel_vehicle_unavailability(uuid,text)') is null
     or to_regprocedure('public.replace_vehicle_booking_participants(uuid,jsonb)') is null then
    raise exception 'MISSING_REQUIRED_BOOKING_RPC';
  end if;
end;
$required_rpc_surface$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

do $unauthorized_reject$
declare v_booking_id uuid;
begin
  select unauthorized_booking_id into v_booking_id from vehicle_booking_test_context;
  begin
    perform public.reject_vehicle_booking(v_booking_id, 'Unauthorized regression probe');
  exception when others then
    if sqlstate = '42501' and position('PERMISSION_DENIED' in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'SECURITY_REGRESSION: unrelated actor rejected booking';
end;
$unauthorized_reject$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', manager_auth_id, 'email', manager_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;
select public.reject_vehicle_booking(manager_reject_booking_id, 'Manager rejected for smoke test')
from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', dispatcher_auth_id, 'email', dispatcher_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

do $override_required$
declare v_booking_id uuid;
begin
  select external_booking_id into v_booking_id from vehicle_booking_test_context;
  begin
    perform public.dispatch_vehicle_booking(
      v_booking_id, 'EXTERNAL_TRANSPORT', p_external_service_type => 'TAXI'
    );
  exception when others then
    if position('OVERRIDE_REASON_REQUIRED' in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'BUSINESS_REGRESSION: pending approval dispatch did not require override reason';
end;
$override_required$;

select public.dispatch_vehicle_booking(
  external_booking_id, 'EXTERNAL_TRANSPORT',
  p_external_service_type => 'TAXI', p_external_provider_name => 'Smoke Taxi',
  p_dispatch_reason_code => 'NO_AVAILABLE_VEHICLE',
  p_override_reason => 'Dispatcher approved because manager was unavailable'
) from vehicle_booking_test_context;

select public.dispatch_vehicle_booking(
  internal_booking_id, 'INTERNAL_WITH_DRIVER', vehicle_asset_id,
  driver_user_id
) from vehicle_booking_test_context;

select public.dispatch_vehicle_booking(
  self_drive_booking_id, 'INTERNAL_SELF_DRIVE', vehicle_asset_id,
  requester_user_id, handover_user_id
) from vehicle_booking_test_context;

select public.dispatch_vehicle_booking(
  no_show_booking_id, 'INTERNAL_WITH_DRIVER', vehicle_asset_id,
  driver_user_id
) from vehicle_booking_test_context;

select public.dispatch_vehicle_booking(
  reassign_booking_id, 'EXTERNAL_TRANSPORT',
  p_external_service_type => 'TAXI', p_external_provider_name => 'Provider A',
  p_dispatch_reason_code => 'NO_AVAILABLE_VEHICLE'
) from vehicle_booking_test_context;

select public.reassign_vehicle_booking(
  reassign_booking_id, 'Change external provider', 'EXTERNAL_TRANSPORT',
  p_external_service_type => 'CONTRACT_CAR', p_external_provider_name => 'Provider B',
  p_dispatch_reason_code => 'OTHER'
) from vehicle_booking_test_context;

select public.dispatch_vehicle_booking(
  custody_cancel_booking_id, 'INTERNAL_SELF_DRIVE', vehicle_asset_id,
  requester_user_id, handover_user_id
) from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

do $unauthorized_assigned_mutations$
declare v_booking_id uuid;
begin
  select internal_booking_id into v_booking_id from vehicle_booking_test_context;
  begin
    perform public.cancel_vehicle_booking(v_booking_id, 'Outsider cancellation');
    raise exception 'SECURITY_REGRESSION: outsider cancelled assigned booking';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.start_vehicle_trip(
      v_booking_id, 100, v_booking_id::text || '/trips/start.jpg',
      10.78, 106.69, 10, false, null, null
    );
    raise exception 'SECURITY_REGRESSION: outsider started assigned booking';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then raise; end if;
  end;
end;
$unauthorized_assigned_mutations$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', requester_auth_id, 'email', requester_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

select public.complete_external_transport(
  external_booking_id, 250000,
  external_booking_id::text || '/external/receipt-smoke.pdf',
  'External smoke completed'
) from vehicle_booking_test_context;

do $self_drive_handover_required$
declare v_booking_id uuid;
begin
  select self_drive_booking_id into v_booking_id from vehicle_booking_test_context;
  perform public.respond_to_vehicle_assignment(v_booking_id, 'CONFIRMED');
  begin
    perform public.start_vehicle_trip(
      v_booking_id, 100, v_booking_id::text || '/trips/start.jpg',
      10.78, 106.69, 10, false, null, null
    );
  exception when others then
    if position('HANDOVER_REQUIRED' in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'BUSINESS_REGRESSION: self-drive started without handover';
end;
$self_drive_handover_required$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', driver_auth_id, 'email', driver_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

select public.respond_to_vehicle_assignment(internal_booking_id, 'CONFIRMED')
from vehicle_booking_test_context;

do $start_photo_required$
declare v_booking_id uuid;
begin
  select internal_booking_id into v_booking_id from vehicle_booking_test_context;
  begin
    perform public.start_vehicle_trip(v_booking_id, 100, null, 10.78, 106.69, 10, false, null, null);
  exception when others then
    if position('ODOMETER_PHOTO_REQUIRED' in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'BUSINESS_REGRESSION: internal trip started without odometer photo';
end;
$start_photo_required$;

select public.start_vehicle_trip(
  internal_booking_id, 100,
  internal_booking_id::text || '/trips/start.jpg',
  10.78, 106.69, 10, false, null, null
) from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

do $unauthorized_in_progress_mutations$
declare v_booking_id uuid;
begin
  select internal_booking_id into v_booking_id from vehicle_booking_test_context;
  begin
    perform public.record_vehicle_trip_checkpoint(v_booking_id, 'PICKED_UP_PASSENGER');
    raise exception 'SECURITY_REGRESSION: outsider recorded checkpoint';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.finish_vehicle_trip(
      v_booking_id, 120, v_booking_id::text || '/trips/end.jpg',
      10.78, 106.69, 10, false, null, 'NORMAL', null, null
    );
    raise exception 'SECURITY_REGRESSION: outsider finished trip';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then raise; end if;
  end;
end;
$unauthorized_in_progress_mutations$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', driver_auth_id, 'email', driver_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

select public.record_vehicle_trip_checkpoint(internal_booking_id, 'PICKED_UP_PASSENGER')
from vehicle_booking_test_context;

do $finish_issue_note_required$
declare v_booking_id uuid;
begin
  select internal_booking_id into v_booking_id from vehicle_booking_test_context;
  begin
    perform public.finish_vehicle_trip(
      v_booking_id, 120, v_booking_id::text || '/trips/end.jpg',
      10.78, 106.69, 10, false, null, 'ISSUE', null, null
    );
  exception when others then
    if position('ISSUE_NOTE_REQUIRED' in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'BUSINESS_REGRESSION: ISSUE condition completed without note';
end;
$finish_issue_note_required$;

select public.finish_vehicle_trip(
  internal_booking_id, 120,
  internal_booking_id::text || '/trips/end.jpg',
  10.78, 106.69, 10, false, null, 'NORMAL', null, null
) from vehicle_booking_test_context;

select public.mark_vehicle_booking_no_show(no_show_booking_id, 'Passenger did not appear')
from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', handover_auth_id, 'email', handover_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

select public.confirm_vehicle_handover(self_drive_booking_id, 'OUTBOUND_HANDOVER', 'Keys handed over')
from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', requester_auth_id, 'email', requester_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

select public.start_vehicle_trip(
  self_drive_booking_id, 120,
  self_drive_booking_id::text || '/trips/start.jpg',
  10.78, 106.69, 10, false, null, null
) from vehicle_booking_test_context;
select public.finish_vehicle_trip(
  self_drive_booking_id, 135,
  self_drive_booking_id::text || '/trips/end.jpg',
  10.78, 106.69, 10, false, null, 'NORMAL', null, null
) from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', handover_auth_id, 'email', handover_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;
select public.confirm_vehicle_return(self_drive_booking_id, 'Keys received', null)
from vehicle_booking_test_context;

select public.confirm_vehicle_handover(custody_cancel_booking_id, 'OUTBOUND_HANDOVER', 'Keys handed over')
from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', requester_auth_id, 'email', requester_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;
select public.cancel_vehicle_booking(custody_cancel_booking_id, 'Requester cancelled before departure')
from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

do $unauthorized_feedback$
declare v_booking_id uuid;
begin
  select internal_booking_id into v_booking_id from vehicle_booking_test_context;
  begin
    perform public.submit_vehicle_feedback(
      v_booking_id, false, 5, array['CLEAN_VEHICLE'], null, null
    );
  exception when others then
    if sqlstate = '42501' and position('PERMISSION_DENIED' in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'SECURITY_REGRESSION: outsider submitted feedback';
end;
$unauthorized_feedback$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', requester_auth_id, 'email', requester_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;
select public.submit_vehicle_feedback(
  internal_booking_id, true, 2, array[]::text[],
  'SERVICE_DELAY', 'SMOKE_SECRET_ISSUE_COMMENT'
) from vehicle_booking_test_context;

do $requester_evidence_access$
declare
  v_booking_id uuid;
  v_auth_id uuid;
begin
  select internal_booking_id, requester_auth_id
  into v_booking_id, v_auth_id
  from vehicle_booking_test_context;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'vehicle-trip-evidence'
      and object.name = v_booking_id::text || '/trips/server-seeded-smoke.jpg'
  ) then
    raise exception 'SECURITY_REGRESSION: requester cannot read related trip evidence';
  end if;
end;
$requester_evidence_access$;

insert into storage.objects(bucket_id, name, owner_id)
select
  'vehicle-trip-evidence',
  external_booking_id::text || '/external/requester-upload-smoke.pdf',
  requester_auth_id::text
from vehicle_booking_test_context;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

do $outsider_rls_and_storage$
declare v_context vehicle_booking_test_context%rowtype;
begin
  select * into v_context from vehicle_booking_test_context;
  if exists (
    select 1 from public.vehicle_booking_issues issue
    where issue.booking_id = v_context.internal_booking_id
  ) then
    raise exception 'SECURITY_REGRESSION: outsider read sensitive issue';
  end if;
  if exists (
    select 1 from storage.objects object
    where object.bucket_id = 'vehicle-trip-evidence'
      and object.name = v_context.internal_booking_id::text || '/trips/server-seeded-smoke.jpg'
  ) then
    raise exception 'SECURITY_REGRESSION: outsider read unrelated trip evidence';
  end if;
  begin
    insert into storage.objects(bucket_id, name, owner_id)
    values (
      'vehicle-trip-evidence',
      v_context.external_booking_id::text || '/external/outsider-smoke.pdf',
      v_context.outsider_auth_id::text
    );
    raise exception 'SECURITY_REGRESSION: outsider uploaded evidence to unrelated booking';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end;
$outsider_rls_and_storage$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', dispatcher_auth_id, 'email', dispatcher_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_test_context;

do $dispatcher_sensitive_access$
declare v_booking_id uuid;
begin
  select internal_booking_id into v_booking_id from vehicle_booking_test_context;
  if not exists (
    select 1 from public.vehicle_booking_issues issue
    where issue.booking_id = v_booking_id
  ) then
    raise exception 'ASSERTION_FAILED: dispatcher cannot read sensitive issue';
  end if;
end;
$dispatcher_sensitive_access$;

reset role;

do $final_assertions$
declare
  v_context vehicle_booking_test_context%rowtype;
begin
  select * into v_context from vehicle_booking_test_context;

  if (select status from public.vehicle_bookings where id = v_context.manager_reject_booking_id) <> 'CANCELLED' then
    raise exception 'ASSERTION_FAILED: manager reject status';
  end if;
  if (select status from public.vehicle_bookings where id = v_context.external_booking_id) <> 'COMPLETED' then
    raise exception 'ASSERTION_FAILED: external completion status';
  end if;
  if (select status from public.vehicle_bookings where id = v_context.internal_booking_id) <> 'COMPLETED' then
    raise exception 'ASSERTION_FAILED: internal completion status';
  end if;
  if (select status from public.vehicle_bookings where id = v_context.self_drive_booking_id) <> 'COMPLETED' then
    raise exception 'ASSERTION_FAILED: self-drive completion status';
  end if;
  if (select close_reason from public.vehicle_bookings where id = v_context.no_show_booking_id) <> 'NO_SHOW' then
    raise exception 'ASSERTION_FAILED: no-show close reason';
  end if;
  if (select max(version) from public.vehicle_booking_assignments where booking_id = v_context.reassign_booking_id) <> 2 then
    raise exception 'ASSERTION_FAILED: reassignment version';
  end if;
  if exists (
    select 1 from public.fleet_vehicle_profiles
    where asset_id = v_context.vehicle_asset_id
      and (custody_status <> 'AVAILABLE' or current_custody_assignment_id is not null)
  ) then
    raise exception 'ASSERTION_FAILED: custody was not released';
  end if;
  if exists (
    select 1 from public.audit_trail
    where record_id = v_context.internal_booking_id::text
      and (old_data::text like '%SMOKE_SECRET_ISSUE_COMMENT%'
        or new_data::text like '%SMOKE_SECRET_ISSUE_COMMENT%'
        or changes::text like '%SMOKE_SECRET_ISSUE_COMMENT%'
        or context::text like '%SMOKE_SECRET_ISSUE_COMMENT%')
  ) then
    raise exception 'SECURITY_REGRESSION: sensitive issue comment leaked into audit';
  end if;
end;
$final_assertions$;

update public.vehicle_booking_feedback feedback
set created_at = now() - interval '48 hours'
from vehicle_booking_test_context context
where feedback.booking_id = context.external_booking_id;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $service_worker_delivery$
declare
  v_claimed jsonb;
  v_outbox_id uuid;
  v_result jsonb;
  v_closed integer;
begin
  select public.process_vehicle_feedback_auto_close() into v_closed;
  if v_closed < 1 then
    raise exception 'ASSERTION_FAILED: feedback auto-close processed no rows';
  end if;

  select public.claim_vehicle_notification_outbox(1) into v_claimed;
  if jsonb_array_length(v_claimed) <> 1 then
    raise exception 'ASSERTION_FAILED: outbox worker did not claim one row';
  end if;
  v_outbox_id := (v_claimed -> 0 ->> 'id')::uuid;
  select public.deliver_vehicle_notification(v_outbox_id) into v_result;
  if coalesce((v_result ->> 'delivered')::boolean, false) is not true then
    raise exception 'ASSERTION_FAILED: outbox worker did not deliver claimed row';
  end if;
end;
$service_worker_delivery$;

reset role;

do $job_results$
declare v_booking_id uuid;
begin
  select external_booking_id into v_booking_id from vehicle_booking_test_context;
  if (select status from public.vehicle_booking_feedback where booking_id = v_booking_id) <> 'AUTO_CLOSED' then
    raise exception 'ASSERTION_FAILED: feedback was not auto-closed';
  end if;
  if not exists (
    select 1 from app_private.vehicle_booking_notification_outbox
    where status = 'DELIVERED' and delivered_at is not null
  ) then
    raise exception 'ASSERTION_FAILED: no delivered vehicle notification';
  end if;
  if not exists (
    select 1 from public.notifications
    where module = 'VEHICLE_BOOKING'
  ) then
    raise exception 'ASSERTION_FAILED: notification was not materialized';
  end if;
end;
$job_results$;

do $worker_and_cron_security$
begin
  if has_function_privilege(
    'authenticated',
    'app_private.claim_notification_outbox_batch(integer)',
    'EXECUTE'
  ) then
    raise exception 'SECURITY_REGRESSION: authenticated can claim notification outbox';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.process_vehicle_feedback_auto_close()',
    'EXECUTE'
  ) then
    raise exception 'SECURITY_REGRESSION: authenticated can auto-close all feedback';
  end if;
  if not exists (
    select 1 from cron.job
    where jobname = 'vehicle-booking-feedback-auto-close' and active
  ) then
    raise exception 'MISSING_JOB: vehicle booking feedback auto-close cron';
  end if;
end;
$worker_and_cron_security$;

rollback;
