import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import { workGroupService } from '../workGroupService';

describe('workGroupService Phase 3 RPC mutations', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('creates, updates, archives, and removes work groups through work-group RPCs', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({ data: { id: 'group-1', code: 'wg-1', name: 'Đội 1', sort_order: 10, is_active: true }, error: null })
      .mockResolvedValueOnce({ data: { id: 'group-1', code: 'wg-1', name: 'Đội 1A', sort_order: 20, is_active: true }, error: null })
      .mockResolvedValueOnce({ data: { id: 'group-1', code: 'wg-1', name: 'Đội 1A', sort_order: 20, is_active: false }, error: null })
      .mockResolvedValueOnce({ data: { id: 'group-1' }, error: null });

    await workGroupService.createGroup({ code: 'wg-1', name: 'Đội 1', sortOrder: 10 });
    await workGroupService.updateGroup({ id: 'group-1', code: 'wg-1', name: 'Đội 1A', sortOrder: 20, isActive: true });
    await workGroupService.archiveGroup('group-1');
    await workGroupService.removeGroup('group-1');

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'upsert_work_group', {
      p_work_group: expect.objectContaining({ code: 'wg-1', name: 'Đội 1', sort_order: 10 }),
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'upsert_work_group', {
      p_work_group: expect.objectContaining({ id: 'group-1', code: 'wg-1', name: 'Đội 1A', sort_order: 20 }),
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(3, 'upsert_work_group', {
      p_work_group: { id: 'group-1', is_active: false },
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(4, 'delete_work_group', {
      p_work_group_id: 'group-1',
    });
  });
});
