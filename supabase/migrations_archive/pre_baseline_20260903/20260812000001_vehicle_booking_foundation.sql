-- ============================================================================
-- Migration 1: Vehicle Booking Foundation (Schema, Tables, Indexes, Constraints)
-- Date: 2026-08-12
-- Author: Vioo ERP System Architect
-- ============================================================================

-- 1. Kích hoạt Extension btree_gist cho Postgres Exclusion Range Constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Sequence sinh mã booking CAR-YYMMDD-XXXX
CREATE SEQUENCE IF NOT EXISTS public.vehicle_booking_code_seq START 1;

-- 3. Bảng fleet_locations (Danh mục Home Base chuẩn)
CREATE TABLE IF NOT EXISTS public.fleet_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  source_type text NOT NULL CHECK (source_type IN ('OFFICE', 'CONSTRUCTION_SITE', 'CUSTOM')),
  source_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Bảng fleet_system_settings (Bảng Cấu hình tham số Singleton)
CREATE TABLE IF NOT EXISTS public.fleet_system_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  booking_buffer_minutes integer NOT NULL DEFAULT 30 CHECK (booking_buffer_minutes >= 0),
  late_cancellation_cutoff_minutes integer NOT NULL DEFAULT 120 CHECK (late_cancellation_cutoff_minutes >= 0),
  feedback_auto_close_hours integer NOT NULL DEFAULT 24 CHECK (feedback_auto_close_hours >= 0),
  home_base_warning_radius_meters integer NOT NULL DEFAULT 500 CHECK (home_base_warning_radius_meters >= 0),
  on_time_tolerance_minutes integer NOT NULL DEFAULT 15 CHECK (on_time_tolerance_minutes >= 0),
  max_evidence_image_mb numeric(4, 1) NOT NULL DEFAULT 5.0 CHECK (max_evidence_image_mb > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Chèn dòng cấu hình singleton mặc định
INSERT INTO public.fleet_system_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 5. Bảng fleet_vehicle_profiles (Hồ sơ vận hành mở rộng cho Tài sản Xe)
CREATE TABLE IF NOT EXISTS public.fleet_vehicle_profiles (
  asset_id text PRIMARY KEY REFERENCES public.assets(id) ON DELETE RESTRICT,
  home_base_id uuid REFERENCES public.fleet_locations(id) ON DELETE SET NULL,
  vehicle_type text NOT NULL,
  seat_count integer NOT NULL CHECK (seat_count > 0),
  availability_status text NOT NULL DEFAULT 'AVAILABLE' CHECK (availability_status IN ('AVAILABLE', 'MAINTENANCE', 'LOCKED')),
  allow_self_drive boolean NOT NULL DEFAULT false,
  current_odometer numeric(12, 1) NOT NULL DEFAULT 0.0 CHECK (current_odometer >= 0),
  custody_status text NOT NULL DEFAULT 'AVAILABLE' CHECK (custody_status IN ('AVAILABLE', 'IN_CUSTODY')),
  current_custody_assignment_id uuid, -- Foreign Key được thêm sau bảng assignments
  inspection_certificate_number text,
  inspection_expiry_date date,
  inspection_photo_path text,
  insurance_expiry_date date,
  parking_spot_code text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Bảng vehicle_driver_authorizations (Ủy quyền Lái xe / Tài xế)
CREATE TABLE IF NOT EXISTS public.vehicle_driver_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  authorization_type text NOT NULL CHECK (authorization_type IN ('PROFESSIONAL_DRIVER', 'SELF_DRIVE')),
  license_number text NOT NULL,
  license_class text NOT NULL,
  license_expiry date NOT NULL,
  license_front_photo_path text,
  license_back_photo_path text,
  health_check_expiry_date date,
  allowed_vehicle_types text[],
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED')),
  approved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_authorization_type UNIQUE (user_id, authorization_type)
);

-- 7. View an toàn vehicle_driver_authorizations_eligible_v cho Dispatcher (Giấu thông tin bằng lái nhạy cảm)
CREATE OR REPLACE VIEW public.vehicle_driver_authorizations_eligible_v
WITH (security_invoker = true) AS
SELECT
  vda.id,
  vda.user_id,
  vda.employee_id,
  vda.authorization_type,
  vda.license_class,
  vda.license_expiry,
  vda.allowed_vehicle_types,
  vda.status,
  CASE
    WHEN vda.status = 'ACTIVE' AND vda.license_expiry >= CURRENT_DATE THEN true
    ELSE false
  END AS is_eligible
FROM public.vehicle_driver_authorizations vda;

-- 8. Bảng vehicle_unavailability_periods (Lịch không khả dụng của Xe - Bảo dưỡng/Khóa)
CREATE TABLE IF NOT EXISTS public.vehicle_unavailability_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_asset_id text NOT NULL REFERENCES public.fleet_vehicle_profiles(asset_id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('MAINTENANCE', 'REPAIR', 'LOCKED', 'OTHER')),
  note text,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_range tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
  CONSTRAINT check_unavailability_time_valid CHECK (end_at > start_at),
  CONSTRAINT no_vehicle_unavailability_overlap EXCLUDE USING gist (vehicle_asset_id WITH =, scheduled_range WITH &&)
);

-- 9. Bảng operator_unavailability_periods (Lịch không khả dụng của Người lái - Nghỉ phép/Bệnh)
CREATE TABLE IF NOT EXISTS public.operator_unavailability_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('LEAVE', 'SICK', 'OFFLINE', 'OTHER')),
  note text,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_range tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
  CONSTRAINT check_operator_unavailability_time_valid CHECK (end_at > start_at),
  CONSTRAINT no_operator_unavailability_overlap EXCLUDE USING gist (operator_user_id WITH =, scheduled_range WITH &&)
);

-- 10. Bảng vehicle_bookings (Yêu cầu Đặt xe)
CREATE TABLE IF NOT EXISTS public.vehicle_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code text NOT NULL UNIQUE,
  requester_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  trip_owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requester_employee_id_snapshot uuid,
  department_id_snapshot uuid,
  manager_user_id_snapshot uuid REFERENCES public.users(id) ON DELETE SET NULL,
  manager_resolution_status text DEFAULT 'NORMAL' CHECK (manager_resolution_status IN ('NORMAL', 'MISSING', 'OVERRIDDEN')),
  requested_pickup_at timestamptz NOT NULL,
  expected_return_at timestamptz NOT NULL,
  trip_type text NOT NULL CHECK (trip_type IN ('ONE_WAY', 'ROUND_TRIP', 'MULTI_STOP', 'MULTI_DAY')),
  pickup_location_text text NOT NULL,
  destination_text text NOT NULL,
  route_stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  purpose text NOT NULL,
  passenger_count integer NOT NULL CHECK (passenger_count > 0),
  requested_mode text NOT NULL CHECK (requested_mode IN ('WITH_DRIVER', 'SELF_DRIVE', 'FLEXIBLE')),
  preferred_vehicle_asset_id text REFERENCES public.fleet_vehicle_profiles(asset_id) ON DELETE SET NULL,
  preferred_driver_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  note text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'WAITING_DISPATCH', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  submitted_at timestamptz,
  approved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approval_source text CHECK (approval_source IN ('MANAGER', 'DISPATCH_OVERRIDE')),
  approval_note text,
  cancelled_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  close_reason text CHECK (close_reason IN ('REJECTED_BY_MANAGER', 'CANCELLED_BY_REQUESTER', 'LATE_CANCELLED', 'CANCELLED_BY_DISPATCHER', 'NO_SHOW', 'OTHER')),
  close_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_booking_time_valid CHECK (expected_return_at > requested_pickup_at)
);

-- 11. Bảng vehicle_booking_participants (Danh sách Người đi cùng)
CREATE TABLE IF NOT EXISTS public.vehicle_booking_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.vehicle_bookings(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  participant_name text NOT NULL,
  is_external boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 12. Bảng vehicle_booking_assignments (Gán Phương án Điều phối & Chống trùng lịch Range)
CREATE TABLE IF NOT EXISTS public.vehicle_booking_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.vehicle_bookings(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('INTERNAL_WITH_DRIVER', 'INTERNAL_SELF_DRIVE', 'EXTERNAL_TRANSPORT')),
  vehicle_asset_id text REFERENCES public.fleet_vehicle_profiles(asset_id) ON DELETE RESTRICT,
  operator_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  operator_type text CHECK (operator_type IN ('PROFESSIONAL_DRIVER', 'SELF_DRIVER')),
  reserved_start_at timestamptz NOT NULL,
  reserved_end_at timestamptz NOT NULL,
  released_at timestamptz,
  superseded_at timestamptz,
  superseded_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  supersede_reason text,
  home_base_id_snapshot uuid REFERENCES public.fleet_locations(id) ON DELETE SET NULL,
  handover_officer_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  allow_non_home_base_return boolean NOT NULL DEFAULT false,
  non_home_base_return_reason text,
  external_service_type text,
  external_provider_name text,
  external_driver_name text,
  external_driver_phone text,
  external_vehicle_plate text,
  external_estimated_cost numeric(12, 2) CHECK (external_estimated_cost >= 0),
  external_actual_cost numeric(12, 2) CHECK (external_actual_cost >= 0),
  external_currency text NOT NULL DEFAULT 'VND',
  external_receipt_path text,
  dispatch_reason_code text,
  operator_confirmation_status text DEFAULT 'PENDING' CHECK (operator_confirmation_status IN ('PENDING', 'CONFIRMED', 'DECLINED')),
  operator_confirmed_at timestamptz,
  operator_decline_reason text,
  assigned_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assignment_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scheduled_range tstzrange GENERATED ALWAYS AS (tstzrange(reserved_start_at, reserved_end_at, '[)')) STORED,
  CONSTRAINT check_assignment_reserved_time_valid CHECK (reserved_end_at > reserved_start_at),
  CONSTRAINT unique_booking_version UNIQUE (booking_id, version),
  CONSTRAINT no_vehicle_assignment_overlap EXCLUDE USING gist (vehicle_asset_id WITH =, scheduled_range WITH &&) WHERE (is_active = true AND released_at IS NULL AND vehicle_asset_id IS NOT NULL),
  CONSTRAINT no_operator_assignment_overlap EXCLUDE USING gist (operator_user_id WITH =, scheduled_range WITH &&) WHERE (is_active = true AND released_at IS NULL AND operator_user_id IS NOT NULL)
);

-- Partial Unique Index cho Active Assignment duy nhất của 1 booking
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_assignment_per_booking ON public.vehicle_booking_assignments(booking_id) WHERE is_active = true;

-- Gắn Foreign Key FK_current_custody_assignment vào fleet_vehicle_profiles
ALTER TABLE public.fleet_vehicle_profiles
  DROP CONSTRAINT IF EXISTS fk_fleet_vehicle_custody_assignment,
  ADD CONSTRAINT fk_fleet_vehicle_custody_assignment FOREIGN KEY (current_custody_assignment_id) REFERENCES public.vehicle_booking_assignments(id) ON DELETE SET NULL;

-- 13. Bảng vehicle_trip_logs (Nhật ký Chuyến đi Thực tế)
CREATE TABLE IF NOT EXISTS public.vehicle_trip_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.vehicle_bookings(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.vehicle_booking_assignments(id) ON DELETE RESTRICT,
  assignment_version_snapshot integer NOT NULL,
  vehicle_asset_id_snapshot text,
  operator_user_id_snapshot uuid,
  trip_status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (trip_status IN ('NOT_STARTED', 'IN_PROGRESS', 'FINISHED')),
  started_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  departed_home_base_at timestamptz,
  actual_pickup_at timestamptz,
  start_odometer numeric(12, 1) CHECK (start_odometer >= 0),
  start_photo_path text,
  start_latitude numeric(10, 7) CHECK (start_latitude BETWEEN -90 AND 90),
  start_longitude numeric(10, 7) CHECK (start_longitude BETWEEN -180 AND 180),
  start_accuracy_m numeric(8, 2),
  start_location_capture_failed boolean NOT NULL DEFAULT false,
  start_location_failure_reason text,
  finished_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actual_return_at timestamptz,
  end_odometer numeric(12, 1) CHECK (end_odometer >= 0),
  end_photo_path text,
  end_latitude numeric(10, 7) CHECK (end_latitude BETWEEN -90 AND 90),
  end_longitude numeric(10, 7) CHECK (end_longitude BETWEEN -180 AND 180),
  end_accuracy_m numeric(8, 2),
  end_location_capture_failed boolean NOT NULL DEFAULT false,
  end_location_failure_reason text,
  distance_km numeric(12, 1) CHECK (distance_km >= 0),
  vehicle_condition_end text CHECK (vehicle_condition_end IN ('NORMAL', 'ISSUE')),
  issue_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_odometer_range CHECK (end_odometer IS NULL OR start_odometer IS NULL OR end_odometer >= start_odometer)
);

-- 14. Bảng vehicle_handover_logs (Bàn giao & Nhận lại Chìa khóa)
CREATE TABLE IF NOT EXISTS public.vehicle_handover_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.vehicle_bookings(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.vehicle_booking_assignments(id) ON DELETE RESTRICT,
  assignment_version_snapshot integer NOT NULL,
  vehicle_asset_id_snapshot text NOT NULL,
  operator_user_id_snapshot uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('OUTBOUND_HANDOVER', 'RETURN_RECEIPT')),
  officer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_on_behalf boolean NOT NULL DEFAULT false,
  override_reason text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_handover_event_per_assignment UNIQUE (assignment_id, event_type)
);

-- 15. Bảng vehicle_booking_issues (Phản ánh Nhạy cảm & Khiếu nại)
CREATE TABLE IF NOT EXISTS public.vehicle_booking_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.vehicle_bookings(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  issue_category text NOT NULL,
  comment text NOT NULL,
  resolution_status text NOT NULL DEFAULT 'PENDING' CHECK (resolution_status IN ('PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  resolved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 16. Bảng vehicle_booking_feedback (Đánh giá 5 Sao & Tag tích cực)
CREATE TABLE IF NOT EXISTS public.vehicle_booking_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.vehicle_bookings(id) ON DELETE CASCADE,
  respondent_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'ISSUE_REPORTED', 'AUTO_CLOSED', 'RESOLVED')),
  rating integer CHECK (rating BETWEEN 1 AND 5),
  positive_tags text[],
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 17. Indexes Tối ưu hóa truy vấn
CREATE INDEX IF NOT EXISTS idx_fleet_vehicle_profiles_status ON public.fleet_vehicle_profiles(availability_status, custody_status);
CREATE INDEX IF NOT EXISTS idx_vehicle_driver_authorizations_user ON public.vehicle_driver_authorizations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_bookings_requester ON public.vehicle_bookings(requester_user_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_bookings_status_time ON public.vehicle_bookings(status, requested_pickup_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_booking_assignments_booking ON public.vehicle_booking_assignments(booking_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vehicle_booking_assignments_vehicle_time ON public.vehicle_booking_assignments(vehicle_asset_id, reserved_start_at, reserved_end_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_booking_assignments_operator_time ON public.vehicle_booking_assignments(operator_user_id, reserved_start_at, reserved_end_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_trip_logs_booking ON public.vehicle_trip_logs(booking_id, trip_status);
CREATE INDEX IF NOT EXISTS idx_vehicle_handover_logs_assignment ON public.vehicle_handover_logs(assignment_id, event_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_booking_issues_booking ON public.vehicle_booking_issues(booking_id, resolution_status);
