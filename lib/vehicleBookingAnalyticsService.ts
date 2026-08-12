import type {
  VehicleBookingAnalytics,
  VehicleBookingAnalyticsExportRow,
  VehicleBookingReportPreset,
  VehicleBookingReportingPeriod,
} from '../types';
import { supabase } from './supabase';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const vietnamMidnightIso = (year: number, monthIndex: number, day: number): string =>
  new Date(Date.UTC(year, monthIndex, day) - VIETNAM_OFFSET_MS).toISOString();

const parseCalendarDate = (value: string): [number, number, number] => {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error('Ngày báo cáo phải có định dạng YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) {
    throw new Error('Ngày báo cáo không hợp lệ.');
  }
  return [year, month - 1, day];
};

const assertValidPeriod = (period: VehicleBookingReportingPeriod): void => {
  const from = Date.parse(period.fromAt);
  const to = Date.parse(period.toAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    throw new Error('Khoảng thời gian báo cáo không hợp lệ.');
  }
};

export function buildVehicleBookingReportingPeriod(
  preset: VehicleBookingReportPreset,
  now = new Date(),
): VehicleBookingReportingPeriod {
  const vietnamNow = new Date(now.getTime() + VIETNAM_OFFSET_MS);
  const year = vietnamNow.getUTCFullYear();
  const month = vietnamNow.getUTCMonth();
  const day = vietnamNow.getUTCDate();

  if (preset === 'THIS_WEEK') {
    const daysSinceMonday = (vietnamNow.getUTCDay() + 6) % 7;
    return {
      fromAt: vietnamMidnightIso(year, month, day - daysSinceMonday),
      toAt: vietnamMidnightIso(year, month, day - daysSinceMonday + 7),
    };
  }

  if (preset === 'THIS_MONTH') {
    return {
      fromAt: vietnamMidnightIso(year, month, 1),
      toAt: vietnamMidnightIso(year, month + 1, 1),
    };
  }

  const quarterStartMonth = Math.floor(month / 3) * 3;
  return {
    fromAt: vietnamMidnightIso(year, quarterStartMonth, 1),
    toAt: vietnamMidnightIso(year, quarterStartMonth + 3, 1),
  };
}

export function buildVehicleBookingCustomReportingPeriod(
  fromDate: string,
  toDateInclusive: string,
): VehicleBookingReportingPeriod {
  const [fromYear, fromMonth, fromDay] = parseCalendarDate(fromDate);
  const [toYear, toMonth, toDay] = parseCalendarDate(toDateInclusive);
  const period = {
    fromAt: vietnamMidnightIso(fromYear, fromMonth, fromDay),
    toAt: vietnamMidnightIso(toYear, toMonth, toDay + 1),
  };
  assertValidPeriod(period);
  return period;
}

const emptyKpis: VehicleBookingAnalytics['kpis'] = {
  completedTrips: 0,
  onTimeEligibleTrips: 0,
  onTimeTrips: 0,
  onTimeRate: null,
  submittedBookings: 0,
  lateCancelledBookings: 0,
  lateCancellationRate: null,
  usedVehicleMinutes: 0,
  availableVehicleMinutes: 0,
  vehicleUtilizationRate: null,
};

const normalizeAnalytics = (
  data: Partial<VehicleBookingAnalytics>,
  period: VehicleBookingReportingPeriod,
  departmentId: string | null,
): VehicleBookingAnalytics => ({
  period: data.period || { ...period, timeZone: 'Asia/Ho_Chi_Minh' },
  scope: data.scope || {
    departmentId,
    capacityDenominator: 'CURRENT_ACTIVE_COMPANY_FLEET',
  },
  kpis: { ...emptyKpis, ...(data.kpis || {}) },
  distanceByVehicle: Array.isArray(data.distanceByVehicle) ? data.distanceByVehicle : [],
  fulfillmentBreakdown: Array.isArray(data.fulfillmentBreakdown) ? data.fulfillmentBreakdown : [],
  externalCostByDepartment: Array.isArray(data.externalCostByDepartment) ? data.externalCostByDepartment : [],
});

export async function fetchVehicleBookingAnalytics(
  period: VehicleBookingReportingPeriod,
  departmentId?: string,
): Promise<VehicleBookingAnalytics> {
  assertValidPeriod(period);
  const { data, error } = await supabase.rpc('get_vehicle_booking_analytics', {
    p_from_at: period.fromAt,
    p_to_at: period.toAt,
    p_department_id: departmentId || null,
  });
  if (error) throw error;
  return normalizeAnalytics((data || {}) as Partial<VehicleBookingAnalytics>, period, departmentId || null);
}

const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

export async function fetchVehicleBookingAnalyticsExport(
  period: VehicleBookingReportingPeriod,
  departmentId?: string,
): Promise<VehicleBookingAnalyticsExportRow[]> {
  assertValidPeriod(period);
  const { data, error } = await supabase.rpc('export_vehicle_booking_analytics', {
    p_from_at: period.fromAt,
    p_to_at: period.toAt,
    p_department_id: departmentId || null,
  });
  if (error) throw error;
  return ((data || []) as Array<Record<string, unknown>>).map(row => ({
    bookingId: String(row.booking_id),
    bookingCode: String(row.booking_code),
    departmentId: row.department_id ? String(row.department_id) : null,
    departmentName: String(row.department_name || 'Chưa xác định'),
    requestedPickupAt: String(row.requested_pickup_at),
    actualPickupAt: row.actual_pickup_at ? String(row.actual_pickup_at) : null,
    actualReturnAt: row.actual_return_at ? String(row.actual_return_at) : null,
    fulfillmentType: (row.fulfillment_type || null) as VehicleBookingAnalyticsExportRow['fulfillmentType'],
    vehicleCode: row.vehicle_code ? String(row.vehicle_code) : null,
    vehicleName: row.vehicle_name ? String(row.vehicle_name) : null,
    distanceKm: nullableNumber(row.distance_km),
    externalActualCost: nullableNumber(row.external_actual_cost),
    status: String(row.status),
    closeReason: row.close_reason ? String(row.close_reason) : null,
    isOnTime: typeof row.is_on_time === 'boolean' ? row.is_on_time : null,
  }));
}
