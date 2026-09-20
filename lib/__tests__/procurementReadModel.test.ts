import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { procurementReadService } from '../procurement/readService';

const row = (patch: Record<string, unknown> = {}) => ({
  key: 'mr-1:line-1', demandId: 'demand-1', demandLineId: 'demand-line-1',
  demandLineVersion: '4', sourceRevisionId: 'revision-1',
  requestId: 'mr-1', requestCode: 'MR-001', requestTitle: 'Cement', requestStatus: 'APPROVED',
  createdDate: '2026-09-20T00:00:00Z', expectedDate: '2026-09-21T00:00:00Z',
  targetWarehouseId: 'warehouse-1', fulfillmentMode: 'RECEIVE_TO_STOCK',
  projectId: 'project-1', constructionSiteId: 'site-1', requestLineId: 'line-1',
  itemId: 'item-1', itemName: 'Cement', sku: 'CEM', unit: 'kg', supplierId: 'supplier-1',
  workBoqItemId: null, materialBudgetItemId: null, neededDate: null, boqQty: null,
  requestedQty: '100', approvedQty: '100', fulfilledQty: '100', closedQty: '0', reservedQty: '0',
  committedQty: '0', openNeedQty: '0', availableToPlanQty: '0', orderedQty: '100',
  remainingKnown: true, reconciliationIssues: [], canViewPrice: false, canAllocate: true,
  ...patch,
});

describe('procurement read model', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('preserves a known zero and does not invent price fields', async () => {
    mocks.rpc.mockResolvedValue({ data: [row()], error: null });
    const [result] = await procurementReadService.listOpenDemand();
    expect(result.remainingKnown).toBe(true);
    expect(result.remainingQty).toBe(0);
    expect(result.actualReceivedQty).toBe(100);
    expect(result.canViewPrice).toBe(false);
    expect(result).not.toHaveProperty('unitPrice');
  });

  it('keeps non-ingested legacy demand unknown and non-actionable', async () => {
    mocks.rpc.mockResolvedValue({ data: [row({
      demandId: null, demandLineId: null, sourceRevisionId: null,
      approvedQty: null, fulfilledQty: null, closedQty: null, reservedQty: null,
      committedQty: null, openNeedQty: null, availableToPlanQty: null,
      remainingKnown: false, reconciliationIssues: ['g2_identity_not_ingested'], canAllocate: false,
    })], error: null });
    const [result] = await procurementReadService.listOpenDemand();
    expect(result.remainingKnown).toBe(false);
    expect(result.remainingQty).toBeNull();
    expect(result.reconciliationIssues).toContain('g2_identity_not_ingested');
  });

  it('propagates mandatory read errors instead of returning an empty list', async () => {
    const error = { code: '42501', message: 'PROCUREMENT_ACCESS_DENIED' };
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(procurementReadService.listOpenDemand()).rejects.toBe(error);
  });
});
