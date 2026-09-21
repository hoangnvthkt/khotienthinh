import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: mocks }));

import { wmsWorkspaceService } from '../wmsWorkspaceService';

describe('wmsWorkspaceService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves unknown available quantity for a non-authoritative row', async () => {
    mocks.rpc.mockResolvedValue({ data: {
      asOf: '2026-09-21T00:00:00Z', metricVersion: 'g6.wms.quantity.v1', warehouseId: 'wh-1',
      rows: [{ key: 'wh-1:item-1', warehouseId: 'wh-1', warehouseName: 'Kho 1', materialId: 'item-1', sku: 'VT-1', materialName: 'Thép', unit: 'kg', cacheQty: 0, onHandQty: 10, reservedQty: 0, availableQty: null, inTransitQty: 4, receiptCustodyQty: 0.2, teamCustodyQty: 10, authoritative: false, classification: 'quantity_mismatch' }],
      nextCursor: null, completeness: { authoritative: false, openReconciliationIssues: 1, unknownReceiptCounts: 0 },
    }, error: null });
    const page = await wmsWorkspaceService.getInventory({ warehouseId: 'wh-1' });
    expect(page.rows[0]).toMatchObject({ availableQty: null, authoritative: false, inTransitQty: 4 });
    expect(page.completeness.authoritative).toBe(false);
  });

  it('preserves unknown receipt custody instead of coercing it to zero', async () => {
    mocks.rpc.mockResolvedValue({ data: {
      asOf: '2026-09-21T00:00:00Z', metricVersion: 'g6.wms.quantity.v1', warehouseId: 'wh-1',
      rows: [{ key: 'wh-1:item-1', warehouseId: 'wh-1', warehouseName: 'Kho 1', materialId: 'item-1', sku: 'VT-1', materialName: 'Thép', unit: 'kg', cacheQty: 10, onHandQty: 10, reservedQty: 0, availableQty: null, inTransitQty: 0, receiptCustodyQty: null, teamCustodyQty: 0, authoritative: false, classification: 'receipt_count_unknown' }],
      nextCursor: null, completeness: { authoritative: false, openReconciliationIssues: 0, unknownReceiptCounts: 1 },
    }, error: null });
    const page = await wmsWorkspaceService.getInventory({ warehouseId: 'wh-1' });
    expect(page.rows[0]).toMatchObject({ receiptCustodyQty: null, availableQty: null, authoritative: false });
    expect(page.completeness.unknownReceiptCounts).toBe(1);
  });

  it('propagates denied reads instead of returning an empty workspace', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(wmsWorkspaceService.getInventory({ warehouseId: 'wh-2' }))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('starts and posts one versioned inventory count', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { inventoryCountId: 'count-1', countNo: 'KK-1', warehouseId: 'wh-1', status: 'counting', rowVersion: 1, snapshotAt: '2026-09-21T00:00:00Z', replayed: false }, error: null })
      .mockResolvedValueOnce({ data: { inventoryCountId: 'count-1', countNo: 'KK-1', status: 'posted', rowVersion: 2, adjustmentTransactionId: 'tx-adjust', replayed: false }, error: null });
    const started = await wmsWorkspaceService.startCount({ warehouseId: 'wh-1', itemIds: ['item-1'], reason: 'Kiểm kê', idempotencyKey: 'start-1' });
    expect(started.rowVersion).toBe(1);
    const posted = await wmsWorkspaceService.postCount({ inventoryCountId: 'count-1', expectedVersion: 1, idempotencyKey: 'post-1', lines: [{ countLineId: 'line-1', countedQty: 88, evidence: [] }] });
    expect(posted.adjustmentTransactionId).toBe('tx-adjust');
  });
});
