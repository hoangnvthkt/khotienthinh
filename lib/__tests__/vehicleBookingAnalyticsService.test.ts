import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('../supabase', () => ({ supabase: { rpc } }));

import {
  fetchVehicleBookingAnalytics,
  fetchVehicleBookingAnalyticsExport,
} from '../vehicleBookingAnalyticsService';

describe('vehicle booking analytics service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('sends the exact scoped analytics RPC payload', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        period: { fromAt: '2026-07-31T17:00:00.000Z', toAt: '2026-08-31T17:00:00.000Z', timeZone: 'Asia/Ho_Chi_Minh' },
        scope: { departmentId: 'department-1', capacityDenominator: 'CURRENT_ACTIVE_COMPANY_FLEET' },
        kpis: {},
      },
      error: null,
    });

    await fetchVehicleBookingAnalytics(
      { fromAt: '2026-07-31T17:00:00.000Z', toAt: '2026-08-31T17:00:00.000Z' },
      'department-1',
    );

    expect(rpc).toHaveBeenCalledWith('get_vehicle_booking_analytics', {
      p_from_at: '2026-07-31T17:00:00.000Z',
      p_to_at: '2026-08-31T17:00:00.000Z',
      p_department_id: 'department-1',
    });
  });

  it('normalizes missing analytics collections and nullable rates', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        period: { fromAt: '2026-07-31T17:00:00.000Z', toAt: '2026-08-31T17:00:00.000Z', timeZone: 'Asia/Ho_Chi_Minh' },
        scope: { departmentId: null, capacityDenominator: 'CURRENT_ACTIVE_COMPANY_FLEET' },
        kpis: {
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
        },
      },
      error: null,
    });

    const result = await fetchVehicleBookingAnalytics({
      fromAt: '2026-07-31T17:00:00.000Z',
      toAt: '2026-08-31T17:00:00.000Z',
    });

    expect(result.distanceByVehicle).toEqual([]);
    expect(result.fulfillmentBreakdown).toEqual([]);
    expect(result.externalCostByDepartment).toEqual([]);
    expect(result.kpis.onTimeRate).toBeNull();
  });

  it('maps snake_case export rows to the typed camel-case contract', async () => {
    rpc.mockResolvedValueOnce({
      data: [{
        booking_id: 'booking-1',
        booking_code: 'CAR-001',
        department_id: null,
        department_name: 'Chưa xác định',
        requested_pickup_at: '2026-08-01T01:00:00.000Z',
        actual_pickup_at: null,
        actual_return_at: null,
        fulfillment_type: 'EXTERNAL_TRANSPORT',
        vehicle_code: null,
        vehicle_name: null,
        distance_km: null,
        external_actual_cost: 250000,
        status: 'COMPLETED',
        close_reason: null,
        is_on_time: null,
      }],
      error: null,
    });

    const rows = await fetchVehicleBookingAnalyticsExport({
      fromAt: '2026-07-31T17:00:00.000Z',
      toAt: '2026-08-31T17:00:00.000Z',
    });

    expect(rows[0]).toMatchObject({
      bookingId: 'booking-1',
      bookingCode: 'CAR-001',
      externalActualCost: 250000,
      isOnTime: null,
    });
  });

  it('rejects an invalid period before calling Supabase', async () => {
    await expect(fetchVehicleBookingAnalytics({
      fromAt: '2026-08-02T00:00:00.000Z',
      toAt: '2026-08-01T00:00:00.000Z',
    })).rejects.toThrow('Khoảng thời gian báo cáo không hợp lệ.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates the Supabase RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('PERMISSION_DENIED') });
    await expect(fetchVehicleBookingAnalytics({
      fromAt: '2026-08-01T00:00:00.000Z',
      toAt: '2026-08-02T00:00:00.000Z',
    })).rejects.toThrow('PERMISSION_DENIED');
  });
});
