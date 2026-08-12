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
  vehicle_asset_id text not null,
  audit_booking_id uuid not null,
  audit_assignment_id uuid not null,
  audit_replacement_assignment_id uuid not null,
  feedback_good_booking_id uuid not null,
  feedback_issue_booking_id uuid not null
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
  v_fleet_location_id uuid;
  v_booking_on_time uuid := gen_random_uuid();
  v_booking_late uuid := gen_random_uuid();
  v_booking_external uuid := gen_random_uuid();
  v_booking_cancelled uuid := gen_random_uuid();
  v_feedback_good_booking uuid := gen_random_uuid();
  v_feedback_issue_booking uuid := gen_random_uuid();
  v_assignment_on_time uuid := gen_random_uuid();
  v_assignment_late uuid := gen_random_uuid();
  v_assignment_external uuid := gen_random_uuid();
  v_assignment_replacement uuid := gen_random_uuid();
begin
  for v_candidate in
    select u.id, u.auth_id, u.email,
      row_number() over (order by u.created_at, u.id) as row_number
    from public.users u
    where u.auth_id is not null
      and coalesce(u.is_active, true)
      and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
      and u.role::text <> 'ADMIN'
      and not exists (
        select 1 from public.user_permission_grants grant_row
        where grant_row.user_id = u.id
          and grant_row.permission_code in (
            'booking.vehicle.admin',
            'booking.vehicle.view_reports',
            'booking.vehicle.view_sensitive_feedback',
            'booking.vehicle.resolve_sensitive_feedback',
            'booking.vehicle.view_audit'
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
    raise exception 'PHASE3_SMOKE_FIXTURE_MISSING: three active non-admin authenticated users are required';
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

    select location.id into v_fleet_location_id
    from public.fleet_locations location
    where location.active
    order by location.created_at, location.id
    limit 1;
    if v_fleet_location_id is null then
      v_fleet_location_id := gen_random_uuid();
      insert into public.fleet_locations(id, name, source_type, active)
      values (v_fleet_location_id, 'Phase 3 smoke home base', 'CUSTOM', true);
    end if;

    insert into public.fleet_vehicle_profiles(
      asset_id, home_base_id, vehicle_type, seat_count, availability_status,
      allow_self_drive, current_odometer, custody_status,
      inspection_expiry_date, insurance_expiry_date, active
    ) values (
      v_vehicle_asset_id, v_fleet_location_id, 'PHASE3_SMOKE', 5, 'AVAILABLE',
      false, 0, 'AVAILABLE', current_date + 365, current_date + 365, true
    );
  end if;

  insert into public.user_permission_grants(
    user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, grant_reason
  ) values
    (v_global.id, 'booking.vehicle.view_reports', 'global', '*', true,
     v_global.id, now(), 'Vehicle booking phase 3 smoke'),
    (v_global.id, 'booking.vehicle.view_sensitive_feedback', 'global', '*', true,
     v_global.id, now(), 'Vehicle booking phase 3 smoke'),
    (v_global.id, 'booking.vehicle.view_audit', 'global', '*', true,
     v_global.id, now(), 'Vehicle booking phase 3 smoke'),
    (v_department.id, 'booking.vehicle.view_reports', 'department',
     v_department_id::text, true, v_global.id, now(),
     'Vehicle booking phase 3 smoke'),
    (v_department.id, 'booking.vehicle.resolve_sensitive_feedback', 'global', '*', true,
     v_global.id, now(), 'Vehicle booking phase 3 smoke'),
    (v_department.id, 'booking.vehicle.view_audit', 'department',
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
    v_department_id, v_other_department_id, v_vehicle_asset_id,
    v_booking_on_time, v_assignment_on_time, v_assignment_replacement,
    v_feedback_good_booking, v_feedback_issue_booking
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
     'CANCELLED', '2096-07-01 00:00:00+00'),
    (v_feedback_good_booking, 'CAR-P3-' || substr(v_feedback_good_booking::text, 1, 8),
     v_outsider.id, v_outsider.id, v_other_department_id,
     '2096-08-03 01:00:00+00', '2096-08-03 02:00:00+00',
     'ROUND_TRIP', 'A', 'B', 'Phase 3 positive feedback', 1, 'WITH_DRIVER',
     'COMPLETED', '2096-08-02 00:00:00+00'),
    (v_feedback_issue_booking, 'CAR-P3-' || substr(v_feedback_issue_booking::text, 1, 8),
     v_outsider.id, v_outsider.id, v_other_department_id,
     '2096-08-03 03:00:00+00', '2096-08-03 04:00:00+00',
     'ROUND_TRIP', 'A', 'B', 'Phase 3 sensitive feedback', 1, 'WITH_DRIVER',
     'COMPLETED', '2096-08-02 00:00:00+00');

  update public.vehicle_bookings
  set close_reason = 'LATE_CANCELLED',
      cancelled_at = '2096-08-01 06:30:00+00',
      cancelled_by_user_id = v_global.id
  where id = v_booking_cancelled;

  insert into public.vehicle_booking_assignments(
    id, booking_id, version, is_active, fulfillment_type,
    vehicle_asset_id, operator_user_id, operator_type,
    reserved_start_at, reserved_end_at, assigned_by_user_id,
    external_service_type, external_actual_cost, assigned_at
  ) values
    (v_assignment_on_time, v_booking_on_time, 1, true,
     'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_global.id,
     'PROFESSIONAL_DRIVER', '2096-08-01 01:00:00+00',
     '2096-08-01 02:00:00+00', v_global.id, null, null,
     '2096-07-30 10:00:00+00'),
    (v_assignment_late, v_booking_late, 1, true,
     'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_global.id,
     'PROFESSIONAL_DRIVER', '2096-08-01 03:00:00+00',
     '2096-08-01 04:00:00+00', v_global.id, null, null,
     '2096-07-30 11:00:00+00'),
    (v_assignment_external, v_booking_external, 1, true,
     'EXTERNAL_TRANSPORT', null, null, null,
     '2096-08-01 05:00:00+00', '2096-08-01 06:00:00+00',
     v_global.id, 'TAXI', 300000, '2096-07-30 12:00:00+00');

  update public.vehicle_booking_assignments
  set is_active = false,
      released_at = '2096-07-31 10:00:00+00',
      superseded_at = '2096-07-31 10:00:00+00',
      superseded_by_user_id = v_department.id,
      supersede_reason = 'Phase 3 audit reassignment',
      updated_at = now()
  where id = v_assignment_on_time;

  insert into public.vehicle_booking_assignments(
    id, booking_id, version, is_active, fulfillment_type,
    vehicle_asset_id, operator_user_id, operator_type,
    reserved_start_at, reserved_end_at, assigned_by_user_id, assigned_at
  ) values (
    v_assignment_replacement, v_booking_on_time, 2, true,
    'INTERNAL_WITH_DRIVER', v_vehicle_asset_id, v_global.id,
    'PROFESSIONAL_DRIVER', '2096-08-01 01:00:00+00',
    '2096-08-01 02:00:00+00', v_global.id, '2096-07-31 11:00:00+00'
  );

  insert into public.vehicle_handover_logs(
    booking_id, assignment_id, assignment_version_snapshot,
    vehicle_asset_id_snapshot, operator_user_id_snapshot, event_type,
    officer_user_id, confirmed_at, note
  ) values (
    v_booking_on_time, v_assignment_replacement, 2,
    v_vehicle_asset_id, v_global.id, 'OUTBOUND_HANDOVER',
    v_department.id, '2096-08-01 00:30:00+00', 'Phase 3 handover'
  );

  insert into public.vehicle_booking_feedback(booking_id, respondent_user_id, status)
  values
    (v_feedback_good_booking, v_outsider.id, 'PENDING'),
    (v_feedback_issue_booking, v_outsider.id, 'PENDING');

  insert into public.vehicle_trip_logs(
    booking_id, assignment_id, assignment_version_snapshot,
    vehicle_asset_id_snapshot, operator_user_id_snapshot, trip_status,
    departed_home_base_at, actual_pickup_at, actual_return_at,
    start_odometer, end_odometer, distance_km,
    start_photo_path, start_location_capture_failed, start_location_failure_reason,
    end_photo_path, end_location_capture_failed, end_location_failure_reason,
    vehicle_condition_end
  ) values
    (v_booking_on_time, v_assignment_on_time, 1, v_vehicle_asset_id,
     v_global.id, 'FINISHED', '2096-08-01 01:00:00+00',
     '2096-08-01 01:10:00+00', '2096-08-01 02:00:00+00', 100, 120, 20,
     v_booking_on_time::text || '/start.jpg', true, 'Phase 3 fixture',
     v_booking_on_time::text || '/end.jpg', true, 'Phase 3 fixture', 'NORMAL'),
    (v_booking_late, v_assignment_late, 1, v_vehicle_asset_id,
     v_global.id, 'FINISHED', '2096-08-01 03:00:00+00',
     '2096-08-01 03:30:00+00', '2096-08-01 04:00:00+00', 120, 150, 30,
     v_booking_late::text || '/start.jpg', true, 'Phase 3 fixture',
     v_booking_late::text || '/end.jpg', true, 'Phase 3 fixture', 'NORMAL');

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

do $feedback_and_actor_binding$
declare
  v_context vehicle_booking_phase3_context%rowtype;
  v_payload jsonb;
  v_rejected boolean := false;
begin
  select * into v_context from vehicle_booking_phase3_context;

  v_payload := public.submit_vehicle_feedback(
    v_context.feedback_good_booking_id,
    false,
    5,
    array['CLEAN_VEHICLE', 'COURTEOUS_DRIVER'],
    null,
    null
  );
  if not coalesce((v_payload ->> 'success')::boolean, false) then
    raise exception 'PHASE3_FEEDBACK_CONFIRM_ASSERTION_FAILED: %', v_payload;
  end if;

  begin
    perform public.submit_vehicle_feedback(
      v_context.feedback_issue_booking_id,
      false,
      2,
      array[]::text[],
      null,
      null
    );
  exception when others then
    if sqlstate = '22023' and position('LOW_RATING_REQUIRES_ISSUE' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'PHASE3_LOW_RATING_ASSERTION_FAILED';
  end if;

  begin
    perform app_private.command_submit_vehicle_feedback(
      v_context.global_user_id,
      v_context.feedback_issue_booking_id,
      true,
      2,
      array[]::text[],
      'SERVICE_DELAY',
      'Forged actor attempt'
    );
    raise exception 'PHASE3_FORGED_FEEDBACK_ACTOR_WAS_ACCEPTED';
  exception when others then
    if sqlstate <> '42501' or position('VEHICLE_ACTOR_MISMATCH' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  v_payload := public.submit_vehicle_feedback(
    v_context.feedback_issue_booking_id,
    true,
    2,
    array[]::text[],
    'SERVICE_DELAY',
    'Phase 3 private issue detail'
  );
  if not coalesce((v_payload ->> 'success')::boolean, false)
     or nullif(v_payload ->> 'issue_id', '') is null then
    raise exception 'PHASE3_FEEDBACK_ISSUE_ASSERTION_FAILED: %', v_payload;
  end if;
  perform set_config('vehicle_booking_smoke.issue_id', v_payload ->> 'issue_id', true);
end;
$feedback_and_actor_binding$;

reset role;

do $feedback_persistence$
declare
  v_context vehicle_booking_phase3_context%rowtype;
  v_issue_id uuid := current_setting('vehicle_booking_smoke.issue_id')::uuid;
begin
  select * into v_context from vehicle_booking_phase3_context;

  if not exists (
    select 1
    from public.vehicle_booking_feedback feedback
    where feedback.booking_id = v_context.feedback_good_booking_id
      and feedback.status = 'CONFIRMED'
      and feedback.rating = 5
      and feedback.positive_tags = array['CLEAN_VEHICLE', 'COURTEOUS_DRIVER']::text[]
  ) then
    raise exception 'PHASE3_FEEDBACK_CONFIRM_PERSISTENCE_FAILED';
  end if;

  if not exists (
    select 1
    from public.vehicle_booking_issues issue
    join public.vehicle_booking_feedback feedback on feedback.booking_id = issue.booking_id
    where issue.id = v_issue_id
      and issue.booking_id = v_context.feedback_issue_booking_id
      and issue.comment = 'Phase 3 private issue detail'
      and issue.resolution_status = 'PENDING'
      and feedback.status = 'ISSUE_REPORTED'
      and feedback.rating = 2
  ) then
    raise exception 'PHASE3_FEEDBACK_ISSUE_PERSISTENCE_FAILED';
  end if;
end;
$feedback_persistence$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', global_auth_id, 'email', global_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_phase3_context;

do $viewer_and_audit$
declare
  v_context vehicle_booking_phase3_context%rowtype;
  v_issue_id uuid := current_setting('vehicle_booking_smoke.issue_id')::uuid;
  v_issues jsonb;
  v_timeline jsonb;
  v_expected_superseder text;
begin
  select * into v_context from vehicle_booking_phase3_context;

  v_issues := public.get_vehicle_booking_issues(null, 50, null, null);
  if not exists (
    select 1
    from jsonb_array_elements(v_issues -> 'items') item
    where (item ->> 'id')::uuid = v_issue_id
      and item ->> 'comment' = 'Phase 3 private issue detail'
  ) then
    raise exception 'PHASE3_ISSUE_VIEW_ASSERTION_FAILED: %', v_issues;
  end if;

  begin
    perform public.transition_vehicle_booking_issue(v_issue_id, 'IN_REVIEW', null);
    raise exception 'PHASE3_VIEWER_TRANSITION_WAS_ACCEPTED';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  v_timeline := public.get_vehicle_booking_audit_timeline(
    v_context.audit_booking_id, null, null, null, null, 50, null, null
  );
  select coalesce(u.name, u.email)
  into v_expected_superseder
  from public.users u
  where u.id = v_context.department_user_id;

  if not exists (
    select 1 from jsonb_array_elements(v_timeline -> 'items') item
    where item ->> 'id' = 'ASSIGNMENT_CREATED:' || v_context.audit_assignment_id::text
      and (item ->> 'occurredAt')::timestamptz = '2096-07-30 10:00:00+00'
      and item ->> 'eventType' = 'ASSIGNMENT_CREATED'
  ) or not exists (
    select 1 from jsonb_array_elements(v_timeline -> 'items') item
    where item ->> 'id' = 'ASSIGNMENT_SUPERSEDED:' || v_context.audit_assignment_id::text
      and (item ->> 'occurredAt')::timestamptz = '2096-07-31 10:00:00+00'
      and item ->> 'eventType' = 'ASSIGNMENT_SUPERSEDED'
      and item ->> 'actorName' = v_expected_superseder
  ) or not exists (
    select 1 from jsonb_array_elements(v_timeline -> 'items') item
    where item ->> 'id' = 'ASSIGNMENT_CREATED:' || v_context.audit_replacement_assignment_id::text
      and (item ->> 'occurredAt')::timestamptz = '2096-07-31 11:00:00+00'
  ) or not exists (
    select 1 from jsonb_array_elements(v_timeline -> 'items') item
    where item ->> 'sourceType' = 'HANDOVER'
      and item ->> 'eventType' = 'OUTBOUND_HANDOVER'
  ) then
    raise exception 'PHASE3_AUDIT_TIMELINE_ASSERTION_FAILED: %', v_timeline;
  end if;

  if lower(v_timeline::text) like '%"olddata"%'
     or lower(v_timeline::text) like '%"newdata"%'
     or lower(v_timeline::text) like '%"comment"%'
     or lower(v_timeline::text) like '%"resolutionnote"%'
     or v_timeline::text like '%Phase 3 private issue detail%' then
    raise exception 'PHASE3_AUDIT_REDACTION_ASSERTION_FAILED: %', v_timeline;
  end if;
end;
$viewer_and_audit$;

do $export_contract$
declare
  v_result_type text;
  v_row jsonb;
begin
  v_result_type := lower(pg_get_function_result(
    'public.export_vehicle_booking_analytics(timestamptz,timestamptz,uuid)'::regprocedure
  ));
  if v_result_type like '%comment%'
     or v_result_type like '%resolution_note%'
     or v_result_type like '%issue_category%' then
    raise exception 'PHASE3_EXPORT_SIGNATURE_REDACTION_FAILED: %', v_result_type;
  end if;

  select to_jsonb(export_row)
  into v_row
  from public.export_vehicle_booking_analytics(
    '2096-08-01 00:00:00+00', '2096-08-02 00:00:00+00', null
  ) export_row
  limit 1;

  if v_row is null
     or v_row ?| array['comment', 'resolution_note', 'issue_category'] then
    raise exception 'PHASE3_EXPORT_ROW_REDACTION_FAILED: %', v_row;
  end if;
end;
$export_contract$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', department_auth_id, 'email', department_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_phase3_context;

do $resolver_only_cannot_list$
begin
  begin
    perform public.get_vehicle_booking_issues(null, 50, null, null);
    raise exception 'PHASE3_RESOLVER_ONLY_LIST_WAS_ACCEPTED';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end;
$resolver_only_cannot_list$;

reset role;
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active,
  granted_by, granted_at, grant_reason
)
select department_user_id, 'booking.vehicle.view_sensitive_feedback',
  'global', '*', true, global_user_id, now(), 'Vehicle booking phase 3 smoke'
from vehicle_booking_phase3_context
on conflict (user_id, permission_code, scope_type, scope_id) do update
set is_active = true, revoked_at = null, expires_at = null, updated_at = now();

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', department_auth_id, 'email', department_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_phase3_context;

do $issue_resolution_and_department_audit$
declare
  v_context vehicle_booking_phase3_context%rowtype;
  v_issue_id uuid := current_setting('vehicle_booking_smoke.issue_id')::uuid;
  v_payload jsonb;
  v_rejected boolean := false;
begin
  select * into v_context from vehicle_booking_phase3_context;

  v_payload := public.transition_vehicle_booking_issue(v_issue_id, 'IN_REVIEW', null);
  if v_payload ->> 'status' <> 'IN_REVIEW' then
    raise exception 'PHASE3_ISSUE_IN_REVIEW_ASSERTION_FAILED: %', v_payload;
  end if;

  begin
    perform public.transition_vehicle_booking_issue(v_issue_id, 'RESOLVED', null);
  exception when others then
    if sqlstate = '22023' and position('RESOLUTION_NOTE_INVALID' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'PHASE3_RESOLUTION_NOTE_ASSERTION_FAILED';
  end if;

  v_payload := public.transition_vehicle_booking_issue(
    v_issue_id, 'RESOLVED', 'Phase 3 resolved privately'
  );
  if v_payload ->> 'status' <> 'RESOLVED' then
    raise exception 'PHASE3_ISSUE_RESOLVED_ASSERTION_FAILED: %', v_payload;
  end if;

  perform public.get_vehicle_booking_audit_timeline(
    v_context.audit_booking_id, v_context.department_id,
    null, null, null, 50, null, null
  );

  begin
    perform public.get_vehicle_booking_audit_timeline(
      null, v_context.other_department_id, null, null, null, 50, null, null
    );
    raise exception 'PHASE3_DEPARTMENT_AUDIT_SCOPE_WAS_BYPASSED';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  begin
    perform app_private.command_transition_vehicle_booking_issue(
      v_context.global_user_id, v_issue_id, 'RESOLVED', 'Forged actor'
    );
    raise exception 'PHASE3_FORGED_ISSUE_ACTOR_WAS_ACCEPTED';
  exception when others then
    if sqlstate <> '42501' or position('VEHICLE_ACTOR_MISMATCH' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end;
$issue_resolution_and_department_audit$;

reset role;

do $issue_redaction_and_outbox$
declare
  v_context vehicle_booking_phase3_context%rowtype;
  v_issue_id uuid := current_setting('vehicle_booking_smoke.issue_id')::uuid;
  v_outbox_id uuid;
begin
  select * into v_context from vehicle_booking_phase3_context;

  if not exists (
    select 1
    from public.vehicle_booking_issues issue
    join public.vehicle_booking_feedback feedback on feedback.booking_id = issue.booking_id
    where issue.id = v_issue_id
      and issue.resolution_status = 'RESOLVED'
      and issue.resolution_note = 'Phase 3 resolved privately'
      and feedback.status = 'RESOLVED'
  ) then
    raise exception 'PHASE3_ISSUE_RESOLUTION_PERSISTENCE_FAILED';
  end if;

  if exists (
    select 1
    from public.audit_trail audit
    where audit.record_id = v_context.feedback_issue_booking_id::text
      and (
        row_to_json(audit)::text like '%Phase 3 private issue detail%'
        or row_to_json(audit)::text like '%Phase 3 resolved privately%'
      )
  ) then
    raise exception 'PHASE3_SHARED_AUDIT_LEAKED_SENSITIVE_FEEDBACK';
  end if;

  select outbox.id
  into v_outbox_id
  from app_private.vehicle_booking_notification_outbox outbox
  where outbox.event_type = 'ISSUE_RESOLVED'
    and outbox.recipient_user_id = v_context.outsider_user_id
    and outbox.payload ->> 'booking_id' = v_context.feedback_issue_booking_id::text
  order by outbox.created_at desc
  limit 1;

  if v_outbox_id is null then
    raise exception 'PHASE3_ISSUE_NOTIFICATION_OUTBOX_MISSING';
  end if;
  if exists (
    select 1 from app_private.vehicle_booking_notification_outbox outbox
    where outbox.id = v_outbox_id
      and (
        outbox.payload::text like '%Phase 3 private issue detail%'
        or outbox.payload::text like '%Phase 3 resolved privately%'
      )
  ) then
    raise exception 'PHASE3_ISSUE_NOTIFICATION_OUTBOX_LEAKED_SENSITIVE_DATA';
  end if;

  update app_private.vehicle_booking_notification_outbox
  set status = 'PROCESSING', attempt_count = greatest(attempt_count, 1),
      locked_at = now(), updated_at = now()
  where id = v_outbox_id;
  perform set_config('vehicle_booking_smoke.outbox_id', v_outbox_id::text, true);
end;
$issue_redaction_and_outbox$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $deliver_issue_notification$
declare
  v_payload jsonb;
begin
  v_payload := public.deliver_vehicle_notification(
    current_setting('vehicle_booking_smoke.outbox_id')::uuid
  );
  if not coalesce((v_payload ->> 'delivered')::boolean, false) then
    raise exception 'PHASE3_ISSUE_NOTIFICATION_DELIVERY_FAILED: %', v_payload;
  end if;
end;
$deliver_issue_notification$;

reset role;

do $notification_grants_jobs_and_realtime$
declare
  v_context vehicle_booking_phase3_context%rowtype;
  v_public_wrapper_is_definer boolean;
begin
  select * into v_context from vehicle_booking_phase3_context;

  if not exists (
    select 1
    from public.notifications notification
    where notification.source_type = 'vehicle_booking'
      and notification.source_id = v_context.feedback_issue_booking_id::text
      and notification.user_id = v_context.outsider_user_id::text
      and notification.title = 'Phản ánh chuyến xe đã được xử lý'
      and notification.link = '/booking/vehicle/my?booking=' || v_context.feedback_issue_booking_id::text
      and notification.action_url = '/booking/vehicle/my?booking=' || v_context.feedback_issue_booking_id::text
      and notification.metadata::text not like '%Phase 3 private issue detail%'
      and notification.metadata::text not like '%Phase 3 resolved privately%'
  ) then
    raise exception 'PHASE3_CANONICAL_NOTIFICATION_ASSERTION_FAILED';
  end if;

  if not has_function_privilege(
      'authenticated',
      to_regprocedure('public.submit_vehicle_feedback(uuid,boolean,integer,text[],text,text)'),
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      to_regprocedure('public.submit_vehicle_feedback(uuid,boolean,integer,text[],text,text)'),
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      to_regprocedure('app_private.command_submit_vehicle_feedback(uuid,uuid,boolean,integer,text[],text,text)'),
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      to_regprocedure('app_private.command_submit_vehicle_feedback_phase3_impl(uuid,uuid,boolean,integer,text[],text,text)'),
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      to_regprocedure('public.get_vehicle_booking_audit_timeline(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,text)'),
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      to_regprocedure('public.get_vehicle_booking_audit_timeline(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,text)'),
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      to_regprocedure('public.deliver_vehicle_notification(uuid)'),
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      to_regprocedure('public.deliver_vehicle_notification(uuid)'),
      'EXECUTE'
    ) then
    raise exception 'PHASE3_FUNCTION_GRANT_ASSERTION_FAILED';
  end if;

  select proc.prosecdef
  into v_public_wrapper_is_definer
  from pg_proc proc
  where proc.oid = to_regprocedure(
    'public.transition_vehicle_booking_issue(uuid,text,text)'
  );
  if v_public_wrapper_is_definer then
    raise exception 'PHASE3_PUBLIC_COMMAND_WRAPPER_MUST_BE_SECURITY_INVOKER';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'vehicle-booking-feedback-auto-close'
      and schedule = '*/5 * * * *' and active
  ) or not exists (
    select 1 from cron.job
    where jobname = 'vehicle-booking-notification-outbox'
      and schedule = '* * * * *' and active
  ) then
    raise exception 'PHASE3_CRON_ASSERTION_FAILED';
  end if;

  if (
    select count(*)
    from pg_publication_tables published
    where published.pubname = 'supabase_realtime'
      and published.schemaname = 'public'
      and published.tablename in (
        'notifications',
        'vehicle_bookings',
        'vehicle_booking_assignments',
        'fleet_vehicle_profiles',
        'vehicle_unavailability_periods',
        'operator_unavailability_periods'
      )
  ) <> 6 then
    raise exception 'PHASE3_REALTIME_PUBLICATION_ASSERTION_FAILED';
  end if;
end;
$notification_grants_jobs_and_realtime$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_phase3_context;

do $outsider_audit_denied$
declare
  v_booking_id uuid;
begin
  select audit_booking_id into v_booking_id from vehicle_booking_phase3_context;
  begin
    perform public.get_vehicle_booking_audit_timeline(
      v_booking_id, null, null, null, null, 50, null, null
    );
    raise exception 'PHASE3_OUTSIDER_AUDIT_WAS_ACCEPTED';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end;
$outsider_audit_denied$;

reset role;

rollback;
