import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));
import { procurementV2Service } from '../procurement/procurementV2Service';

describe('Procurement V2 dossier service', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('passes document filters and bounded cursor to the server', async () => {
    const page = { items: [], nextCursor: null, snapshotToken: 'hash',
      counters: [{ key: 'dossiers', count: 0, grain: 'document' }] };
    mocks.rpc.mockResolvedValue({ data: page, error: null });
    await expect(procurementV2Service.list({ projectId: 'p1', source: 'material_plan' },
      'cursor', 500)).resolves.toEqual(page);
    expect(mocks.rpc).toHaveBeenCalledWith('list_procurement_dossiers_v2', {
      p_filter: { projectId: 'p1', source: 'material_plan' }, p_cursor: 'cursor', p_limit: 200,
    });
  });

  it('preserves nullable unknown balance and propagates denied access', async () => {
    const dossier = { id: 'd1', sourceAdapter: 'material_plan', lines: [{ availableToPlanQty: null }] };
    mocks.rpc.mockResolvedValueOnce({ data: dossier, error: null });
    await expect(procurementV2Service.get('d1')).resolves.toEqual(dossier);
    const denied = { code: '42501', message: 'PROCUREMENT_READ_DENIED' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: denied });
    await expect(procurementV2Service.get('d1')).rejects.toBe(denied);
  });
});
