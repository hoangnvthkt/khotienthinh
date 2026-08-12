begin;

create or replace function app_private.get_vehicle_booking_dispatcher_candidates_impl(
  p_actor_user_id uuid
) returns table (
  user_id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  employee_title text,
  employee_avatar_url text,
  department_id uuid,
  department_name text,
  is_dispatcher boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is distinct from public.current_app_user_id() then
    perform app_private.vehicle_raise_permission_denied('Actor mismatch');
  end if;

  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.admin'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Booking administrator permission required'
    );
  end if;

  return query
  select
    app_user.id,
    employee.id,
    employee.employee_code::text,
    employee.full_name::text,
    employee.title::text,
    employee.avatar_url,
    employee.department_id,
    department.name,
    exists (
      select 1
      from public.user_permission_grants grant_row
      where grant_row.user_id = app_user.id
        and grant_row.permission_code = 'booking.vehicle.dispatch'
        and grant_row.scope_type = 'global'
        and grant_row.scope_id = '*'
        and grant_row.is_active
        and grant_row.revoked_at is null
        and (grant_row.expires_at is null or grant_row.expires_at > now())
    )
  from public.employees employee
  join public.users app_user on app_user.id = employee.user_id
  left join public.org_units department on department.id = employee.department_id
  where employee.status = 'Đang làm việc'
    and app_user.is_active
    and app_user.account_status = 'ACTIVE'
    and app_user.role::text <> 'ADMIN'
  order by employee.full_name, employee.employee_code;
end;
$$;

create or replace function public.get_vehicle_booking_dispatcher_candidates()
returns table (
  user_id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  employee_title text,
  employee_avatar_url text,
  department_id uuid,
  department_name text,
  is_dispatcher boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_vehicle_booking_dispatcher_candidates_impl(
    public.current_app_user_id()
  );
$$;

create or replace function app_private.command_set_vehicle_booking_dispatchers(
  p_actor_user_id uuid,
  p_user_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_ids uuid[] := array(
    select distinct selected_user_id
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) selected_user_id
    where selected_user_id is not null
    order by selected_user_id
  );
  v_before_user_ids uuid[];
  v_invalid_count integer;
begin
  if p_actor_user_id is distinct from public.current_app_user_id() then
    perform app_private.vehicle_raise_permission_denied('Actor mismatch');
  end if;

  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.admin'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Booking administrator permission required'
    );
  end if;

  select coalesce(array_agg(grant_row.user_id order by grant_row.user_id), '{}'::uuid[])
  into v_before_user_ids
  from public.user_permission_grants grant_row
  where grant_row.permission_code = 'booking.vehicle.dispatch'
    and grant_row.scope_type = 'global'
    and grant_row.scope_id = '*'
    and grant_row.is_active
    and grant_row.revoked_at is null
    and (grant_row.expires_at is null or grant_row.expires_at > now());

  select count(*)::integer
  into v_invalid_count
  from unnest(v_user_ids) selected_user_id
  where not exists (
    select 1
    from public.users app_user
    join public.employees employee on employee.user_id = app_user.id
    where app_user.id = selected_user_id
      and app_user.is_active
      and app_user.account_status = 'ACTIVE'
      and app_user.role::text <> 'ADMIN'
      and employee.status = 'Đang làm việc'
  );

  if v_invalid_count > 0 then
    raise exception 'DISPATCHER_CANDIDATE_INVALID'
      using errcode = '22023';
  end if;

  update public.user_permission_grants grant_row
  set is_active = false,
      revoked_at = now(),
      revoked_by = p_actor_user_id,
      revoked_reason = 'Cập nhật danh sách nhân sự điều phối Booking',
      updated_at = now()
  where grant_row.permission_code = 'booking.vehicle.dispatch'
    and grant_row.scope_type = 'global'
    and grant_row.scope_id = '*'
    and grant_row.is_active
    and not (grant_row.user_id = any(v_user_ids));

  insert into public.user_permission_grants (
    user_id,
    permission_code,
    scope_type,
    scope_id,
    is_active,
    granted_by,
    granted_at,
    expires_at,
    revoked_at,
    revoked_by,
    revoked_reason,
    grant_reason,
    updated_at
  )
  select
    selected_user_id,
    'booking.vehicle.dispatch',
    'global',
    '*',
    true,
    p_actor_user_id,
    now(),
    null,
    null,
    null,
    null,
    'Được phân công điều phối Booking',
    now()
  from unnest(v_user_ids) selected_user_id
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = null,
      revoked_at = null,
      revoked_by = null,
      revoked_reason = null,
      grant_reason = excluded.grant_reason,
      updated_at = now();

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  ) values (
    p_actor_user_id,
    null,
    'booking_dispatchers_replaced',
    to_jsonb(v_before_user_ids),
    to_jsonb(v_user_ids),
    jsonb_build_object(
      'permissionCode', 'booking.vehicle.dispatch',
      'scopeType', 'global',
      'scopeId', '*'
    )
  );

  return jsonb_build_object(
    'success', true,
    'dispatcherCount', cardinality(v_user_ids)
  );
end;
$$;

create or replace function public.set_vehicle_booking_dispatchers(
  p_user_ids uuid[]
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_set_vehicle_booking_dispatchers(
    public.current_app_user_id(),
    p_user_ids
  );
$$;

create or replace function app_private.get_pending_vehicle_booking_approval_cards_impl(
  p_actor_user_id uuid
) returns table (
  id uuid,
  booking_code text,
  requester_user_id uuid,
  trip_owner_user_id uuid,
  requester_employee_id_snapshot uuid,
  department_id_snapshot uuid,
  manager_user_id_snapshot uuid,
  manager_resolution_status text,
  requested_pickup_at timestamptz,
  expected_return_at timestamptz,
  trip_type text,
  pickup_location_text text,
  destination_text text,
  route_stops jsonb,
  purpose text,
  passenger_count integer,
  requested_mode text,
  preferred_vehicle_asset_id text,
  preferred_driver_user_id uuid,
  note text,
  status text,
  submitted_at timestamptz,
  approved_by_user_id uuid,
  approved_at timestamptz,
  approval_source text,
  approval_note text,
  cancelled_by_user_id uuid,
  cancelled_at timestamptz,
  close_reason text,
  close_note text,
  created_at timestamptz,
  updated_at timestamptz,
  requester_employee_code text,
  requester_employee_name text,
  requester_employee_title text,
  requester_avatar_url text,
  requester_department_name text,
  preferred_vehicle_asset_code text,
  preferred_vehicle_asset_name text,
  preferred_vehicle_image_url text,
  preferred_vehicle_type text,
  preferred_vehicle_seat_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is distinct from public.current_app_user_id() then
    perform app_private.vehicle_raise_permission_denied('Actor mismatch');
  end if;

  if p_actor_user_id is null then
    perform app_private.vehicle_raise_permission_denied('Authentication required');
  end if;

  return query
  select
    booking.id,
    booking.booking_code,
    booking.requester_user_id,
    booking.trip_owner_user_id,
    booking.requester_employee_id_snapshot,
    booking.department_id_snapshot,
    booking.manager_user_id_snapshot,
    booking.manager_resolution_status,
    booking.requested_pickup_at,
    booking.expected_return_at,
    booking.trip_type,
    booking.pickup_location_text,
    booking.destination_text,
    booking.route_stops,
    booking.purpose,
    booking.passenger_count,
    booking.requested_mode,
    booking.preferred_vehicle_asset_id,
    booking.preferred_driver_user_id,
    booking.note,
    booking.status,
    booking.submitted_at,
    booking.approved_by_user_id,
    booking.approved_at,
    booking.approval_source,
    booking.approval_note,
    booking.cancelled_by_user_id,
    booking.cancelled_at,
    booking.close_reason,
    booking.close_note,
    booking.created_at,
    booking.updated_at,
    requester.employee_code::text,
    requester.full_name::text,
    requester.title::text,
    requester.avatar_url,
    requester_department.name,
    asset.code,
    asset.name,
    asset.image_url,
    vehicle.vehicle_type,
    vehicle.seat_count
  from public.vehicle_bookings booking
  left join lateral (
    select employee.*
    from public.employees employee
    where employee.id = booking.requester_employee_id_snapshot
       or employee.user_id = booking.requester_user_id
    order by (employee.id = booking.requester_employee_id_snapshot) desc,
             employee.updated_at desc
    limit 1
  ) requester on true
  left join public.org_units requester_department
    on requester_department.id = coalesce(requester.department_id, booking.department_id_snapshot)
  left join public.fleet_vehicle_profiles vehicle
    on vehicle.asset_id = booking.preferred_vehicle_asset_id
  left join public.assets asset
    on asset.id = booking.preferred_vehicle_asset_id
  where booking.status = 'PENDING_APPROVAL'
    and (
      booking.manager_user_id_snapshot = p_actor_user_id
      or app_private.vehicle_user_has_permission(
        p_actor_user_id,
        'booking.vehicle.approve_direct_reports'
      )
    )
  order by booking.requested_pickup_at, booking.created_at;
end;
$$;

create or replace function public.get_pending_vehicle_booking_approval_cards()
returns table (
  id uuid,
  booking_code text,
  requester_user_id uuid,
  trip_owner_user_id uuid,
  requester_employee_id_snapshot uuid,
  department_id_snapshot uuid,
  manager_user_id_snapshot uuid,
  manager_resolution_status text,
  requested_pickup_at timestamptz,
  expected_return_at timestamptz,
  trip_type text,
  pickup_location_text text,
  destination_text text,
  route_stops jsonb,
  purpose text,
  passenger_count integer,
  requested_mode text,
  preferred_vehicle_asset_id text,
  preferred_driver_user_id uuid,
  note text,
  status text,
  submitted_at timestamptz,
  approved_by_user_id uuid,
  approved_at timestamptz,
  approval_source text,
  approval_note text,
  cancelled_by_user_id uuid,
  cancelled_at timestamptz,
  close_reason text,
  close_note text,
  created_at timestamptz,
  updated_at timestamptz,
  requester_employee_code text,
  requester_employee_name text,
  requester_employee_title text,
  requester_avatar_url text,
  requester_department_name text,
  preferred_vehicle_asset_code text,
  preferred_vehicle_asset_name text,
  preferred_vehicle_image_url text,
  preferred_vehicle_type text,
  preferred_vehicle_seat_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_pending_vehicle_booking_approval_cards_impl(
    public.current_app_user_id()
  );
$$;

revoke all on function app_private.get_vehicle_booking_dispatcher_candidates_impl(uuid)
  from public, anon;
revoke all on function app_private.command_set_vehicle_booking_dispatchers(uuid, uuid[])
  from public, anon;
revoke all on function app_private.get_pending_vehicle_booking_approval_cards_impl(uuid)
  from public, anon;

grant execute on function app_private.get_vehicle_booking_dispatcher_candidates_impl(uuid)
  to authenticated;
grant execute on function app_private.command_set_vehicle_booking_dispatchers(uuid, uuid[])
  to authenticated;
grant execute on function app_private.get_pending_vehicle_booking_approval_cards_impl(uuid)
  to authenticated;

revoke all on function public.get_vehicle_booking_dispatcher_candidates()
  from public, anon;
revoke all on function public.set_vehicle_booking_dispatchers(uuid[])
  from public, anon;
revoke all on function public.get_pending_vehicle_booking_approval_cards()
  from public, anon;

grant execute on function public.get_vehicle_booking_dispatcher_candidates()
  to authenticated;
grant execute on function public.set_vehicle_booking_dispatchers(uuid[])
  to authenticated;
grant execute on function public.get_pending_vehicle_booking_approval_cards()
  to authenticated;

notify pgrst, 'reload schema';

commit;
