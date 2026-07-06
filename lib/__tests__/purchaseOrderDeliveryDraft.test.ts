import { describe, expect, it } from 'vitest';
import type { InventoryItem, PurchaseOrderDeliveryBatch, PurchaseOrderItem } from '../../types';
import * as deliveryDraft from '../purchaseOrderDeliveryDraft';
import { makePoDeliveryLineDraft } from '../purchaseOrderDeliveryDraft';

const inventory: InventoryItem = {
  id: 'item-1',
  sku: 'VT000825',
  name: 'Thep XD D10',
  category: 'Thep',
  unit: 'Kg',
  purchaseUnit: 'Cay',
  purchaseConversionFactor: 7.2,
  priceIn: 0,
  priceOut: 0,
  minStock: 0,
  stockByWarehouse: {},
};

const poItem: PurchaseOrderItem = {
  lineId: 'line-1',
  itemId: inventory.id,
  sku: inventory.sku,
  name: inventory.name,
  unit: inventory.purchaseUnit || inventory.unit,
  unitSnapshot: inventory.unit,
  stockUnitSnapshot: inventory.unit,
  purchaseUnitSnapshot: inventory.purchaseUnit,
  purchaseConversionFactor: inventory.purchaseConversionFactor,
  qty: 10,
  unitPrice: 100,
};

describe('purchaseOrderDeliveryDraft', () => {
  it('defaults stock planned quantity from purchase quantity conversion', () => {
    const line = makePoDeliveryLineDraft({
      id: 'delivery-line-1',
      batchId: 'batch-1',
      purchaseOrderId: 'po-1',
      item: poItem,
      inventory,
      plannedQty: 10,
    });

    expect(line.plannedQty).toBe(10);
    expect(line.unit).toBe('Cay');
    expect(line.stockPlannedQty).toBe(72);
    expect(line.stockUnit).toBe('Kg');
  });

  it('keeps manually edited stock planned quantity when provided', () => {
    const line = makePoDeliveryLineDraft({
      id: 'delivery-line-1',
      batchId: 'batch-1',
      purchaseOrderId: 'po-1',
      item: poItem,
      inventory,
      plannedQty: 10,
      stockPlannedQty: 70.5,
    });

    expect(line.plannedQty).toBe(10);
    expect(line.stockPlannedQty).toBe(70.5);
  });

  it('uses delivery schedule quantities and weighted prices as the PO line totals', () => {
    const schedule: PurchaseOrderDeliveryBatch[] = [
      {
        id: 'batch-1',
        purchaseOrderId: 'po-1',
        deliveryNo: 1,
        plannedDeliveryDate: '2026-07-06',
        status: 'planned',
        lines: [
          {
            id: 'line-1-b1',
            deliveryBatchId: 'batch-1',
            purchaseOrderId: 'po-1',
            purchaseOrderLineId: 'line-1',
            itemId: 'item-1',
            plannedQty: 10,
            deliveryUnitPrice: 100,
          },
        ],
      },
      {
        id: 'batch-2',
        purchaseOrderId: 'po-1',
        deliveryNo: 2,
        plannedDeliveryDate: '2026-07-07',
        status: 'planned',
        lines: [
          {
            id: 'line-1-b2',
            deliveryBatchId: 'batch-2',
            purchaseOrderId: 'po-1',
            purchaseOrderLineId: 'line-1',
            itemId: 'item-1',
            plannedQty: 5,
            deliveryUnitPrice: 160,
          },
        ],
      },
    ];

    const syncItems = (deliveryDraft as any).syncPoItemsFromDeliverySchedule;
    expect(typeof syncItems).toBe('function');

    const [synced] = syncItems([{ ...poItem, qty: 1, unitPrice: 1 }], schedule);

    expect(synced.qty).toBe(15);
    expect(synced.unitPrice).toBeCloseTo(120);
  });

  it('keeps request demand quantity when only schedule price should be synced', () => {
    const schedule: PurchaseOrderDeliveryBatch[] = [
      {
        id: 'batch-1',
        purchaseOrderId: 'po-1',
        deliveryNo: 1,
        plannedDeliveryDate: '2026-07-06',
        status: 'planned',
        lines: [
          {
            id: 'line-1-b1',
            deliveryBatchId: 'batch-1',
            purchaseOrderId: 'po-1',
            purchaseOrderLineId: 'line-1',
            itemId: 'item-1',
            plannedQty: 10,
            deliveryUnitPrice: 120,
          },
        ],
      },
    ];

    const syncPrices = (deliveryDraft as any).syncPoItemPricesFromDeliverySchedule;
    expect(typeof syncPrices).toBe('function');

    const [synced] = syncPrices([{ ...poItem, qty: 16, unitPrice: 1 }], schedule);

    expect(synced.qty).toBe(16);
    expect(synced.unitPrice).toBe(120);
  });
});
