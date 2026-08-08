import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: supabaseMocks,
}));

import { projectOpeningBalanceService } from '../projectOpeningBalanceService';

describe('projectOpeningBalanceService authoritative snapshot retry RPCs', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
    supabaseMocks.from.mockReset();
  });

  it('retrieves retry status by opening-balance identity without reading client-writable metadata', async () => {
    const retryState = {
      openingBalanceId: 'opening-1',
      status: 'pending',
      canRetry: true,
      scopeKey: 'project-1_site-1',
      weekStart: '2026-08-03',
      refreshedAt: null,
    };
    supabaseMocks.rpc.mockResolvedValueOnce({ data: retryState, error: null });

    await expect((projectOpeningBalanceService as any).getOpeningBalanceSnapshotRetry('opening-1'))
      .resolves.toEqual(retryState);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('get_project_opening_balance_snapshot_retry', {
      p_opening_balance_id: 'opening-1',
    });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('prepares and retries snapshots using only the bound opening-balance id', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: { openingBalanceId: 'opening-1', status: 'pending', canRetry: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { openingBalanceId: 'opening-1', status: 'synced', canRetry: false },
        error: null,
      });

    await (projectOpeningBalanceService as any).prepareOpeningBalanceSnapshotRetry('opening-1');
    await (projectOpeningBalanceService as any).retryOpeningBalanceSnapshot('opening-1');

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'prepare_project_opening_balance_snapshot', {
      p_opening_balance_id: 'opening-1',
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'sync_project_opening_balance_snapshot', {
      p_opening_balance_id: 'opening-1',
    });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });
});
