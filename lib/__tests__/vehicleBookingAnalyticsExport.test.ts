import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { VehicleBookingAnalytics, VehicleBookingAnalyticsExportRow } from '../../types';
import {
  buildVehicleBookingAnalyticsCsv,
  buildVehicleBookingAnalyticsWorkbook,
} from '../vehicleBookingAnalyticsExport';

const analytics: VehicleBookingAnalytics = {
  period: { fromAt: '2026-07-31T17:00:00.000Z', toAt: '2026-08-31T17:00:00.000Z', timeZone: 'Asia/Ho_Chi_Minh' },
  scope: { departmentId: null, capacityDenominator: 'CURRENT_ACTIVE_COMPANY_FLEET' },
  kpis: {
    completedTrips: 1,
    onTimeEligibleTrips: 1,
    onTimeTrips: 1,
    onTimeRate: 100,
    submittedBookings: 1,
    lateCancelledBookings: 0,
    lateCancellationRate: 0,
    usedVehicleMinutes: 60,
    availableVehicleMinutes: 1440,
    vehicleUtilizationRate: 4.2,
  },
  distanceByVehicle: [],
  fulfillmentBreakdown: [],
  externalCostByDepartment: [],
};

const rows: VehicleBookingAnalyticsExportRow[] = [{
  bookingId: 'booking-1',
  bookingCode: 'CAR-001',
  departmentId: null,
  departmentName: 'Phòng Điều hành',
  requestedPickupAt: '2026-08-01T01:00:00.000Z',
  actualPickupAt: '2026-08-01T01:10:00.000Z',
  actualReturnAt: '2026-08-01T02:00:00.000Z',
  fulfillmentType: 'INTERNAL_WITH_DRIVER',
  vehicleCode: 'TS-001',
  vehicleName: 'Toyota Fortuner',
  distanceKm: 20,
  externalActualCost: null,
  status: 'COMPLETED',
  closeReason: null,
  isOnTime: true,
}];

describe('vehicle booking analytics export', () => {
  it('creates separate summary and detail workbook sheets', () => {
    const workbook = buildVehicleBookingAnalyticsWorkbook(XLSX, analytics, rows);
    expect(workbook.SheetNames).toEqual(['Tong hop', 'Chi tiet']);
    const detail = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['Chi tiet'], { header: 1 });
    expect(detail[0]).toEqual([
      'Mã đơn', 'Phòng ban', 'Giờ yêu cầu', 'Giờ đón thực tế', 'Giờ trả thực tế',
      'Hình thức', 'Mã xe', 'Tên xe', 'Quãng đường (km)', 'Chi phí xe ngoài (VND)',
      'Trạng thái', 'Lý do đóng', 'Đúng giờ',
    ]);
  });

  it('creates UTF-8 BOM CSV and excludes sensitive issue fields', () => {
    const csv = buildVehicleBookingAnalyticsCsv(rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Phòng Điều hành');
    expect(csv.toLowerCase()).not.toContain('comment');
    expect(csv.toLowerCase()).not.toContain('resolutionnote');
    expect(csv.toLowerCase()).not.toContain('issuecategory');
  });
});
