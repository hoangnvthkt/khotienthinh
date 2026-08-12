-- Vehicle Booking Phase 3 Cloud smoke. All fixtures are rolled back.

begin;

create temporary table vehicle_booking_phase3_context (
  global_user_id uuid not null,
  global_auth_id uuid not null,
  global_email text not null,
  department_user_id uuid not null,
  department_auth_id uuid not null,
  department_email text not null,
  outsider_user_id uuid not null,
  outsider_auth_id uuid not null,
  outsider_email text not null,
  department_id uuid not null,
  other_department_id uuid not null,
  vehicle_asset_id text not null
) on commit drop;

do $fixtures$
declare
  v_global record;
  v_department record;
  v_outsider record;
  v_candidate record;
  v_department_id uuid;
  v_other_department_id uuid := gen_random_uuid();
  v_vehicle_asset_id text;
  v_booking_on_time uuid := gen_random_uuid();
  v_booking_late uuid := gen_random_uuid();
  v_booking_external uuid := gen_random_uuid();
  v_booking_cancelled uuid := gen_random_uuid();
  v_assignment_on_time uuid := gen_random_uuid();
  v_assignment_late uuid := gen_random_uuid();
  v_assignment_external uuid := gen_random_uuid();
begin
  for v_candidate in
    select u.id, u.auth_id, u.email,
      row_number() over (order by u.created_at, u.id) as row_number
    from public.users u
    where u.auth_id is not null
      and coalesce(u.is_active, true)
      and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
      and not exists (
        select 1 from public.user_permission_grants grant_row
        where grant_row.user_id = u.id
          and grant_row.permission_code in (
            'booking.vehicle.admin', 'booking.vehicle.view_reports'
          )
          and coalesce(grant_row.is_active, false)
          and grant_row.revoked_at is null
          and (grant_row.expires_at is null or grant_row.expires_at > now())
      )
    order by u.created_at, u.id
    limit 3
  loop
    case v_candidate.row_number
      when 1 then v_global := v_candidate;
      when 2 then v_department := v_candidate;
      when 3 then v_outsider := v_candidate;
    end case;
  end loop;

  if v_outsider.id is null then
    raise exception 'PHASE3_SMOKE_FIXTURE_MISSING: three active authenticated users are required';
  end if;

  select org.id into v_department_id
  from public.org_units org
  where org.type = 'department'
  order by org.id
  limit 1;

  if v_department_id is null then
    raise exception 'PHASE3_SMOKE_FIXTURE_MISSING: one department org unit is required';
  end if;

  select profile.asset_id into v_vehicle_asset_id
  from public.fleet_vehicle_profiles profile
  where profile.active
  order by profile.asset_id
  limit 1;

  if v_vehicle_asset_id is null then
    select asset.id into v_vehicle_asset_id
    from public.assets asset
    left join public.fleet_vehicle_profiles profile on profile.asset_id = asset.id
    where profile.asset_id is null
    order by asset.created_at, asset.id
    limit 1;

    if v_vehicle_asset_id is null then
      raise exception 'PHASE3_SMOKE_FIXTURE_MISSING: one asset is required';
    end if;

    insert into public.fleet_vehicle_profiles(
      asset_id, vehicle_type, seat_count, availability_status,
      allow_self_drive, current_odometer, custody_status, active
    ) values (
      v_vehicle_asset_id, 'PHASE3_SMOKE', 5, 'AVAILABLE',
      false, 0, 'AVAILABLE', true
    );
  end if;

  insert into public.user_permission_grants(
    user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, grant_reason
  ) values
    (v_global.id, 'booking.vehicle.view_reports', 'global', '*', true,
     v_global.id, now(), 'Vehicle booking phase 3 smoke'),
    (v_department.id, 'booking.vehicle.view_reports', 'department',
     v_department_id::text, true, v_global.id, now(),
     'Vehicle booking phase 3 smoke')
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      revoked_at = null,
      expires_at = null,
      updated_at = now();

  insert into vehicle_booking_phase3_context values (
    v_global.id, v_global.auth_id, v_global.email,
    v_department.id, v_department.auth_id, v_department.email,
    v_outsider.id, v_outsider.auth_id, v_outsider.email,
    v_department_id, v_other_department_id, v_vehicle_asset_id
  );

  insert into public.vehicle_bookings(
    id, booking_code, requester_user_id, trip_owner_user_id,
    department_id_snapshot, requested_pickup_at, expected_return_at,
    trip_type, pickup_location_text, destination_text, purpose,
    passenger_count, requested_mode, status, submitted_at
  ) values
    (v_booking_on_time, 'CAR-P3-' || substr(v_booking_on_time::text, 1, 8),
     v_global.id, v_global.id, v_department_id,
     '2096-08-01 01:00:00+00', '2096-08-01 02:00:00+00',
     'ROUND_TRIP', 'A', 'B', 'Phase 3 on-time', 1, 'WITH_DRIVER',
     'COMPLETED', '2096-07-01 00:00:00+00'),
    (v_booking_late, 'CAR-P3-' || substr(v_booking_late::text, 1, 8),
     v_global.id, v_global.id, v_department_id,
     '2096-08-01 03:00:00+00', '2096-08-01 04:00:00+00',
     'ROUND_TRIP', 'A', 'B', 'Phase 3 late', 1, 'WITH_DRIVER',
     'COMPLETED', '2096-07-01 00:00:00+00'),
    (v_booking_external, 'CAR-P3-' || substr(v_booking_external::text, 1, 8),
     v_global.id, v_global.id, v_department_id,
     '2096-08-01 05:00:00+00', '2096-08-01 06:00:00+00',
     'ROUND_TRIP', 'A', 'B', 'Phase 3 external', 1, 'FLEXIBLE',
     'COMPLETED', '2096-07-01 00:00:00+00'),
    (v_booking_cancelled, 'CAR-P3-' || substr(v_booking_cancelled::text, 1, 8),
     v_global.id, v_global.id, v_department_id,
     '2096-08-01 07:00:00+00', '2096-08-01 08:00:00+00',
     'ROUND_TRIP', 'A', 'B', 'Phase 3 cancelled', 1, 'FLEXIBLE',
     'CANCELLED', '2096-07-01 00:00:00+00');

  update public.vehicle_bookings
  set close_reason = 'LATE_CANCELLED',
      cancelled_at = '2096-08-01 06:30:00+00',
      cancelled_by_user_id = v_global.id
  where id = v_booking_cancelled;

  insert into public.vehicle_booking_assignments(
    id, booking_id, version, is_active, fulfillment_type,
    vehicle_asset_id, operator_user_id, operator_type,
    reserved_start_at, reserved_end_at, assigned_by_user_id,
    external_actual_cost
  ) values
    (v_assignment_on_time, v_booking_on_time, 1, true,
     'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_global.id,
     'PROFESSIONAL_DRIVER', '2096-08-01 01:00:00+00',
     '2096-08-01 02:00:00+00', v_global.id, null),
    (v_assignment_late, v_booking_late, 1, true,
     'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_global.id,
     'PROFESSIONAL_DRIVER', '2096-08-01 03:00:00+00',
     '2096-08-01 04:00:00+00', v_global.id, null),
    (v_assignment_external, v_booking_external, 1, true,
     'EXTERNAL_TRANSPORT', null, null, null,
     '2096-08-01 05:00:00+00', '2096-08-01 06:00:00+00',
     v_global.id, 300000);

  insert into public.vehicle_trip_logs(
    booking_id, assignment_id, assignment_version_snapshot,
    vehicle_asset_id_snapshot, operator_user_id_snapshot, trip_status,
    departed_home_base_at, actual_pickup_at, actual_return_at,
    start_odometer, end_odometer, distance_km
  ) values
    (v_booking_on_time, v_assignment_on_time, 1, v_vehicle_asset_id,
     v_global.id, 'FINISHED', '2096-08-01 01:00:00+00',
     '2096-08-01 01:10:00+00', '2096-08-01 02:00:00+00', 100, 120, 20),
    (v_booking_late, v_assignment_late, 1, v_vehicle_asset_id,
     v_global.id, 'FINISHED', '2096-08-01 03:00:00+00',
     '2096-08-01 03:30:00+00', '2096-08-01 04:00:00+00', 120, 150, 30);

  insert into public.vehicle_unavailability_periods(
    vehicle_asset_id, start_at, end_at, reason_code, created_by_user_id
  ) values (
    v_vehicle_asset_id, '2096-08-01 10:00:00+00',
    '2096-08-01 11:00:00+00', 'MAINTENANCE', v_global.id
  );
end;
$fixtures$;

grant select on vehicle_booking_phase3_context to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', global_auth_id, 'email', global_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_phase3_context;

do $global_analytics$
declare
  v_payload jsonb;
  v_active_vehicle_count integer;
  v_expected_available numeric;
begin
  select public.get_vehicle_booking_analytics(
    '2096-08-01 00:00:00+00', '2096-08-02 00:00:00+00', null
  ) into v_payload;

  select count(*) into v_active_vehicle_count
  from public.fleet_vehicle_profiles where active;
  v_expected_available := v_active_vehicle_count * 1440 - 60;

  if (v_payload #>> '{kpis,completedTrips}')::integer <> 3
     or (v_payload #>> '{kpis,onTimeEligibleTrips}')::integer <> 2
     or (v_payload #>> '{kpis,onTimeTrips}')::integer <> 1
     or (v_payload #>> '{kpis,onTimeRate}')::numeric <> 50.0
     or (v_payload #>> '{kpis,submittedBookings}')::integer <> 4
     or (v_payload #>> '{kpis,lateCancelledBookings}')::integer <> 1
     or (v_payload #>> '{kpis,lateCancellationRate}')::numeric <> 25.0
     or (v_payload #>> '{kpis,usedVehicleMinutes}')::numeric <> 120.0
     or (v_payload #>> '{kpis,availableVehicleMinutes}')::numeric <> v_expected_available
     or (v_payload #>> '{externalCostByDepartment,0,actualCost}')::numeric <> 300000 then
    raise exception 'PHASE3_ANALYTICS_ASSERTION_FAILED: %', v_payload;
  end if;
end;
$global_analytics$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', department_auth_id, 'email', department_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_phase3_context;

do $department_scope$
declare
  v_payload jsonb;
  v_department_id uuid;
  v_other_department_id uuid;
begin
  select department_id, other_department_id
  into v_department_id, v_other_department_id
  from vehicle_booking_phase3_context;

  v_payload := public.get_vehicle_booking_analytics(
    '2096-08-01 00:00:00+00', '2096-08-02 00:00:00+00', v_department_id
  );
  if (v_payload #>> '{kpis,completedTrips}')::integer <> 3 then
    raise exception 'PHASE3_DEPARTMENT_ANALYTICS_ASSERTION_FAILED: %', v_payload;
  end if;

  begin
    perform public.get_vehicle_booking_analytics(
      '2096-08-01 00:00:00+00', '2096-08-02 00:00:00+00', v_other_department_id
    );
  exception when others then
    if sqlstate = '42501' and position('PERMISSION_DENIED' in sqlerrm) > 0 then
      return;
    end if;
    raise;
  end;
  raise exception 'PHASE3_SCOPE_ASSERTION_FAILED: department actor read another department';
end;
$department_scope$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_phase3_context;

do $outsider_denied$
begin
  begin
    perform public.get_vehicle_booking_analytics(
      '2096-08-01 00:00:00+00', '2096-08-02 00:00:00+00', null
    );
  exception when others then
    if sqlstate = '42501' and position('PERMISSION_DENIED' in sqlerrm) > 0 then
      return;
    end if;
    raise;
  end;
  raise exception 'PHASE3_SECURITY_ASSERTION_FAILED: outsider read analytics';
end;
$outsider_denied$;

reset role;

do $export_contract$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'export_vehicle_booking_analytics'
      and column_name in ('comment', 'resolution_note', 'issue_category')
  ) then
    raise exception 'PHASE3_EXPORT_REDACTION_ASSERTION_FAILED';
  end if;
end;
$export_contract$;

rollback;
