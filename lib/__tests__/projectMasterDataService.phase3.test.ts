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

import { projectMasterDataService } from '../projectMasterDataService';

describe('projectMasterDataService Phase 3 RPC mutations', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('creates and updates project categories through RPCs', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: { id: 'group-1', code: 'civil', name: 'Dân dụng', sort_order: 10, is_active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'type-1', code: 'actual', name: 'Thực tế', sort_order: 20, is_active: true },
        error: null,
      });

    await projectMasterDataService.createGroup({ code: 'civil', name: 'Dân dụng', sortOrder: 10 });
    await projectMasterDataService.updateType({ id: 'type-1', code: 'actual', name: 'Thực tế', sortOrder: 20, isActive: true });

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'upsert_project_category', {
      p_category_kind: 'group',
      p_category: expect.objectContaining({ code: 'civil', name: 'Dân dụng', sort_order: 10 }),
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'upsert_project_category', {
      p_category_kind: 'type',
      p_category: expect.objectContaining({ id: 'type-1', code: 'actual', name: 'Thực tế', sort_order: 20 }),
    });
  });

  it('archives and deletes project categories through RPCs', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({ data: { id: 'sector-1', is_active: false }, error: null })
      .mockResolvedValueOnce({ data: { id: 'group-1' }, error: null });

    await projectMasterDataService.archiveSector('sector-1');
    await projectMasterDataService.removeGroup('group-1');

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'upsert_project_category', {
      p_category_kind: 'sector',
      p_category: { id: 'sector-1', is_active: false },
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'delete_project_category', {
      p_category_kind: 'group',
      p_category_id: 'group-1',
    });
  });
});
