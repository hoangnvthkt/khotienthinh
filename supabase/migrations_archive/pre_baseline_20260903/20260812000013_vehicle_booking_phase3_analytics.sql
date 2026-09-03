-- Vehicle Booking Phase 3B: scoped operational analytics.

begin;

create index if not exists idx_vehicle_bookings_reporting_window
  on public.vehicle_bookings(requested_pickup_at, department_id_snapshot, status);

create index if not exists idx_vehicle_trip_logs_reporting
  on public.vehicle_trip_logs(departed_home_base_at, actual_return_at, trip_status);

create index if not exists idx_vehicle_assignments_external_cost
  on public.vehicle_booking_assignments(booking_id, fulfillment_type)
  where is_active and fulfillment_type = 'EXTERNAL_TRANSPORT';

create index if not exists idx_vehicle_unavailability_reporting
  on public.vehicle_unavailability_periods(vehicle_asset_id, start_at, end_at);

create or replace function app_private.vehicle_require_report_scope(
  p_actor_user_id uuid,
  p_department_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_department_id is null then
    if not app_private.vehicle_user_has_scoped_permission(
      p_actor_user_id,
      'booking.vehicle.view_reports',
      'global',
      '*'
    ) then
      perform app_private.vehicle_raise_permission_denied(
        'Global report permission required'
      );
    end if;
  elsif not (
    app_private.vehicle_user_has_scoped_permission(
      p_actor_user_id,
      'booking.vehicle.view_reports',
      'global',
      '*'
    )
    or app_private.vehicle_user_has_scoped_permission(
      p_actor_user_id,
      'booking.vehicle.view_reports',
      'department',
      p_department_id::text
    )
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Department report permission required'
    );
  end if;
end;
$$;

create or replace function public.get_vehicle_booking_analytics(
  p_from_at timestamptz,
  p_to_at timestamptz,
  p_department_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_completed_trips bigint := 0;
  v_on_time_eligible bigint := 0;
  v_on_time_trips bigint := 0;
  v_submitted_bookings bigint := 0;
  v_late_cancelled bigint := 0;
  v_used_vehicle_minutes numeric := 0;
  v_available_vehicle_minutes numeric := 0;
  v_total_capacity_minutes numeric := 0;
  v_unavailable_vehicle_minutes numeric := 0;
  v_distance_by_vehicle jsonb := '[]'::jsonb;
  v_fulfillment_breakdown jsonb := '[]'::jsonb;
  v_external_cost_by_department jsonb := '[]'::jsonb;
begin
  if p_from_at is null or p_to_at is null or p_to_at <= p_from_at then
    raise exception using errcode = '22023', message = 'INVALID_REPORTING_PERIOD';
  end if;

  perform app_private.vehicle_require_report_scope(
    public.current_app_user_id(),
    p_department_id
  );

  with report_bookings as (
    select b.*
    from public.vehicle_bookings b
    where b.requested_pickup_at >= p_from_at
      and b.requested_pickup_at < p_to_at
      and (p_department_id is null or b.department_id_snapshot = p_department_id)
  ), completed_rows as (
    select
      b.id,
      b.requested_pickup_at,
      a.id as assignment_id,
      a.fulfillment_type,
      t.actual_pickup_at
    from report_bookings b
    left join public.vehicle_booking_assignments a
      on a.booking_id = b.id and a.is_active
    left join public.vehicle_trip_logs t
      on t.booking_id = b.id
    where b.status = 'COMPLETED'
  )
  select
    count(*)::bigint,
    count(*) filter (
      where completed_rows.fulfillment_type in (
        'INTERNAL_WITH_DRIVER', 'INTERNAL_SELF_DRIVE'
      )
      and completed_rows.actual_pickup_at is not null
    )::bigint,
    count(*) filter (
      where completed_rows.fulfillment_type in (
        'INTERNAL_WITH_DRIVER', 'INTERNAL_SELF_DRIVE'
      )
      and completed_rows.actual_pickup_at is not null
      and completed_rows.actual_pickup_at <= completed_rows.requested_pickup_at
        + make_interval(mins => settings.on_time_tolerance_minutes)
    )::bigint
  into v_completed_trips, v_on_time_eligible, v_on_time_trips
  from completed_rows
  cross join public.fleet_system_settings settings
  where settings.id = 1;

  select
    count(*) filter (where b.status <> 'DRAFT')::bigint,
    count(*) filter (where b.close_reason = 'LATE_CANCELLED')::bigint
  into v_submitted_bookings, v_late_cancelled
  from public.vehicle_bookings b
  where b.requested_pickup_at >= p_from_at
    and b.requested_pickup_at < p_to_at
    and (p_department_id is null or b.department_id_snapshot = p_department_id);

  select coalesce(sum(
    extract(epoch from (
      least(coalesce(t.actual_return_at, least(now(), p_to_at)), p_to_at)
      - greatest(t.departed_home_base_at, p_from_at)
    )) / 60.0
  ), 0)
  into v_used_vehicle_minutes
  from public.vehicle_trip_logs t
  join public.vehicle_bookings b on b.id = t.booking_id
  join public.vehicle_booking_assignments a on a.id = t.assignment_id
  where a.fulfillment_type in ('INTERNAL_WITH_DRIVER', 'INTERNAL_SELF_DRIVE')
    and t.departed_home_base_at is not null
    and t.departed_home_base_at < p_to_at
    and coalesce(t.actual_return_at, least(now(), p_to_at)) > p_from_at
    and (p_department_id is null or b.department_id_snapshot = p_department_id);

  select count(*) * extract(epoch from (p_to_at - p_from_at)) / 60.0
  into v_total_capacity_minutes
  from public.fleet_vehicle_profiles profile
  where profile.active;

  select coalesce(sum(
    extract(epoch from (
      least(period.end_at, p_to_at) - greatest(period.start_at, p_from_at)
    )) / 60.0
  ), 0)
  into v_unavailable_vehicle_minutes
  from public.vehicle_unavailability_periods period
  join public.fleet_vehicle_profiles profile
    on profile.asset_id = period.vehicle_asset_id and profile.active
  where period.start_at < p_to_at
    and period.end_at > p_from_at;

  v_available_vehicle_minutes := greatest(
    v_total_capacity_minutes - v_unavailable_vehicle_minutes,
    0
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicleAssetId', distance_rows.vehicle_asset_id,
    'vehicleCode', distance_rows.vehicle_code,
    'vehicleName', distance_rows.vehicle_name,
    'distanceKm', distance_rows.distance_km,
    'tripCount', distance_rows.trip_count
  ) order by distance_rows.distance_km desc, distance_rows.vehicle_code), '[]'::jsonb)
  into v_distance_by_vehicle
  from (
    select
      t.vehicle_asset_id_snapshot as vehicle_asset_id,
      coalesce(asset.code, t.vehicle_asset_id_snapshot) as vehicle_code,
      coalesce(asset.name, t.vehicle_asset_id_snapshot) as vehicle_name,
      round(coalesce(sum(t.distance_km), 0)::numeric, 1) as distance_km,
      count(*)::bigint as trip_count
    from public.vehicle_trip_logs t
    join public.vehicle_bookings b on b.id = t.booking_id
    left join public.assets asset on asset.id = t.vehicle_asset_id_snapshot
    where b.requested_pickup_at >= p_from_at
      and b.requested_pickup_at < p_to_at
      and (p_department_id is null or b.department_id_snapshot = p_department_id)
      and t.trip_status = 'FINISHED'
      and t.vehicle_asset_id_snapshot is not null
    group by t.vehicle_asset_id_snapshot, asset.code, asset.name
  ) distance_rows;

  select coalesce(jsonb_agg(jsonb_build_object(
    'fulfillmentType', fulfillment_rows.fulfillment_type,
    'tripCount', fulfillment_rows.trip_count
  ) order by fulfillment_rows.fulfillment_type), '[]'::jsonb)
  into v_fulfillment_breakdown
  from (
    select a.fulfillment_type, count(*)::bigint as trip_count
    from public.vehicle_bookings b
    join public.vehicle_booking_assignments a
      on a.booking_id = b.id and a.is_active
    where b.requested_pickup_at >= p_from_at
      and b.requested_pickup_at < p_to_at
      and (p_department_id is null or b.department_id_snapshot = p_department_id)
      and b.status = 'COMPLETED'
    group by a.fulfillment_type
  ) fulfillment_rows;

  select coalesce(jsonb_agg(jsonb_build_object(
    'departmentId', cost_rows.department_id,
    'departmentName', cost_rows.department_name,
    'actualCost', cost_rows.actual_cost,
    'tripCount', cost_rows.trip_count
  ) order by cost_rows.actual_cost desc, cost_rows.department_name), '[]'::jsonb)
  into v_external_cost_by_department
  from (
    select
      b.department_id_snapshot as department_id,
      coalesce(org.name, 'Chưa xác định') as department_name,
      round(coalesce(sum(a.external_actual_cost), 0)::numeric, 2) as actual_cost,
      count(*)::bigint as trip_count
    from public.vehicle_bookings b
    join public.vehicle_booking_assignments a
      on a.booking_id = b.id and a.is_active
    left join public.org_units org on org.id = b.department_id_snapshot
    where b.requested_pickup_at >= p_from_at
      and b.requested_pickup_at < p_to_at
      and (p_department_id is null or b.department_id_snapshot = p_department_id)
      and b.status = 'COMPLETED'
      and a.fulfillment_type = 'EXTERNAL_TRANSPORT'
    group by b.department_id_snapshot, org.name
  ) cost_rows;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'fromAt', p_from_at,
      'toAt', p_to_at,
      'timeZone', 'Asia/Ho_Chi_Minh'
    ),
    'scope', jsonb_build_object(
      'departmentId', p_department_id,
      'capacityDenominator', 'CURRENT_ACTIVE_COMPANY_FLEET'
    ),
    'kpis', jsonb_build_object(
      'completedTrips', v_completed_trips,
      'onTimeEligibleTrips', v_on_time_eligible,
      'onTimeTrips', v_on_time_trips,
      'onTimeRate', case when v_on_time_eligible = 0 then null
        else round(100.0 * v_on_time_trips / v_on_time_eligible, 1) end,
      'submittedBookings', v_submitted_bookings,
      'lateCancelledBookings', v_late_cancelled,
      'lateCancellationRate', case when v_submitted_bookings = 0 then null
        else round(100.0 * v_late_cancelled / v_submitted_bookings, 1) end,
      'usedVehicleMinutes', round(v_used_vehicle_minutes, 1),
      'availableVehicleMinutes', round(v_available_vehicle_minutes, 1),
      'vehicleUtilizationRate', case when v_available_vehicle_minutes = 0 then null
        else round(100.0 * v_used_vehicle_minutes / v_available_vehicle_minutes, 1) end
    ),
    'distanceByVehicle', v_distance_by_vehicle,
    'fulfillmentBreakdown', v_fulfillment_breakdown,
    'externalCostByDepartment', v_external_cost_by_department
  );
end;
$$;

create or replace function public.export_vehicle_booking_analytics(
  p_from_at timestamptz,
  p_to_at timestamptz,
  p_department_id uuid default null
) returns table (
  booking_id uuid,
  booking_code text,
  department_id uuid,
  department_name text,
  requested_pickup_at timestamptz,
  actual_pickup_at timestamptz,
  actual_return_at timestamptz,
  fulfillment_type text,
  vehicle_code text,
  vehicle_name text,
  distance_km numeric,
  external_actual_cost numeric,
  status text,
  close_reason text,
  is_on_time boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_from_at is null or p_to_at is null or p_to_at <= p_from_at then
    raise exception using errcode = '22023', message = 'INVALID_REPORTING_PERIOD';
  end if;

  perform app_private.vehicle_require_report_scope(
    public.current_app_user_id(),
    p_department_id
  );

  return query
  select
    b.id,
    b.booking_code,
    b.department_id_snapshot,
    coalesce(org.name, 'Chưa xác định'),
    b.requested_pickup_at,
    t.actual_pickup_at,
    t.actual_return_at,
    a.fulfillment_type,
    coalesce(asset.code, t.vehicle_asset_id_snapshot),
    coalesce(asset.name, t.vehicle_asset_id_snapshot),
    t.distance_km,
    a.external_actual_cost,
    b.status,
    b.close_reason,
    case
      when a.fulfillment_type in ('INTERNAL_WITH_DRIVER', 'INTERNAL_SELF_DRIVE')
        and t.actual_pickup_at is not null
      then t.actual_pickup_at <= b.requested_pickup_at
        + make_interval(mins => settings.on_time_tolerance_minutes)
      else null
    end
  from public.vehicle_bookings b
  left join public.vehicle_booking_assignments a
    on a.booking_id = b.id and a.is_active
  left join public.vehicle_trip_logs t on t.booking_id = b.id
  left join public.assets asset on asset.id = t.vehicle_asset_id_snapshot
  left join public.org_units org on org.id = b.department_id_snapshot
  cross join public.fleet_system_settings settings
  where settings.id = 1
    and b.requested_pickup_at >= p_from_at
    and b.requested_pickup_at < p_to_at
    and b.status <> 'DRAFT'
    and (p_department_id is null or b.department_id_snapshot = p_department_id)
  order by b.requested_pickup_at, b.booking_code;
end;
$$;

revoke all on function app_private.vehicle_require_report_scope(uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.get_vehicle_booking_analytics(timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.get_vehicle_booking_analytics(timestamptz, timestamptz, uuid)
  to authenticated;

revoke all on function public.export_vehicle_booking_analytics(timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.export_vehicle_booking_analytics(timestamptz, timestamptz, uuid)
  to authenticated;

commit;
