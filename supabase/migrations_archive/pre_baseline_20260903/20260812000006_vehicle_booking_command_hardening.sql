-- Vehicle Booking Phase 1.1B: state machine and command hardening.
-- Cloud-only additive migration; safe to re-run.

begin;

alter table public.fleet_system_settings
  add column if not exists trip_reminder_minutes integer not null default 60,
  add column if not exists require_handover_for_self_drive boolean not null default true,
  add column if not exists allow_dispatch_approval_override boolean not null default true;

do $settings_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fleet_system_settings'::regclass
      and conname = 'fleet_system_settings_trip_reminder_nonnegative'
  ) then
    alter table public.fleet_system_settings
      add constraint fleet_system_settings_trip_reminder_nonnegative
      check (trip_reminder_minutes >= 0);
  end if;
end;
$settings_constraints$;

alter table public.fleet_vehicle_profiles
  alter column home_base_id set not null;

do $booking_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_booking_assignments'::regclass
      and conname = 'vehicle_assignment_fulfillment_shape_check'
  ) then
    alter table public.vehicle_booking_assignments
      add constraint vehicle_assignment_fulfillment_shape_check
      check (
        (
          fulfillment_type = 'INTERNAL_WITH_DRIVER'
          and vehicle_asset_id is not null
          and operator_user_id is not null
          and operator_type = 'PROFESSIONAL_DRIVER'
          and external_service_type is null
        )
        or (
          fulfillment_type = 'INTERNAL_SELF_DRIVE'
          and vehicle_asset_id is not null
          and operator_user_id is not null
          and operator_type = 'SELF_DRIVER'
          and handover_officer_user_id is not null
          and external_service_type is null
        )
        or (
          fulfillment_type = 'EXTERNAL_TRANSPORT'
          and vehicle_asset_id is null
          and operator_user_id is null
          and operator_type is null
          and handover_officer_user_id is null
          and nullif(trim(external_service_type), '') is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_booking_assignments'::regclass
      and conname = 'vehicle_assignment_non_home_base_reason_check'
  ) then
    alter table public.vehicle_booking_assignments
      add constraint vehicle_assignment_non_home_base_reason_check
      check (
        not allow_non_home_base_return
        or nullif(trim(non_home_base_return_reason), '') is not null
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_trip_logs'::regclass
      and conname = 'vehicle_trip_start_evidence_check'
  ) then
    alter table public.vehicle_trip_logs
      add constraint vehicle_trip_start_evidence_check
      check (
        trip_status = 'NOT_STARTED'
        or (
          start_odometer is not null
          and nullif(trim(start_photo_path), '') is not null
          and (
            (not start_location_capture_failed and start_latitude is not null and start_longitude is not null)
            or (
              start_location_capture_failed
              and nullif(trim(start_location_failure_reason), '') is not null
            )
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_trip_logs'::regclass
      and conname = 'vehicle_trip_finish_evidence_check'
  ) then
    alter table public.vehicle_trip_logs
      add constraint vehicle_trip_finish_evidence_check
      check (
        trip_status <> 'FINISHED'
        or (
          end_odometer is not null
          and nullif(trim(end_photo_path), '') is not null
          and vehicle_condition_end is not null
          and (
            vehicle_condition_end <> 'ISSUE'
            or nullif(trim(issue_note), '') is not null
          )
          and (
            (not end_location_capture_failed and end_latitude is not null and end_longitude is not null)
            or (
              end_location_capture_failed
              and nullif(trim(end_location_failure_reason), '') is not null
            )
          )
        )
      );
  end if;
end;
$booking_constraints$;

create index if not exists idx_vehicle_participants_user_booking
  on public.vehicle_booking_participants(user_id, booking_id)
  where user_id is not null;
create index if not exists idx_vehicle_assignments_operator_active
  on public.vehicle_booking_assignments(operator_user_id, booking_id)
  where is_active and operator_user_id is not null;
create index if not exists idx_vehicle_assignments_handover_active
  on public.vehicle_booking_assignments(handover_officer_user_id, booking_id)
  where is_active and handover_officer_user_id is not null;
create index if not exists idx_vehicle_unavailability_asset_range
  on public.vehicle_unavailability_periods using gist(vehicle_asset_id, scheduled_range);
create index if not exists idx_operator_unavailability_user_range
  on public.operator_unavailability_periods using gist(operator_user_id, scheduled_range);

create or replace function app_private.vehicle_raise_permission_denied(p_detail text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'PERMISSION_DENIED',
    detail = p_detail;
end;
$$;

create or replace function app_private.vehicle_record_audit(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_event text,
  p_old_data jsonb default '{}'::jsonb,
  p_new_data jsonb default '{}'::jsonb,
  p_description text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_trail (
    table_name,
    record_id,
    action,
    changes,
    old_data,
    new_data,
    user_id,
    user_name,
    module,
    description,
    record_label,
    entity_type,
    changed_fields,
    change_count,
    impact_level,
    context
  ) values (
    'vehicle_bookings',
    p_booking_id::text,
    'UPDATE',
    jsonb_build_object('event', p_event),
    coalesce(p_old_data, '{}'::jsonb),
    coalesce(p_new_data, '{}'::jsonb),
    p_actor_user_id::text,
    '',
    'VEHICLE_BOOKING',
    coalesce(p_description, p_event),
    p_booking_id::text,
    'vehicle_booking',
    array(select jsonb_object_keys(coalesce(p_new_data, '{}'::jsonb))),
    (
      select count(*)::integer
      from jsonb_object_keys(coalesce(p_new_data, '{}'::jsonb))
    ),
    case when p_event like '%OVERRIDE%' or p_event in ('NO_SHOW', 'CANCELLED') then 'high' else 'normal' end,
    jsonb_build_object('booking_id', p_booking_id, 'event', p_event)
  );
end;
$$;

create or replace function app_private.vehicle_enqueue_notification(
  p_booking_id uuid,
  p_event_type text,
  p_recipient_user_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient_user_id is null then
    return;
  end if;

  insert into app_private.vehicle_booking_notification_outbox (
    event_key,
    recipient_user_id,
    payload
  ) values (
    'vehicle:' || p_booking_id::text || ':' || p_event_type || ':' || p_recipient_user_id::text,
    p_recipient_user_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'booking_id', p_booking_id,
      'event_type', p_event_type
    )
  ) on conflict (event_key, recipient_user_id) do nothing;
end;
$$;

create or replace function app_private.vehicle_assert_operator_eligible(
  p_operator_user_id uuid,
  p_authorization_type text,
  p_vehicle_type text
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_authorization public.vehicle_driver_authorizations%rowtype;
begin
  if not exists (
    select 1
    from public.users u
    where u.id = p_operator_user_id
      and coalesce(u.is_active, true)
      and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATOR_UNAVAILABLE';
  end if;

  select *
  into v_authorization
  from public.vehicle_driver_authorizations vda
  where vda.user_id = p_operator_user_id
    and vda.authorization_type = p_authorization_type;

  if not found or v_authorization.status <> 'ACTIVE' then
    raise exception using errcode = 'P0001', message = case
      when p_authorization_type = 'SELF_DRIVE' then 'SELF_DRIVER_NOT_AUTHORIZED'
      else 'DRIVER_NOT_AUTHORIZED'
    end;
  end if;

  if v_authorization.license_expiry < current_date then
    raise exception using errcode = 'P0001', message = 'DRIVER_LICENSE_EXPIRED';
  end if;

  if v_authorization.health_check_expiry_date is not null
     and v_authorization.health_check_expiry_date < current_date then
    raise exception using errcode = 'P0001', message = 'OPERATOR_UNAVAILABLE';
  end if;

  if v_authorization.allowed_vehicle_types is null
     or not (p_vehicle_type = any(v_authorization.allowed_vehicle_types)) then
    raise exception using errcode = 'P0001', message = 'DRIVER_LICENSE_CLASS_MISMATCH';
  end if;
end;
$$;

create or replace function app_private.vehicle_validate_assignment(
  p_booking_id uuid,
  p_fulfillment_type text,
  p_vehicle_asset_id text,
  p_operator_user_id uuid,
  p_handover_officer_user_id uuid,
  p_allow_non_home_base_return boolean,
  p_non_home_base_return_reason text,
  p_external_service_type text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_vehicle public.fleet_vehicle_profiles%rowtype;
  v_buffer_minutes integer := 0;
  v_reserved_range tstzrange;
begin
  select * into v_booking
  from public.vehicle_bookings b
  where b.id = p_booking_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'BOOKING_NOT_FOUND';
  end if;

  select coalesce(settings.booking_buffer_minutes, 0)
  into v_buffer_minutes
  from public.fleet_system_settings settings
  where settings.id = 1;

  v_reserved_range := tstzrange(
    v_booking.requested_pickup_at,
    v_booking.expected_return_at + make_interval(mins => coalesce(v_buffer_minutes, 0)),
    '[)'
  );

  if coalesce(p_allow_non_home_base_return, false)
     and nullif(trim(p_non_home_base_return_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'NON_HOME_BASE_RETURN_REASON_REQUIRED';
  end if;

  if p_fulfillment_type = 'EXTERNAL_TRANSPORT' then
    if p_vehicle_asset_id is not null or p_operator_user_id is not null
       or p_handover_officer_user_id is not null then
      raise exception using errcode = 'P0001', message = 'INVALID_EXTERNAL_ASSIGNMENT';
    end if;
    if nullif(trim(p_external_service_type), '') is null then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_SERVICE_TYPE_REQUIRED';
    end if;
    return;
  end if;

  if p_fulfillment_type not in ('INTERNAL_WITH_DRIVER', 'INTERNAL_SELF_DRIVE') then
    raise exception using errcode = 'P0001', message = 'INVALID_FULFILLMENT_TYPE';
  end if;

  if p_vehicle_asset_id is null then
    raise exception using errcode = 'P0001', message = 'VEHICLE_REQUIRED';
  end if;
  if p_operator_user_id is null then
    raise exception using errcode = 'P0001', message = 'OPERATOR_REQUIRED';
  end if;
  if p_fulfillment_type = 'INTERNAL_SELF_DRIVE' and p_handover_officer_user_id is null then
    raise exception using errcode = 'P0001', message = 'HANDOVER_OFFICER_REQUIRED';
  end if;

  select * into v_vehicle
  from public.fleet_vehicle_profiles profile
  where profile.asset_id = p_vehicle_asset_id
  for share;

  if not found or not v_vehicle.active
     or v_vehicle.availability_status <> 'AVAILABLE'
     or v_vehicle.home_base_id is null then
    raise exception using errcode = 'P0001', message = 'VEHICLE_UNAVAILABLE';
  end if;

  if v_vehicle.inspection_expiry_date is not null
     and v_vehicle.inspection_expiry_date < current_date then
    raise exception using errcode = 'P0001', message = 'VEHICLE_INSPECTION_EXPIRED';
  end if;
  if v_vehicle.insurance_expiry_date is not null
     and v_vehicle.insurance_expiry_date < current_date then
    raise exception using errcode = 'P0001', message = 'VEHICLE_INSURANCE_EXPIRED';
  end if;
  if p_fulfillment_type = 'INTERNAL_SELF_DRIVE' and not v_vehicle.allow_self_drive then
    raise exception using errcode = 'P0001', message = 'SELF_DRIVE_NOT_ALLOWED';
  end if;

  perform app_private.vehicle_assert_operator_eligible(
    p_operator_user_id,
    case when p_fulfillment_type = 'INTERNAL_SELF_DRIVE'
      then 'SELF_DRIVE' else 'PROFESSIONAL_DRIVER' end,
    v_vehicle.vehicle_type
  );

  if exists (
    select 1
    from public.vehicle_unavailability_periods unavailable
    where unavailable.vehicle_asset_id = p_vehicle_asset_id
      and unavailable.scheduled_range && v_reserved_range
  ) then
    raise exception using errcode = 'P0001', message = 'VEHICLE_UNAVAILABLE';
  end if;

  if exists (
    select 1
    from public.operator_unavailability_periods unavailable
    where unavailable.operator_user_id = p_operator_user_id
      and unavailable.scheduled_range && v_reserved_range
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATOR_UNAVAILABLE';
  end if;
end;
$$;

revoke all on function app_private.vehicle_raise_permission_denied(text) from public, anon, authenticated;
revoke all on function app_private.vehicle_record_audit(uuid, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function app_private.vehicle_enqueue_notification(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function app_private.vehicle_assert_operator_eligible(uuid, text, text) from public, anon, authenticated;
revoke all on function app_private.vehicle_validate_assignment(uuid, text, text, uuid, uuid, boolean, text, text) from public, anon, authenticated;

create or replace function app_private.command_reject_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_reject_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
begin
  if nullif(trim(p_reject_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'REJECT_REASON_REQUIRED';
  end if;

  select * into v_booking
  from public.vehicle_bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BOOKING_NOT_FOUND';
  end if;
  if v_booking.status <> 'PENDING_APPROVAL' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if v_booking.manager_user_id_snapshot is distinct from p_actor_user_id
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') then
    perform app_private.vehicle_raise_permission_denied('Only the snapshot manager or dispatcher can reject');
  end if;

  update public.vehicle_bookings
  set status = 'CANCELLED',
      close_reason = 'REJECTED_BY_MANAGER',
      close_note = trim(p_reject_reason),
      cancelled_by_user_id = p_actor_user_id,
      cancelled_at = now(),
      updated_at = now()
  where id = p_booking_id;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    'REJECTED',
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('status', 'CANCELLED', 'close_reason', 'REJECTED_BY_MANAGER'),
    'Từ chối booking xe'
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'BOOKING_REJECTED',
    v_booking.requester_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code)
  );

  return jsonb_build_object('success', true, 'status', 'CANCELLED', 'close_reason', 'REJECTED_BY_MANAGER');
end;
$$;

create or replace function app_private.command_dispatch_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_fulfillment_type text,
  p_vehicle_asset_id text default null,
  p_operator_user_id uuid default null,
  p_handover_officer_user_id uuid default null,
  p_allow_non_home_base_return boolean default false,
  p_non_home_base_return_reason text default null,
  p_external_service_type text default null,
  p_external_provider_name text default null,
  p_external_driver_name text default null,
  p_external_driver_phone text default null,
  p_external_vehicle_plate text default null,
  p_external_estimated_cost numeric default null,
  p_dispatch_reason_code text default null,
  p_assignment_note text default null,
  p_override_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment_id uuid := gen_random_uuid();
  v_buffer_minutes integer := 0;
  v_keys text[] := array[]::text[];
  v_key text;
  v_operator_type text;
  v_home_base_id uuid;
begin
  if not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') then
    perform app_private.vehicle_raise_permission_denied('Dispatcher permission is required');
  end if;

  select * into v_booking
  from public.vehicle_bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BOOKING_NOT_FOUND';
  end if;
  if v_booking.status not in ('PENDING_APPROVAL', 'WAITING_DISPATCH') then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if v_booking.status = 'PENDING_APPROVAL'
     and nullif(trim(p_override_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'OVERRIDE_REASON_REQUIRED';
  end if;

  if p_vehicle_asset_id is not null then
    v_keys := array_append(v_keys, 'vehicle:' || p_vehicle_asset_id);
  end if;
  if p_operator_user_id is not null then
    v_keys := array_append(v_keys, 'operator:' || p_operator_user_id::text);
  end if;
  select coalesce(array_agg(resource_key order by resource_key), array[]::text[])
  into v_keys
  from unnest(v_keys) resource_key;
  foreach v_key in array v_keys loop
    perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  end loop;

  perform app_private.vehicle_validate_assignment(
    p_booking_id,
    p_fulfillment_type,
    p_vehicle_asset_id,
    p_operator_user_id,
    p_handover_officer_user_id,
    p_allow_non_home_base_return,
    p_non_home_base_return_reason,
    p_external_service_type
  );

  select coalesce(settings.booking_buffer_minutes, 0)
  into v_buffer_minutes
  from public.fleet_system_settings settings
  where settings.id = 1;

  if p_vehicle_asset_id is not null then
    select profile.home_base_id into v_home_base_id
    from public.fleet_vehicle_profiles profile
    where profile.asset_id = p_vehicle_asset_id;
  end if;

  v_operator_type := case p_fulfillment_type
    when 'INTERNAL_WITH_DRIVER' then 'PROFESSIONAL_DRIVER'
    when 'INTERNAL_SELF_DRIVE' then 'SELF_DRIVER'
    else null
  end;

  insert into public.vehicle_booking_assignments (
    id, booking_id, version, is_active, fulfillment_type,
    vehicle_asset_id, operator_user_id, operator_type,
    reserved_start_at, reserved_end_at, home_base_id_snapshot,
    handover_officer_user_id, allow_non_home_base_return,
    non_home_base_return_reason, external_service_type,
    external_provider_name, external_driver_name, external_driver_phone,
    external_vehicle_plate, external_estimated_cost, dispatch_reason_code,
    assigned_by_user_id, assignment_note
  ) values (
    v_assignment_id, p_booking_id, 1, true, p_fulfillment_type,
    p_vehicle_asset_id, p_operator_user_id, v_operator_type,
    v_booking.requested_pickup_at,
    v_booking.expected_return_at + make_interval(mins => coalesce(v_buffer_minutes, 0)),
    v_home_base_id, p_handover_officer_user_id,
    coalesce(p_allow_non_home_base_return, false), p_non_home_base_return_reason,
    p_external_service_type, p_external_provider_name, p_external_driver_name,
    p_external_driver_phone, p_external_vehicle_plate, p_external_estimated_cost,
    p_dispatch_reason_code, p_actor_user_id, p_assignment_note
  );

  if p_fulfillment_type <> 'EXTERNAL_TRANSPORT' then
    insert into public.vehicle_trip_logs (
      booking_id, assignment_id, assignment_version_snapshot,
      vehicle_asset_id_snapshot, operator_user_id_snapshot, trip_status
    ) values (
      p_booking_id, v_assignment_id, 1,
      p_vehicle_asset_id, p_operator_user_id, 'NOT_STARTED'
    );
  end if;

  update public.vehicle_bookings
  set status = 'ASSIGNED',
      approved_by_user_id = coalesce(approved_by_user_id, p_actor_user_id),
      approved_at = coalesce(approved_at, now()),
      approval_source = case when status = 'PENDING_APPROVAL' then 'DISPATCH_OVERRIDE' else approval_source end,
      approval_note = case when status = 'PENDING_APPROVAL' then trim(p_override_reason) else approval_note end,
      manager_resolution_status = case when status = 'PENDING_APPROVAL' then 'OVERRIDDEN' else manager_resolution_status end,
      updated_at = now()
  where id = p_booking_id;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    case when v_booking.status = 'PENDING_APPROVAL' then 'DISPATCH_OVERRIDE' else 'DISPATCHED' end,
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('status', 'ASSIGNED', 'assignment_id', v_assignment_id, 'fulfillment_type', p_fulfillment_type),
    'Điều phối booking xe'
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'BOOKING_ASSIGNED',
    v_booking.requester_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code, 'assignment_id', v_assignment_id)
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'BOOKING_ASSIGNED',
    p_operator_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code, 'assignment_id', v_assignment_id)
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'HANDOVER_ASSIGNED',
    p_handover_officer_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code, 'assignment_id', v_assignment_id)
  );

  return jsonb_build_object('success', true, 'assignment_id', v_assignment_id, 'status', 'ASSIGNED');
end;
$$;

create or replace function app_private.command_reassign_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_reassign_reason text,
  p_fulfillment_type text,
  p_vehicle_asset_id text default null,
  p_operator_user_id uuid default null,
  p_handover_officer_user_id uuid default null,
  p_allow_non_home_base_return boolean default false,
  p_non_home_base_return_reason text default null,
  p_external_service_type text default null,
  p_external_provider_name text default null,
  p_external_driver_name text default null,
  p_external_driver_phone text default null,
  p_external_vehicle_plate text default null,
  p_external_estimated_cost numeric default null,
  p_dispatch_reason_code text default null,
  p_assignment_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_old_assignment public.vehicle_booking_assignments%rowtype;
  v_new_assignment_id uuid := gen_random_uuid();
  v_new_version integer;
  v_buffer_minutes integer := 0;
  v_operator_type text;
  v_home_base_id uuid;
  v_keys text[] := array[]::text[];
  v_key text;
begin
  if not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') then
    perform app_private.vehicle_raise_permission_denied('Dispatcher permission is required');
  end if;
  if nullif(trim(p_reassign_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'REASSIGN_REASON_REQUIRED';
  end if;

  select * into v_booking
  from public.vehicle_bookings b
  where b.id = p_booking_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOOKING_NOT_FOUND';
  end if;
  if v_booking.status <> 'ASSIGNED' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;

  select * into v_old_assignment
  from public.vehicle_booking_assignments assignment
  where assignment.booking_id = p_booking_id and assignment.is_active
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;

  v_keys := array_remove(array[
    case when v_old_assignment.vehicle_asset_id is not null then 'vehicle:' || v_old_assignment.vehicle_asset_id end,
    case when v_old_assignment.operator_user_id is not null then 'operator:' || v_old_assignment.operator_user_id::text end,
    case when p_vehicle_asset_id is not null then 'vehicle:' || p_vehicle_asset_id end,
    case when p_operator_user_id is not null then 'operator:' || p_operator_user_id::text end
  ], null);
  select coalesce(array_agg(distinct resource_key order by resource_key), array[]::text[])
  into v_keys
  from unnest(v_keys) resource_key;
  foreach v_key in array v_keys loop
    perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  end loop;

  perform app_private.vehicle_validate_assignment(
    p_booking_id,
    p_fulfillment_type,
    p_vehicle_asset_id,
    p_operator_user_id,
    p_handover_officer_user_id,
    p_allow_non_home_base_return,
    p_non_home_base_return_reason,
    p_external_service_type
  );

  select coalesce(max(assignment.version), 0) + 1
  into v_new_version
  from public.vehicle_booking_assignments assignment
  where assignment.booking_id = p_booking_id;

  update public.vehicle_booking_assignments
  set is_active = false,
      released_at = coalesce(released_at, now()),
      superseded_at = now(),
      superseded_by_user_id = p_actor_user_id,
      supersede_reason = trim(p_reassign_reason),
      updated_at = now()
  where id = v_old_assignment.id;

  delete from public.vehicle_trip_logs
  where booking_id = p_booking_id
    and trip_status = 'NOT_STARTED';

  select coalesce(settings.booking_buffer_minutes, 0)
  into v_buffer_minutes
  from public.fleet_system_settings settings
  where settings.id = 1;

  if p_vehicle_asset_id is not null then
    select profile.home_base_id into v_home_base_id
    from public.fleet_vehicle_profiles profile
    where profile.asset_id = p_vehicle_asset_id;
  end if;

  v_operator_type := case p_fulfillment_type
    when 'INTERNAL_WITH_DRIVER' then 'PROFESSIONAL_DRIVER'
    when 'INTERNAL_SELF_DRIVE' then 'SELF_DRIVER'
    else null
  end;

  insert into public.vehicle_booking_assignments (
    id, booking_id, version, is_active, fulfillment_type,
    vehicle_asset_id, operator_user_id, operator_type,
    reserved_start_at, reserved_end_at, home_base_id_snapshot,
    handover_officer_user_id, allow_non_home_base_return,
    non_home_base_return_reason, external_service_type,
    external_provider_name, external_driver_name, external_driver_phone,
    external_vehicle_plate, external_estimated_cost, dispatch_reason_code,
    assigned_by_user_id, assignment_note
  ) values (
    v_new_assignment_id, p_booking_id, v_new_version, true, p_fulfillment_type,
    p_vehicle_asset_id, p_operator_user_id, v_operator_type,
    v_booking.requested_pickup_at,
    v_booking.expected_return_at + make_interval(mins => coalesce(v_buffer_minutes, 0)),
    v_home_base_id, p_handover_officer_user_id,
    coalesce(p_allow_non_home_base_return, false), p_non_home_base_return_reason,
    p_external_service_type, p_external_provider_name, p_external_driver_name,
    p_external_driver_phone, p_external_vehicle_plate, p_external_estimated_cost,
    p_dispatch_reason_code, p_actor_user_id, p_assignment_note
  );

  if p_fulfillment_type <> 'EXTERNAL_TRANSPORT' then
    insert into public.vehicle_trip_logs (
      booking_id, assignment_id, assignment_version_snapshot,
      vehicle_asset_id_snapshot, operator_user_id_snapshot, trip_status
    ) values (
      p_booking_id, v_new_assignment_id, v_new_version,
      p_vehicle_asset_id, p_operator_user_id, 'NOT_STARTED'
    );
  end if;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    'REASSIGNED',
    jsonb_build_object(
      'assignment_id', v_old_assignment.id,
      'vehicle_asset_id', v_old_assignment.vehicle_asset_id,
      'operator_user_id', v_old_assignment.operator_user_id
    ),
    jsonb_build_object(
      'assignment_id', v_new_assignment_id,
      'vehicle_asset_id', p_vehicle_asset_id,
      'operator_user_id', p_operator_user_id,
      'reason', trim(p_reassign_reason)
    ),
    'Đổi phương án điều phối xe'
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'BOOKING_REASSIGNED',
    v_booking.requester_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code, 'assignment_id', v_new_assignment_id)
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'BOOKING_REASSIGNED_OLD_OPERATOR',
    v_old_assignment.operator_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code)
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'BOOKING_REASSIGNED_NEW_OPERATOR',
    p_operator_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code, 'assignment_id', v_new_assignment_id)
  );

  return jsonb_build_object(
    'success', true,
    'assignment_id', v_new_assignment_id,
    'version', v_new_version,
    'status', 'ASSIGNED'
  );
end;
$$;

create or replace function app_private.command_respond_to_vehicle_assignment(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_response text,
  p_decline_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.vehicle_booking_assignments%rowtype;
begin
  if p_response not in ('CONFIRMED', 'DECLINED') then
    raise exception using errcode = 'P0001', message = 'INVALID_ASSIGNMENT_RESPONSE';
  end if;
  if p_response = 'DECLINED' and nullif(trim(p_decline_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'DECLINE_REASON_REQUIRED';
  end if;

  select * into v_assignment
  from public.vehicle_booking_assignments assignment
  where assignment.booking_id = p_booking_id and assignment.is_active
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_assignment.operator_user_id is distinct from p_actor_user_id then
    perform app_private.vehicle_raise_permission_denied('Only the assigned operator can respond');
  end if;
  if not exists (
    select 1 from public.vehicle_bookings booking
    where booking.id = p_booking_id and booking.status = 'ASSIGNED'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;

  update public.vehicle_booking_assignments
  set operator_confirmation_status = p_response,
      operator_confirmed_at = case when p_response = 'CONFIRMED' then now() else null end,
      operator_decline_reason = case when p_response = 'DECLINED' then trim(p_decline_reason) else null end,
      updated_at = now()
  where id = v_assignment.id;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    'ASSIGNMENT_' || p_response,
    jsonb_build_object('operator_confirmation_status', v_assignment.operator_confirmation_status),
    jsonb_build_object('operator_confirmation_status', p_response),
    'Phản hồi phân công chuyến xe'
  );

  if p_response = 'DECLINED' then
    insert into app_private.vehicle_booking_notification_outbox(event_key, recipient_user_id, payload)
    select
      'vehicle:' || p_booking_id::text || ':ASSIGNMENT_DECLINED:' || grant_row.user_id::text,
      grant_row.user_id,
      jsonb_build_object('booking_id', p_booking_id, 'event_type', 'ASSIGNMENT_DECLINED')
    from public.user_permission_grants grant_row
    where grant_row.permission_code in ('booking.vehicle.dispatch', 'booking.vehicle.admin')
      and grant_row.is_active
      and grant_row.revoked_at is null
      and (grant_row.expires_at is null or grant_row.expires_at > now())
    on conflict (event_key, recipient_user_id) do nothing;
  end if;

  return jsonb_build_object('success', true, 'response', p_response, 'requires_reassignment', p_response = 'DECLINED');
end;
$$;

create or replace function app_private.command_confirm_vehicle_handover(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_event_type text,
  p_note text default null,
  p_override_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment public.vehicle_booking_assignments%rowtype;
  v_handover_id uuid := gen_random_uuid();
  v_on_behalf boolean := false;
begin
  if p_event_type not in ('OUTBOUND_HANDOVER', 'RETURN_RECEIPT') then
    raise exception using errcode = 'P0001', message = 'INVALID_HANDOVER_EVENT';
  end if;

  select * into v_booking
  from public.vehicle_bookings booking
  where booking.id = p_booking_id
  for update;
  select * into v_assignment
  from public.vehicle_booking_assignments assignment
  where assignment.booking_id = p_booking_id and assignment.is_active
  for update;

  if v_booking.id is null or v_assignment.id is null then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_assignment.fulfillment_type <> 'INTERNAL_SELF_DRIVE' then
    raise exception using errcode = 'P0001', message = 'HANDOVER_NOT_APPLICABLE';
  end if;
  if p_event_type = 'OUTBOUND_HANDOVER' and v_booking.status <> 'ASSIGNED' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if p_event_type = 'RETURN_RECEIPT' and v_booking.status <> 'COMPLETED' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;

  if v_assignment.handover_officer_user_id is distinct from p_actor_user_id then
    if not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') then
      perform app_private.vehicle_raise_permission_denied('Only the handover officer or dispatcher can confirm');
    end if;
    if nullif(trim(p_override_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'OVERRIDE_REASON_REQUIRED';
    end if;
    v_on_behalf := true;
  end if;

  if p_event_type = 'RETURN_RECEIPT' and not exists (
    select 1 from public.vehicle_handover_logs log
    where log.assignment_id = v_assignment.id
      and log.event_type = 'OUTBOUND_HANDOVER'
  ) then
    raise exception using errcode = 'P0001', message = 'OUTBOUND_HANDOVER_REQUIRED';
  end if;

  insert into public.vehicle_handover_logs (
    id, booking_id, assignment_id, assignment_version_snapshot,
    vehicle_asset_id_snapshot, operator_user_id_snapshot, event_type,
    officer_user_id, confirmed_on_behalf, override_reason, note
  ) values (
    v_handover_id, p_booking_id, v_assignment.id, v_assignment.version,
    v_assignment.vehicle_asset_id, v_assignment.operator_user_id, p_event_type,
    p_actor_user_id, v_on_behalf, nullif(trim(p_override_reason), ''), p_note
  );

  if p_event_type = 'OUTBOUND_HANDOVER' then
    update public.fleet_vehicle_profiles
    set custody_status = 'IN_CUSTODY',
        current_custody_assignment_id = v_assignment.id,
        updated_at = now()
    where asset_id = v_assignment.vehicle_asset_id
      and (
        current_custody_assignment_id is null
        or current_custody_assignment_id = v_assignment.id
      );
    if not found then
      raise exception using errcode = 'P0001', message = 'VEHICLE_IN_CUSTODY';
    end if;
  else
    update public.fleet_vehicle_profiles
    set custody_status = 'AVAILABLE',
        current_custody_assignment_id = null,
        updated_at = now()
    where asset_id = v_assignment.vehicle_asset_id
      and current_custody_assignment_id = v_assignment.id;
    update public.vehicle_booking_assignments
    set released_at = coalesce(released_at, now()), updated_at = now()
    where id = v_assignment.id;
  end if;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    p_event_type,
    '{}'::jsonb,
    jsonb_build_object('assignment_id', v_assignment.id, 'confirmed_on_behalf', v_on_behalf),
    case when p_event_type = 'OUTBOUND_HANDOVER' then 'Bàn giao xe tự lái' else 'Nhận lại xe tự lái' end
  );

  return jsonb_build_object('success', true, 'handover_id', v_handover_id, 'event_type', p_event_type);
end;
$$;

create or replace function app_private.command_record_vehicle_trip_checkpoint(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_checkpoint_type text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment public.vehicle_booking_assignments%rowtype;
begin
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  select * into v_assignment from public.vehicle_booking_assignments
  where booking_id = p_booking_id and is_active for share;
  if v_booking.id is null or v_assignment.id is null then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_booking.status <> 'IN_PROGRESS' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if v_assignment.operator_user_id is distinct from p_actor_user_id
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') then
    perform app_private.vehicle_raise_permission_denied('Only assigned operator or dispatcher can record checkpoints');
  end if;

  if p_checkpoint_type = 'DEPARTED_HOME_BASE' then
    update public.vehicle_trip_logs
    set departed_home_base_at = coalesce(departed_home_base_at, now()), updated_at = now()
    where booking_id = p_booking_id and trip_status = 'IN_PROGRESS';
  elsif p_checkpoint_type = 'PICKED_UP_PASSENGER' then
    update public.vehicle_trip_logs
    set actual_pickup_at = coalesce(actual_pickup_at, now()), updated_at = now()
    where booking_id = p_booking_id and trip_status = 'IN_PROGRESS';
  else
    raise exception using errcode = 'P0001', message = 'INVALID_CHECKPOINT_TYPE';
  end if;

  return jsonb_build_object('success', true, 'checkpoint_type', p_checkpoint_type);
end;
$$;

create or replace function app_private.vehicle_assert_evidence_path(
  p_booking_id uuid,
  p_path text,
  p_namespace text
) returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_path), '') is null then
    raise exception using errcode = 'P0001', message = 'ODOMETER_PHOTO_REQUIRED';
  end if;
  if p_path not like p_booking_id::text || '/' || p_namespace || '/%' then
    raise exception using errcode = 'P0001', message = 'INVALID_EVIDENCE_PATH';
  end if;
end;
$$;

drop function if exists public.start_vehicle_trip(uuid, numeric, text, numeric, numeric, numeric, boolean, text);
drop function if exists app_private.command_start_vehicle_trip(uuid, uuid, numeric, text, numeric, numeric, numeric, boolean, text);

create or replace function app_private.command_start_vehicle_trip(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_start_odometer numeric,
  p_start_photo_path text,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_accuracy_m numeric default null,
  p_location_capture_failed boolean default false,
  p_location_failure_reason text default null,
  p_override_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment public.vehicle_booking_assignments%rowtype;
  v_vehicle public.fleet_vehicle_profiles%rowtype;
  v_is_dispatcher boolean := false;
  v_requires_handover boolean := true;
  v_used_override boolean := false;
begin
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  select * into v_assignment from public.vehicle_booking_assignments
  where booking_id = p_booking_id and is_active for update;

  if v_booking.id is null or v_assignment.id is null then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_booking.status <> 'ASSIGNED' or v_assignment.fulfillment_type = 'EXTERNAL_TRANSPORT' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;

  v_is_dispatcher := app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch');
  if v_assignment.operator_user_id is distinct from p_actor_user_id then
    if not v_is_dispatcher then
      perform app_private.vehicle_raise_permission_denied('Only assigned operator or dispatcher can start');
    end if;
    if nullif(trim(p_override_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'OVERRIDE_REASON_REQUIRED';
    end if;
    v_used_override := true;
  end if;

  if v_assignment.operator_confirmation_status = 'DECLINED' then
    if not v_is_dispatcher or nullif(trim(p_override_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'ASSIGNMENT_DECLINED';
    end if;
    v_used_override := true;
  elsif v_assignment.operator_confirmation_status = 'PENDING'
        and v_assignment.operator_user_id = p_actor_user_id then
    update public.vehicle_booking_assignments
    set operator_confirmation_status = 'CONFIRMED',
        operator_confirmed_at = now(),
        updated_at = now()
    where id = v_assignment.id;
  end if;

  if p_start_odometer is null then
    raise exception using errcode = 'P0001', message = 'ODOMETER_REQUIRED';
  end if;
  perform app_private.vehicle_assert_evidence_path(p_booking_id, p_start_photo_path, 'trips');

  if coalesce(p_location_capture_failed, false) then
    if nullif(trim(p_location_failure_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'LOCATION_FAILURE_REASON_REQUIRED';
    end if;
  elsif p_latitude is null or p_longitude is null then
    raise exception using errcode = 'P0001', message = 'LOCATION_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vehicle:' || v_assignment.vehicle_asset_id, 0));
  select * into v_vehicle
  from public.fleet_vehicle_profiles
  where asset_id = v_assignment.vehicle_asset_id
  for update;

  if not found or not v_vehicle.active or v_vehicle.availability_status <> 'AVAILABLE' then
    raise exception using errcode = 'P0001', message = 'VEHICLE_UNAVAILABLE';
  end if;
  if v_vehicle.current_custody_assignment_id is not null
     and v_vehicle.current_custody_assignment_id <> v_assignment.id then
    raise exception using errcode = 'P0001', message = 'VEHICLE_IN_CUSTODY';
  end if;

  if p_start_odometer < v_vehicle.current_odometer then
    if not v_is_dispatcher or nullif(trim(p_override_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'INVALID_ODOMETER_RANGE';
    end if;
    v_used_override := true;
  end if;

  select coalesce(settings.require_handover_for_self_drive, true)
  into v_requires_handover
  from public.fleet_system_settings settings
  where settings.id = 1;

  if v_assignment.fulfillment_type = 'INTERNAL_SELF_DRIVE'
     and v_requires_handover
     and not exists (
       select 1 from public.vehicle_handover_logs log
       where log.assignment_id = v_assignment.id
         and log.event_type = 'OUTBOUND_HANDOVER'
     ) then
    if not v_is_dispatcher or nullif(trim(p_override_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'HANDOVER_REQUIRED';
    end if;
    v_used_override := true;
  end if;

  update public.fleet_vehicle_profiles
  set custody_status = 'IN_CUSTODY',
      current_custody_assignment_id = v_assignment.id,
      updated_at = now()
  where asset_id = v_assignment.vehicle_asset_id;

  update public.vehicle_trip_logs
  set trip_status = 'IN_PROGRESS',
      started_by_user_id = p_actor_user_id,
      departed_home_base_at = now(),
      start_odometer = p_start_odometer,
      start_photo_path = trim(p_start_photo_path),
      start_latitude = p_latitude,
      start_longitude = p_longitude,
      start_accuracy_m = p_accuracy_m,
      start_location_capture_failed = coalesce(p_location_capture_failed, false),
      start_location_failure_reason = nullif(trim(p_location_failure_reason), ''),
      updated_at = now()
  where booking_id = p_booking_id and trip_status = 'NOT_STARTED';
  if not found then
    raise exception using errcode = 'P0001', message = 'TRIP_LOG_NOT_FOUND';
  end if;

  update public.vehicle_bookings
  set status = 'IN_PROGRESS', updated_at = now()
  where id = p_booking_id;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    case when v_used_override then 'TRIP_STARTED_OVERRIDE' else 'TRIP_STARTED' end,
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('status', 'IN_PROGRESS', 'start_odometer', p_start_odometer),
    'Bắt đầu chuyến xe'
  );
  return jsonb_build_object('success', true, 'status', 'IN_PROGRESS');
end;
$$;

drop function if exists public.finish_vehicle_trip(uuid, numeric, text, numeric, numeric, numeric, boolean, text, text, text);
drop function if exists app_private.command_finish_vehicle_trip(uuid, uuid, numeric, text, numeric, numeric, numeric, boolean, text, text, text);

create or replace function app_private.command_finish_vehicle_trip(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_end_odometer numeric,
  p_end_photo_path text,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_accuracy_m numeric default null,
  p_location_capture_failed boolean default false,
  p_location_failure_reason text default null,
  p_vehicle_condition_end text default 'NORMAL',
  p_issue_note text default null,
  p_override_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment public.vehicle_booking_assignments%rowtype;
  v_trip public.vehicle_trip_logs%rowtype;
  v_distance numeric(12, 1);
  v_is_dispatcher boolean := false;
begin
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  select * into v_assignment from public.vehicle_booking_assignments
  where booking_id = p_booking_id and is_active for update;
  select * into v_trip from public.vehicle_trip_logs where booking_id = p_booking_id for update;

  if v_booking.id is null or v_assignment.id is null or v_trip.id is null then
    raise exception using errcode = 'P0001', message = 'TRIP_LOG_NOT_FOUND';
  end if;
  if v_booking.status <> 'IN_PROGRESS' or v_trip.trip_status <> 'IN_PROGRESS' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;

  v_is_dispatcher := app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch');
  if v_assignment.operator_user_id is distinct from p_actor_user_id then
    if not v_is_dispatcher then
      perform app_private.vehicle_raise_permission_denied('Only assigned operator or dispatcher can finish');
    end if;
    if nullif(trim(p_override_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'OVERRIDE_REASON_REQUIRED';
    end if;
  end if;

  if p_end_odometer is null then
    raise exception using errcode = 'P0001', message = 'ODOMETER_REQUIRED';
  end if;
  if p_end_odometer < v_trip.start_odometer then
    raise exception using errcode = 'P0001', message = 'INVALID_ODOMETER_RANGE';
  end if;
  perform app_private.vehicle_assert_evidence_path(p_booking_id, p_end_photo_path, 'trips');

  if coalesce(p_location_capture_failed, false) then
    if nullif(trim(p_location_failure_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'LOCATION_FAILURE_REASON_REQUIRED';
    end if;
  elsif p_latitude is null or p_longitude is null then
    raise exception using errcode = 'P0001', message = 'LOCATION_REQUIRED';
  end if;
  if p_vehicle_condition_end not in ('NORMAL', 'ISSUE') then
    raise exception using errcode = 'P0001', message = 'INVALID_VEHICLE_CONDITION';
  end if;
  if p_vehicle_condition_end = 'ISSUE' and nullif(trim(p_issue_note), '') is null then
    raise exception using errcode = 'P0001', message = 'ISSUE_NOTE_REQUIRED';
  end if;

  v_distance := p_end_odometer - v_trip.start_odometer;

  update public.vehicle_trip_logs
  set trip_status = 'FINISHED',
      finished_by_user_id = p_actor_user_id,
      actual_return_at = now(),
      end_odometer = p_end_odometer,
      end_photo_path = trim(p_end_photo_path),
      end_latitude = p_latitude,
      end_longitude = p_longitude,
      end_accuracy_m = p_accuracy_m,
      end_location_capture_failed = coalesce(p_location_capture_failed, false),
      end_location_failure_reason = nullif(trim(p_location_failure_reason), ''),
      distance_km = v_distance,
      vehicle_condition_end = p_vehicle_condition_end,
      issue_note = nullif(trim(p_issue_note), ''),
      updated_at = now()
  where id = v_trip.id;

  update public.fleet_vehicle_profiles
  set current_odometer = greatest(current_odometer, p_end_odometer),
      updated_at = now()
  where asset_id = v_assignment.vehicle_asset_id;

  update public.vehicle_bookings
  set status = 'COMPLETED', updated_at = now()
  where id = p_booking_id;

  if v_assignment.fulfillment_type = 'INTERNAL_WITH_DRIVER' then
    update public.fleet_vehicle_profiles
    set custody_status = 'AVAILABLE', current_custody_assignment_id = null, updated_at = now()
    where asset_id = v_assignment.vehicle_asset_id
      and current_custody_assignment_id = v_assignment.id;
    update public.vehicle_booking_assignments
    set released_at = coalesce(released_at, now()), updated_at = now()
    where id = v_assignment.id;
  end if;

  insert into public.vehicle_booking_feedback(booking_id, respondent_user_id, status)
  values (p_booking_id, v_booking.requester_user_id, 'PENDING')
  on conflict (booking_id) do nothing;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    'TRIP_FINISHED',
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('status', 'COMPLETED', 'distance_km', v_distance),
    'Kết thúc chuyến xe'
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'TRIP_COMPLETED',
    v_booking.requester_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code, 'distance_km', v_distance)
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'VEHICLE_RETURN_REQUIRED',
    case when v_assignment.fulfillment_type = 'INTERNAL_SELF_DRIVE'
      then v_assignment.handover_officer_user_id else null end,
    jsonb_build_object('booking_code', v_booking.booking_code)
  );

  return jsonb_build_object('success', true, 'status', 'COMPLETED', 'distance_km', v_distance);
end;
$$;

drop function if exists public.confirm_vehicle_return(uuid, text);
drop function if exists app_private.command_confirm_vehicle_return(uuid, uuid, text);

create or replace function app_private.command_confirm_vehicle_return(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_note text default null,
  p_override_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := app_private.command_confirm_vehicle_handover(
    p_actor_user_id,
    p_booking_id,
    'RETURN_RECEIPT',
    p_note,
    p_override_reason
  );
  return v_result || jsonb_build_object('custody_status', 'AVAILABLE');
end;
$$;

create or replace function app_private.command_complete_external_transport(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_external_actual_cost numeric default null,
  p_external_receipt_path text default null,
  p_completion_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment public.vehicle_booking_assignments%rowtype;
begin
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  select * into v_assignment from public.vehicle_booking_assignments
  where booking_id = p_booking_id and is_active for update;

  if v_booking.id is null or v_assignment.id is null then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_booking.status <> 'ASSIGNED' or v_assignment.fulfillment_type <> 'EXTERNAL_TRANSPORT' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if p_actor_user_id not in (v_booking.requester_user_id, coalesce(v_booking.trip_owner_user_id, v_booking.requester_user_id))
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') then
    perform app_private.vehicle_raise_permission_denied('Requester, trip owner or dispatcher is required');
  end if;
  if p_external_actual_cost is not null and p_external_actual_cost < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_EXTERNAL_COST';
  end if;
  if p_external_receipt_path is not null
     and p_external_receipt_path not like p_booking_id::text || '/external/%' then
    raise exception using errcode = 'P0001', message = 'INVALID_EVIDENCE_PATH';
  end if;

  update public.vehicle_booking_assignments
  set external_actual_cost = p_external_actual_cost,
      external_receipt_path = nullif(trim(p_external_receipt_path), ''),
      assignment_note = concat_ws(E'\n', assignment_note, nullif(trim(p_completion_note), '')),
      released_at = now(),
      updated_at = now()
  where id = v_assignment.id;
  update public.vehicle_bookings set status = 'COMPLETED', updated_at = now() where id = p_booking_id;
  insert into public.vehicle_booking_feedback(booking_id, respondent_user_id, status)
  values (p_booking_id, v_booking.requester_user_id, 'PENDING')
  on conflict (booking_id) do nothing;

  perform app_private.vehicle_record_audit(
    p_actor_user_id, p_booking_id, 'EXTERNAL_TRANSPORT_COMPLETED',
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('status', 'COMPLETED', 'external_actual_cost', p_external_actual_cost),
    'Hoàn tất chuyến xe ngoài'
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id, 'TRIP_COMPLETED', v_booking.requester_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code)
  );
  return jsonb_build_object('success', true, 'status', 'COMPLETED');
end;
$$;

create or replace function app_private.command_submit_vehicle_feedback(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_is_issue boolean,
  p_rating integer default null,
  p_positive_tags text[] default null,
  p_issue_category text default null,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_feedback public.vehicle_booking_feedback%rowtype;
  v_issue_id uuid;
begin
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for share;
  select * into v_feedback from public.vehicle_booking_feedback where booking_id = p_booking_id for update;

  if v_booking.id is null or v_feedback.id is null then
    raise exception using errcode = 'P0001', message = 'FEEDBACK_NOT_FOUND';
  end if;
  if v_booking.status <> 'COMPLETED' or v_feedback.status <> 'PENDING' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if p_actor_user_id not in (v_booking.requester_user_id, coalesce(v_booking.trip_owner_user_id, v_booking.requester_user_id)) then
    perform app_private.vehicle_raise_permission_denied('Only requester or trip owner can submit feedback');
  end if;

  if p_is_issue then
    if nullif(trim(p_comment), '') is null then
      raise exception using errcode = 'P0001', message = 'COMMENT_REQUIRED';
    end if;
    insert into public.vehicle_booking_issues(
      booking_id, reporter_user_id, issue_category, comment
    ) values (
      p_booking_id, p_actor_user_id, coalesce(nullif(trim(p_issue_category), ''), 'OTHER'), trim(p_comment)
    ) returning id into v_issue_id;

    update public.vehicle_booking_feedback
    set respondent_user_id = p_actor_user_id,
        status = 'ISSUE_REPORTED',
        submitted_at = now(),
        updated_at = now()
    where id = v_feedback.id;

    -- Deliberately redact comment and resolution details from the shared audit table.
    perform app_private.vehicle_record_audit(
      p_actor_user_id,
      p_booking_id,
      'FEEDBACK_ISSUE_REPORTED',
      jsonb_build_object('status', v_feedback.status),
      jsonb_build_object(
        'status', 'ISSUE_REPORTED',
        'issue_id', v_issue_id,
        'issue_category', coalesce(nullif(trim(p_issue_category), ''), 'OTHER')
      ),
      'Ghi nhận phản ánh booking xe (nội dung đã ẩn)'
    );
  else
    update public.vehicle_booking_feedback
    set respondent_user_id = p_actor_user_id,
        status = 'CONFIRMED',
        rating = p_rating,
        positive_tags = p_positive_tags,
        submitted_at = now(),
        updated_at = now()
    where id = v_feedback.id;

    perform app_private.vehicle_record_audit(
      p_actor_user_id,
      p_booking_id,
      'FEEDBACK_CONFIRMED',
      jsonb_build_object('status', v_feedback.status),
      jsonb_build_object('status', 'CONFIRMED', 'rating', p_rating),
      'Xác nhận dịch vụ chuyến xe'
    );
  end if;

  return jsonb_build_object('success', true, 'is_issue', p_is_issue, 'issue_id', v_issue_id);
end;
$$;

create or replace function app_private.command_cancel_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_cancel_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment public.vehicle_booking_assignments%rowtype;
  v_is_dispatcher boolean := false;
  v_cutoff_minutes integer := 120;
  v_close_reason text;
begin
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOOKING_NOT_FOUND';
  end if;
  if v_booking.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;

  v_is_dispatcher := app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch');
  if v_booking.requester_user_id is distinct from p_actor_user_id and not v_is_dispatcher then
    perform app_private.vehicle_raise_permission_denied('Only requester or dispatcher can cancel');
  end if;

  select coalesce(settings.late_cancellation_cutoff_minutes, 120)
  into v_cutoff_minutes from public.fleet_system_settings settings where settings.id = 1;

  if v_is_dispatcher and v_booking.requester_user_id is distinct from p_actor_user_id then
    v_close_reason := 'CANCELLED_BY_DISPATCHER';
  elsif now() + make_interval(mins => v_cutoff_minutes) >= v_booking.requested_pickup_at then
    v_close_reason := 'LATE_CANCELLED';
  else
    v_close_reason := 'CANCELLED_BY_REQUESTER';
  end if;

  if v_close_reason in ('LATE_CANCELLED', 'CANCELLED_BY_DISPATCHER')
     and nullif(trim(p_cancel_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'CANCEL_REASON_REQUIRED';
  end if;

  select * into v_assignment
  from public.vehicle_booking_assignments assignment
  where assignment.booking_id = p_booking_id and assignment.is_active
  for update;

  update public.vehicle_bookings
  set status = 'CANCELLED',
      close_reason = v_close_reason,
      close_note = nullif(trim(p_cancel_reason), ''),
      cancelled_by_user_id = p_actor_user_id,
      cancelled_at = now(),
      updated_at = now()
  where id = p_booking_id;

  if v_assignment.id is not null then
    update public.vehicle_booking_assignments
    set released_at = coalesce(released_at, now()), updated_at = now()
    where id = v_assignment.id;
    update public.fleet_vehicle_profiles
    set custody_status = 'AVAILABLE', current_custody_assignment_id = null, updated_at = now()
    where current_custody_assignment_id = v_assignment.id;
  end if;

  perform app_private.vehicle_record_audit(
    p_actor_user_id, p_booking_id, 'CANCELLED',
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('status', 'CANCELLED', 'close_reason', v_close_reason),
    'Hủy booking xe'
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id, 'BOOKING_CANCELLED', v_booking.manager_user_id_snapshot,
    jsonb_build_object('booking_code', v_booking.booking_code, 'close_reason', v_close_reason)
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id, 'BOOKING_CANCELLED', v_assignment.operator_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code, 'close_reason', v_close_reason)
  );
  return jsonb_build_object('success', true, 'status', 'CANCELLED', 'close_reason', v_close_reason);
end;
$$;

create or replace function app_private.command_mark_vehicle_booking_no_show(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment public.vehicle_booking_assignments%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'NO_SHOW_REASON_REQUIRED';
  end if;
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  select * into v_assignment from public.vehicle_booking_assignments
  where booking_id = p_booking_id and is_active for update;

  if v_booking.id is null or v_assignment.id is null then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_booking.status <> 'ASSIGNED' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if v_assignment.operator_user_id is distinct from p_actor_user_id
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') then
    perform app_private.vehicle_raise_permission_denied('Assigned operator or dispatcher is required');
  end if;

  update public.vehicle_bookings
  set status = 'CANCELLED', close_reason = 'NO_SHOW', close_note = trim(p_reason),
      cancelled_by_user_id = p_actor_user_id, cancelled_at = now(), updated_at = now()
  where id = p_booking_id;
  update public.vehicle_booking_assignments
  set released_at = coalesce(released_at, now()), updated_at = now()
  where id = v_assignment.id;
  update public.fleet_vehicle_profiles
  set custody_status = 'AVAILABLE', current_custody_assignment_id = null, updated_at = now()
  where current_custody_assignment_id = v_assignment.id;

  perform app_private.vehicle_record_audit(
    p_actor_user_id, p_booking_id, 'NO_SHOW',
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('status', 'CANCELLED', 'close_reason', 'NO_SHOW'),
    'Ghi nhận no-show booking xe'
  );
  perform app_private.vehicle_enqueue_notification(
    p_booking_id, 'BOOKING_NO_SHOW', v_booking.requester_user_id,
    jsonb_build_object('booking_code', v_booking.booking_code)
  );
  return jsonb_build_object('success', true, 'status', 'CANCELLED', 'close_reason', 'NO_SHOW');
end;
$$;

create or replace function app_private.command_create_operator_unavailability(
  p_actor_user_id uuid,
  p_operator_user_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason_code text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid := gen_random_uuid();
begin
  if p_actor_user_id is distinct from p_operator_user_id
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch')
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_authorizations') then
    perform app_private.vehicle_raise_permission_denied('Operator or fleet administrator is required');
  end if;
  if p_end_at <= p_start_at then
    raise exception using errcode = 'P0001', message = 'INVALID_UNAVAILABILITY_RANGE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('operator:' || p_operator_user_id::text, 0));
  if exists (
    select 1 from public.vehicle_booking_assignments assignment
    where assignment.operator_user_id = p_operator_user_id
      and assignment.is_active and assignment.released_at is null
      and assignment.scheduled_range && tstzrange(p_start_at, p_end_at, '[)')
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATOR_TIME_CONFLICT';
  end if;

  insert into public.operator_unavailability_periods(
    id, operator_user_id, start_at, end_at, reason_code, note, created_by_user_id
  ) values (v_id, p_operator_user_id, p_start_at, p_end_at, p_reason_code, p_note, p_actor_user_id);
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function app_private.command_cancel_operator_unavailability(
  p_actor_user_id uuid,
  p_unavailability_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_period public.operator_unavailability_periods%rowtype;
begin
  select * into v_period from public.operator_unavailability_periods
  where id = p_unavailability_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'UNAVAILABILITY_NOT_FOUND'; end if;
  if p_actor_user_id is distinct from v_period.operator_user_id
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch')
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_authorizations') then
    perform app_private.vehicle_raise_permission_denied('Operator or fleet administrator is required');
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'CANCEL_REASON_REQUIRED';
  end if;
  delete from public.operator_unavailability_periods where id = p_unavailability_id;
  return jsonb_build_object('success', true, 'id', p_unavailability_id);
end;
$$;

create or replace function app_private.command_cancel_vehicle_unavailability(
  p_actor_user_id uuid,
  p_unavailability_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_fleet') then
    perform app_private.vehicle_raise_permission_denied('Fleet management permission is required');
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'CANCEL_REASON_REQUIRED';
  end if;
  delete from public.vehicle_unavailability_periods where id = p_unavailability_id;
  if not found then raise exception using errcode = 'P0001', message = 'UNAVAILABILITY_NOT_FOUND'; end if;
  return jsonb_build_object('success', true, 'id', p_unavailability_id);
end;
$$;

create or replace function app_private.command_replace_vehicle_booking_participants(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_participants jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_participant jsonb;
  v_count integer := 0;
begin
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'BOOKING_NOT_FOUND'; end if;
  if v_booking.status <> 'DRAFT' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if v_booking.requester_user_id is distinct from p_actor_user_id
     and not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') then
    perform app_private.vehicle_raise_permission_denied('Requester or dispatcher is required');
  end if;
  if jsonb_typeof(coalesce(p_participants, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_PARTICIPANTS';
  end if;

  delete from public.vehicle_booking_participants where booking_id = p_booking_id;
  for v_participant in select value from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb))
  loop
    if nullif(trim(v_participant ->> 'participantName'), '') is null then
      raise exception using errcode = 'P0001', message = 'PARTICIPANT_NAME_REQUIRED';
    end if;
    insert into public.vehicle_booking_participants(
      booking_id, user_id, employee_id, participant_name, is_external
    ) values (
      p_booking_id,
      nullif(v_participant ->> 'userId', '')::uuid,
      nullif(v_participant ->> 'employeeId', '')::uuid,
      trim(v_participant ->> 'participantName'),
      coalesce((v_participant ->> 'isExternal')::boolean, false)
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('success', true, 'participant_count', v_count);
end;
$$;

create or replace function public.reject_vehicle_booking(
  p_booking_id uuid,
  p_reject_reason text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_reject_vehicle_booking(
    public.current_app_user_id(), p_booking_id, p_reject_reason
  );
$$;

create or replace function public.dispatch_vehicle_booking(
  p_booking_id uuid,
  p_fulfillment_type text,
  p_vehicle_asset_id text default null,
  p_operator_user_id uuid default null,
  p_handover_officer_user_id uuid default null,
  p_allow_non_home_base_return boolean default false,
  p_non_home_base_return_reason text default null,
  p_external_service_type text default null,
  p_external_provider_name text default null,
  p_external_driver_name text default null,
  p_external_driver_phone text default null,
  p_external_vehicle_plate text default null,
  p_external_estimated_cost numeric default null,
  p_dispatch_reason_code text default null,
  p_assignment_note text default null,
  p_override_reason text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_dispatch_vehicle_booking(
    public.current_app_user_id(), p_booking_id, p_fulfillment_type,
    p_vehicle_asset_id, p_operator_user_id, p_handover_officer_user_id,
    p_allow_non_home_base_return, p_non_home_base_return_reason,
    p_external_service_type, p_external_provider_name, p_external_driver_name,
    p_external_driver_phone, p_external_vehicle_plate, p_external_estimated_cost,
    p_dispatch_reason_code, p_assignment_note, p_override_reason
  );
$$;

create or replace function public.reassign_vehicle_booking(
  p_booking_id uuid,
  p_reassign_reason text,
  p_fulfillment_type text,
  p_vehicle_asset_id text default null,
  p_operator_user_id uuid default null,
  p_handover_officer_user_id uuid default null,
  p_allow_non_home_base_return boolean default false,
  p_non_home_base_return_reason text default null,
  p_external_service_type text default null,
  p_external_provider_name text default null,
  p_external_driver_name text default null,
  p_external_driver_phone text default null,
  p_external_vehicle_plate text default null,
  p_external_estimated_cost numeric default null,
  p_dispatch_reason_code text default null,
  p_assignment_note text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_reassign_vehicle_booking(
    public.current_app_user_id(), p_booking_id, p_reassign_reason,
    p_fulfillment_type, p_vehicle_asset_id, p_operator_user_id,
    p_handover_officer_user_id, p_allow_non_home_base_return,
    p_non_home_base_return_reason, p_external_service_type,
    p_external_provider_name, p_external_driver_name,
    p_external_driver_phone, p_external_vehicle_plate,
    p_external_estimated_cost, p_dispatch_reason_code, p_assignment_note
  );
$$;

create or replace function public.respond_to_vehicle_assignment(
  p_booking_id uuid,
  p_response text,
  p_decline_reason text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_respond_to_vehicle_assignment(
    public.current_app_user_id(), p_booking_id, p_response, p_decline_reason
  );
$$;

create or replace function public.confirm_vehicle_handover(
  p_booking_id uuid,
  p_event_type text,
  p_note text default null,
  p_override_reason text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_confirm_vehicle_handover(
    public.current_app_user_id(), p_booking_id, p_event_type, p_note, p_override_reason
  );
$$;

create or replace function public.record_vehicle_trip_checkpoint(
  p_booking_id uuid,
  p_checkpoint_type text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_record_vehicle_trip_checkpoint(
    public.current_app_user_id(), p_booking_id, p_checkpoint_type
  );
$$;

create or replace function public.start_vehicle_trip(
  p_booking_id uuid,
  p_start_odometer numeric,
  p_start_photo_path text,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_accuracy_m numeric default null,
  p_location_capture_failed boolean default false,
  p_location_failure_reason text default null,
  p_override_reason text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_start_vehicle_trip(
    public.current_app_user_id(), p_booking_id, p_start_odometer,
    p_start_photo_path, p_latitude, p_longitude, p_accuracy_m,
    p_location_capture_failed, p_location_failure_reason, p_override_reason
  );
$$;

create or replace function public.finish_vehicle_trip(
  p_booking_id uuid,
  p_end_odometer numeric,
  p_end_photo_path text,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_accuracy_m numeric default null,
  p_location_capture_failed boolean default false,
  p_location_failure_reason text default null,
  p_vehicle_condition_end text default 'NORMAL',
  p_issue_note text default null,
  p_override_reason text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_finish_vehicle_trip(
    public.current_app_user_id(), p_booking_id, p_end_odometer,
    p_end_photo_path, p_latitude, p_longitude, p_accuracy_m,
    p_location_capture_failed, p_location_failure_reason,
    p_vehicle_condition_end, p_issue_note, p_override_reason
  );
$$;

create or replace function public.confirm_vehicle_return(
  p_booking_id uuid,
  p_note text default null,
  p_override_reason text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_confirm_vehicle_return(
    public.current_app_user_id(), p_booking_id, p_note, p_override_reason
  );
$$;

create or replace function public.complete_external_transport(
  p_booking_id uuid,
  p_external_actual_cost numeric default null,
  p_external_receipt_path text default null,
  p_completion_note text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_complete_external_transport(
    public.current_app_user_id(), p_booking_id, p_external_actual_cost,
    p_external_receipt_path, p_completion_note
  );
$$;

create or replace function public.submit_vehicle_feedback(
  p_booking_id uuid,
  p_is_issue boolean,
  p_rating integer default null,
  p_positive_tags text[] default null,
  p_issue_category text default null,
  p_comment text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_submit_vehicle_feedback(
    public.current_app_user_id(), p_booking_id, p_is_issue, p_rating,
    p_positive_tags, p_issue_category, p_comment
  );
$$;

create or replace function public.cancel_vehicle_booking(
  p_booking_id uuid,
  p_cancel_reason text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_cancel_vehicle_booking(
    public.current_app_user_id(), p_booking_id, p_cancel_reason
  );
$$;

create or replace function public.mark_vehicle_booking_no_show(
  p_booking_id uuid,
  p_reason text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_mark_vehicle_booking_no_show(
    public.current_app_user_id(), p_booking_id, p_reason
  );
$$;

create or replace function public.create_operator_unavailability(
  p_operator_user_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason_code text,
  p_note text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_create_operator_unavailability(
    public.current_app_user_id(), p_operator_user_id, p_start_at,
    p_end_at, p_reason_code, p_note
  );
$$;

create or replace function public.cancel_operator_unavailability(
  p_unavailability_id uuid,
  p_reason text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_cancel_operator_unavailability(
    public.current_app_user_id(), p_unavailability_id, p_reason
  );
$$;

create or replace function public.cancel_vehicle_unavailability(
  p_unavailability_id uuid,
  p_reason text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_cancel_vehicle_unavailability(
    public.current_app_user_id(), p_unavailability_id, p_reason
  );
$$;

create or replace function public.replace_vehicle_booking_participants(
  p_booking_id uuid,
  p_participants jsonb
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_replace_vehicle_booking_participants(
    public.current_app_user_id(), p_booking_id, p_participants
  );
$$;

do $command_privileges$
declare
  v_function record;
begin
  for v_function in
    select procedure.oid::regprocedure as signature
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname like 'command\_%vehicle%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon', v_function.signature);
    execute format('grant execute on function %s to authenticated', v_function.signature);
  end loop;
end;
$command_privileges$;

revoke all on function public.reject_vehicle_booking(uuid, text) from public, anon;
revoke all on function public.dispatch_vehicle_booking(uuid, text, text, uuid, uuid, boolean, text, text, text, text, text, text, numeric, text, text, text) from public, anon;
revoke all on function public.reassign_vehicle_booking(uuid, text, text, text, uuid, uuid, boolean, text, text, text, text, text, text, numeric, text, text) from public, anon;
revoke all on function public.respond_to_vehicle_assignment(uuid, text, text) from public, anon;
revoke all on function public.confirm_vehicle_handover(uuid, text, text, text) from public, anon;
revoke all on function public.record_vehicle_trip_checkpoint(uuid, text) from public, anon;
revoke all on function public.start_vehicle_trip(uuid, numeric, text, numeric, numeric, numeric, boolean, text, text) from public, anon;
revoke all on function public.finish_vehicle_trip(uuid, numeric, text, numeric, numeric, numeric, boolean, text, text, text, text) from public, anon;
revoke all on function public.confirm_vehicle_return(uuid, text, text) from public, anon;
revoke all on function public.complete_external_transport(uuid, numeric, text, text) from public, anon;
revoke all on function public.submit_vehicle_feedback(uuid, boolean, integer, text[], text, text) from public, anon;
revoke all on function public.cancel_vehicle_booking(uuid, text) from public, anon;
revoke all on function public.mark_vehicle_booking_no_show(uuid, text) from public, anon;
revoke all on function public.create_operator_unavailability(uuid, timestamptz, timestamptz, text, text) from public, anon;
revoke all on function public.cancel_operator_unavailability(uuid, text) from public, anon;
revoke all on function public.cancel_vehicle_unavailability(uuid, text) from public, anon;
revoke all on function public.replace_vehicle_booking_participants(uuid, jsonb) from public, anon;

grant execute on function public.reject_vehicle_booking(uuid, text) to authenticated;
grant execute on function public.dispatch_vehicle_booking(uuid, text, text, uuid, uuid, boolean, text, text, text, text, text, text, numeric, text, text, text) to authenticated;
grant execute on function public.reassign_vehicle_booking(uuid, text, text, text, uuid, uuid, boolean, text, text, text, text, text, text, numeric, text, text) to authenticated;
grant execute on function public.respond_to_vehicle_assignment(uuid, text, text) to authenticated;
grant execute on function public.confirm_vehicle_handover(uuid, text, text, text) to authenticated;
grant execute on function public.record_vehicle_trip_checkpoint(uuid, text) to authenticated;
grant execute on function public.start_vehicle_trip(uuid, numeric, text, numeric, numeric, numeric, boolean, text, text) to authenticated;
grant execute on function public.finish_vehicle_trip(uuid, numeric, text, numeric, numeric, numeric, boolean, text, text, text, text) to authenticated;
grant execute on function public.confirm_vehicle_return(uuid, text, text) to authenticated;
grant execute on function public.complete_external_transport(uuid, numeric, text, text) to authenticated;
grant execute on function public.submit_vehicle_feedback(uuid, boolean, integer, text[], text, text) to authenticated;
grant execute on function public.cancel_vehicle_booking(uuid, text) to authenticated;
grant execute on function public.mark_vehicle_booking_no_show(uuid, text) to authenticated;
grant execute on function public.create_operator_unavailability(uuid, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.cancel_operator_unavailability(uuid, text) to authenticated;
grant execute on function public.cancel_vehicle_unavailability(uuid, text) to authenticated;
grant execute on function public.replace_vehicle_booking_participants(uuid, jsonb) to authenticated;

commit;
