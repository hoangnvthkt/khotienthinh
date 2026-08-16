-- Cloud-only transactional smoke for assignment concurrency and decline/re-dispatch.
begin;

do $smoke$
declare
  v_actor uuid;
  v_vehicle_asset_id text;
  v_booking_declined uuid := gen_random_uuid();
  v_booking_runtime_one uuid := gen_random_uuid();
  v_booking_runtime_two uuid := gen_random_uuid();
  v_assignment_declined uuid := gen_random_uuid();
  v_assignment_redispatched uuid := gen_random_uuid();
  v_assignment_runtime_one uuid := gen_random_uuid();
  v_assignment_runtime_two uuid := gen_random_uuid();
  v_version integer;
begin
  select app_user.id into v_actor
  from public.users app_user
  where coalesce(app_user.is_active, true)
  order by app_user.created_at, app_user.id
  limit 1;

  if v_actor is null then
    raise exception 'BOOKING_TEST_FIXTURE_MISSING: one active app user is required';
  end if;

  select profile.asset_id into v_vehicle_asset_id
  from public.fleet_vehicle_profiles profile
  where profile.active
  order by profile.created_at, profile.asset_id
  limit 1;
  if v_vehicle_asset_id is null then
    raise exception 'BOOKING_TEST_FIXTURE_MISSING: one active fleet vehicle is required';
  end if;

  insert into public.vehicle_bookings(
    id, booking_code, requester_user_id, trip_owner_user_id,
    requested_pickup_at, expected_return_at, trip_type,
    pickup_location_text, destination_text, purpose, passenger_count,
    requested_mode, status, submitted_at, approved_at, approval_source
  ) values
    (v_booking_declined, 'CAR-CONC-' || substr(v_booking_declined::text, 1, 8), v_actor, v_actor,
      now() + interval '1000 days', now() + interval '1000 days 2 hours', 'ROUND_TRIP',
      'A', 'B', 'Decline and redispatch smoke', 1, 'WITH_DRIVER', 'ASSIGNED', now(), now(), 'MANAGER'),
    (v_booking_runtime_one, 'CAR-CONC-' || substr(v_booking_runtime_one::text, 1, 8), v_actor, v_actor,
      now() + interval '1002 days', now() + interval '1002 days 2 hours', 'ROUND_TRIP',
      'A', 'B', 'Runtime operator smoke one', 1, 'WITH_DRIVER', 'ASSIGNED', now(), now(), 'MANAGER'),
    (v_booking_runtime_two, 'CAR-CONC-' || substr(v_booking_runtime_two::text, 1, 8), v_actor, v_actor,
      now() + interval '1004 days', now() + interval '1004 days 2 hours', 'ROUND_TRIP',
      'A', 'B', 'Runtime operator smoke two', 1, 'WITH_DRIVER', 'ASSIGNED', now(), now(), 'MANAGER');

  insert into public.vehicle_booking_assignments(
    id, booking_id, version, fulfillment_type, vehicle_asset_id, operator_user_id, operator_type,
    reserved_start_at, reserved_end_at, assigned_by_user_id
  ) values
    (v_assignment_declined, v_booking_declined, 1, 'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_actor, 'PROFESSIONAL_DRIVER',
      now() + interval '1000 days', now() + interval '1000 days 2 hours', v_actor),
    (v_assignment_runtime_one, v_booking_runtime_one, 1, 'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_actor, 'PROFESSIONAL_DRIVER',
      now() + interval '1002 days', now() + interval '1002 days 2 hours', v_actor),
    (v_assignment_runtime_two, v_booking_runtime_two, 1, 'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_actor, 'PROFESSIONAL_DRIVER',
      now() + interval '1004 days', now() + interval '1004 days 2 hours', v_actor);

  insert into public.vehicle_trip_logs(
    booking_id, assignment_id, assignment_version_snapshot,
    vehicle_asset_id_snapshot, operator_user_id_snapshot, trip_status
  ) values
    (v_booking_declined, v_assignment_declined, 99, v_vehicle_asset_id, v_actor, 'NOT_STARTED'),
    (v_booking_runtime_one, v_assignment_runtime_one, 99, v_vehicle_asset_id, v_actor, 'NOT_STARTED'),
    (v_booking_runtime_two, v_assignment_runtime_two, 99, v_vehicle_asset_id, v_actor, 'NOT_STARTED');

  if (select assignment_version_snapshot from public.vehicle_trip_logs where booking_id = v_booking_declined) <> 1 then
    raise exception 'ASSERTION_FAILED: trip did not snapshot normalized assignment version';
  end if;

  update public.vehicle_booking_assignments
  set operator_confirmation_status = 'DECLINED',
      operator_decline_reason = 'Concurrency smoke',
      updated_at = now()
  where id = v_assignment_declined;

  if not exists (
    select 1 from public.vehicle_booking_assignments assignment
    where assignment.id = v_assignment_declined
      and not assignment.is_active
      and assignment.released_at is not null
  ) then
    raise exception 'ASSERTION_FAILED: declined assignment was not released';
  end if;
  if (select status from public.vehicle_bookings where id = v_booking_declined) <> 'WAITING_DISPATCH' then
    raise exception 'ASSERTION_FAILED: declined booking did not return to dispatch';
  end if;
  if exists (select 1 from public.vehicle_trip_logs where booking_id = v_booking_declined) then
    raise exception 'ASSERTION_FAILED: stale NOT_STARTED trip log survived decline';
  end if;

  insert into public.vehicle_booking_assignments(
    id, booking_id, version, fulfillment_type, vehicle_asset_id, operator_user_id, operator_type,
    reserved_start_at, reserved_end_at, assigned_by_user_id
  ) values (
    v_assignment_redispatched, v_booking_declined, 1, 'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_actor, 'PROFESSIONAL_DRIVER',
    now() + interval '1000 days', now() + interval '1000 days 2 hours', v_actor
  );

  select assignment.version into v_version
  from public.vehicle_booking_assignments assignment
  where assignment.id = v_assignment_redispatched;
  if v_version <> 2 then
    raise exception 'ASSERTION_FAILED: redispatch assignment version is %, expected 2', v_version;
  end if;

  insert into public.vehicle_trip_logs(
    booking_id, assignment_id, assignment_version_snapshot,
    vehicle_asset_id_snapshot, operator_user_id_snapshot, trip_status
  ) values (v_booking_declined, v_assignment_redispatched, 1, v_vehicle_asset_id, v_actor, 'NOT_STARTED');
  if (select assignment_version_snapshot from public.vehicle_trip_logs where booking_id = v_booking_declined) <> 2 then
    raise exception 'ASSERTION_FAILED: redispatch trip snapshot did not use version 2';
  end if;

  update public.vehicle_trip_logs
  set trip_status = 'IN_PROGRESS',
      start_odometer = 100,
      start_photo_path = v_booking_runtime_one::text || '/trips/start.jpg',
      start_latitude = 10.78,
      start_longitude = 106.69
  where booking_id = v_booking_runtime_one;

  begin
    update public.vehicle_trip_logs
    set trip_status = 'IN_PROGRESS',
        start_odometer = 100,
        start_photo_path = v_booking_runtime_two::text || '/trips/start.jpg',
        start_latitude = 10.78,
        start_longitude = 106.69
    where booking_id = v_booking_runtime_two;
    raise exception 'ASSERTION_FAILED: one operator started two trips concurrently';
  exception
    when unique_violation then
      if position('vehicle_trip_logs_one_active_trip_per_operator' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$smoke$;

rollback;
