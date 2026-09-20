import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { procurementAccessService } from '../procurement/access';

describe('procurement access service', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('keeps read, price and allocation capabilities separate', async () => {
    mocks.rpc.mockResolvedValue({
      data: { canRead: true, canViewPrice: false, canAllocate: true }, error: null,
    });
    await expect(procurementAccessService.get('project-1', 'site-1')).resolves.toEqual({
      canRead: true, canViewPrice: false, canAllocate: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('get_procurement_access_v1', {
      p_project_id: 'project-1', p_construction_site_id: 'site-1',
    });
  });

  it('propagates inactive and denied actor errors', async () => {
    const denied = { code: '42501', message: 'PROCUREMENT_ACCESS_DENIED' };
    mocks.rpc.mockResolvedValue({ data: null, error: denied });
    await expect(procurementAccessService.get('project-1', null)).rejects.toBe(denied);
  });
});
