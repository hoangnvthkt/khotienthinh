import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import {
  buildPurchaseOrderCloneDraft,
  canClonePurchaseOrder,
} from '../purchaseOrderClone';

const makePo = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-source',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  vendorId: 'vendor-1',
  vendorName: 'NCC A',
  poNumber: 'PO-OLD',
  items: [
    {
      lineId: 'source-line-1',
      itemId: 'item-1',
      sku: 'VT001',
      name: 'Thep D16',
      unit: 'kg',
      qty: 10,
      unitPrice: 12000,
      receivedQty: 8,
      returnedQty: 1,
      note: 'Ghi chu dong',
    },
  ],
  totalAmount: 120000,
  vatRate: 8,
  orderDate: '2026-08-01',
  expectedDeliveryDate: '2026-08-20',
  actualDeliveryDate: '2026-08-22',
  status: 'closed',
  sourceMode: 'proactive_project',
  purchaseMode: 'multiple',
  approvalRequestTitle: 'Mua thep tang 2',
  targetWarehouseId: 'wh-1',
  receivedTransactionIds: ['tx-1'],
  note: 'Ghi chu PO',
  qrToken: 'qr-old',
  createdById: 'user-old',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

const makeBatch = (): PurchaseOrderDeliveryBatch => ({
  id: 'batch-source',
  purchaseOrderId: 'po-source',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  supplierId: 'vendor-1',
  supplierNameSnapshot: 'NCC A',
  deliveryNo: 1,
  plannedDeliveryDate: '2026-08-20',
  status: 'received',
  qrToken: 'batch-qr-old',
  wmsTransactionId: 'wms-old',
  fulfillmentBatchIds: ['fulfillment-old'],
  createdBy: 'user-old',
  lines: [
    {
      id: 'batch-line-source',
      deliveryBatchId: 'batch-source',
      purchaseOrderId: 'po-source',
      purchaseOrderLineId: 'source-line-1',
      itemId: 'item-1',
      plannedQty: 10,
      acceptedQty: 8,
      deliveryUnitPrice: 12000,
    },
  ],
});

describe('purchaseOrderClone', () => {
  it('allows cloning only proactive project purchase orders', () => {
    expect(canClonePurchaseOrder(makePo({ sourceMode: 'proactive_project' }))).toBe(true);
    expect(canClonePurchaseOrder(makePo({ sourceMode: 'from_request' }))).toBe(false);
    expect(canClonePurchaseOrder(makePo({ sourceMode: 'proactive_stock' }))).toBe(false);
  });

  it('builds a draft clone with a new PO number, copied commercial fields, fresh line ids, and reset operational state', () => {
    const clone = buildPurchaseOrderCloneDraft({
      po: makePo(),
      nextPoNumber: 'PO-NEW',
      deliveryBatches: [makeBatch()],
      makeId: (() => {
        const ids = ['new-line-1', 'new-batch-1', 'new-batch-line-1'];
        return () => ids.shift() || 'extra-id';
      })(),
    });

    expect(clone.poNumber).toBe('PO-NEW');
    expect(clone.sourceMode).toBe('proactive_project');
    expect(clone.status).toBe('draft');
    expect(clone.approvalRequestTitle).toBe('Mua thep tang 2 Copy');
    expect(clone.items[0]).toMatchObject({
      lineId: 'new-line-1',
      itemId: 'item-1',
      sku: 'VT001',
      name: 'Thep D16',
      qty: 10,
      unitPrice: 12000,
      receivedQty: 0,
      returnedQty: 0,
      note: 'Ghi chu dong',
    });
    expect(clone.deliveryBatches[0]).toMatchObject({
      id: 'new-batch-1',
      purchaseOrderId: '',
      status: 'planned',
      qrToken: null,
      wmsTransactionId: null,
      fulfillmentBatchIds: [],
    });
    expect(clone.deliveryBatches[0].lines[0]).toMatchObject({
      id: 'new-batch-line-1',
      deliveryBatchId: 'new-batch-1',
      purchaseOrderId: '',
      purchaseOrderLineId: 'new-line-1',
      itemId: 'item-1',
      plannedQty: 10,
      acceptedQty: 0,
      deliveryUnitPrice: 12000,
    });
  });

  it('maps delivery schedule lines that point to the source item id onto the cloned line id', () => {
    const batch = makeBatch();
    batch.lines[0].purchaseOrderLineId = 'item-1';

    const clone = buildPurchaseOrderCloneDraft({
      po: makePo(),
      nextPoNumber: 'PO-NEW',
      deliveryBatches: [batch],
      makeId: (() => {
        const ids = ['new-line-1', 'new-batch-1', 'new-batch-line-1'];
        return () => ids.shift() || 'extra-id';
      })(),
    });

    expect(clone.deliveryBatches[0].lines[0].purchaseOrderLineId).toBe('new-line-1');
  });
});
