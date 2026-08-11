-- ============================================================================
-- Migration 2: Vehicle Booking Security (Permissions, RLS, Storage & Outbox)
-- Date: 2026-08-12
-- Author: Vioo ERP System Architect
-- ============================================================================

-- 1. Đảm bảo schema app_private tồn tại và được phân quyền
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM public;
REVOKE ALL ON SCHEMA app_private FROM anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;

-- 2. Đăng ký Application, Module và 11 Permission Codes vào Hệ thống Phân quyền ERP
INSERT INTO public.permission_applications (code, name, sort_order)
VALUES ('resource_booking', 'Booking tài nguyên', 140)
ON CONFLICT (code) DO UPDATE
SET name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

INSERT INTO public.permission_modules (application_code, code, name, routes, legacy_module_key, sort_order)
VALUES ('resource_booking', 'resource_booking.vehicle', 'Đặt xe công ty', array['/booking/vehicle', '/booking/vehicle/dispatch', '/booking/vehicle/fleet', '/booking/vehicle/drivers', '/booking/vehicle/reports']::text[], 'VEHICLE_BOOKING', 10)
ON CONFLICT (code) DO UPDATE
SET name = excluded.name,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    updated_at = now();

INSERT INTO public.permission_actions (module_code, action, permission_code, label, scope_modes, legacy_module_key, legacy_route, legacy_admin_only, sort_order)
VALUES
  ('resource_booking.vehicle', 'create', 'booking.vehicle.create', 'Tạo yêu cầu đặt xe', array['global', 'own']::text[], 'VEHICLE_BOOKING', '/booking/vehicle', false, 10),
  ('resource_booking.vehicle', 'view_own', 'booking.vehicle.view_own', 'Xem yêu cầu cá nhân', array['global', 'own']::text[], 'VEHICLE_BOOKING', '/booking/vehicle', false, 20),
  ('resource_booking.vehicle', 'approve_direct_reports', 'booking.vehicle.approve_direct_reports', 'Duyệt yêu cầu cấp dưới', array['global', 'department']::text[], 'VEHICLE_BOOKING', '/booking/vehicle', false, 30),
  ('resource_booking.vehicle', 'dispatch', 'booking.vehicle.dispatch', 'Điều phối & duyệt thay', array['global', 'department', 'assigned']::text[], 'VEHICLE_BOOKING', '/booking/vehicle/dispatch', false, 40),
  ('resource_booking.vehicle', 'trip.execute', 'booking.vehicle.trip.execute', 'Thực hiện chuyến đi', array['global', 'assigned']::text[], 'VEHICLE_BOOKING', '/booking/vehicle', false, 50),
  ('resource_booking.vehicle', 'handover', 'booking.vehicle.handover', 'Bàn giao xe & chìa khóa', array['global', 'assigned']::text[], 'VEHICLE_BOOKING', '/booking/vehicle', false, 60),
  ('resource_booking.vehicle', 'manage_authorizations', 'booking.vehicle.manage_authorizations', 'Quản lý ủy quyền tài xế', array['global']::text[], 'VEHICLE_BOOKING', '/booking/vehicle/drivers', true, 70),
  ('resource_booking.vehicle', 'manage_fleet', 'booking.vehicle.manage_fleet', 'Quản lý hồ sơ xe', array['global']::text[], 'VEHICLE_BOOKING', '/booking/vehicle/fleet', true, 80),
  ('resource_booking.vehicle', 'view_reports', 'booking.vehicle.view_reports', 'Xem báo cáo & KPI', array['global', 'department']::text[], 'VEHICLE_BOOKING', '/booking/vehicle/reports', false, 90),
  ('resource_booking.vehicle', 'view_sensitive_feedback', 'booking.vehicle.view_sensitive_feedback', 'Xem phản ánh nhạy cảm', array['global']::text[], 'VEHICLE_BOOKING', '/booking/vehicle/reports', true, 100),
  ('resource_booking.vehicle', 'admin', 'booking.vehicle.admin', 'Quản trị tối cao đặt xe', array['global']::text[], 'VEHICLE_BOOKING', '/booking/vehicle', true, 110)
ON CONFLICT (permission_code) DO UPDATE
SET label = excluded.label,
    scope_modes = excluded.scope_modes,
    sort_order = excluded.sort_order,
    updated_at = now();

-- 3. Bảng Notification Outbox trong app_private cho Worker
CREATE TABLE IF NOT EXISTS app_private.vehicle_booking_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_outbox_event_recipient UNIQUE (event_key, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_notification_outbox_queue ON app_private.vehicle_booking_notification_outbox(status, available_at) WHERE status IN ('PENDING', 'PROCESSING');

-- 4. Helper Security Functions trong app_private
CREATE OR REPLACE FUNCTION app_private.vehicle_user_has_permission(
  p_user_id uuid,
  p_permission_code text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_has_perm boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Kiểm tra Admin tối cao hệ thống
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND u.role = 'ADMIN'
  ) THEN
    RETURN true;
  END IF;

  -- 2. Kiểm tra qua Permission Framework hiện có (gọi permission surface)
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permission_grants g
    WHERE g.user_id = p_user_id
      AND g.permission_code IN (p_permission_code, 'booking.vehicle.admin')
      AND g.is_active = true
  ) INTO v_has_perm;

  IF v_has_perm THEN
    RETURN true;
  END IF;

  -- Fallback mặc định cho các quyền cơ bản (create, view_own, trip.execute, handover)
  IF p_permission_code IN ('booking.vehicle.create', 'booking.vehicle.view_own', 'booking.vehicle.trip.execute', 'booking.vehicle.handover') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.vehicle_user_can_view_booking(
  p_user_id uuid,
  p_booking_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL OR p_booking_id IS NULL THEN
    RETURN false;
  END IF;

  -- Dispatcher, Admin, Fleet Manager có quyền xem toàn bộ
  IF app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.dispatch')
     OR app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.manage_fleet')
     OR app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.admin') THEN
    RETURN true;
  END IF;

  -- Người tạo (Requester) hoặc Người chịu trách nhiệm (Trip Owner)
  IF EXISTS (
    SELECT 1 FROM public.vehicle_bookings b
    WHERE b.id = p_booking_id AND (b.requester_user_id = p_user_id OR b.trip_owner_user_id = p_user_id)
  ) THEN
    RETURN true;
  END IF;

  -- Quản lý trực tiếp phụ trách
  IF EXISTS (
    SELECT 1 FROM public.vehicle_bookings b
    WHERE b.id = p_booking_id AND b.manager_user_id_snapshot = p_user_id
  ) THEN
    RETURN true;
  END IF;

  -- Người đi cùng (Participant)
  IF EXISTS (
    SELECT 1 FROM public.vehicle_booking_participants p
    WHERE p.booking_id = p_booking_id AND p.user_id = p_user_id
  ) THEN
    RETURN true;
  END IF;

  -- Tài xế / Người tự lái được gán trong Assignment
  IF EXISTS (
    SELECT 1 FROM public.vehicle_booking_assignments a
    WHERE a.booking_id = p_booking_id AND a.operator_user_id = p_user_id AND a.is_active = true
  ) THEN
    RETURN true;
  END IF;

  -- Người được giao bàn giao chìa khóa
  IF EXISTS (
    SELECT 1 FROM public.vehicle_booking_assignments a
    WHERE a.booking_id = p_booking_id AND a.handover_officer_user_id = p_user_id AND a.is_active = true
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 5. Kích hoạt và thiết lập RLS Policies cho toàn bộ 14 Bảng
ALTER TABLE public.fleet_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_vehicle_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_driver_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_unavailability_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_unavailability_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_booking_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_booking_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_trip_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_handover_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_booking_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_booking_feedback ENABLE ROW LEVEL SECURITY;

-- Dynamic SELECT Policies
DROP POLICY IF EXISTS p_fleet_locations_select ON public.fleet_locations;
CREATE POLICY p_fleet_locations_select ON public.fleet_locations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS p_fleet_system_settings_select ON public.fleet_system_settings;
CREATE POLICY p_fleet_system_settings_select ON public.fleet_system_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS p_fleet_vehicle_profiles_select ON public.fleet_vehicle_profiles;
CREATE POLICY p_fleet_vehicle_profiles_select ON public.fleet_vehicle_profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS p_vehicle_driver_authorizations_select ON public.vehicle_driver_authorizations;
CREATE POLICY p_vehicle_driver_authorizations_select ON public.vehicle_driver_authorizations FOR SELECT TO authenticated
USING (
  user_id = public.current_app_user_id()
  OR app_private.vehicle_user_has_permission(public.current_app_user_id(), 'booking.vehicle.manage_authorizations')
  OR app_private.vehicle_user_has_permission(public.current_app_user_id(), 'booking.vehicle.dispatch')
);

DROP POLICY IF EXISTS p_vehicle_unavailability_periods_select ON public.vehicle_unavailability_periods;
CREATE POLICY p_vehicle_unavailability_periods_select ON public.vehicle_unavailability_periods FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS p_operator_unavailability_periods_select ON public.operator_unavailability_periods;
CREATE POLICY p_operator_unavailability_periods_select ON public.operator_unavailability_periods FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS p_vehicle_bookings_select ON public.vehicle_bookings;
CREATE POLICY p_vehicle_bookings_select ON public.vehicle_bookings FOR SELECT TO authenticated
USING (app_private.vehicle_user_can_view_booking(public.current_app_user_id(), id));

DROP POLICY IF EXISTS p_vehicle_booking_participants_select ON public.vehicle_booking_participants;
CREATE POLICY p_vehicle_booking_participants_select ON public.vehicle_booking_participants FOR SELECT TO authenticated
USING (app_private.vehicle_user_can_view_booking(public.current_app_user_id(), booking_id));

DROP POLICY IF EXISTS p_vehicle_booking_assignments_select ON public.vehicle_booking_assignments;
CREATE POLICY p_vehicle_booking_assignments_select ON public.vehicle_booking_assignments FOR SELECT TO authenticated
USING (app_private.vehicle_user_can_view_booking(public.current_app_user_id(), booking_id));

DROP POLICY IF EXISTS p_vehicle_trip_logs_select ON public.vehicle_trip_logs;
CREATE POLICY p_vehicle_trip_logs_select ON public.vehicle_trip_logs FOR SELECT TO authenticated
USING (app_private.vehicle_user_can_view_booking(public.current_app_user_id(), booking_id));

DROP POLICY IF EXISTS p_vehicle_handover_logs_select ON public.vehicle_handover_logs;
CREATE POLICY p_vehicle_handover_logs_select ON public.vehicle_handover_logs FOR SELECT TO authenticated
USING (app_private.vehicle_user_can_view_booking(public.current_app_user_id(), booking_id));

-- RLS BẢO MẬT TUYỆT ĐỐI CHO BẢNG PHẢN ÁNH NHẠY CẢM vehicle_booking_issues
DROP POLICY IF EXISTS p_vehicle_booking_issues_select ON public.vehicle_booking_issues;
CREATE POLICY p_vehicle_booking_issues_select ON public.vehicle_booking_issues FOR SELECT TO authenticated
USING (
  reporter_user_id = public.current_app_user_id()
  OR app_private.vehicle_user_has_permission(public.current_app_user_id(), 'booking.vehicle.view_sensitive_feedback')
  OR app_private.vehicle_user_has_permission(public.current_app_user_id(), 'booking.vehicle.dispatch')
);

DROP POLICY IF EXISTS p_vehicle_booking_feedback_select ON public.vehicle_booking_feedback;
CREATE POLICY p_vehicle_booking_feedback_select ON public.vehicle_booking_feedback FOR SELECT TO authenticated
USING (app_private.vehicle_user_can_view_booking(public.current_app_user_id(), booking_id));

-- 6. Thu hồi toàn bộ quyền Direct DML (INSERT/UPDATE/DELETE) trên các Bảng Công khai
REVOKE INSERT, UPDATE, DELETE ON public.fleet_locations FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.fleet_system_settings FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.fleet_vehicle_profiles FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_driver_authorizations FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_unavailability_periods FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.operator_unavailability_periods FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_bookings FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_booking_participants FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_booking_assignments FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_trip_logs FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_handover_logs FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_booking_issues FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_booking_feedback FROM authenticated, anon;

-- 7. Cấu hình Private Storage Bucket vehicle-trip-evidence & Storage Policies
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-trip-evidence',
  'vehicle-trip-evidence',
  false,
  10485760, -- 10MB limit
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760;

-- Storage Policies cho Bucket vehicle-trip-evidence theo Namespace Bất biến (cấm UPDATE)
DROP POLICY IF EXISTS p_storage_vehicle_evidence_select ON storage.objects;
CREATE POLICY p_storage_vehicle_evidence_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'vehicle-trip-evidence'
  AND (
    (storage.foldername(name))[1] IN ('trips', 'external', 'licenses', 'fleet')
  )
);

DROP POLICY IF EXISTS p_storage_vehicle_evidence_insert ON storage.objects;
CREATE POLICY p_storage_vehicle_evidence_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vehicle-trip-evidence'
  AND (
    (storage.foldername(name))[1] IN ('trips', 'external', 'licenses', 'fleet')
  )
);

-- Cấm hoàn toàn UPDATE & DELETE file trên storage để đảm bảo tính bất biến của bằng chứng kilomet
REVOKE UPDATE, DELETE ON storage.objects FROM authenticated, anon;
