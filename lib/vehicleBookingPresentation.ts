import type {
  FulfillmentType,
  VehicleBookingAssignmentDisplay,
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
