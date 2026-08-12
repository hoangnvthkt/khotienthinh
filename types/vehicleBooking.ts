export type LocationSourceType = 'OFFICE' | 'CONSTRUCTION_SITE' | 'CUSTOM';
export type VehicleAvailabilityStatus = 'AVAILABLE' | 'MAINTENANCE' | 'LOCKED';
export type PhysicalCustodyStatus = 'AVAILABLE' | 'IN_CUSTODY';
export type DriverAuthorizationType = 'PROFESSIONAL_DRIVER' | 'SELF_DRIVE';
export type DriverAuthorizationStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
export type VehicleUnavailabilityReason = 'MAINTENANCE' | 'REPAIR' | 'LOCKED' | 'OTHER';
export type OperatorUnavailabilityReason = 'LEAVE' | 'SICK' | 'OFFLINE' | 'OTHER';
export type VehicleTripType = 'ONE_WAY' | 'ROUND_TRIP' | 'MULTI_STOP' | 'MULTI_DAY';
export type VehicleRequestedMode = 'WITH_DRIVER' | 'SELF_DRIVE' | 'FLEXIBLE';
export type VehicleBookingStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'WAITING_DISPATCH' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ManagerResolutionStatus = 'NORMAL' | 'MISSING' | 'OVERRIDDEN';
export type ApprovalSource = 'MANAGER' | 'DISPATCH_OVERRIDE';
export type BookingCloseReason = 'REJECTED_BY_MANAGER' | 'CANCELLED_BY_REQUESTER' | 'LATE_CANCELLED' | 'CANCELLED_BY_DISPATCHER' | 'NO_SHOW' | 'OTHER';
export type FulfillmentType = 'INTERNAL_WITH_DRIVER' | 'INTERNAL_SELF_DRIVE' | 'EXTERNAL_TRANSPORT';
export type OperatorType = 'PROFESSIONAL_DRIVER' | 'SELF_DRIVER';
export type OperatorConfirmationStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';
export type TripStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED';
export type HandoverEventType = 'OUTBOUND_HANDOVER' | 'RETURN_RECEIPT';
export type IssueResolutionStatus = 'PENDING' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';
export type FeedbackStatus = 'PENDING' | 'CONFIRMED' | 'ISSUE_REPORTED' | 'AUTO_CLOSED' | 'RESOLVED';

export interface FleetLocation {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source_type: LocationSourceType;
  source_id?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FleetSystemSetting {
  id: number;
  booking_buffer_minutes: number;
  late_cancellation_cutoff_minutes: number;
  feedback_auto_close_hours: number;
  home_base_warning_radius_meters: number;
  on_time_tolerance_minutes: number;
  trip_reminder_minutes: number;
  max_evidence_image_mb: number;
  require_handover_for_self_drive: boolean;
  allow_dispatch_approval_override: boolean;
  created_at: string;
  updated_at: string;
}

export interface FleetVehicleProfile {
  asset_id: string;
  home_base_id?: string | null;
  vehicle_type: string;
  seat_count: number;
  availability_status: VehicleAvailabilityStatus;
  allow_self_drive: boolean;
  current_odometer: number;
  custody_status: PhysicalCustodyStatus;
  current_custody_assignment_id?: string | null;
  inspection_certificate_number?: string | null;
  inspection_expiry_date?: string | null;
  inspection_photo_path?: string | null;
  insurance_expiry_date?: string | null;
  parking_spot_code?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FleetVehicleProfileView extends FleetVehicleProfile {
  asset_code: string;
  asset_name: string;
  asset_image_url?: string | null;
  asset_brand?: string | null;
  asset_model?: string | null;
  home_base_name?: string | null;
}

export interface FleetVehicleCandidate {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  asset_image_url?: string | null;
  asset_brand?: string | null;
  asset_model?: string | null;
  category_name: string;
}

export interface VehicleDriverAuthorization {
  id: string;
  user_id: string;
  employee_id?: string | null;
  authorization_type: DriverAuthorizationType;
  license_number: string;
  license_class: string;
  license_expiry: string;
  license_front_photo_path?: string | null;
  license_back_photo_path?: string | null;
  health_check_expiry_date?: string | null;
  allowed_vehicle_types?: string[] | null;
  status: DriverAuthorizationStatus;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleDriverAuthorizationAdminView extends VehicleDriverAuthorization {
  employee_code?: string | null;
  employee_name?: string | null;
  employee_title?: string | null;
  employee_avatar_url?: string | null;
  department_id?: string | null;
}

export interface VehicleDriverCandidate {
  employee_id: string;
  user_id: string;
  employee_code: string;
  employee_name: string;
  employee_title?: string | null;
  employee_avatar_url?: string | null;
  department_id?: string | null;
  authorization_count: number;
}

export interface VehicleDriverAuthorizationEligible {
  id: string;
  user_id: string;
  employee_id?: string | null;
  authorization_type: DriverAuthorizationType;
  license_class: string;
  license_expiry: string;
  allowed_vehicle_types?: string[] | null;
  status: DriverAuthorizationStatus;
  is_eligible: boolean;
  employee_name?: string | null;
  employee_title?: string | null;
  employee_avatar_url?: string | null;
}

export interface VehicleUnavailabilityPeriod {
  id: string;
  vehicle_asset_id: string;
  start_at: string;
  end_at: string;
  reason_code: VehicleUnavailabilityReason;
  note?: string | null;
  created_by_user_id?: string | null;
  created_at: string;
}

export interface OperatorUnavailabilityPeriod {
  id: string;
  operator_user_id: string;
  start_at: string;
  end_at: string;
  reason_code: OperatorUnavailabilityReason;
  note?: string | null;
  created_by_user_id?: string | null;
  created_at: string;
}

export interface VehicleBookingParticipant {
  id: string;
  booking_id: string;
  user_id?: string | null;
  employee_id?: string | null;
  participant_name: string;
  is_external: boolean;
  created_at: string;
}

export interface VehicleBooking {
  id: string;
  booking_code: string;
  requester_user_id: string;
  trip_owner_user_id?: string | null;
  requester_employee_id_snapshot?: string | null;
  department_id_snapshot?: string | null;
  manager_user_id_snapshot?: string | null;
  manager_resolution_status: ManagerResolutionStatus;
  requested_pickup_at: string;
  expected_return_at: string;
  trip_type: VehicleTripType;
  pickup_location_text: string;
  destination_text: string;
  route_stops: any[];
  purpose: string;
  passenger_count: number;
  requested_mode: VehicleRequestedMode;
  preferred_vehicle_asset_id?: string | null;
  preferred_driver_user_id?: string | null;
  note?: string | null;
  status: VehicleBookingStatus;
  submitted_at?: string | null;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  approval_source?: ApprovalSource | null;
  approval_note?: string | null;
  cancelled_by_user_id?: string | null;
  cancelled_at?: string | null;
  close_reason?: BookingCloseReason | null;
  close_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleBookingDispatcherCandidate {
  user_id: string;
  employee_id: string;
  employee_code?: string | null;
  employee_name: string;
  employee_title?: string | null;
  employee_avatar_url?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  is_dispatcher: boolean;
}

export interface VehicleBookingApprovalCard extends VehicleBooking {
  requester_employee_code?: string | null;
  requester_employee_name?: string | null;
  requester_employee_title?: string | null;
  requester_avatar_url?: string | null;
  requester_department_name?: string | null;
  preferred_vehicle_asset_code?: string | null;
  preferred_vehicle_asset_name?: string | null;
  preferred_vehicle_image_url?: string | null;
  preferred_vehicle_type?: string | null;
  preferred_vehicle_seat_count?: number | null;
}

export interface VehicleBookingAssignment {
  id: string;
  booking_id: string;
  version: number;
  is_active: boolean;
  fulfillment_type: FulfillmentType;
  vehicle_asset_id?: string | null;
  operator_user_id?: string | null;
  operator_type?: OperatorType | null;
  reserved_start_at: string;
  reserved_end_at: string;
  released_at?: string | null;
  superseded_at?: string | null;
  superseded_by_user_id?: string | null;
  supersede_reason?: string | null;
  home_base_id_snapshot?: string | null;
  handover_officer_user_id?: string | null;
  allow_non_home_base_return: boolean;
  non_home_base_return_reason?: string | null;
  external_service_type?: string | null;
  external_provider_name?: string | null;
  external_driver_name?: string | null;
  external_driver_phone?: string | null;
  external_vehicle_plate?: string | null;
  external_estimated_cost?: number | null;
  external_actual_cost?: number | null;
  external_currency: string;
  external_receipt_path?: string | null;
  dispatch_reason_code?: string | null;
  operator_confirmation_status: OperatorConfirmationStatus;
  operator_confirmed_at?: string | null;
  operator_decline_reason?: string | null;
  assigned_by_user_id: string;
  assigned_at: string;
  assignment_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleTripLog {
  id: string;
  booking_id: string;
  assignment_id: string;
  assignment_version_snapshot: number;
  vehicle_asset_id_snapshot?: string | null;
  operator_user_id_snapshot?: string | null;
  trip_status: TripStatus;
  started_by_user_id?: string | null;
  departed_home_base_at?: string | null;
  actual_pickup_at?: string | null;
  start_odometer?: number | null;
  start_photo_path?: string | null;
  start_latitude?: number | null;
  start_longitude?: number | null;
  start_accuracy_m?: number | null;
  start_location_capture_failed: boolean;
  start_location_failure_reason?: string | null;
  finished_by_user_id?: string | null;
  actual_return_at?: string | null;
  end_odometer?: number | null;
  end_photo_path?: string | null;
  end_latitude?: number | null;
  end_longitude?: number | null;
  end_accuracy_m?: number | null;
  end_location_capture_failed: boolean;
  end_location_failure_reason?: string | null;
  distance_km?: number | null;
  vehicle_condition_end?: 'NORMAL' | 'ISSUE' | null;
  issue_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleHandoverLog {
  id: string;
  booking_id: string;
  assignment_id: string;
  assignment_version_snapshot: number;
  vehicle_asset_id_snapshot: string;
  operator_user_id_snapshot: string;
  event_type: HandoverEventType;
  officer_user_id: string;
  confirmed_at: string;
  confirmed_on_behalf: boolean;
  override_reason?: string | null;
  note?: string | null;
  created_at: string;
}

export interface VehicleBookingIssue {
  id: string;
  booking_id: string;
  reporter_user_id: string;
  issue_category: string;
  comment: string;
  resolution_status: IssueResolutionStatus;
  resolved_by_user_id?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleBookingFeedback {
  id: string;
  booking_id: string;
  respondent_user_id?: string | null;
  status: FeedbackStatus;
  rating?: number | null;
  positive_tags?: string[] | null;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
}
