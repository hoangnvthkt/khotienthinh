import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { documentTraceService } from '../documentTraceService';

describe('management lineage batch reader', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads task to PO lineage in one scoped RPC and preserves inferred metadata', async () => {
    mocks.rpc.mockResolvedValue({ data: {
      metricVersion: 'g8.lineage.v1',
      nodes: [
        { type: 'project_task', id: 'task-1', label: 'Móng', documentNo: 'T-1', status: '20%', metadata: {} },
        { type: 'purchase_order', id: 'po-1', label: 'NCC A', documentNo: 'PO-1', status: 'confirmed', metadata: {} },
      ],
      edges: [{ from: 'project_task:task-1', to: 'purchase_order:po-1', relation: 'legacy_order_reference', amount: null, metadata: { inferred: true } }],
      completeness: { financeRestricted: true, hasInferredHistory: true },
    }, error: null });

    const graph = await documentTraceService.getTraceGraph({ type: 'project_task', id: 'task-1' }, { depth: 8 });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('get_management_lineage_v1', {
      p_seed_type: 'project_task', p_seed_id: 'task-1', p_max_depth: 8,
    });
    expect(graph.nodes.map(node => node.type)).toEqual(['project_task', 'purchase_order']);
    expect(graph.edges[0].metadata).toEqual({ inferred: true });
    expect(graph.completeness).toEqual({ financeRestricted: true, hasInferredHistory: true });
  });

  it('propagates denied lineage instead of falling back to direct table reads', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(documentTraceService.getTraceGraph({ type: 'material_plan', id: 'plan-1' }))
      .rejects.toMatchObject({ code: '42501' });
  });
});
