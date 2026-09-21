import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import {
  isProcurementWorkbenchUnavailable,
  procurementWorkbenchService,
} from '../procurement/workbenchService';

const page = {
  items: [{
    id: 'line-1', objectType: 'demand_line', objectId: 'line-1', actionKind: 'plan_supply',
    demandId: 'demand-1', demandLineId: 'line-1', title: 'Thép D20', sourceLabel: 'Đề xuất dự án', sourceCode: 'MR-001',
    projectId: 'project-1', constructionSiteId: 'site-1', destinationLabel: 'Kho công trình',
    assigneeUserId: null, unit: 'kg',
    balance: { openNeed: '100', availableToPlan: '20', coverageExcess: '0', receivedExcess: '0' },
    allowedActions: ['plan_supply'], version: '4', neededDate: '2026-09-30',
    nextActionLabel: 'Lập phương án cung ứng', tags: [{ label: 'Sẵn sàng', tone: 'success' }],
  }],
  nextCursor: 'cursor-2', snapshotToken: 'snapshot-1', asOf: '2026-09-21T03:00:00Z', stale: false,
  counters: [{ key: 'work', count: 1, grain: 'work' }],
};

describe('procurement workbench service', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('passes scoped filters, cursor and bounded page size to the server', async () => {
    mocks.rpc.mockResolvedValue({ data: page, error: null });
    await expect(procurementWorkbenchService.list({
      view: 'work', projectId: 'project-1', constructionSiteId: 'site-1', search: 'thép',
    }, 'cursor-1', 500)).resolves.toEqual(page);
    expect(mocks.rpc).toHaveBeenCalledWith('list_procurement_work_v1', {
      p_filter: { view: 'work', projectId: 'project-1', constructionSiteId: 'site-1', search: 'thép' },
      p_cursor: 'cursor-1', p_limit: 200,
    });
  });

  it('falls back only for a missing RPC and never for denied or network failures', () => {
    expect(isProcurementWorkbenchUnavailable({ code: '42883', message: 'undefined function' })).toBe(true);
    expect(isProcurementWorkbenchUnavailable({ code: 'PGRST202', message: 'schema cache miss' })).toBe(true);
    expect(isProcurementWorkbenchUnavailable({
      code: '42501', message: 'permission denied for function list_procurement_work_v1',
    })).toBe(false);
    expect(isProcurementWorkbenchUnavailable({ message: 'Failed to fetch list_procurement_work_v1' })).toBe(false);
  });

  it('rejects malformed page responses and propagates denied reads', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { items: null }, error: null });
    await expect(procurementWorkbenchService.list({ view: 'work' })).rejects.toThrow('PROCUREMENT_WORKBENCH_RESPONSE_INVALID');
    const denied = { code: '42501', message: 'PROCUREMENT_ACCESS_DENIED' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: denied });
    await expect(procurementWorkbenchService.list({ view: 'work' })).rejects.toBe(denied);
  });

  it('loads demand detail by canonical demand id and keeps decimal strings', async () => {
    const detail = {
      id: 'demand-1', version: '3', title: 'MR-001', sourceCode: 'MR-001', projectId: 'project-1',
      constructionSiteId: 'site-1', assigneeUserId: null,
      sourceRef: { type: 'material_request', id: 'mr-1', engine: 'project_material_request' },
      allowedActions: ['assign', 'plan_supply'], asOf: '2026-09-21T03:00:00Z', issues: [],
      lines: [{
        id: 'line-1', itemId: 'item-1', title: 'Thép D20', unit: 'kg', requestedQty: '100',
        balanceInput: { approved: '100', fulfilled: '30', closed: '0', reserved: '0', committed: '50' },
        balance: { openNeed: '70', availableToPlan: '20', coverageExcess: '0', receivedExcess: '0' },
        allocations: [],
      }],
    };
    mocks.rpc.mockResolvedValue({ data: detail, error: null });
    await expect(procurementWorkbenchService.getDemand('demand-1')).resolves.toEqual(detail);
    expect(mocks.rpc).toHaveBeenCalledWith('get_procurement_demand_v1', { p_demand_id: 'demand-1' });
  });
});
