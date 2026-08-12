import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import {
  fetchVehicleBookingIssues,
  transitionVehicleBookingIssue,
} from '../vehicleBookingIssueService';

describe('vehicle booking sensitive issue service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: { items: [], nextCursor: null }, error: null });
  });

  it('sends status and keyset cursor to the list RPC', async () => {
    await fetchVehicleBookingIssues({
      status: 'IN_REVIEW',
      limit: 25,
      cursor: { createdAt: '2026-08-12T00:00:00.000Z', id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(rpc).toHaveBeenCalledWith('get_vehicle_booking_issues', {
      p_status: 'IN_REVIEW',
      p_limit: 25,
      p_cursor_created_at: '2026-08-12T00:00:00.000Z',
      p_cursor_id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('sends the exact transition command payload', async () => {
    rpc.mockResolvedValueOnce({ data: { success: true, status: 'RESOLVED' }, error: null });
    await transitionVehicleBookingIssue({
      issueId: '11111111-1111-4111-8111-111111111111',
      targetStatus: 'RESOLVED',
      resolutionNote: 'Đã làm việc với tài xế.',
    });
    expect(rpc).toHaveBeenCalledWith('transition_vehicle_booking_issue', {
      p_issue_id: '11111111-1111-4111-8111-111111111111',
      p_target_status: 'RESOLVED',
      p_resolution_note: 'Đã làm việc với tài xế.',
    });
  });

  it('propagates database permission errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('PERMISSION_DENIED') });
    await expect(fetchVehicleBookingIssues({})).rejects.toThrow('PERMISSION_DENIED');
  });
});
