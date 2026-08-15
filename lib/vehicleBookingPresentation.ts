import type {
  FulfillmentType,
  VehicleBookingAssignmentDisplay,
  VehicleBookingSubmissionRoute,
} from '../types/vehicleBooking';

const fulfillmentLabels: Record<FulfillmentType, string> = {
  INTERNAL_WITH_DRIVER: 'Xe nội bộ + tài xế chuyên trách',
  INTERNAL_SELF_DRIVE: 'Xe nội bộ + nhân viên tự lái',
  EXTERNAL_TRANSPORT: 'Xe ngoài / Taxi',
};

export const getVehicleFulfillmentLabel = (type: FulfillmentType): string =>
  fulfillmentLabels[type];

export function getAssignedVehicleLabel(
  display?: VehicleBookingAssignmentDisplay | null,
): string {
  if (!display) return 'Chưa có thông tin';

  const values = display.fulfillment_type === 'EXTERNAL_TRANSPORT'
    ? [display.external_provider_name, display.external_vehicle_plate]
    : [display.vehicle_code, display.vehicle_name];

  return values.filter(Boolean).join(' · ') || 'Chưa có thông tin';
}

export function getAssignedDriverLabel(
  display?: VehicleBookingAssignmentDisplay | null,
): string {
  if (!display) return 'Chưa có thông tin';
  if (display.fulfillment_type === 'EXTERNAL_TRANSPORT') {
    return display.external_driver_name || 'Theo nhà cung cấp';
  }
  return display.operator_name || 'Chưa có thông tin';
}

export type VehicleBookingSubmissionErrorCode =
  | 'VEHICLE_DISPATCHER_MISSING'
  | 'VEHICLE_DIRECT_MANAGER_CONFIRMATION_REQUIRED'
  | 'VEHICLE_BOOKING_STALE_STATE'
  | 'VEHICLE_MANAGER_INVALID'
  | 'VEHICLE_BOOKING_ERROR';

const vehicleBookingSubmissionErrorMessages: Record<VehicleBookingSubmissionErrorCode, string> = {
  VEHICLE_DISPATCHER_MISSING: 'Hệ thống chưa có Điều phối viên đặt xe đang hoạt động. Vui lòng liên hệ quản trị Booking.',
  VEHICLE_DIRECT_MANAGER_CONFIRMATION_REQUIRED: 'Tài khoản của bạn chưa được thiết lập người quản lý trực tiếp.',
  VEHICLE_BOOKING_STALE_STATE: 'Đơn đặt xe đã thay đổi. Vui lòng tải lại trước khi thao tác.',
  VEHICLE_MANAGER_INVALID: 'Người duyệt mới không hợp lệ hoặc trùng với người đặt xe.',
  VEHICLE_BOOKING_ERROR: 'Không thể xử lý đơn đặt xe.',
};

export function mapVehicleBookingSubmissionError(error: unknown): {
  code: VehicleBookingSubmissionErrorCode;
  message: string;
} {
  const value = (error ?? {}) as { message?: string; details?: string };
  const diagnostic = value.message || value.details || '';
  const matchedCode = diagnostic.match(/VEHICLE_[A-Z0-9_]+/)?.[0] as VehicleBookingSubmissionErrorCode | undefined;
  const code = matchedCode && matchedCode in vehicleBookingSubmissionErrorMessages
    ? matchedCode
    : 'VEHICLE_BOOKING_ERROR';
  return { code, message: vehicleBookingSubmissionErrorMessages[code] };
}

export function getVehicleBookingSubmitSuccessMessage(
  route: Exclude<VehicleBookingSubmissionRoute, 'LEGACY'>,
  bookingCode: string,
): string {
  if (route === 'MANAGER') {
    return `Đã gửi ${bookingCode} đến quản lý trực tiếp để phê duyệt.`;
  }
  return `Đã gửi ${bookingCode} thẳng đến bộ phận Điều phối.`;
}
