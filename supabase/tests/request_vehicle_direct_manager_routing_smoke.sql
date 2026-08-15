-- Direct-manager routing smoke for Request and Vehicle Booking.
-- All fixture changes, audits, and notifications are rolled back.

begin;

create temporary table direct_manager_routing_context (
  requester_user_id uuid not null,
  requester_auth_id uuid not null,
  requester_email text not null,
  manager_user_id uuid not null,
  replacement_manager_user_id uuid not null,
  admin_user_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  manager_booking_id uuid not null,
  bypass_booking_id uuid not null,
  config_disabled_booking_id uuid not null
) on commit drop;

do $fixtures$
declare
  v_requester record;
  v_manager record;
  v_replacement record;
  v_admin record;
  v_booking_manager uuid := gen_random_uuid();
  v_booking_bypass uuid := gen_random_uuid();
  v_booking_config_disabled uuid := gen_random_uuid();
begin
  select app_user.id, app_user.auth_id, app_user.email
  into v_admin
  from public.users app_user
  where app_user.auth_id is not null
    and app_user.role::text = 'ADMIN'
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  order by app_user.created_at, app_user.id
  limit 1;

  select app_user.id, app_user.auth_id, app_user.email
  into v_requester
  from public.users app_user
  where app_user.auth_id is not null
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    and app_user.id is distinct from v_admin.id
  order by app_user.created_at, app_user.id
  limit 1;

  select app_user.id, app_user.auth_id, app_user.email
  into v_manager
  from public.users app_user
  where app_user.auth_id is not null
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    and app_user.id not in (v_admin.id, v_requester.id)
  order by app_user.created_at, app_user.id
  limit 1;

  select app_user.id, app_user.auth_id, app_user.email
  into v_replacement
  from public.users app_user
  where app_user.auth_id is not null
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    and app_user.id not in (v_admin.id, v_requester.id, v_manager.id)
  order by app_user.created_at, app_user.id
  limit 1;

  if v_admin.id is null or v_requester.id is null
     or v_manager.id is null or v_replacement.id is null then
    raise exception using message =
      'DIRECT_MANAGER_SMOKE_FIXTURE_MISSING: four active authenticated users including one ADMIN are required';
  end if;

  -- Exercise the same protected user-update path as an authenticated system
  -- administrator so the privilege guard remains enabled during this smoke.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin.auth_id,
    'email', v_admin.email,
    'role', 'authenticated'
  )::text, true);

  insert into public.user_permission_grants (
    user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, expires_at, revoked_at, grant_reason, updated_at
  ) values
    (v_manager.id, 'booking.vehicle.dispatch', 'global', '*', true,
     v_admin.id, now(), null, null, 'Direct manager routing smoke', now()),
    (v_admin.id, 'booking.vehicle.admin', 'global', '*', true,
     v_admin.id, now(), null, null, 'Direct manager routing smoke', now())
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      revoked_at = null,
      expires_at = null,
      updated_at = now();

  update public.fleet_system_settings
  set require_direct_manager_approval = true
  where id = 1;

  update public.users
  set manager_id = v_manager.id
  where id = v_requester.id;

  if app_private.resolve_active_direct_manager(v_requester.id)
     is distinct from v_manager.id then
    raise exception using message = 'REQUEST_DIRECT_MANAGER_RESOLUTION_FAILED';
  end if;

  update public.users set manager_id = v_requester.id where id = v_requester.id;
  if app_private.resolve_active_direct_manager(v_requester.id) is not null then
    raise exception using message = 'REQUEST_SELF_MANAGER_WAS_NOT_REJECTED';
  end if;
  update public.users set manager_id = v_manager.id where id = v_requester.id;

  insert into direct_manager_routing_context values (
    v_requester.id, v_requester.auth_id, v_requester.email,
    v_manager.id, v_replacement.id,
    v_admin.id, v_admin.auth_id, v_admin.email,
    v_booking_manager, v_booking_bypass, v_booking_config_disabled
  );

  insert into public.vehicle_bookings (
    id, booking_code, requester_user_id, trip_owner_user_id,
    requested_pickup_at, expected_return_at, trip_type,
    pickup_location_text, destination_text, purpose,
    passenger_count, requested_mode, status
  ) values
    (v_booking_manager, 'CAR-DM-' || substr(v_booking_manager::text, 1, 8),
     v_requester.id, v_requester.id, '2098-01-01 01:00:00+00',
     '2098-01-01 02:00:00+00', 'ROUND_TRIP', 'A', 'B',
     'Direct manager smoke', 1, 'WITH_DRIVER', 'DRAFT'),
    (v_booking_bypass, 'CAR-DM-' || substr(v_booking_bypass::text, 1, 8),
     v_requester.id, v_requester.id, '2098-01-02 01:00:00+00',
     '2098-01-02 02:00:00+00', 'ROUND_TRIP', 'A', 'B',
     'Missing manager bypass smoke', 1, 'WITH_DRIVER', 'DRAFT'),
    (v_booking_config_disabled,
     'CAR-DM-' || substr(v_booking_config_disabled::text, 1, 8),
     v_requester.id, v_requester.id, '2098-01-03 01:00:00+00',
     '2098-01-03 02:00:00+00', 'ROUND_TRIP', 'A', 'B',
     'Config disabled smoke', 1, 'WITH_DRIVER', 'DRAFT');
end;
$fixtures$;

grant select on direct_manager_routing_context to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', requester_auth_id, 'email', requester_email, 'role', 'authenticated'
)::text, true) from direct_manager_routing_context;

do $manager_route$
declare
  v_context direct_manager_routing_context%rowtype;
  v_preview jsonb;
  v_result jsonb;
begin
  select * into v_context from direct_manager_routing_context;
  v_preview := public.preview_vehicle_booking_submission_route();
  if v_preview->>'route' <> 'MANAGER'
     or (v_preview->>'manager_user_id')::uuid is distinct from v_context.manager_user_id then
    raise exception 'VEHICLE_MANAGER_PREVIEW_FAILED: %', v_preview;
  end if;

  -- A forged bypass flag must not skip an available manager.
  v_result := public.submit_vehicle_booking(v_context.manager_booking_id, true);
  if v_result->>'manager_approval_route' <> 'MANAGER'
     or v_result->>'status' <> 'PENDING_APPROVAL' then
    raise exception 'VEHICLE_MANAGER_SUBMISSION_FAILED: %', v_result;
  end if;
end;
$manager_route$;

reset role;
update public.users
set manager_id = null
where id = (select requester_user_id from direct_manager_routing_context);

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', requester_auth_id, 'email', requester_email, 'role', 'authenticated'
)::text, true) from direct_manager_routing_context;

do $missing_manager_route$
declare
  v_context direct_manager_routing_context%rowtype;
  v_preview jsonb;
  v_result jsonb;
begin
  select * into v_context from direct_manager_routing_context;
  v_preview := public.preview_vehicle_booking_submission_route();
  if v_preview->>'route' <> 'MISSING_MANAGER_CONFIRMATION_REQUIRED' then
    raise exception 'VEHICLE_MISSING_MANAGER_PREVIEW_FAILED: %', v_preview;
  end if;

  begin
    perform public.submit_vehicle_booking(v_context.bypass_booking_id, false);
    raise exception using message = 'VEHICLE_MISSING_MANAGER_WAS_NOT_BLOCKED';
  exception
    when others then
      if sqlerrm <> 'VEHICLE_DIRECT_MANAGER_CONFIRMATION_REQUIRED' then
        raise;
      end if;
  end;

  if (select status from public.vehicle_bookings
      where id = v_context.bypass_booking_id) <> 'DRAFT' then
    raise exception using message = 'VEHICLE_BLOCKED_SUBMISSION_CHANGED_DRAFT';
  end if;

  v_result := public.submit_vehicle_booking(v_context.bypass_booking_id, true);
  if v_result->>'manager_approval_route' <> 'MISSING_MANAGER_BYPASS'
     or v_result->>'status' <> 'WAITING_DISPATCH' then
    raise exception 'VEHICLE_MANAGER_BYPASS_FAILED: %', v_result;
  end if;
end;
$missing_manager_route$;

reset role;
update public.fleet_system_settings
set require_direct_manager_approval = false
where id = 1;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', requester_auth_id, 'email', requester_email, 'role', 'authenticated'
)::text, true) from direct_manager_routing_context;

do $config_disabled_route$
declare
  v_context direct_manager_routing_context%rowtype;
  v_preview jsonb;
  v_result jsonb;
begin
  select * into v_context from direct_manager_routing_context;
  v_preview := public.preview_vehicle_booking_submission_route();
  if v_preview->>'route' <> 'CONFIG_DISABLED' then
    raise exception 'VEHICLE_CONFIG_DISABLED_PREVIEW_FAILED: %', v_preview;
  end if;

  v_result := public.submit_vehicle_booking(
    v_context.config_disabled_booking_id, false
  );
  if v_result->>'manager_approval_route' <> 'CONFIG_DISABLED'
     or v_result->>'status' <> 'WAITING_DISPATCH' then
    raise exception 'VEHICLE_CONFIG_DISABLED_SUBMISSION_FAILED: %', v_result;
  end if;
end;
$config_disabled_route$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', admin_auth_id, 'email', admin_email, 'role', 'authenticated'
)::text, true) from direct_manager_routing_context;

do $manager_reassignment$
declare
  v_context direct_manager_routing_context%rowtype;
  v_expected_updated_at timestamptz;
  v_result jsonb;
begin
  select * into v_context from direct_manager_routing_context;
  select updated_at into v_expected_updated_at
  from public.vehicle_bookings
  where id = v_context.manager_booking_id;

  v_result := public.reassign_vehicle_booking_manager(
    v_context.manager_booking_id,
    v_context.replacement_manager_user_id,
    'Direct manager routing smoke',
    v_expected_updated_at
  );
  if (v_result->>'manager_user_id')::uuid
     is distinct from v_context.replacement_manager_user_id then
    raise exception 'VEHICLE_MANAGER_REASSIGNMENT_FAILED: %', v_result;
  end if;
end;
$manager_reassignment$;

reset role;

do $final_assertions$
declare
  v_context direct_manager_routing_context%rowtype;
begin
  select * into v_context from direct_manager_routing_context;

  if not exists (
    select 1 from public.audit_trail audit
    where audit.table_name = 'vehicle_bookings'
      and audit.record_id = v_context.manager_booking_id::text
      and audit.changes->>'event' = 'MANAGER_REASSIGNED'
  ) then
    raise exception using message = 'VEHICLE_MANAGER_REASSIGNMENT_AUDIT_MISSING';
  end if;

  if not exists (
    select 1 from public.audit_trail audit
    where audit.table_name = 'vehicle_bookings'
      and audit.record_id = v_context.bypass_booking_id::text
      and audit.changes->>'event' = 'BOOKING_SUBMITTED_MANAGER_BYPASS'
  ) then
    raise exception using message = 'VEHICLE_MANAGER_BYPASS_AUDIT_MISSING';
  end if;

  if not exists (
    select 1 from app_private.vehicle_booking_notification_outbox outbox
    where outbox.event_key like 'vehicle:' || v_context.bypass_booking_id::text || ':%'
  ) then
    raise exception using message = 'VEHICLE_DISPATCH_NOTIFICATION_MISSING';
  end if;
end;
$final_assertions$;

rollback;
