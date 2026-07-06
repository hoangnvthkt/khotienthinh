import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import { getPurchaseOrderDisplayAmount } from '../purchaseOrderAmount';

const po: PurchaseOrder = {
  id: 'po-102',
  vendorId: 'vendor-1',
  poNumber: 'PO-102',
  items: [
    {
      lineId: 'line-1',
      itemId: 'item-1',
      sku: 'VT000111',
      name: 'Bien bao chu A',
      unit: 'Cai',
      qty: 16,
      unitPrice: 103750,
    },
  ],
  totalAmount: 1660000,
  orderDate: '2026-07-06',
  status: 'draft',
  sourceMode: 'from_request',
  createdAt: '2026-07-06T00:00:00.000Z',
};

const deliveryBatch = (id: string, plannedQty: number, deliveryUnitPrice: number, status: PurchaseOrderDeliveryBatch['status'] = 'planned'): PurchaseOrderDeliveryBatch => ({
  id,
  purchaseOrderId: po.id,
  deliveryNo: Number(id.replace(/\D/g, '')) || 1,
  plannedDeliveryDate: '2026-07-07',
  status,
  lines: [
    {
      id: `${id}-line-1`,
      deliveryBatchId: id,
      purchaseOrderId: po.id,
      purchaseOrderLineId: 'line-1',
      itemId: 'item-1',
      plannedQty,
      deliveryUnitPrice,
    },
  ],
});

describe('purchaseOrderAmount', () => {
  it('uses active delivery batches for the visible PO amount after a planned batch is removed', () => {
    const amount = getPurchaseOrderDisplayAmount(po, [
      deliveryBatch('batch-1', 10, 100000),
    ]);

    expect(amount).toBe(1000000);
  });

  it('ignores cancelled batches when calculating the visible PO amount', () => {
    const amount = getPurchaseOrderDisplayAmount(po, [
      deliveryBatch('batch-1', 10, 100000),
      deliveryBatch('batch-2', 6, 110000, 'cancelled'),
    ]);

    expect(amount).toBe(1000000);
  });

  it('falls back to saved PO amount when there is no delivery schedule', () => {
    expect(getPurchaseOrderDisplayAmount(po, [])).toBe(1660000);
  });
});
