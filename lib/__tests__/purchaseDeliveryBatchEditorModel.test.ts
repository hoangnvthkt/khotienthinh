import { describe, expect, it } from 'vitest';
import { MaterialRequestFulfillmentMode, type PurchaseOrder, type PurchaseOrderDeliveryBatch } from '../../types';
import {
  buildPurchaseDeliveryLineDrafts,
  getPurchaseDeliveryDraftSummary,
  getSelectedPurchaseDeliveryLinesForSave,
} from '../purchaseDeliveryBatchEditorModel';

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

  it('defaults stock-unit delivery quantity from the purchase conversion factor while keeping it editable', () => {
    const [draft] = buildPurchaseDeliveryLineDrafts({
      purchaseOrder: {
        ...makePo(),
        items: [{
          ...(makePo().items?.[0] || {}),
          lineId: 'steel-line',
          itemId: 'steel-1',
          sku: 'VT000826',
          name: 'Thép XD D12',
          unit: 'Cây',
          qty: 3,
          unitPrice: 15170,
          purchaseUnitSnapshot: 'Cây',
          stockUnitSnapshot: 'Kg',
          unitSnapshot: 'Kg',
          purchaseConversionFactor: 10,
        }],
      },
      existingBatches: [],
    });

    expect(draft).toMatchObject({
      purchaseQty: 3,
      purchaseUnit: 'Cây',
      stockQty: 30,
      stockUnit: 'Kg',
      conversionFactor: 10,
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

  it('uses the edited request package PO unit price when cloning a stale delivery batch', () => {
    const sourceBatch = makeBatch({
      lines: [{
        id: 'delivery-line-1',
        deliveryBatchId: 'batch-1',
        purchaseOrderId: 'po-1',
        purchaseOrderLineId: 'line-1',
        itemId: 'item-1',
        plannedQty: 473,
        stockPlannedQty: 473,
        unit: 'm3',
        stockUnit: 'm3',
        deliveryUnitPrice: 2_567_000,
      }],
    });

    const drafts = buildPurchaseDeliveryLineDrafts({
      purchaseOrder: {
        ...makePo(),
        poNumber: 'MR-2026-9775',
        purchaseMode: 'single',
        referenceGrossAmount: 1_316_800_000.131,
        items: [{
          ...(makePo().items?.[0] || {}),
          lineId: 'line-1',
          itemId: 'item-1',
          sku: 'VT0000861',
          name: 'Tam vach ALC be tong',
          unit: 'm3',
          qty: 473,
          unitPrice: 2_783_932.347,
        }],
      },
      existingBatches: [],
      cloneFromBatch: sourceBatch,
    });

    expect(drafts[0].purchaseQty).toBe(473);
    expect(drafts[0].purchaseUnitPrice).toBe(2_783_932.347);
  });

  it('summarizes release totals and variance for the operator before saving', () => {
    const summary = getPurchaseDeliveryDraftSummary({
      purchaseOrder: makePo(),
      existingBatches: [makeBatch({})],
      draftLines: [{
        included: true,
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
        conversionFactor: 1,
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

  it('ignores unselected lines when summarizing and saving a partial delivery batch', () => {
    const draftLines = [
      {
        included: true,
        purchaseOrderLineId: 'line-1',
        itemId: 'item-1',
        itemName: 'Sika màu xám',
        orderedQty: 7000,
        alreadyReleasedQty: 3000,
        remainingQty: 4000,
        purchaseQty: 1500,
        purchaseUnit: 'Kg',
        stockQty: 1500,
        stockUnit: 'Kg',
        conversionFactor: 1,
        purchaseUnitPrice: 5600,
        stockUnitPrice: 5600,
      },
      {
        included: false,
        purchaseOrderLineId: 'line-2',
        itemId: 'item-2',
        itemName: 'Áo lưới vàng',
        orderedQty: 100,
        alreadyReleasedQty: 0,
        remainingQty: 100,
        purchaseQty: 100,
        purchaseUnit: 'Cái',
        stockQty: 100,
        stockUnit: 'Cái',
        conversionFactor: 1,
        purchaseUnitPrice: 25000,
        stockUnitPrice: 25000,
      },
    ];

    const summary = getPurchaseDeliveryDraftSummary({
      purchaseOrder: {
        ...makePo(),
        items: [
          ...(makePo().items || []),
          {
            lineId: 'line-2',
            itemId: 'item-2',
            sku: 'VT002',
            name: 'Áo lưới vàng',
            unit: 'Cái',
            qty: 100,
            unitPrice: 25000,
            receivedQty: 0,
          },
        ],
      },
      existingBatches: [makeBatch({})],
      draftLines,
    });

    expect(summary.draftQty).toBe(1500);
    expect(summary.draftAmount).toBe(8_400_000);
    expect(getSelectedPurchaseDeliveryLinesForSave(draftLines)).toEqual([draftLines[0]]);
  });

  it('excludes the batch being edited from alreadyReleasedQty calculation and pre-fills its quantities', () => {
    const batch1 = makeBatch({ id: 'batch-1', lines: [{ id: 'l1', deliveryBatchId: 'batch-1', purchaseOrderId: 'po-1', purchaseOrderLineId: 'line-1', itemId: 'item-1', plannedQty: 3000, unit: 'Kg', deliveryUnitPrice: 5600 }] });
    const batch2 = makeBatch({ id: 'batch-2', lines: [{ id: 'l2', deliveryBatchId: 'batch-2', purchaseOrderId: 'po-1', purchaseOrderLineId: 'line-1', itemId: 'item-1', plannedQty: 2000, unit: 'Kg', deliveryUnitPrice: 5800 }] });

    const drafts = buildPurchaseDeliveryLineDrafts({
      purchaseOrder: makePo(), // qty: 7000
      existingBatches: [batch1, batch2],
      editBatch: batch1,
    });

    // When editing batch1, alreadyReleasedQty should only count batch2 (2000), leaving remaining = 5000
    // And draft purchaseQty should be initialized to batch1's quantity (3000)
    expect(drafts[0].alreadyReleasedQty).toBe(2000);
    expect(drafts[0].purchaseQty).toBe(3000);
    expect(drafts[0].purchaseUnitPrice).toBe(5600);
    expect(drafts[0].included).toBe(true);

    const summary = getPurchaseDeliveryDraftSummary({
      purchaseOrder: makePo(),
      existingBatches: [batch1, batch2],
      draftLines: drafts,
      excludeBatchId: batch1.id,
    });

    expect(summary.alreadyReleasedQty).toBe(2000);
    expect(summary.draftQty).toBe(3000);
    expect(summary.nextReleasedQty).toBe(5000);
    expect(summary.varianceQty).toBe(-2000);
  });
});
