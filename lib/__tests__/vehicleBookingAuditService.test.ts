import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import { fetchVehicleBookingAuditTimeline } from '../vehicleBookingAuditService';

describe('vehicle booking audit timeline service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: { items: [], nextCursor: null }, error: null });
  });

  it('sends scoped filters and keyset cursor to the RPC', async () => {
    await fetchVehicleBookingAuditTimeline({
      bookingId: '11111111-1111-4111-8111-111111111111',
      departmentId: '22222222-2222-4222-8222-222222222222',
      sourceType: 'ASSIGNMENT_VERSION',
      fromAt: '2026-08-01T00:00:00.000Z',
      toAt: '2026-09-01T00:00:00.000Z',
      limit: 25,
      cursor: { occurredAt: '2026-08-12T00:00:00.000Z', id: 'ASSIGNMENT:1' },
    });
    expect(rpc).toHaveBeenCalledWith('get_vehicle_booking_audit_timeline', {
      p_booking_id: '11111111-1111-4111-8111-111111111111',
      p_department_id: '22222222-2222-4222-8222-222222222222',
      p_event_type: 'ASSIGNMENT_VERSION',
      p_from_at: '2026-08-01T00:00:00.000Z',
      p_to_at: '2026-09-01T00:00:00.000Z',
      p_limit: 25,
      p_cursor_occurred_at: '2026-08-12T00:00:00.000Z',
      p_cursor_id: 'ASSIGNMENT:1',
    });
  });

  it('normalizes an empty response', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchVehicleBookingAuditTimeline({})).resolves.toEqual({ items: [], nextCursor: null });
  });
});
