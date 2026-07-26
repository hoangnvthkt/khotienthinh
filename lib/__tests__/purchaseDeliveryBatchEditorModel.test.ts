import { describe, expect, it } from 'vitest';
import { MaterialRequestFulfillmentMode, type PurchaseOrder, type PurchaseOrderDeliveryBatch } from '../../types';
import { buildPurchaseDeliveryLineDrafts, getPurchaseDeliveryDraftSummary } from '../purchaseDeliveryBatchEditorModel';

const makePo = (): PurchaseOrder => ({
  id: 'po-1',
  vendorId: 'vendor-1',
  vendorName: 'NCC A',
  poNumber: 'PO-001',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  purchaseMode: 'multiple',
  fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
  targetWarehouseId: 'warehouse-1',
  items: [{
    lineId: 'line-1',
    itemId: 'item-1',
    sku: 'VT001',
    name: 'Sika màu xám',
    unit: 'Kg',
    qty: 7000,
    unitPrice: 5600,
    receivedQty: 0,
    purchaseUnitSnapshot: 'Kg',
    stockUnitSnapshot: 'Kg',
    purchaseConversionFactor: 25,
  }],
  totalAmount: 39_200_000,
  orderDate: '2026-07-26',
  status: 'confirmed',
  sourceMode: 'from_request',
  createdAt: '2026-07-26T00:00:00.000Z',
});

const makeBatch = (patch: Partial<PurchaseOrderDeliveryBatch>): PurchaseOrderDeliveryBatch => ({
  id: 'batch-1',
  purchaseOrderId: 'po-1',
  deliveryNo: 1,
  status: 'receiving',
  lines: [{
    id: 'delivery-line-1',
    deliveryBatchId: 'batch-1',
    purchaseOrderId: 'po-1',
    purchaseOrderLineId: 'line-1',
    itemId: 'item-1',
    plannedQty: 3000,
    stockPlannedQty: 3000,
    unit: 'Kg',
    stockUnit: 'Kg',
    deliveryUnitPrice: 5600,
  }],
  ...patch,
});

describe('purchase delivery batch editor model', () => {
  it('defaults a new delivery to the unreleased quantity instead of the full PO quantity', () => {
    const drafts = buildPurchaseDeliveryLineDrafts({
      purchaseOrder: makePo(),
      existingBatches: [makeBatch({})],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      purchaseOrderLineId: 'line-1',
      purchaseQty: 4000,
      stockQty: 4000,
      purchaseUnit: 'Kg',
      stockUnit: 'Kg',
      purchaseUnitPrice: 5600,
    });
  });

  it('keeps clone quantities and prices from the source delivery batch', () => {
    const sourceBatch = makeBatch({
      lines: [{
        id: 'delivery-line-1',
        deliveryBatchId: 'batch-1',
        purchaseOrderId: 'po-1',
        purchaseOrderLineId: 'line-1',
        itemId: 'item-1',
        plannedQty: 1200,
        stockPlannedQty: 1200,
        unit: 'Kg',
        stockUnit: 'Kg',
        deliveryUnitPrice: 5700,
      }],
    });

    const drafts = buildPurchaseDeliveryLineDrafts({
      purchaseOrder: makePo(),
      existingBatches: [makeBatch({})],
      cloneFromBatch: sourceBatch,
    });

    expect(drafts[0].purchaseQty).toBe(1200);
    expect(drafts[0].stockQty).toBe(1200);
    expect(drafts[0].purchaseUnitPrice).toBe(5700);
  });

  it('summarizes release totals and variance for the operator before saving', () => {
    const summary = getPurchaseDeliveryDraftSummary({
      purchaseOrder: makePo(),
      existingBatches: [makeBatch({})],
      draftLines: [{
        purchaseOrderLineId: 'line-1',
        itemId: 'item-1',
        itemName: 'Sika màu xám',
        orderedQty: 7000,
        alreadyReleasedQty: 3000,
        remainingQty: 4000,
        purchaseQty: 4100,
        purchaseUnit: 'Kg',
        stockQty: 4100,
        stockUnit: 'Kg',
        purchaseUnitPrice: 5600,
        stockUnitPrice: 5600,
      }],
    });

    expect(summary).toEqual({
      orderedQty: 7000,
      alreadyReleasedQty: 3000,
      draftQty: 4100,
      nextReleasedQty: 7100,
      varianceQty: 100,
      draftAmount: 22_960_000,
    });
  });
});
