-- ============================================================================
-- Migration 3: Vehicle Booking Commands (RPC Core Engine, Advisory Locks & State Machine)
-- Date: 2026-08-12
-- Author: Vioo ERP System Architect
-- ============================================================================

-- ----------------------------------------------------------------------------
-- MASTER DATA ADMIN RPCS (app_private + public wrappers)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.command_upsert_fleet_vehicle_profile(
  p_actor_user_id uuid,
  p_asset_id text,
  p_home_base_id uuid,
  p_vehicle_type text,
  p_seat_count integer,
  p_availability_status text DEFAULT 'AVAILABLE',
  p_allow_self_drive boolean DEFAULT false,
  p_inspection_certificate_number text DEFAULT NULL,
  p_inspection_expiry_date date DEFAULT NULL,
  p_inspection_photo_path text DEFAULT NULL,
  p_insurance_expiry_date date DEFAULT NULL,
  p_parking_spot_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_fleet') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: User does not have permission to manage fleet vehicles';
  END IF;

  INSERT INTO public.fleet_vehicle_profiles (
    asset_id, home_base_id, vehicle_type, seat_count, availability_status,
    allow_self_drive, inspection_certificate_number, inspection_expiry_date,
    inspection_photo_path, insurance_expiry_date, parking_spot_code, updated_at
  ) VALUES (
    p_asset_id, p_home_base_id, p_vehicle_type, p_seat_count, p_availability_status,
    p_allow_self_drive, p_inspection_certificate_number, p_inspection_expiry_date,
    p_inspection_photo_path, p_insurance_expiry_date, p_parking_spot_code, now()
  )
  ON CONFLICT (asset_id) DO UPDATE SET
    home_base_id = EXCLUDED.home_base_id,
    vehicle_type = EXCLUDED.vehicle_type,
    seat_count = EXCLUDED.seat_count,
    availability_status = EXCLUDED.availability_status,
    allow_self_drive = EXCLUDED.allow_self_drive,
    inspection_certificate_number = EXCLUDED.inspection_certificate_number,
    inspection_expiry_date = EXCLUDED.inspection_expiry_date,
    inspection_photo_path = EXCLUDED.inspection_photo_path,
    insurance_expiry_date = EXCLUDED.insurance_expiry_date,
    parking_spot_code = EXCLUDED.parking_spot_code,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'asset_id', p_asset_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_fleet_vehicle_profile(
  p_asset_id text,
  p_home_base_id uuid,
  p_vehicle_type text,
  p_seat_count integer,
  p_availability_status text DEFAULT 'AVAILABLE',
  p_allow_self_drive boolean DEFAULT false,
  p_inspection_certificate_number text DEFAULT NULL,
  p_inspection_expiry_date date DEFAULT NULL,
  p_inspection_photo_path text DEFAULT NULL,
  p_insurance_expiry_date date DEFAULT NULL,
  p_parking_spot_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_upsert_fleet_vehicle_profile(
    public.current_app_user_id(), p_asset_id, p_home_base_id, p_vehicle_type, p_seat_count,
    p_availability_status, p_allow_self_drive, p_inspection_certificate_number,
    p_inspection_expiry_date, p_inspection_photo_path, p_insurance_expiry_date, p_parking_spot_code
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_fleet_vehicle_profile FROM public, anon;
GRANT EXECUTE ON FUNCTION public.upsert_fleet_vehicle_profile TO authenticated;

-- Master Data Admin RPC: Authorizations
CREATE OR REPLACE FUNCTION app_private.command_upsert_driver_authorization(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_employee_id uuid,
  p_authorization_type text,
  p_license_number text,
  p_license_class text,
  p_license_expiry date,
  p_license_front_photo_path text DEFAULT NULL,
  p_license_back_photo_path text DEFAULT NULL,
  p_health_check_expiry_date date DEFAULT NULL,
  p_allowed_vehicle_types text[] DEFAULT NULL,
  p_status text DEFAULT 'ACTIVE',
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_authorizations') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: User does not have permission to manage driver authorizations';
  END IF;

  INSERT INTO public.vehicle_driver_authorizations (
    user_id, employee_id, authorization_type, license_number, license_class,
    license_expiry, license_front_photo_path, license_back_photo_path,
    health_check_expiry_date, allowed_vehicle_types, status, approved_by_user_id, approved_at, note, updated_at
  ) VALUES (
    p_target_user_id, p_employee_id, p_authorization_type, p_license_number, p_license_class,
    p_license_expiry, p_license_front_photo_path, p_license_back_photo_path,
    p_health_check_expiry_date, p_allowed_vehicle_types, p_status, p_actor_user_id, now(), p_note, now()
  )
  ON CONFLICT (user_id, authorization_type) DO UPDATE SET
    employee_id = EXCLUDED.employee_id,
    license_number = EXCLUDED.license_number,
    license_class = EXCLUDED.license_class,
    license_expiry = EXCLUDED.license_expiry,
    license_front_photo_path = EXCLUDED.license_front_photo_path,
    license_back_photo_path = EXCLUDED.license_back_photo_path,
    health_check_expiry_date = EXCLUDED.health_check_expiry_date,
    allowed_vehicle_types = EXCLUDED.allowed_vehicle_types,
    status = EXCLUDED.status,
    approved_by_user_id = p_actor_user_id,
    approved_at = now(),
    note = EXCLUDED.note,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'target_user_id', p_target_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_driver_authorization(
  p_target_user_id uuid,
  p_employee_id uuid,
  p_authorization_type text,
  p_license_number text,
  p_license_class text,
  p_license_expiry date,
  p_license_front_photo_path text DEFAULT NULL,
  p_license_back_photo_path text DEFAULT NULL,
  p_health_check_expiry_date date DEFAULT NULL,
  p_allowed_vehicle_types text[] DEFAULT NULL,
  p_status text DEFAULT 'ACTIVE',
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_upsert_driver_authorization(
    public.current_app_user_id(), p_target_user_id, p_employee_id, p_authorization_type,
    p_license_number, p_license_class, p_license_expiry, p_license_front_photo_path,
    p_license_back_photo_path, p_health_check_expiry_date, p_allowed_vehicle_types, p_status, p_note
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_driver_authorization FROM public, anon;
GRANT EXECUTE ON FUNCTION public.upsert_driver_authorization TO authenticated;

-- Master Data Admin RPC: Locations
CREATE OR REPLACE FUNCTION app_private.command_upsert_fleet_location(
  p_actor_user_id uuid,
  p_location_id uuid,
  p_name text,
  p_address text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_source_type text DEFAULT 'CUSTOM',
  p_source_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid := COALESCE(p_location_id, gen_random_uuid());
BEGIN
  IF NOT app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_fleet') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: User does not have permission to manage fleet locations';
  END IF;

  INSERT INTO public.fleet_locations (id, name, address, latitude, longitude, source_type, source_id, updated_at)
  VALUES (v_id, p_name, p_address, p_latitude, p_longitude, p_source_type, p_source_id, now())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    address = EXCLUDED.address,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_fleet_location(
  p_location_id uuid,
  p_name text,
  p_address text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_source_type text DEFAULT 'CUSTOM',
  p_source_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_upsert_fleet_location(
    public.current_app_user_id(), p_location_id, p_name, p_address, p_latitude, p_longitude, p_source_type, p_source_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_fleet_location FROM public, anon;
GRANT EXECUTE ON FUNCTION public.upsert_fleet_location TO authenticated;

-- Master Data Admin RPC: Vehicle Unavailability
CREATE OR REPLACE FUNCTION app_private.command_create_vehicle_unavailability(
  p_actor_user_id uuid,
  p_vehicle_asset_id text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason_code text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_fleet') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: User does not have permission to manage vehicle unavailability';
  END IF;

  -- Advisory lock chống race condition
  PERFORM pg_advisory_xact_lock(hashtextextended('vehicle:' || p_vehicle_asset_id, 0));

  -- Check overlap với active assignments
  IF EXISTS (
    SELECT 1 FROM public.vehicle_booking_assignments a
    WHERE a.vehicle_asset_id = p_vehicle_asset_id
      AND a.is_active = true
      AND a.released_at IS NULL
      AND tstzrange(a.reserved_start_at, a.reserved_end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)')
  ) THEN
    RAISE EXCEPTION 'VEHICLE_TIME_CONFLICT: Vehicle is already assigned during this period';
  END IF;

  INSERT INTO public.vehicle_unavailability_periods (id, vehicle_asset_id, start_at, end_at, reason_code, note, created_by_user_id)
  VALUES (v_id, p_vehicle_asset_id, p_start_at, p_end_at, p_reason_code, p_note, p_actor_user_id);

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_vehicle_unavailability(
  p_vehicle_asset_id text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason_code text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_create_vehicle_unavailability(
    public.current_app_user_id(), p_vehicle_asset_id, p_start_at, p_end_at, p_reason_code, p_note
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_vehicle_unavailability FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_vehicle_unavailability TO authenticated;

-- Master Data Admin RPC: Settings
CREATE OR REPLACE FUNCTION app_private.command_update_fleet_system_settings(
  p_actor_user_id uuid,
  p_booking_buffer_minutes integer,
  p_late_cancellation_cutoff_minutes integer,
  p_feedback_auto_close_hours integer,
  p_home_base_warning_radius_meters integer,
  p_on_time_tolerance_minutes integer,
  p_max_evidence_image_mb numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.admin') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Admin permission required to update system settings';
  END IF;

  UPDATE public.fleet_system_settings SET
    booking_buffer_minutes = p_booking_buffer_minutes,
    late_cancellation_cutoff_minutes = p_late_cancellation_cutoff_minutes,
    feedback_auto_close_hours = p_feedback_auto_close_hours,
    home_base_warning_radius_meters = p_home_base_warning_radius_meters,
    on_time_tolerance_minutes = p_on_time_tolerance_minutes,
    max_evidence_image_mb = p_max_evidence_image_mb,
    updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_fleet_system_settings(
  p_booking_buffer_minutes integer,
  p_late_cancellation_cutoff_minutes integer,
  p_feedback_auto_close_hours integer,
  p_home_base_warning_radius_meters integer,
  p_on_time_tolerance_minutes integer,
  p_max_evidence_image_mb numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_update_fleet_system_settings(
    public.current_app_user_id(), p_booking_buffer_minutes, p_late_cancellation_cutoff_minutes,
    p_feedback_auto_close_hours, p_home_base_warning_radius_meters, p_on_time_tolerance_minutes, p_max_evidence_image_mb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_fleet_system_settings FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_fleet_system_settings TO authenticated;

-- ----------------------------------------------------------------------------
-- CORE BUSINESS RPCS (15 + 1 CHECKPOINT RPC)
-- ----------------------------------------------------------------------------

-- RPC 1: create_vehicle_booking
CREATE OR REPLACE FUNCTION app_private.command_create_vehicle_booking(
  p_actor_user_id uuid,
  p_requested_pickup_at timestamptz,
  p_expected_return_at timestamptz,
  p_trip_type text,
  p_pickup_location_text text,
  p_destination_text text,
  p_purpose text,
  p_passenger_count integer,
  p_requested_mode text,
  p_route_stops jsonb DEFAULT '[]'::jsonb,
  p_preferred_vehicle_asset_id text DEFAULT NULL,
  p_preferred_driver_user_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_trip_owner_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_booking_id uuid := gen_random_uuid();
  v_booking_code text;
  v_seq integer;
  v_date_str text;
  v_manager_user_id uuid;
  v_emp_id uuid;
  v_dept_id uuid;
BEGIN
  SELECT nextval('public.vehicle_booking_code_seq') INTO v_seq;
  v_date_str := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD');
  v_booking_code := 'CAR-' || v_date_str || '-' || lpad(v_seq::text, 4, '0');

  SELECT e.id, e.department_id INTO v_emp_id, v_dept_id
  FROM public.employees e
  WHERE e.user_id = p_actor_user_id
  LIMIT 1;

  INSERT INTO public.vehicle_bookings (
    id, booking_code, requester_user_id, trip_owner_user_id, requester_employee_id_snapshot,
    department_id_snapshot, requested_pickup_at, expected_return_at, trip_type, pickup_location_text,
    destination_text, route_stops, purpose, passenger_count, requested_mode, preferred_vehicle_asset_id,
    preferred_driver_user_id, note, status
  ) VALUES (
    v_booking_id, v_booking_code, p_actor_user_id, COALESCE(p_trip_owner_user_id, p_actor_user_id),
    v_emp_id, v_dept_id, p_requested_pickup_at, p_expected_return_at, p_trip_type, p_pickup_location_text,
    p_destination_text, p_route_stops, p_purpose, p_passenger_count, p_requested_mode, p_preferred_vehicle_asset_id,
    p_preferred_driver_user_id, p_note, 'DRAFT'
  );

  RETURN jsonb_build_object('success', true, 'id', v_booking_id, 'booking_code', v_booking_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_vehicle_booking(
  p_requested_pickup_at timestamptz,
  p_expected_return_at timestamptz,
  p_trip_type text,
  p_pickup_location_text text,
  p_destination_text text,
  p_purpose text,
  p_passenger_count integer,
  p_requested_mode text,
  p_route_stops jsonb DEFAULT '[]'::jsonb,
  p_preferred_vehicle_asset_id text DEFAULT NULL,
  p_preferred_driver_user_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_trip_owner_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_create_vehicle_booking(
    public.current_app_user_id(), p_requested_pickup_at, p_expected_return_at, p_trip_type,
    p_pickup_location_text, p_destination_text, p_purpose, p_passenger_count, p_requested_mode,
    p_route_stops, p_preferred_vehicle_asset_id, p_preferred_driver_user_id, p_note, p_trip_owner_user_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_vehicle_booking FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_vehicle_booking TO authenticated;

-- RPC 2: submit_vehicle_booking
CREATE OR REPLACE FUNCTION app_private.command_submit_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_manager_user_id uuid;
  v_resolution_status text := 'NORMAL';
BEGIN
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking does not exist';
  END IF;

  IF v_booking.requester_user_id != p_actor_user_id AND NOT app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.admin') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only requester can submit booking';
  END IF;

  IF v_booking.status != 'DRAFT' THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Only DRAFT bookings can be submitted';
  END IF;

  -- Gọi đúng hàm resolve_request_direct_manager đã có trong codebase
  v_manager_user_id := app_private.resolve_request_direct_manager(p_actor_user_id);

  IF v_manager_user_id IS NULL THEN
    v_resolution_status := 'MISSING';
  END IF;

  UPDATE public.vehicle_bookings SET
    status = 'PENDING_APPROVAL',
    submitted_at = now(),
    manager_user_id_snapshot = v_manager_user_id,
    manager_resolution_status = v_resolution_status,
    updated_at = now()
  WHERE id = p_booking_id;

  -- Ghi notification outbox cho manager hoặc dispatcher
  IF v_manager_user_id IS NOT NULL THEN
    INSERT INTO app_private.vehicle_booking_notification_outbox (event_key, recipient_user_id, payload)
    VALUES ('BOOKING_SUBMITTED_' || p_booking_id::text, v_manager_user_id, jsonb_build_object('booking_id', p_booking_id, 'booking_code', v_booking.booking_code))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'PENDING_APPROVAL', 'manager_resolution_status', v_resolution_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_vehicle_booking(
  p_booking_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_submit_vehicle_booking(public.current_app_user_id(), p_booking_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_vehicle_booking FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_vehicle_booking TO authenticated;

-- RPC 3: approve_vehicle_booking
CREATE OR REPLACE FUNCTION app_private.command_approve_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_approval_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_source text := 'MANAGER';
BEGIN
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking does not exist';
  END IF;

  IF v_booking.status != 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Booking is not in PENDING_APPROVAL status';
  END IF;

  -- Kiểm tra vai trò Manager hoặc Dispatcher Override
  IF v_booking.manager_user_id_snapshot IS NOT NULL AND v_booking.manager_user_id_snapshot = p_actor_user_id THEN
    v_source := 'MANAGER';
  ELSIF app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') THEN
    v_source := 'DISPATCH_OVERRIDE';
    IF p_approval_note IS NULL OR length(trim(p_approval_note)) = 0 THEN
      RAISE EXCEPTION 'APPROVAL_NOTE_REQUIRED: Dispatcher override requires approval note';
    END IF;
  ELSE
    RAISE EXCEPTION 'PERMISSION_DENIED: Only assigned manager or dispatcher can approve';
  END IF;

  UPDATE public.vehicle_bookings SET
    status = 'WAITING_DISPATCH',
    approved_by_user_id = p_actor_user_id,
    approved_at = now(),
    approval_source = v_source,
    approval_note = p_approval_note,
    manager_resolution_status = CASE WHEN v_source = 'DISPATCH_OVERRIDE' THEN 'OVERRIDDEN' ELSE 'NORMAL' END,
    updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'status', 'WAITING_DISPATCH', 'approval_source', v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_vehicle_booking(
  p_booking_id uuid,
  p_approval_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_approve_vehicle_booking(public.current_app_user_id(), p_booking_id, p_approval_note);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_vehicle_booking FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_vehicle_booking TO authenticated;

-- RPC 4: reject_vehicle_booking
CREATE OR REPLACE FUNCTION app_private.command_reject_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_reject_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_booking record;
BEGIN
  IF p_reject_reason IS NULL OR length(trim(p_reject_reason)) = 0 THEN
    RAISE EXCEPTION 'REJECT_REASON_REQUIRED: Reject reason is required';
  END IF;

  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking does not exist';
  END IF;

  IF v_booking.status != 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Booking is not pending approval';
  END IF;

  UPDATE public.vehicle_bookings SET
    status = 'CANCELLED',
    close_reason = 'REJECTED_BY_MANAGER',
    close_note = p_reject_reason,
    cancelled_by_user_id = p_actor_user_id,
    cancelled_at = now(),
    updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'status', 'CANCELLED', 'close_reason', 'REJECTED_BY_MANAGER');
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_vehicle_booking(
  p_booking_id uuid,
  p_reject_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_reject_vehicle_booking(public.current_app_user_id(), p_booking_id, p_reject_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_vehicle_booking FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reject_vehicle_booking TO authenticated;

-- RPC 5: dispatch_vehicle_booking (Advisory lock 64-bit + Custody Checks + tstzrange Exclusion)
CREATE OR REPLACE FUNCTION app_private.command_dispatch_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_fulfillment_type text,
  p_vehicle_asset_id text DEFAULT NULL,
  p_operator_user_id uuid DEFAULT NULL,
  p_handover_officer_user_id uuid DEFAULT NULL,
  p_allow_non_home_base_return boolean DEFAULT false,
  p_non_home_base_return_reason text DEFAULT NULL,
  p_external_service_type text DEFAULT NULL,
  p_external_provider_name text DEFAULT NULL,
  p_external_driver_name text DEFAULT NULL,
  p_external_driver_phone text DEFAULT NULL,
  p_external_vehicle_plate text DEFAULT NULL,
  p_external_estimated_cost numeric DEFAULT NULL,
  p_dispatch_reason_code text DEFAULT NULL,
  p_assignment_note text DEFAULT NULL,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_buffer_mins integer;
  v_res_start timestamptz;
  v_res_end timestamptz;
  v_assignment_id uuid := gen_random_uuid();
  v_custody_status text;
  v_keys text[];
  v_key text;
BEGIN
  IF NOT app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only dispatcher can dispatch bookings';
  END IF;

  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking does not exist';
  END IF;

  IF v_booking.status NOT IN ('PENDING_APPROVAL', 'WAITING_DISPATCH') THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Booking cannot be dispatched in current status';
  END IF;

  -- Lấy buffer từ settings
  SELECT booking_buffer_minutes INTO v_buffer_mins FROM public.fleet_system_settings WHERE id = 1;
  v_buffer_mins := COALESCE(v_buffer_mins, 30);

  v_res_start := v_booking.requested_pickup_at;
  v_res_end := v_booking.expected_return_at + (v_buffer_mins || ' minutes')::interval;

  -- Advisory Lock 64-bit sắp xếp các resource keys để tránh deadlock
  v_keys := ARRAY[]::text[];
  IF p_vehicle_asset_id IS NOT NULL THEN
    v_keys := array_append(v_keys, 'vehicle:' || p_vehicle_asset_id);
  END IF;
  IF p_operator_user_id IS NOT NULL THEN
    v_keys := array_append(v_keys, 'operator:' || p_operator_user_id::text);
  END IF;

  -- Sort keys
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM unnest(v_keys) k;

  FOREACH v_key IN ARRAY v_keys LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  END LOOP;

  -- Validation theo fulfillment_type
  IF p_fulfillment_type IN ('INTERNAL_WITH_DRIVER', 'INTERNAL_SELF_DRIVE') THEN
    IF p_vehicle_asset_id IS NULL THEN
      RAISE EXCEPTION 'VEHICLE_REQUIRED: Internal transport requires vehicle_asset_id';
    END IF;

    -- Kiểm tra xe có đang bị khóa custody bởi chuyến khác
    SELECT custody_status INTO v_custody_status FROM public.fleet_vehicle_profiles WHERE asset_id = p_vehicle_asset_id;
    IF v_custody_status = 'IN_CUSTODY' THEN
      RAISE EXCEPTION 'VEHICLE_IN_CUSTODY: Vehicle is currently held in physical custody';
    END IF;

    -- Kiểm tra Unavailability xe
    IF EXISTS (
      SELECT 1 FROM public.vehicle_unavailability_periods
      WHERE vehicle_asset_id = p_vehicle_asset_id
        AND tstzrange(start_at, end_at, '[)') && tstzrange(v_res_start, v_res_end, '[)')
    ) THEN
      RAISE EXCEPTION 'VEHICLE_UNAVAILABLE: Vehicle is scheduled for maintenance/lock';
    END IF;

    IF p_operator_user_id IS NOT NULL THEN
      -- Kiểm tra Unavailability người lái
      IF EXISTS (
        SELECT 1 FROM public.operator_unavailability_periods
        WHERE operator_user_id = p_operator_user_id
          AND tstzrange(start_at, end_at, '[)') && tstzrange(v_res_start, v_res_end, '[)')
      ) THEN
        RAISE EXCEPTION 'OPERATOR_UNAVAILABLE: Operator is on leave or offline';
      END IF;

      -- Kiểm tra bằng lái hợp lệ
      IF NOT EXISTS (
        SELECT 1 FROM public.vehicle_driver_authorizations_eligible_v
        WHERE user_id = p_operator_user_id AND is_eligible = true
      ) THEN
        RAISE EXCEPTION 'SELF_DRIVER_NOT_ELIGIBLE: Operator does not have an active eligible driver authorization';
      END IF;
    END IF;
  END IF;

  -- Tạo Assignment
  INSERT INTO public.vehicle_booking_assignments (
    id, booking_id, version, is_active, fulfillment_type, vehicle_asset_id, operator_user_id,
    operator_type, reserved_start_at, reserved_end_at, handover_officer_user_id,
    allow_non_home_base_return, non_home_base_return_reason, external_service_type,
    external_provider_name, external_driver_name, external_driver_phone, external_vehicle_plate,
    external_estimated_cost, dispatch_reason_code, assigned_by_user_id, assigned_at, assignment_note
  ) VALUES (
    v_assignment_id, p_booking_id, 1, true, p_fulfillment_type, p_vehicle_asset_id, p_operator_user_id,
    CASE WHEN p_fulfillment_type = 'INTERNAL_WITH_DRIVER' THEN 'PROFESSIONAL_DRIVER' ELSE 'SELF_DRIVER' END,
    v_res_start, v_res_end, p_handover_officer_user_id, p_allow_non_home_base_return,
    p_non_home_base_return_reason, p_external_service_type, p_external_provider_name,
    p_external_driver_name, p_external_driver_phone, p_external_vehicle_plate,
    p_external_estimated_cost, p_dispatch_reason_code, p_actor_user_id, now(), p_assignment_note
  );

  -- Cập nhật Booking sang ASSIGNED
  UPDATE public.vehicle_bookings SET
    status = 'ASSIGNED',
    approved_by_user_id = COALESCE(approved_by_user_id, p_actor_user_id),
    approved_at = COALESCE(approved_at, now()),
    approval_source = CASE WHEN status = 'PENDING_APPROVAL' THEN 'DISPATCH_OVERRIDE' ELSE approval_source END,
    approval_note = CASE WHEN status = 'PENDING_APPROVAL' THEN COALESCE(p_override_reason, 'Dispatched directly') ELSE approval_note END,
    updated_at = now()
  WHERE id = p_booking_id;

  -- Tạo Trip Log rỗng ở trạng thái NOT_STARTED
  INSERT INTO public.vehicle_trip_logs (
    booking_id, assignment_id, assignment_version_snapshot, vehicle_asset_id_snapshot,
    operator_user_id_snapshot, trip_status
  ) VALUES (
    p_booking_id, v_assignment_id, 1, p_vehicle_asset_id, p_operator_user_id, 'NOT_STARTED'
  );

  RETURN jsonb_build_object('success', true, 'assignment_id', v_assignment_id, 'status', 'ASSIGNED');
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_vehicle_booking(
  p_booking_id uuid,
  p_fulfillment_type text,
  p_vehicle_asset_id text DEFAULT NULL,
  p_operator_user_id uuid DEFAULT NULL,
  p_handover_officer_user_id uuid DEFAULT NULL,
  p_allow_non_home_base_return boolean DEFAULT false,
  p_non_home_base_return_reason text DEFAULT NULL,
  p_external_service_type text DEFAULT NULL,
  p_external_provider_name text DEFAULT NULL,
  p_external_driver_name text DEFAULT NULL,
  p_external_driver_phone text DEFAULT NULL,
  p_external_vehicle_plate text DEFAULT NULL,
  p_external_estimated_cost numeric DEFAULT NULL,
  p_dispatch_reason_code text DEFAULT NULL,
  p_assignment_note text DEFAULT NULL,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_dispatch_vehicle_booking(
    public.current_app_user_id(), p_booking_id, p_fulfillment_type, p_vehicle_asset_id,
    p_operator_user_id, p_handover_officer_user_id, p_allow_non_home_base_return,
    p_non_home_base_return_reason, p_external_service_type, p_external_provider_name,
    p_external_driver_name, p_external_driver_phone, p_external_vehicle_plate,
    p_external_estimated_cost, p_dispatch_reason_code, p_assignment_note, p_override_reason
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispatch_vehicle_booking FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_vehicle_booking TO authenticated;

-- RPC 8: confirm_vehicle_handover
CREATE OR REPLACE FUNCTION app_private.command_confirm_vehicle_handover(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_event_type text,
  p_note text DEFAULT NULL,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_assign record;
  v_on_behalf boolean := false;
  v_handover_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_assign FROM public.vehicle_booking_assignments WHERE booking_id = p_booking_id AND is_active = true FOR UPDATE;

  IF v_assign IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: No active assignment found for booking';
  END IF;

  IF v_assign.handover_officer_user_id IS NOT NULL AND v_assign.handover_officer_user_id != p_actor_user_id THEN
    IF NOT app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Only assigned handover officer or dispatcher can confirm handover';
    END IF;
    v_on_behalf := true;
    IF p_override_reason IS NULL OR length(trim(p_override_reason)) = 0 THEN
      RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED: Confirming on behalf requires override reason';
    END IF;
  END IF;

  INSERT INTO public.vehicle_handover_logs (
    id, booking_id, assignment_id, assignment_version_snapshot, vehicle_asset_id_snapshot,
    operator_user_id_snapshot, event_type, officer_user_id, confirmed_at, confirmed_on_behalf,
    override_reason, note
  ) VALUES (
    v_handover_id, p_booking_id, v_assign.id, v_assign.version, v_assign.vehicle_asset_id,
    v_assign.operator_user_id, p_event_type, p_actor_user_id, now(), v_on_behalf, p_override_reason, p_note
  );

  -- Nếu là OUTBOUND_HANDOVER: Cập nhật custody_status = IN_CUSTODY
  IF p_event_type = 'OUTBOUND_HANDOVER' THEN
    UPDATE public.fleet_vehicle_profiles SET
      custody_status = 'IN_CUSTODY',
      current_custody_assignment_id = v_assign.id,
      updated_at = now()
    WHERE asset_id = v_assign.vehicle_asset_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'handover_id', v_handover_id, 'event_type', p_event_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_vehicle_handover(
  p_booking_id uuid,
  p_event_type text,
  p_note text DEFAULT NULL,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_confirm_vehicle_handover(
    public.current_app_user_id(), p_booking_id, p_event_type, p_note, p_override_reason
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_vehicle_handover FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_vehicle_handover TO authenticated;

-- RPC 9: record_vehicle_trip_checkpoint (Ghi mốc Checkpoint riêng)
CREATE OR REPLACE FUNCTION app_private.command_record_vehicle_trip_checkpoint(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_checkpoint_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_checkpoint_type = 'DEPARTED_HOME_BASE' THEN
    UPDATE public.vehicle_trip_logs SET departed_home_base_at = now(), updated_at = now() WHERE booking_id = p_booking_id;
  ELSIF p_checkpoint_type = 'PICKED_UP_PASSENGER' THEN
    UPDATE public.vehicle_trip_logs SET actual_pickup_at = now(), updated_at = now() WHERE booking_id = p_booking_id;
  ELSE
    RAISE EXCEPTION 'INVALID_CHECKPOINT_TYPE: Checkpoint type must be DEPARTED_HOME_BASE or PICKED_UP_PASSENGER';
  END IF;

  RETURN jsonb_build_object('success', true, 'checkpoint_type', p_checkpoint_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_vehicle_trip_checkpoint(
  p_booking_id uuid,
  p_checkpoint_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_record_vehicle_trip_checkpoint(public.current_app_user_id(), p_booking_id, p_checkpoint_type);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_vehicle_trip_checkpoint FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_vehicle_trip_checkpoint TO authenticated;

-- RPC 10: start_vehicle_trip (Bắt đầu chuyến đi thực tế & Ràng buộc Custody + Odometer)
CREATE OR REPLACE FUNCTION app_private.command_start_vehicle_trip(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_start_odometer numeric,
  p_start_photo_path text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_location_capture_failed boolean DEFAULT false,
  p_location_failure_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_assign record;
  v_vehicle record;
BEGIN
  SELECT * INTO v_assign FROM public.vehicle_booking_assignments WHERE booking_id = p_booking_id AND is_active = true FOR UPDATE;

  IF v_assign IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: No active assignment found for booking';
  END IF;

  -- Lock xe kiểm tra Odometer & Custody
  SELECT * INTO v_vehicle FROM public.fleet_vehicle_profiles WHERE asset_id = v_assign.vehicle_asset_id FOR UPDATE;

  IF v_vehicle.current_custody_assignment_id IS NOT NULL AND v_vehicle.current_custody_assignment_id != v_assign.id THEN
    RAISE EXCEPTION 'VEHICLE_IN_CUSTODY: Vehicle is currently held in physical custody by another assignment';
  END IF;

  IF p_start_odometer < v_vehicle.current_odometer THEN
    RAISE EXCEPTION 'INVALID_ODOMETER_RANGE: Start odometer (%) cannot be less than vehicle current odometer (%)', p_start_odometer, v_vehicle.current_odometer;
  END IF;

  -- Set Custody cho Assignment này
  UPDATE public.fleet_vehicle_profiles SET
    custody_status = 'IN_CUSTODY',
    current_custody_assignment_id = v_assign.id,
    updated_at = now()
  WHERE asset_id = v_assign.vehicle_asset_id;

  -- Cập nhật Trip Log & Booking Status
  UPDATE public.vehicle_trip_logs SET
    trip_status = 'IN_PROGRESS',
    started_by_user_id = p_actor_user_id,
    actual_pickup_at = COALESCE(actual_pickup_at, now()),
    departed_home_base_at = COALESCE(departed_home_base_at, now()),
    start_odometer = p_start_odometer,
    start_photo_path = p_start_photo_path,
    start_latitude = p_latitude,
    start_longitude = p_longitude,
    start_accuracy_m = p_accuracy_m,
    start_location_capture_failed = p_location_capture_failed,
    start_location_failure_reason = p_location_failure_reason,
    updated_at = now()
  WHERE booking_id = p_booking_id;

  UPDATE public.vehicle_bookings SET status = 'IN_PROGRESS', updated_at = now() WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS');
END;
$$;

CREATE OR REPLACE FUNCTION public.start_vehicle_trip(
  p_booking_id uuid,
  p_start_odometer numeric,
  p_start_photo_path text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_location_capture_failed boolean DEFAULT false,
  p_location_failure_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_start_vehicle_trip(
    public.current_app_user_id(), p_booking_id, p_start_odometer, p_start_photo_path,
    p_latitude, p_longitude, p_accuracy_m, p_location_capture_failed, p_location_failure_reason
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_vehicle_trip FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_vehicle_trip TO authenticated;

-- RPC 11: finish_vehicle_trip
CREATE OR REPLACE FUNCTION app_private.command_finish_vehicle_trip(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_end_odometer numeric,
  p_end_photo_path text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_location_capture_failed boolean DEFAULT false,
  p_location_failure_reason text DEFAULT NULL,
  p_vehicle_condition_end text DEFAULT 'NORMAL',
  p_issue_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_assign record;
  v_trip record;
  v_dist numeric(12, 1);
BEGIN
  SELECT * INTO v_assign FROM public.vehicle_booking_assignments WHERE booking_id = p_booking_id AND is_active = true FOR UPDATE;
  SELECT * INTO v_trip FROM public.vehicle_trip_logs WHERE booking_id = p_booking_id FOR UPDATE;

  IF v_trip IS NULL OR v_trip.trip_status != 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Trip is not in progress';
  END IF;

  IF p_end_odometer < v_trip.start_odometer THEN
    RAISE EXCEPTION 'INVALID_ODOMETER_RANGE: End odometer cannot be less than start odometer';
  END IF;

  v_dist := p_end_odometer - v_trip.start_odometer;

  UPDATE public.vehicle_trip_logs SET
    trip_status = 'FINISHED',
    finished_by_user_id = p_actor_user_id,
    actual_return_at = now(),
    end_odometer = p_end_odometer,
    end_photo_path = p_end_photo_path,
    end_latitude = p_latitude,
    end_longitude = p_longitude,
    end_accuracy_m = p_accuracy_m,
    end_location_capture_failed = p_location_capture_failed,
    end_location_failure_reason = p_location_failure_reason,
    distance_km = v_dist,
    vehicle_condition_end = p_vehicle_condition_end,
    issue_note = p_issue_note,
    updated_at = now()
  WHERE booking_id = p_booking_id;

  -- Cập nhật Odometer hiện tại của Xe
  UPDATE public.fleet_vehicle_profiles SET current_odometer = p_end_odometer, updated_at = now() WHERE asset_id = v_assign.vehicle_asset_id;

  -- Chuyển Booking sang COMPLETED
  UPDATE public.vehicle_bookings SET status = 'COMPLETED', updated_at = now() WHERE id = p_booking_id;

  -- Nếu là Xe có tài xế: Tự động giải phóng Custody & Release Assignment
  IF v_assign.fulfillment_type = 'INTERNAL_WITH_DRIVER' THEN
    UPDATE public.fleet_vehicle_profiles SET custody_status = 'AVAILABLE', current_custody_assignment_id = NULL WHERE asset_id = v_assign.vehicle_asset_id;
    UPDATE public.vehicle_booking_assignments SET released_at = now() WHERE id = v_assign.id;
  END IF;
  -- Tự lái: Giữ Custody IN_CUSTODY cho đến khi gọi confirm_vehicle_return

  -- Tạo bản ghi feedback PENDING
  INSERT INTO public.vehicle_booking_feedback (booking_id, respondent_user_id, status)
  VALUES (p_booking_id, (SELECT requester_user_id FROM public.vehicle_bookings WHERE id = p_booking_id), 'PENDING')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true, 'status', 'COMPLETED', 'distance_km', v_dist);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_vehicle_trip(
  p_booking_id uuid,
  p_end_odometer numeric,
  p_end_photo_path text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_location_capture_failed boolean DEFAULT false,
  p_location_failure_reason text DEFAULT NULL,
  p_vehicle_condition_end text DEFAULT 'NORMAL',
  p_issue_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_finish_vehicle_trip(
    public.current_app_user_id(), p_booking_id, p_end_odometer, p_end_photo_path,
    p_latitude, p_longitude, p_accuracy_m, p_location_capture_failed, p_location_failure_reason,
    p_vehicle_condition_end, p_issue_note
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_vehicle_trip FROM public, anon;
GRANT EXECUTE ON FUNCTION public.finish_vehicle_trip TO authenticated;

-- RPC 12: confirm_vehicle_return (Giải phóng Chìa khóa Tự lái)
CREATE OR REPLACE FUNCTION app_private.command_confirm_vehicle_return(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_assign record;
BEGIN
  SELECT * INTO v_assign FROM public.vehicle_booking_assignments WHERE booking_id = p_booking_id AND is_active = true FOR UPDATE;

  IF v_assign IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: No active assignment found';
  END IF;

  -- Ghi nhận Return Receipt
  PERFORM app_private.command_confirm_vehicle_handover(p_actor_user_id, p_booking_id, 'RETURN_RECEIPT', p_note, NULL);

  -- Giải phóng xe và set released_at
  UPDATE public.fleet_vehicle_profiles SET custody_status = 'AVAILABLE', current_custody_assignment_id = NULL WHERE asset_id = v_assign.vehicle_asset_id;
  UPDATE public.vehicle_booking_assignments SET released_at = now() WHERE id = v_assign.id;

  RETURN jsonb_build_object('success', true, 'custody_status', 'AVAILABLE');
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_vehicle_return(
  p_booking_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_confirm_vehicle_return(public.current_app_user_id(), p_booking_id, p_note);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_vehicle_return FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_vehicle_return TO authenticated;

-- RPC 13: submit_vehicle_feedback (Xác nhận Tốt hoặc Gửi Phản ánh Nhạy cảm Redacted)
CREATE OR REPLACE FUNCTION app_private.command_submit_vehicle_feedback(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_is_issue boolean,
  p_rating integer DEFAULT NULL,
  p_positive_tags text[] DEFAULT NULL,
  p_issue_category text DEFAULT NULL,
  p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_is_issue THEN
    IF p_comment IS NULL OR length(trim(p_comment)) = 0 THEN
      RAISE EXCEPTION 'COMMENT_REQUIRED: Issue report requires comment';
    END IF;

    INSERT INTO public.vehicle_booking_issues (booking_id, reporter_user_id, issue_category, comment)
    VALUES (p_booking_id, p_actor_user_id, COALESCE(p_issue_category, 'OTHER'), p_comment);

    UPDATE public.vehicle_booking_feedback SET
      status = 'ISSUE_REPORTED',
      submitted_at = now(),
      updated_at = now()
    WHERE booking_id = p_booking_id;
  ELSE
    UPDATE public.vehicle_booking_feedback SET
      status = 'CONFIRMED',
      rating = p_rating,
      positive_tags = p_positive_tags,
      submitted_at = now(),
      updated_at = now()
    WHERE booking_id = p_booking_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'is_issue', p_is_issue);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_vehicle_feedback(
  p_booking_id uuid,
  p_is_issue boolean,
  p_rating integer DEFAULT NULL,
  p_positive_tags text[] DEFAULT NULL,
  p_issue_category text DEFAULT NULL,
  p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_submit_vehicle_feedback(
    public.current_app_user_id(), p_booking_id, p_is_issue, p_rating, p_positive_tags, p_issue_category, p_comment
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_vehicle_feedback FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_vehicle_feedback TO authenticated;

-- RPC 14: cancel_vehicle_booking
CREATE OR REPLACE FUNCTION app_private.command_cancel_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_cancel_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_cutoff_mins integer;
  v_reason_code text := 'CANCELLED_BY_REQUESTER';
BEGIN
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking does not exist';
  END IF;

  IF v_booking.status IN ('COMPLETED', 'CANCELLED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Booking cannot be cancelled in status %', v_booking.status;
  END IF;

  SELECT late_cancellation_cutoff_minutes INTO v_cutoff_mins FROM public.fleet_system_settings WHERE id = 1;
  v_cutoff_mins := COALESCE(v_cutoff_mins, 120);

  IF now() + (v_cutoff_mins || ' minutes')::interval >= v_booking.requested_pickup_at THEN
    v_reason_code := 'LATE_CANCELLED';
  END IF;

  UPDATE public.vehicle_bookings SET
    status = 'CANCELLED',
    close_reason = v_reason_code,
    close_note = p_cancel_reason,
    cancelled_by_user_id = p_actor_user_id,
    cancelled_at = now(),
    updated_at = now()
  WHERE id = p_booking_id;

  -- Release assignment nếu có
  UPDATE public.vehicle_booking_assignments SET released_at = now() WHERE booking_id = p_booking_id AND is_active = true;

  RETURN jsonb_build_object('success', true, 'status', 'CANCELLED', 'close_reason', v_reason_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_vehicle_booking(
  p_booking_id uuid,
  p_cancel_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.command_cancel_vehicle_booking(public.current_app_user_id(), p_booking_id, p_cancel_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_vehicle_booking FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_vehicle_booking TO authenticated;
