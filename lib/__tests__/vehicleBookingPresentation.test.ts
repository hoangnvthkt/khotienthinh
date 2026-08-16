import { describe, expect, it } from 'vitest';
import {
  getAssignedDriverLabel,
  getAssignedVehicleLabel,
  getStartOdometerLabel,
  getVehicleFulfillmentLabel,
} from '../vehicleBookingPresentation';

describe('vehicle booking presentation', () => {
  it('translates fulfillment types into Vietnamese business labels', () => {
    expect(getVehicleFulfillmentLabel('INTERNAL_WITH_DRIVER'))
      .toBe('Xe nội bộ + tài xế chuyên trách');
    expect(getVehicleFulfillmentLabel('INTERNAL_SELF_DRIVE'))
      .toBe('Xe nội bộ + nhân viên tự lái');
    expect(getVehicleFulfillmentLabel('EXTERNAL_TRANSPORT'))
      .toBe('Xe ngoài / Taxi');
  });

  it('uses asset and HRM names without exposing IDs', () => {
    const display = {
      assignment_id: 'assignment-uuid',
      fulfillment_type: 'INTERNAL_WITH_DRIVER' as const,
      vehicle_code: 'TS-002',
      vehicle_name: 'Xe tải thùng',
      operator_name: 'Nguyễn Văn Hoàng',
    };

    expect(getAssignedVehicleLabel(display)).toBe('TS-002 · Xe tải thùng');
    expect(getAssignedDriverLabel(display)).toBe('Nguyễn Văn Hoàng');
  });

  it('uses external snapshots and safe missing-data labels', () => {
    expect(getAssignedVehicleLabel({
      assignment_id: 'external-assignment',
      fulfillment_type: 'EXTERNAL_TRANSPORT',
      external_provider_name: 'Mai Linh',
      external_vehicle_plate: '29A-123.45',
      external_driver_name: 'Trần Văn Bình',
    })).toBe('Mai Linh · 29A-123.45');
    expect(getAssignedDriverLabel({
      assignment_id: 'external-assignment',
      fulfillment_type: 'EXTERNAL_TRANSPORT',
      external_provider_name: 'Mai Linh',
    })).toBe('Theo nhà cung cấp');
    expect(getAssignedVehicleLabel(null)).toBe('Chưa có thông tin');
    expect(getAssignedDriverLabel(null)).toBe('Chưa có thông tin');
  });

  it('formats the recorded start odometer for the driver trip card', () => {
    expect(getStartOdometerLabel(1234)).toBe('KM đầu: 1.234 km');
    expect(getStartOdometerLabel(1234.5)).toBe('KM đầu: 1.234,5 km');
    expect(getStartOdometerLabel(null)).toBeNull();
    expect(getStartOdometerLabel(undefined)).toBeNull();
  });
});
