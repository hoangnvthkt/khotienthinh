import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderRequestLineLink } from '../../types';
import { getPurchaseOrderDemandStats } from '../purchaseOrderDemand';

const po: PurchaseOrder = {
  id: 'po-1',
  vendorId: 'vendor-1',
  poNumber: 'PO-096',
  items: [
    {
      lineId: 'line-1',
      itemId: 'item-1',
      sku: 'VT000111',
      name: 'Bien bao chu A',
      unit: 'Cai',
      qty: 10,
      unitPrice: 10000,
      receivedQty: 10,
      requestId: 'mr-1',
      requestCode: 'MR-2026-9745',
      requestLineId: 'mr-line-1',
    },
  ],
  totalAmount: 100000,
  orderDate: '2026-07-06',
  status: 'partial',
  sourceMode: 'from_request',
  createdAt: '2026-07-06T00:00:00.000Z',
};

const requestLink: PurchaseOrderRequestLineLink = {
  purchaseOrderId: 'po-1',
  purchaseOrderLineId: 'line-1',
  materialRequestId: 'mr-1',
  materialRequestCode: 'MR-2026-9745',
  requestLineId: 'mr-line-1',
  itemId: 'item-1',
  requestedQty: 16,
  orderedQty: 10,
  requestedQtySnapshot: 16,
  orderedStockQtySnapshot: 10,
  unit: 'Cai',
};

describe('purchaseOrderDemand', () => {
  it('uses linked material request quantity as the demand baseline when it is larger than the saved PO quantity', () => {
    const stats = getPurchaseOrderDemandStats(po, [requestLink]);

    expect(stats.orderedQty).toBe(16);
    expect(stats.receivedQty).toBe(10);
    expect(stats.remainingQty).toBe(6);
  });
});
