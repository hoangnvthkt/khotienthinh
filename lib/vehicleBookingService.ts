import { supabase } from './supabase';
import type {
  FleetLocation,
  FleetSystemSetting,
  FleetVehicleProfile,
  FleetVehicleProfileView,
  FleetVehicleCandidate,
  FleetVehicleTypeOption,
  VehicleDriverAuthorization,
  VehicleDriverAuthorizationAdminView,
  VehicleDriverCandidate,
  VehicleDriverAuthorizationEligible,
  VehicleUnavailabilityPeriod,
  OperatorUnavailabilityPeriod,
  VehicleBooking,
  VehicleBookingApprovalCard,
  VehicleBookingDispatcherCandidate,
  VehicleBookingParticipant,
  VehicleBookingAssignment,
  VehicleBookingAssignmentDisplay,
  VehicleTripLog,
  VehicleHandoverLog,
  VehicleBookingIssue,
  VehicleBookingFeedback,
  VehicleTripType,
  VehicleRequestedMode,
  FulfillmentType,
  OperatorType,
  VehicleUnavailabilityReason,
  OperatorUnavailabilityReason
} from '../types/vehicleBooking';

export type FleetSystemSettingsUpdate = Pick<
  FleetSystemSetting,
  | 'booking_buffer_minutes'
  | 'late_cancellation_cutoff_minutes'
  | 'feedback_auto_close_hours'
  | 'home_base_warning_radius_meters'
  | 'on_time_tolerance_minutes'
  | 'trip_reminder_minutes'
  | 'max_evidence_image_mb'
  | 'require_handover_for_self_drive'
  | 'allow_dispatch_approval_override'
>;

export type FleetVehicleProfileUpdateInput = {
  asset_id: string;
  home_base_id?: string | null;
  vehicle_type: string;
  seat_count: number;
  availability_status: 'AVAILABLE' | 'MAINTENANCE' | 'LOCKED';
  allow_self_drive: boolean;
  inspection_certificate_number?: string | null;
  inspection_expiry_date?: string | null;
  inspection_photo_path?: string | null;
  insurance_expiry_date?: string | null;
  parking_spot_code?: string | null;
};

export function mergeFleetSystemSettings(
  current: FleetSystemSettingsUpdate,
  patch: Partial<FleetSystemSettingsUpdate>,
): FleetSystemSettingsUpdate {
  return {
    booking_buffer_minutes: patch.booking_buffer_minutes ?? current.booking_buffer_minutes,
    late_cancellation_cutoff_minutes: patch.late_cancellation_cutoff_minutes ?? current.late_cancellation_cutoff_minutes,
    feedback_auto_close_hours: patch.feedback_auto_close_hours ?? current.feedback_auto_close_hours,
    home_base_warning_radius_meters: patch.home_base_warning_radius_meters ?? current.home_base_warning_radius_meters,
    on_time_tolerance_minutes: patch.on_time_tolerance_minutes ?? current.on_time_tolerance_minutes,
    trip_reminder_minutes: patch.trip_reminder_minutes ?? current.trip_reminder_minutes,
    max_evidence_image_mb: patch.max_evidence_image_mb ?? current.max_evidence_image_mb,
    require_handover_for_self_drive: patch.require_handover_for_self_drive ?? current.require_handover_for_self_drive,
    allow_dispatch_approval_override: patch.allow_dispatch_approval_override ?? current.allow_dispatch_approval_override,
  };
}

export function buildFleetVehicleProfileUpdate(
  current: FleetVehicleProfileUpdateInput,
  patch: Partial<Omit<FleetVehicleProfileUpdateInput, 'asset_id'>>,
): FleetVehicleProfileUpdateInput {
  return {
    asset_id: current.asset_id,
    home_base_id: patch.home_base_id ?? current.home_base_id,
    vehicle_type: patch.vehicle_type ?? current.vehicle_type,
    seat_count: patch.seat_count ?? current.seat_count,
    availability_status: patch.availability_status ?? current.availability_status,
    allow_self_drive: patch.allow_self_drive ?? current.allow_self_drive,
    inspection_certificate_number: patch.inspection_certificate_number ?? current.inspection_certificate_number,
    inspection_expiry_date: patch.inspection_expiry_date ?? current.inspection_expiry_date,
    inspection_photo_path: patch.inspection_photo_path ?? current.inspection_photo_path,
    insurance_expiry_date: patch.insurance_expiry_date ?? current.insurance_expiry_date,
    parking_spot_code: patch.parking_spot_code ?? current.parking_spot_code,
  };
}

// ============================================================================
// TIMEZONE & DATE HELPERS (Asia/Ho_Chi_Minh - UTC+7)
// ============================================================================

export function vietnamLocalDateTimeToISOString(input: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
  if (!match) throw new Error('INVALID_VIETNAM_LOCAL_DATETIME');

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const validationDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const isValid = validationDate.getUTCFullYear() === year
    && validationDate.getUTCMonth() === month - 1
    && validationDate.getUTCDate() === day
    && validationDate.getUTCHours() === hour
    && validationDate.getUTCMinutes() === minute
    && validationDate.getUTCSeconds() === second;
  if (!isValid) throw new Error('INVALID_VIETNAM_LOCAL_DATETIME');

  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second)).toISOString();
}

export function toVietnamISOString(dateInput: Date | string): string {
  if (typeof dateInput === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateInput)) {
    return vietnamLocalDateTimeToISOString(dateInput);
  }
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date provided to toVietnamISOString');
  }
  return date.toISOString();
}

export function formatVietnamDateTime(isoString?: string | null): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getVietnamDayRange(reference: Date | string = new Date()): {
  startIso: string;
  endIso: string;
} {
  const date = typeof reference === 'string' ? new Date(reference) : reference;
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_REFERENCE_DATE');

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value || '';
  const start = new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00+07:00`);

  return {
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function getDispatchValidationError(input: {
  bookingStatus: string;
  fulfillmentType: string;
  vehicleAssetId?: string;
  operatorUserId?: string;
  handoverOfficerUserId?: string;
  overrideReason?: string;
  externalServiceType?: string;
}): string | null {
  if (input.bookingStatus === 'PENDING_APPROVAL' && !input.overrideReason?.trim()) {
    return 'OVERRIDE_REASON_REQUIRED';
  }
  if (input.fulfillmentType === 'EXTERNAL_TRANSPORT') {
    return input.externalServiceType?.trim() ? null : 'EXTERNAL_SERVICE_TYPE_REQUIRED';
  }
  if (!input.vehicleAssetId) return 'VEHICLE_REQUIRED';
  if (!input.operatorUserId) return 'OPERATOR_REQUIRED';
  if (input.fulfillmentType === 'INTERNAL_SELF_DRIVE' && !input.handoverOfficerUserId) {
    return 'HANDOVER_OFFICER_REQUIRED';
  }
  return null;
}

export function getVehicleOperationalStatus(
  profile: Pick<FleetVehicleProfile, 'active' | 'availability_status' | 'custody_status'>,
  flags: { busy?: boolean; unavailable?: boolean } = {},
): 'AVAILABLE' | 'BUSY' | 'UNAVAILABLE' | 'IN_CUSTODY' | 'INACTIVE' {
  if (!profile.active) return 'INACTIVE';
  if (profile.custody_status === 'IN_CUSTODY') return 'IN_CUSTODY';
  if (profile.availability_status !== 'AVAILABLE' || flags.unavailable) return 'UNAVAILABLE';
  if (flags.busy) return 'BUSY';
  return 'AVAILABLE';
}

export function getOperatorOperationalStatus(
  eligible: boolean,
  flags: { busy?: boolean; unavailable?: boolean } = {},
): 'AVAILABLE' | 'BUSY' | 'UNAVAILABLE' | 'INELIGIBLE' {
  if (!eligible) return 'INELIGIBLE';
  if (flags.unavailable) return 'UNAVAILABLE';
  if (flags.busy) return 'BUSY';
  return 'AVAILABLE';
}

export function isDriverCompatibleWithVehicle(
  driver: Pick<VehicleDriverAuthorizationEligible, 'authorization_type' | 'allowed_vehicle_types'>,
  vehicleType?: string | null,
): boolean {
  return driver.authorization_type === 'PROFESSIONAL_DRIVER'
    && Boolean(vehicleType)
    && Boolean(driver.allowed_vehicle_types?.includes(vehicleType as string));
}

export function selectCompatibleProfessionalDrivers<
  T extends Pick<VehicleDriverAuthorizationEligible, 'authorization_type' | 'allowed_vehicle_types'>,
>(drivers: T[], vehicleType?: string | null): T[] {
  return drivers.filter(driver => isDriverCompatibleWithVehicle(driver, vehicleType));
}

export function getDispatchErrorMessage(
  error: unknown,
  context: { driverName?: string | null; vehicleType?: string | null } = {},
): string {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : String(error || '');

  if (rawMessage.includes('DRIVER_LICENSE_CLASS_MISMATCH')
      || rawMessage.includes('DRIVER_VEHICLE_TYPE_MISMATCH')) {
    const driverName = context.driverName || 'Tài xế đã chọn';
    const vehicleType = context.vehicleType || 'đã chọn';
    return `${driverName} chưa được ủy quyền lái loại xe ${vehicleType}. Vui lòng cập nhật hồ sơ tài xế hoặc chọn tài xế khác.`;
  }

  return rawMessage || 'Xếp xe thất bại! Vui lòng kiểm tra xung đột lịch.';
}

export function getTripEvidenceValidationError(input: {
  mode: 'START' | 'FINISH';
  hasImage: boolean;
  latitude: number | null;
  longitude: number | null;
  locationCaptureFailed: boolean;
  locationFailureReason?: string;
}): string | null {
  if (!input.hasImage) return 'PHOTO_REQUIRED';
  const hasCoordinates = input.latitude !== null && input.longitude !== null;
  if (hasCoordinates) return null;
  if (!input.locationCaptureFailed) return 'LOCATION_REQUIRED';
  if (!input.locationFailureReason?.trim()) return 'LOCATION_FAILURE_REASON_REQUIRED';
  return null;
}

export function buildVehicleBookingParticipantPayload(input: string): Array<{
  participantName: string;
  isExternal: boolean;
}> {
  return input
    .split(/\r?\n/)
    .map(name => name.trim())
    .filter(Boolean)
    .map(participantName => ({ participantName, isExternal: false }));
}

export function getVehicleBookingPilotActions(input: {
  bookingStatus: string;
  fulfillmentType?: string;
  handoverEvents?: string[];
  feedbackStatus?: string;
}): string[] {
  if (input.bookingStatus === 'COMPLETED') {
    return input.feedbackStatus === 'PENDING' ? ['SUBMIT_FEEDBACK'] : [];
  }
  if (input.bookingStatus === 'ASSIGNED' && input.fulfillmentType === 'EXTERNAL_TRANSPORT') {
    return ['COMPLETE_EXTERNAL'];
  }
  if (input.bookingStatus === 'ASSIGNED' && input.fulfillmentType === 'INTERNAL_SELF_DRIVE') {
    return input.handoverEvents?.includes('OUTBOUND_HANDOVER')
      ? ['EXECUTE_TRIP']
      : ['HANDOVER_OUTBOUND'];
  }
  if (
    ['ASSIGNED', 'IN_PROGRESS'].includes(input.bookingStatus)
    && input.fulfillmentType === 'INTERNAL_WITH_DRIVER'
  ) {
    return ['EXECUTE_TRIP'];
  }
  return [];
}

// ============================================================================
// IMAGE COMPRESSION & PRIVATE STORAGE UPLOAD HELPER
// ============================================================================

export function isEvidenceImageWithinLimit(blob: Blob, maxMb: number): boolean {
  return maxMb > 0 && blob.size <= maxMb * 1024 * 1024;
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('IMAGE_COMPRESSION_FAILED')),
      'image/jpeg',
      quality,
    );
  });
}

export async function compressImageWithinLimit(file: File, maxMb = 5): Promise<Blob> {
  if (maxMb <= 0) throw new Error('INVALID_EVIDENCE_IMAGE_LIMIT');
  if (file.type === 'image/jpeg' && isEvidenceImageWithinLimit(file, maxMb)) return file;

  const img = await loadImageFile(file);
  const canvas = document.createElement('canvas');
  const maxDimension = 1920;
  const initialScale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  let width = Math.max(1, Math.round(img.width * initialScale));
  let height = Math.max(1, Math.round(img.height * initialScale));
  let lastBlob: Blob | null = null;

  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('IMAGE_COMPRESSION_FAILED');
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of [0.86, 0.72, 0.58, 0.44]) {
      lastBlob = await canvasToJpeg(canvas, quality);
      if (isEvidenceImageWithinLimit(lastBlob, maxMb)) return lastBlob;
    }

    width = Math.max(1, Math.round(width * 0.75));
    height = Math.max(1, Math.round(height * 0.75));
  }

  if (!lastBlob || !isEvidenceImageWithinLimit(lastBlob, maxMb)) {
    throw new Error('IMAGE_TOO_LARGE_AFTER_COMPRESSION');
  }
  return lastBlob;
}

export const compressImage = compressImageWithinLimit;

export async function uploadEvidenceImage(
  file: File,
  namespacePath: string,
  maxMb = 5
): Promise<string> {
  const compressedBlob = await compressImageWithinLimit(file, maxMb);
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  const fullPath = `${namespacePath.replace(/^\/+|\/+$/g, '')}/${fileName}`;

  const { data, error } = await supabase.storage
    .from('vehicle-trip-evidence')
    .upload(fullPath, compressedBlob, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) {
    throw new Error(`Upload ảnh thất bại: ${error.message}`);
  }
  return data.path;
}

export async function getPrivateImageUrl(path: string): Promise<string> {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const { data, error } = await supabase.storage
    .from('vehicle-trip-evidence')
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    return '';
  }
  return data.signedUrl;
}

// ============================================================================
// DATA QUERY FETCHERS
// ============================================================================

export async function fetchMyBookings(requesterAppUserId: string): Promise<VehicleBooking[]> {
  const { data, error } = await supabase
    .from('vehicle_bookings')
    .select('*')
    .eq('requester_user_id', requesterAppUserId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as VehicleBooking[];
}

export async function fetchPendingApprovals(): Promise<VehicleBooking[]> {
  const { data, error } = await supabase
    .from('vehicle_bookings')
    .select('*')
    .eq('status', 'PENDING_APPROVAL')
    .order('requested_pickup_at', { ascending: true });

  if (error) throw error;
  return (data || []) as VehicleBooking[];
}

export async function fetchPendingApprovalCards(): Promise<VehicleBookingApprovalCard[]> {
  const { data, error } = await supabase.rpc('get_pending_vehicle_booking_approval_cards');

  if (error) throw error;
  return (data || []) as VehicleBookingApprovalCard[];
}

export async function fetchVehicleBookingDispatcherCandidates(): Promise<VehicleBookingDispatcherCandidate[]> {
  const { data, error } = await supabase.rpc('get_vehicle_booking_dispatcher_candidates');

  if (error) throw error;
  return (data || []) as VehicleBookingDispatcherCandidate[];
}

export async function setVehicleBookingDispatchers(userIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('set_vehicle_booking_dispatchers', {
    p_user_ids: [...new Set(userIds)],
  });

  if (error) throw error;
}

export async function fetchWaitingDispatchBookings(): Promise<VehicleBooking[]> {
  const { data, error } = await supabase
    .from('vehicle_bookings')
    .select('*')
    .in('status', ['PENDING_APPROVAL', 'WAITING_DISPATCH'])
    .order('requested_pickup_at', { ascending: true });

  if (error) throw error;
  return (data || []) as VehicleBooking[];
}

export async function fetchVehicleBookingDetails(bookingId: string): Promise<{
  booking: VehicleBooking;
  participants: VehicleBookingParticipant[];
  assignments: VehicleBookingAssignment[];
  tripLog?: VehicleTripLog | null;
  handovers: VehicleHandoverLog[];
  feedback?: VehicleBookingFeedback | null;
  assignmentDisplay: VehicleBookingAssignmentDisplay | null;
}> {
  const [bRes, pRes, aRes, tRes, hRes, fRes, dRes] = await Promise.all([
    supabase.from('vehicle_bookings').select('*').eq('id', bookingId).single(),
    supabase.from('vehicle_booking_participants').select('*').eq('booking_id', bookingId),
    supabase.from('vehicle_booking_assignments').select('*').eq('booking_id', bookingId).order('version', { ascending: false }),
    supabase.from('vehicle_trip_logs').select('*').eq('booking_id', bookingId).maybeSingle(),
    supabase.from('vehicle_handover_logs').select('*').eq('booking_id', bookingId).order('confirmed_at', { ascending: false }),
    supabase.from('vehicle_booking_feedback').select('*').eq('booking_id', bookingId).maybeSingle(),
    supabase.rpc('get_vehicle_booking_assignment_display', { p_booking_id: bookingId }),
  ]);

  if (bRes.error) throw bRes.error;
  if (dRes.error) throw dRes.error;

  return {
    booking: bRes.data as VehicleBooking,
    participants: (pRes.data || []) as VehicleBookingParticipant[],
    assignments: (aRes.data || []) as VehicleBookingAssignment[],
    tripLog: (tRes.data as VehicleTripLog) || null,
    handovers: (hRes.data || []) as VehicleHandoverLog[],
    feedback: (fRes.data as VehicleBookingFeedback) || null,
    assignmentDisplay: ((dRes.data || [])[0] as VehicleBookingAssignmentDisplay) || null,
  };
}

export async function fetchFleetVehicleProfiles(): Promise<FleetVehicleProfileView[]> {
  const { data, error } = await supabase.rpc('get_fleet_vehicle_profiles_admin');

  if (error) throw error;
  return (data || []) as FleetVehicleProfileView[];
}

export async function fetchFleetVehicleCandidates(): Promise<FleetVehicleCandidate[]> {
  const { data, error } = await supabase.rpc('get_fleet_vehicle_candidates');
  if (error) throw error;
  return (data || []) as FleetVehicleCandidate[];
}

export async function fetchFleetVehicleTypeOptions(): Promise<FleetVehicleTypeOption[]> {
  const { data, error } = await supabase.rpc('get_fleet_vehicle_type_options');
  if (error) throw error;
  return (data || []) as FleetVehicleTypeOption[];
}

export async function fetchDriverAuthorizations(): Promise<VehicleDriverAuthorization[]> {
  const { data, error } = await supabase
    .from('vehicle_driver_authorizations')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as VehicleDriverAuthorization[];
}

export async function fetchVehicleDriverAuthorizationCandidates(): Promise<VehicleDriverCandidate[]> {
  const { data, error } = await supabase.rpc('get_vehicle_driver_candidates');
  if (error) throw error;
  return (data || []) as VehicleDriverCandidate[];
}

export async function fetchVehicleDriverAuthorizationsAdmin(): Promise<VehicleDriverAuthorizationAdminView[]> {
  const { data, error } = await supabase.rpc('get_vehicle_driver_authorizations_admin');
  if (error) throw error;
  return (data || []) as VehicleDriverAuthorizationAdminView[];
}

export async function fetchDriverAuthorizationsEligible(): Promise<VehicleDriverAuthorizationEligible[]> {
  const { data, error } = await supabase.rpc('get_vehicle_driver_authorizations_eligible');

  if (error) throw error;
  return (data || []) as VehicleDriverAuthorizationEligible[];
}

export async function setFleetVehicleAssetImage(assetId: string, imageUrl: string) {
  const { data, error } = await supabase.rpc('set_fleet_vehicle_asset_image', {
    p_asset_id: assetId,
    p_image_url: imageUrl,
  });
  if (error) throw error;
  return data;
}

export async function fetchFleetLocations(): Promise<FleetLocation[]> {
  const { data, error } = await supabase
    .from('fleet_locations')
    .select('*')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []) as FleetLocation[];
}

export async function fetchVehicleUnavailabilityPeriods(): Promise<VehicleUnavailabilityPeriod[]> {
  const { data, error } = await supabase
    .from('vehicle_unavailability_periods')
    .select('*')
    .order('start_at', { ascending: false });
  if (error) throw error;
  return (data || []) as VehicleUnavailabilityPeriod[];
}

export async function fetchOperatorUnavailabilityPeriods(): Promise<OperatorUnavailabilityPeriod[]> {
  const { data, error } = await supabase
    .from('operator_unavailability_periods')
    .select('*')
    .order('start_at', { ascending: false });
  if (error) throw error;
  return (data || []) as OperatorUnavailabilityPeriod[];
}

export async function fetchFleetSystemSettings(): Promise<FleetSystemSetting> {
  const { data, error } = await supabase
    .from('fleet_system_settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) throw error;
  return data as FleetSystemSetting;
}

export async function fetchDriverTodayAssignments(operatorAppUserId: string): Promise<{
  assignment: VehicleBookingAssignment;
  booking: VehicleBooking;
  tripLog?: VehicleTripLog | null;
  assignmentDisplay?: VehicleBookingAssignmentDisplay | null;
  requester?: { id: string; name: string; avatar?: string | null } | null;
}[]> {
  const { startIso, endIso } = getVietnamDayRange(new Date());

  const { data: assignments, error } = await supabase
    .from('vehicle_booking_assignments')
    .select('*')
    .eq('operator_user_id', operatorAppUserId)
    .eq('is_active', true)
    .gte('reserved_start_at', startIso)
    .lt('reserved_start_at', endIso)
    .order('reserved_start_at', { ascending: true });

  if (error) throw error;
  if (!assignments || assignments.length === 0) return [];

  const bookingIds = assignments.map(a => a.booking_id);
  const [bRes, tRes] = await Promise.all([
    supabase.from('vehicle_bookings').select('*').in('id', bookingIds),
    supabase.from('vehicle_trip_logs').select('*').in('booking_id', bookingIds),
  ]);

  if (bRes.error) throw bRes.error;
  if (tRes.error) throw tRes.error;

  const visibleBookings = ((bRes.data || []) as VehicleBooking[])
    .filter(booking => ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status));
  const requesterIds = [...new Set(visibleBookings.map(booking => booking.requester_user_id))];
  const [requestersRes, requesterEmployeesRes, displayResults] = await Promise.all([
    requesterIds.length > 0
      ? supabase.from('users').select('id, name, avatar').in('id', requesterIds)
      : Promise.resolve({ data: [], error: null }),
    requesterIds.length > 0
      ? supabase.from('employees').select('user_id, full_name, avatar_url').in('user_id', requesterIds)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(visibleBookings.map(async booking => {
      const response = await supabase.rpc('get_vehicle_booking_assignment_display', {
        p_booking_id: booking.id,
      });
      return { bookingId: booking.id, ...response };
    })),
  ]);

  if (requestersRes.error) throw requestersRes.error;
  const displayError = displayResults.find(result => result.error)?.error;
  if (displayError) throw displayError;

  const bookingMap = new Map(visibleBookings.map(booking => [booking.id, booking]));
  const tripLogMap = new Map((tRes.data || []).map((t: any) => [t.booking_id, t]));
  const requesterUserMap = new Map((requestersRes.data || []).map((requester: any) => [requester.id, requester]));
  const requesterEmployeeMap = new Map((requesterEmployeesRes.data || []).map((employee: any) => [employee.user_id, employee]));
  const requesterMap = new Map(requesterIds.map(requesterId => {
    const appUser = requesterUserMap.get(requesterId) as { name?: string | null; avatar?: string | null } | undefined;
    const employee = requesterEmployeeMap.get(requesterId) as { full_name?: string | null; avatar_url?: string | null } | undefined;
    return [requesterId, {
      id: requesterId,
      name: employee?.full_name?.trim() || appUser?.name?.trim() || 'Chưa có thông tin',
      avatar: employee?.avatar_url || appUser?.avatar || null,
    }];
  }));
  const displayMap = new Map(displayResults.map(result => [
    result.bookingId,
    ((result.data || [])[0] as VehicleBookingAssignmentDisplay) || null,
  ]));

  const result: Array<{
    assignment: VehicleBookingAssignment;
    booking: VehicleBooking;
    tripLog?: VehicleTripLog | null;
    assignmentDisplay?: VehicleBookingAssignmentDisplay | null;
    requester?: { id: string; name: string; avatar?: string | null } | null;
  }> = [];
  assignments.forEach(assignmentRow => {
    const booking = bookingMap.get(assignmentRow.booking_id) as VehicleBooking | undefined;
    if (!booking || !['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status)) return;
    result.push({
      assignment: assignmentRow as VehicleBookingAssignment,
      booking,
      tripLog: tripLogMap.get(assignmentRow.booking_id) as VehicleTripLog | undefined,
      assignmentDisplay: displayMap.get(assignmentRow.booking_id),
      requester: requesterMap.get(booking.requester_user_id) || null,
    });
  });
  return result;
}

export type VehicleHandoverQueueItem = {
  booking: VehicleBooking;
  assignment: VehicleBookingAssignment;
  action: 'OUTBOUND' | 'RETURN';
};

export function selectVehicleHandoverQueue(input: {
  bookings: VehicleBooking[];
  assignments: VehicleBookingAssignment[];
  handovers: VehicleHandoverLog[];
}): VehicleHandoverQueueItem[] {
  const bookingMap = new Map(input.bookings.map(booking => [booking.id, booking]));
  const eventsByAssignment = new Map<string, Set<string>>();
  input.handovers.forEach(handover => {
    const events = eventsByAssignment.get(handover.assignment_id) || new Set<string>();
    events.add(handover.event_type);
    eventsByAssignment.set(handover.assignment_id, events);
  });

  const result: VehicleHandoverQueueItem[] = [];
  input.assignments.forEach(assignment => {
    if (!assignment.is_active || assignment.fulfillment_type !== 'INTERNAL_SELF_DRIVE') return;
    const booking = bookingMap.get(assignment.booking_id);
    if (!booking) return;
    const events = eventsByAssignment.get(assignment.id) || new Set<string>();
    if (booking.status === 'ASSIGNED' && !events.has('OUTBOUND_HANDOVER')) {
      result.push({ booking, assignment, action: 'OUTBOUND' });
      return;
    }
    if (
      booking.status === 'COMPLETED' &&
      events.has('OUTBOUND_HANDOVER') &&
      !events.has('RETURN_RECEIPT')
    ) {
      result.push({ booking, assignment, action: 'RETURN' });
    }
  });
  return result;
}

export async function fetchVehicleHandoverQueue(): Promise<VehicleHandoverQueueItem[]> {
  const { data: assignments, error: assignmentError } = await supabase
    .from('vehicle_booking_assignments')
    .select('*')
    .eq('is_active', true)
    .eq('fulfillment_type', 'INTERNAL_SELF_DRIVE');
  if (assignmentError) throw assignmentError;
  if (!assignments?.length) return [];

  const bookingIds = assignments.map(assignment => assignment.booking_id);
  const assignmentIds = assignments.map(assignment => assignment.id);
  const [bookingResult, handoverResult] = await Promise.all([
    supabase.from('vehicle_bookings').select('*').in('id', bookingIds).in('status', ['ASSIGNED', 'COMPLETED']),
    supabase.from('vehicle_handover_logs').select('*').in('assignment_id', assignmentIds),
  ]);
  if (bookingResult.error) throw bookingResult.error;
  if (handoverResult.error) throw handoverResult.error;

  return selectVehicleHandoverQueue({
    bookings: (bookingResult.data || []) as VehicleBooking[],
    assignments: assignments as VehicleBookingAssignment[],
    handovers: (handoverResult.data || []) as VehicleHandoverLog[],
  });
}

// ============================================================================
// 25 RPC BUSINESS & MASTER DATA COMMANDS
// ============================================================================

export async function createVehicleBooking(params: {
  requested_pickup_at: string;
  expected_return_at: string;
  trip_type: VehicleTripType;
  pickup_location_text: string;
  destination_text: string;
  purpose: string;
  passenger_count: number;
  requested_mode: VehicleRequestedMode;
  route_stops?: any[];
  preferred_vehicle_asset_id?: string;
  preferred_driver_user_id?: string;
  note?: string;
  trip_owner_user_id?: string;
}) {
  const { data, error } = await supabase.rpc('create_vehicle_booking', {
    p_requested_pickup_at: params.requested_pickup_at,
    p_expected_return_at: params.expected_return_at,
    p_trip_type: params.trip_type,
    p_pickup_location_text: params.pickup_location_text,
    p_destination_text: params.destination_text,
    p_purpose: params.purpose,
    p_passenger_count: params.passenger_count,
    p_requested_mode: params.requested_mode,
    p_route_stops: params.route_stops || [],
    p_preferred_vehicle_asset_id: params.preferred_vehicle_asset_id || null,
    p_preferred_driver_user_id: params.preferred_driver_user_id || null,
    p_note: params.note || null,
    p_trip_owner_user_id: params.trip_owner_user_id || null,
  });

  if (error) throw error;
  return data;
}

export async function submitVehicleBooking(bookingId: string) {
  const { data, error } = await supabase.rpc('submit_vehicle_booking', {
    p_booking_id: bookingId,
  });
  if (error) throw error;
  return data;
}

export async function approveVehicleBooking(bookingId: string, approvalNote?: string) {
  const { data, error } = await supabase.rpc('approve_vehicle_booking', {
    p_booking_id: bookingId,
    p_approval_note: approvalNote || null,
  });
  if (error) throw error;
  return data;
}

export async function rejectVehicleBooking(bookingId: string, rejectNote: string) {
  const { data, error } = await supabase.rpc('reject_vehicle_booking', {
    p_booking_id: bookingId,
    p_reject_reason: rejectNote,
  });
  if (error) throw error;
  return data;
}

export async function dispatchVehicleBooking(params: {
  booking_id: string;
  fulfillment_type: FulfillmentType;
  vehicle_asset_id?: string;
  operator_user_id?: string;
  handover_officer_user_id?: string;
  allow_non_home_base_return?: boolean;
  non_home_base_return_reason?: string;
  external_service_type?: string;
  external_provider_name?: string;
  external_driver_name?: string;
  external_driver_phone?: string;
  external_vehicle_plate?: string;
  external_estimated_cost?: number;
  dispatch_reason_code?: string;
  assignment_note?: string;
  override_reason?: string;
}) {
  const { data, error } = await supabase.rpc('dispatch_vehicle_booking', {
    p_booking_id: params.booking_id,
    p_fulfillment_type: params.fulfillment_type,
    p_vehicle_asset_id: params.vehicle_asset_id || null,
    p_operator_user_id: params.operator_user_id || null,
    p_handover_officer_user_id: params.handover_officer_user_id || null,
    p_allow_non_home_base_return: params.allow_non_home_base_return || false,
    p_non_home_base_return_reason: params.non_home_base_return_reason || null,
    p_external_service_type: params.external_service_type || null,
    p_external_provider_name: params.external_provider_name || null,
    p_external_driver_name: params.external_driver_name || null,
    p_external_driver_phone: params.external_driver_phone || null,
    p_external_vehicle_plate: params.external_vehicle_plate || null,
    p_external_estimated_cost: params.external_estimated_cost || null,
    p_dispatch_reason_code: params.dispatch_reason_code || null,
    p_assignment_note: params.assignment_note || null,
    p_override_reason: params.override_reason || null,
  });

  if (error) throw error;
  return data;
}

export async function reassignVehicleBooking(params: {
  booking_id: string;
  reassign_reason: string;
  fulfillment_type: FulfillmentType;
  vehicle_asset_id?: string;
  operator_user_id?: string;
  handover_officer_user_id?: string;
  allow_non_home_base_return?: boolean;
  non_home_base_return_reason?: string;
  external_service_type?: string;
  external_provider_name?: string;
  external_driver_name?: string;
  external_driver_phone?: string;
  external_vehicle_plate?: string;
  external_estimated_cost?: number;
  dispatch_reason_code?: string;
  assignment_note?: string;
}) {
  const { data, error } = await supabase.rpc('reassign_vehicle_booking', {
    p_booking_id: params.booking_id,
    p_reassign_reason: params.reassign_reason,
    p_fulfillment_type: params.fulfillment_type,
    p_vehicle_asset_id: params.vehicle_asset_id || null,
    p_operator_user_id: params.operator_user_id || null,
    p_handover_officer_user_id: params.handover_officer_user_id || null,
    p_allow_non_home_base_return: params.allow_non_home_base_return || false,
    p_non_home_base_return_reason: params.non_home_base_return_reason || null,
    p_external_service_type: params.external_service_type || null,
    p_external_provider_name: params.external_provider_name || null,
    p_external_driver_name: params.external_driver_name || null,
    p_external_driver_phone: params.external_driver_phone || null,
    p_external_vehicle_plate: params.external_vehicle_plate || null,
    p_external_estimated_cost: params.external_estimated_cost ?? null,
    p_dispatch_reason_code: params.dispatch_reason_code || null,
    p_assignment_note: params.assignment_note || null,
  });

  if (error) throw error;
  return data;
}

export async function respondToVehicleAssignment(
  bookingId: string,
  response: 'CONFIRMED' | 'DECLINED',
  declineReason?: string
) {
  const { data, error } = await supabase.rpc('respond_to_vehicle_assignment', {
    p_booking_id: bookingId,
    p_response: response,
    p_decline_reason: declineReason || null,
  });
  if (error) throw error;
  return data;
}

export async function replaceVehicleBookingParticipants(
  bookingId: string,
  participants: any[]
) {
  const { data, error } = await supabase.rpc('replace_vehicle_booking_participants', {
    p_booking_id: bookingId,
    p_participants: participants,
  });
  if (error) throw error;
  return data;
}

export async function confirmVehicleHandover(
  bookingId: string,
  event_type: 'OUTBOUND_HANDOVER' | 'RETURN_RECEIPT',
  override_reason?: string,
  note?: string
) {
  const { data, error } = await supabase.rpc('confirm_vehicle_handover', {
    p_booking_id: bookingId,
    p_event_type: event_type,
    p_override_reason: override_reason || null,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

export async function recordVehicleTripCheckpoint(
  bookingId: string,
  checkpointType: 'DEPARTED_HOME_BASE' | 'PICKED_UP_PASSENGER'
) {
  const { data, error } = await supabase.rpc('record_vehicle_trip_checkpoint', {
    p_booking_id: bookingId,
    p_checkpoint_type: checkpointType,
  });
  if (error) throw error;
  return data;
}

export async function startVehicleTrip(params: {
  booking_id: string;
  start_odometer: number;
  start_photo_path?: string;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
  location_capture_failed?: boolean;
  location_failure_reason?: string;
  override_reason?: string;
}) {
  const { data, error } = await supabase.rpc('start_vehicle_trip', {
    p_booking_id: params.booking_id,
    p_start_odometer: params.start_odometer,
    p_start_photo_path: params.start_photo_path || null,
    p_latitude: params.latitude ?? null,
    p_longitude: params.longitude ?? null,
    p_accuracy_m: params.accuracy_m ?? null,
    p_location_capture_failed: params.location_capture_failed || false,
    p_location_failure_reason: params.location_failure_reason || null,
    p_override_reason: params.override_reason || null,
  });

  if (error) throw error;
  return data;
}

export async function finishVehicleTrip(params: {
  booking_id: string;
  end_odometer: number;
  end_photo_path?: string;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
  location_capture_failed?: boolean;
  location_failure_reason?: string;
  vehicle_condition_end?: 'NORMAL' | 'ISSUE';
  issue_note?: string;
  override_reason?: string;
}) {
  const { data, error } = await supabase.rpc('finish_vehicle_trip', {
    p_booking_id: params.booking_id,
    p_end_odometer: params.end_odometer,
    p_end_photo_path: params.end_photo_path || null,
    p_latitude: params.latitude ?? null,
    p_longitude: params.longitude ?? null,
    p_accuracy_m: params.accuracy_m ?? null,
    p_location_capture_failed: params.location_capture_failed || false,
    p_location_failure_reason: params.location_failure_reason || null,
    p_vehicle_condition_end: params.vehicle_condition_end || 'NORMAL',
    p_issue_note: params.issue_note || null,
    p_override_reason: params.override_reason || null,
  });

  if (error) throw error;
  return data;
}

export async function confirmVehicleReturn(
  bookingId: string,
  override_reason?: string,
  note?: string
) {
  const { data, error } = await supabase.rpc('confirm_vehicle_return', {
    p_booking_id: bookingId,
    p_override_reason: override_reason || null,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

export async function completeExternalTransport(params: {
  booking_id: string;
  external_actual_cost: number;
  external_receipt_path?: string;
  completion_note?: string;
}) {
  const { data, error } = await supabase.rpc('complete_external_transport', {
    p_booking_id: params.booking_id,
    p_external_actual_cost: params.external_actual_cost,
    p_external_receipt_path: params.external_receipt_path || null,
    p_completion_note: params.completion_note || null,
  });
  if (error) throw error;
  return data;
}

export async function submitVehicleFeedback(params: {
  booking_id: string;
  is_issue: boolean;
  rating?: number;
  positive_tags?: string[];
  issue_category?: string;
  comment?: string;
}) {
  const { data, error } = await supabase.rpc('submit_vehicle_feedback', {
    p_booking_id: params.booking_id,
    p_is_issue: params.is_issue,
    p_rating: params.rating ?? null,
    p_positive_tags: params.positive_tags || [],
    p_issue_category: params.issue_category || null,
    p_comment: params.comment || null,
  });
  if (error) throw error;
  return data;
}

export async function cancelVehicleBooking(
  bookingId: string,
  cancelReason: string
) {
  const { data, error } = await supabase.rpc('cancel_vehicle_booking', {
    p_booking_id: bookingId,
    p_cancel_reason: cancelReason,
  });
  if (error) throw error;
  return data;
}

export async function markVehicleBookingNoShow(
  bookingId: string,
  reason: string
) {
  const { data, error } = await supabase.rpc('mark_vehicle_booking_no_show', {
    p_booking_id: bookingId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function upsertFleetVehicleProfile(params: FleetVehicleProfileUpdateInput) {
  const { data, error } = await supabase.rpc('upsert_fleet_vehicle_profile', {
    p_asset_id: params.asset_id,
    p_home_base_id: params.home_base_id || null,
    p_vehicle_type: params.vehicle_type,
    p_seat_count: params.seat_count,
    p_availability_status: params.availability_status,
    p_allow_self_drive: params.allow_self_drive,
    p_inspection_certificate_number: params.inspection_certificate_number || null,
    p_inspection_expiry_date: params.inspection_expiry_date || null,
    p_inspection_photo_path: params.inspection_photo_path || null,
    p_insurance_expiry_date: params.insurance_expiry_date || null,
    p_parking_spot_code: params.parking_spot_code || null,
  });
  if (error) throw error;
  return data;
}

export async function upsertDriverAuthorization(params: {
  target_user_id: string;
  employee_id?: string;
  authorization_type: 'PROFESSIONAL_DRIVER' | 'SELF_DRIVE';
  license_number: string;
  license_class: string;
  license_expiry: string;
  license_front_photo_path?: string;
  license_back_photo_path?: string;
  health_check_expiry_date?: string;
  allowed_vehicle_types?: string[];
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  note?: string;
}) {
  const { data, error } = await supabase.rpc('upsert_driver_authorization', {
    p_target_user_id: params.target_user_id,
    p_employee_id: params.employee_id || null,
    p_authorization_type: params.authorization_type,
    p_license_number: params.license_number,
    p_license_class: params.license_class,
    p_license_expiry: params.license_expiry,
    p_license_front_photo_path: params.license_front_photo_path || null,
    p_license_back_photo_path: params.license_back_photo_path || null,
    p_health_check_expiry_date: params.health_check_expiry_date || null,
    p_allowed_vehicle_types: params.allowed_vehicle_types || [],
    p_status: params.status,
    p_note: params.note || null,
  });
  if (error) throw error;
  return data;
}

export async function upsertFleetLocation(params: {
  location_id?: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  source_type: 'OFFICE' | 'CONSTRUCTION_SITE' | 'CUSTOM';
  source_id?: string;
}): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('upsert_fleet_location', {
    p_location_id: params.location_id || null,
    p_name: params.name,
    p_address: params.address || null,
    p_latitude: params.latitude || null,
    p_longitude: params.longitude || null,
    p_source_type: params.source_type,
    p_source_id: params.source_id || null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string };
}

export async function createVehicleUnavailability(params: {
  vehicle_asset_id: string;
  start_at: string;
  end_at: string;
  reason_code: VehicleUnavailabilityReason;
  note?: string;
}) {
  const { data, error } = await supabase.rpc('create_vehicle_unavailability', {
    p_vehicle_asset_id: params.vehicle_asset_id,
    p_start_at: params.start_at,
    p_end_at: params.end_at,
    p_reason_code: params.reason_code,
    p_note: params.note || null,
  });
  if (error) throw error;
  return data;
}

export async function cancelVehicleUnavailability(unavailabilityId: string, reason: string) {
  const { data, error } = await supabase.rpc('cancel_vehicle_unavailability', {
    p_unavailability_id: unavailabilityId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function createOperatorUnavailability(params: {
  operator_user_id: string;
  start_at: string;
  end_at: string;
  reason_code: OperatorUnavailabilityReason;
  note?: string;
}) {
  const { data, error } = await supabase.rpc('create_operator_unavailability', {
    p_operator_user_id: params.operator_user_id,
    p_start_at: params.start_at,
    p_end_at: params.end_at,
    p_reason_code: params.reason_code,
    p_note: params.note || null,
  });
  if (error) throw error;
  return data;
}

export async function cancelOperatorUnavailability(unavailabilityId: string, reason: string) {
  const { data, error } = await supabase.rpc('cancel_operator_unavailability', {
    p_unavailability_id: unavailabilityId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function updateFleetSystemSettings(params: FleetSystemSettingsUpdate) {
  const { data, error } = await supabase.rpc('update_fleet_system_settings', {
    p_booking_buffer_minutes: params.booking_buffer_minutes,
    p_late_cancellation_cutoff_minutes: params.late_cancellation_cutoff_minutes,
    p_feedback_auto_close_hours: params.feedback_auto_close_hours,
    p_home_base_warning_radius_meters: params.home_base_warning_radius_meters,
    p_on_time_tolerance_minutes: params.on_time_tolerance_minutes,
    p_max_evidence_image_mb: params.max_evidence_image_mb,
    p_trip_reminder_minutes: params.trip_reminder_minutes,
    p_require_handover_for_self_drive: params.require_handover_for_self_drive,
    p_allow_dispatch_approval_override: params.allow_dispatch_approval_override,
  });
  if (error) throw error;
  return data;
}
