import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import { getPurchaseOrderUiPolicy } from '../purchaseOrderUiPolicy';

const batch: PurchaseOrderDeliveryBatch = {
  id: 'batch-1',
  purchaseOrderId: 'po-1',
  deliveryNo: 1,
  plannedDeliveryDate: '2026-07-23',
  status: 'planned',
  lines: [],
};

const po = (sourceMode: PurchaseOrder['sourceMode']): PurchaseOrder => ({
  id: 'po-1',
  vendorId: 'vendor-1',
  vendorName: 'NCC A',
  poNumber: 'PO-145',
  items: [{ itemId: 'item-1', sku: 'VT-1', name: 'Vật tư', unit: 'kg', qty: 100, unitPrice: 10 }],
  totalAmount: 1000,
  orderDate: '2026-07-23',
  status: 'in_transit',
  sourceMode,
  createdAt: '2026-07-23T00:00:00.000Z',
});

describe('purchaseOrderActualReceiptUiPolicy', () => {
  it.each(['from_request', 'proactive_project'] as const)('shows WMS receipt for %s batches', sourceMode => {
    const policy = getPurchaseOrderUiPolicy({
      po: po(sourceMode),
      receiptStats: { orderedQty: 100, receivedQty: 0, remainingQty: 100 },
      deliveryBatches: [batch],
      canReceivePo: true,
    });

    expect(policy.primaryAction?.id).toBe('create_receipt');
    expect(policy.primaryAction?.deliveryBatchId).toBe('batch-1');
  });

  it('keeps consolidated company PO excluded from direct WMS action', () => {
    const policy = getPurchaseOrderUiPolicy({
      po: po('company_consolidated'),
      receiptStats: { orderedQty: 100, receivedQty: 0, remainingQty: 100 },
      deliveryBatches: [batch],
      canReceivePo: true,
    });
    expect(policy.primaryAction?.id).not.toBe('create_receipt');
  });
});
