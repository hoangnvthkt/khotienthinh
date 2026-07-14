import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import {
  applyPurchaseOrderSupplementalState,
  getPurchaseOrderReleaseSummary,
  getPurchaseOrderScheduleQuantityBlockReason,
} from '../purchaseOrderReleaseApproval';

const makePo = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-master-1',
  vendorId: 'vendor-1',
  vendorName: 'NCC A',
  poNumber: 'PO-MASTER-1',
  items: [
    {
      lineId: 'line-1',
      itemId: 'item-1',
      sku: 'VT001',
      name: 'Thep D16',
      unit: 'kg',
      qty: 1000,
      unitPrice: 100,
    },
  ],
  totalAmount: 100000,
  approvedTotalAmount: 100000,
  orderDate: '2026-07-13',
  status: 'confirmed',
  sourceMode: 'from_request',
  createdAt: '2026-07-13T00:00:00.000Z',
  ...patch,
});

const batch = (
  id: string,
  deliveryNo: number,
  plannedQty: number,
  deliveryUnitPrice: number,
  status: PurchaseOrderDeliveryBatch['status'] = 'planned',
): PurchaseOrderDeliveryBatch => ({
  id,
  purchaseOrderId: 'po-master-1',
  deliveryNo,
  plannedDeliveryDate: '2026-07-20',
  status,
  lines: [
    {
      id: `${id}-line-1`,
      deliveryBatchId: id,
      purchaseOrderId: 'po-master-1',
      purchaseOrderLineId: 'line-1',
      itemId: 'item-1',
      plannedQty,
      deliveryUnitPrice,
    },
  ],
});

describe('purchaseOrderReleaseApproval', () => {
  it('tracks released and remaining quantities under a master PO', () => {
    const summary = getPurchaseOrderReleaseSummary(makePo(), [
      batch('batch-1', 1, 300, 100),
    ]);

    expect(summary.lineSummaries).toEqual([
      expect.objectContaining({
        lineKey: 'line-1',
        orderedQty: 1000,
        releasedQty: 300,
        remainingQty: 700,
      }),
    ]);
    expect(summary.actualPlannedAmount).toBe(30000);
    expect(summary.overAmount).toBe(0);
  });

  it('hard-blocks schedules that exceed the master PO quantity', () => {
    const reason = getPurchaseOrderScheduleQuantityBlockReason(makePo(), [
      batch('batch-1', 1, 700, 100),
      batch('batch-2', 2, 400, 100),
    ]);

    expect(reason).toContain('vượt khối lượng PO tổng');
  });

  it('marks the first release that exceeds the approved master amount as supplemental pending', () => {
    const { batches, supplementalRequests } = applyPurchaseOrderSupplementalState(makePo(), [
      batch('batch-1', 1, 300, 100),
      batch('batch-2', 2, 700, 120),
    ]);

    expect(batches.map(item => item.status)).toEqual(['planned', 'supplemental_pending']);
    expect(supplementalRequests).toEqual([
      expect.objectContaining({
        purchaseOrderId: 'po-master-1',
        deliveryBatchId: 'batch-2',
        previousApprovedAmount: 100000,
        requestedTotalAmount: 114000,
        overAmount: 14000,
      }),
    ]);
  });

  it('opens supplemental-pending releases after approved amount covers them', () => {
    const { batches, supplementalRequests } = applyPurchaseOrderSupplementalState(makePo({ approvedTotalAmount: 114000 }), [
      batch('batch-1', 1, 300, 100),
      batch('batch-2', 2, 700, 120, 'supplemental_pending'),
    ]);

    expect(batches.map(item => item.status)).toEqual(['planned', 'planned']);
    expect(supplementalRequests).toEqual([]);
  });
});
