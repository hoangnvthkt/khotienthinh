import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetAssignment } from '../../types';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { assetAssignmentService } from '../assetAssignmentService';

const assignment: AssetAssignment = {
  id: 'assignment-1',
  assetId: 'asset-1',
  type: 'return',
  userId: 'holder-1',
  userName: 'Holder',
  fromUserId: 'holder-1',
  fromUserName: 'Holder',
  date: '2026-09-18T00:00:00.000Z',
  note: 'Return',
  performedBy: 'actor-1',
  performedByName: 'Actor',
};

describe('assetAssignmentService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('uses the canonical authorization command and maps its persisted row', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: assignment.id,
        asset_id: assignment.assetId,
        type: assignment.type,
        user_id: assignment.userId,
        user_name: assignment.userName,
        from_user_id: assignment.fromUserId,
        from_user_name: assignment.fromUserName,
        date: assignment.date,
        note: assignment.note,
        performed_by: assignment.performedBy,
        performed_by_name: assignment.performedByName,
      },
      error: null,
    });

    await expect(assetAssignmentService.record(assignment)).resolves.toEqual(assignment);
    expect(mocks.rpc).toHaveBeenCalledWith('record_asset_assignment', {
      p_assignment: expect.objectContaining({
        asset_id: 'asset-1',
        type: 'return',
        performed_by: 'actor-1',
      }),
    });
  });

  it('propagates a denied command without returning optimistic data', async () => {
    const denied = { code: '42501', message: 'insufficient privilege' };
    mocks.rpc.mockResolvedValue({ data: null, error: denied });

    await expect(assetAssignmentService.record(assignment)).rejects.toEqual(denied);
  });
});
