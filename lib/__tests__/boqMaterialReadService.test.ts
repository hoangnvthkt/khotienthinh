import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import {
  boqMaterialReadService,
  createBoqPlanningRequestGate,
} from '../materialPlanning/boqMaterialReadService';

const material = (patch: Record<string, unknown> = {}) => ({
  id: 'budget-1',
  workBoqItemId: 'work-1',
  taskId: 'task-1',
  itemId: 'item-1',
  sku: 'STEEL',
  itemName: 'Steel',
  category: 'Metal',
  unit: 'kg',
  suggestedQty30d: null,
  unitPrice: null,
  issues: [],
  balance: {
    unit: 'kg',
    budget: '100.000000',
    issuedNet: '60.000000',
    open: {
      awaitingApproval: '10.000000',
      awaitingArrangement: '0.000000',
      executing: '0.000000',
    },
    closed: '0.000000',
    uncovered: '30.000000',
    excess: '0.000000',
    issues: [],
    blockingIssues: [],
    completeness: 'partial',
    selectable: true,
  },
  ...patch,
});

const page = (patch: Record<string, unknown> = {}) => ({
  scope: { projectId: 'project-1', constructionSiteId: 'site-1' },
  asOf: '2026-09-21T01:00:00.000Z',
  metricVersion: 'metric-1',
  nodes: [{
    id: 'work-1', parentId: null, taskId: 'task-1', wbsCode: '1', name: 'Foundation',
    sortOrder: 1, childCount: 0, synthetic: null, materials: [material()],
  }],
  nextCursor: null,
  totals: { workNodeCount: 1, materialLineCount: 1, selectableLineCount: 1, unallocatedEffectCount: 0 },
  capabilities: { canViewPrice: false },
  ...patch,
});

describe('boqMaterialReadService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('sends the exact scoped RPC arguments and preserves decimal strings and hidden price null', async () => {
    mocks.rpc.mockResolvedValue({ data: page(), error: null });

    const result = await boqMaterialReadService.listPage({
      projectId: 'project-1', constructionSiteId: 'site-1', parentId: 'work-root',
      search: 'steel', limit: 25, cursor: 'work-0', asOf: '2026-09-21T01:00:00.000Z',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('list_boq_material_planning_v1', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_parent_id: 'work-root',
      p_search: 'steel',
      p_limit: 25,
      p_cursor: 'work-0',
      p_as_of: '2026-09-21T01:00:00.000Z',
    });
    expect(result.nodes[0].materials[0].balance.budget).toBe('100.000000');
    expect(result.nodes[0].materials[0].unitPrice).toBeNull();
  });

  it('accepts a legitimate empty page without inventing rows or quantities', async () => {
    mocks.rpc.mockResolvedValue({ data: page({
      nodes: [], totals: { workNodeCount: 0, materialLineCount: 0, selectableLineCount: 0, unallocatedEffectCount: 0 },
    }), error: null });

    await expect(boqMaterialReadService.listPage({ projectId: 'project-1', constructionSiteId: 'site-1' }))
      .resolves.toMatchObject({ nodes: [], nextCursor: null });
  });

  it.each([
    ['missing asOf', page({ asOf: null })],
    ['missing metric version', page({ metricVersion: '' })],
    ['scope mismatch', page({ scope: { projectId: 'project-2', constructionSiteId: 'site-1' } })],
    ['malformed decimal', page({ nodes: [{ ...page().nodes[0], materials: [material({
      balance: { ...material().balance, budget: '100.0000001' },
    })] }] })],
    ['invalid unit', page({ nodes: [{ ...page().nodes[0], materials: [material({ unit: ' kg' })] }] })],
    ['duplicate node', page({ nodes: [page().nodes[0], page().nodes[0]], totals: {
      workNodeCount: 2, materialLineCount: 2, selectableLineCount: 2, unallocatedEffectCount: 0,
    } })],
    ['duplicate line', page({ nodes: [page().nodes[0], { ...page().nodes[0], id: 'work-2' }], totals: {
      workNodeCount: 2, materialLineCount: 2, selectableLineCount: 2, unallocatedEffectCount: 0,
    } })],
    ['totals mismatch', page({ totals: {
      workNodeCount: 0, materialLineCount: 0, selectableLineCount: 1, unallocatedEffectCount: 0,
    } })],
  ])('rejects %s instead of coercing the read model', async (_label, response) => {
    mocks.rpc.mockResolvedValue({ data: response, error: null });
    await expect(boqMaterialReadService.listPage({ projectId: 'project-1', constructionSiteId: 'site-1' }))
      .rejects.toThrow();
  });

  it('rejects a page whose as-of or version differs from the requested continuation', async () => {
    mocks.rpc.mockResolvedValue({ data: page(), error: null });
    await expect(boqMaterialReadService.listPage({
      projectId: 'project-1', constructionSiteId: 'site-1',
      asOf: '2026-09-21T00:00:00.000Z', expectedMetricVersion: 'metric-0',
    })).rejects.toThrow('BOQ_PLANNING_PAGE_VERSION_MISMATCH');
  });

  it('propagates denied and network errors instead of returning an empty page', async () => {
    const denied = { code: '42501', message: 'BOQ_MATERIAL_PLANNING_READ_DENIED' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: denied });
    await expect(boqMaterialReadService.listPage({ projectId: 'project-1' })).rejects.toBe(denied);

    const network = new Error('network failed');
    mocks.rpc.mockRejectedValueOnce(network);
    await expect(boqMaterialReadService.listPage({ projectId: 'project-1' })).rejects.toBe(network);
  });
});

describe('createBoqPlanningRequestGate', () => {
  it('marks response A stale after scope B starts', () => {
    const gate = createBoqPlanningRequestGate();
    const scopeA = gate.next();
    expect(gate.isCurrent(scopeA)).toBe(true);

    const scopeB = gate.next();
    expect(gate.isCurrent(scopeA)).toBe(false);
    expect(gate.isCurrent(scopeB)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(scopeB)).toBe(false);
  });
});
