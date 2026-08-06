import { describe, expect, it } from 'vitest';
import type { InventoryItem, PurchaseOrderDeliveryBatch, PurchaseOrderItem } from '../../types';
import { calculateLineTotal } from '../poSpecsUtils';
import { getPurchaseOrderReleaseSummary } from '../purchaseOrderReleaseApproval';
import * as deliveryDraft from '../purchaseOrderDeliveryDraft';
import {
  getPoDeliveryDraftInitialLineValues,
  getPoDeliveryScheduleLineInitialValues,
  getPoDeliveryScheduleUnitPriceForSave,
  getDefaultPurchaseMode,
  makePoDeliveryLineDraft,
  resolvePurchaseOrderItemsForScheduledPricing,
  shouldAutoCreateBatchOnApproval,
  shouldCreateBatchDuringDraftSave,
  shouldAutoCreatePoDeliveryScheduleForForm,
  shouldEditInlineRequestUnitPrice,
  syncPoItemPricesFromDeliverySchedule,
  syncPoItemsFromDeliverySchedule,
} from '../purchaseOrderDeliveryDraft';

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

  it('keeps repeated SKUs linked to their distinct commercial lines in delivery drafts', () => {
    const commercialItems: PurchaseOrderItem[] = [
      {
        ...poItem,
        lineId: 'commercial-10k',
        itemId: 'item-commercial',
        qty: 3,
        unitPrice: 10_000,
      },
      {
        ...poItem,
        lineId: 'commercial-12k',
        itemId: 'item-commercial',
        qty: 7,
        unitPrice: 12_000,
      },
    ];

    const drafts = commercialItems.map((item, index) => makePoDeliveryLineDraft({
      id: `delivery-commercial-${index}`,
      batchId: 'batch-commercial-lines',
      purchaseOrderId: 'po-commercial-lines',
      item,
      plannedQty: item.qty,
    }));

    expect(drafts.map(draft => draft.purchaseOrderLineId)).toEqual([
      'commercial-10k',
      'commercial-12k',
    ]);
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

    const [synced] = syncPoItemsFromDeliverySchedule([{ ...poItem, qty: 1, unitPrice: 1 }], schedule);

    expect(synced.qty).toBe(15);
    expect(synced.unitPrice).toBeCloseTo(120);
  });

  it('zeros scheduled quantity and price when an empty request schedule should stay empty', () => {
    const [synced] = syncPoItemsFromDeliverySchedule(
      [{ ...poItem, qty: 16, unitPrice: 103750 }],
      [],
      { emptyScheduleBehavior: 'zero_qty_and_price' },
    );

    expect(synced.qty).toBe(0);
    expect(synced.unitPrice).toBe(0);
  });

  it('does not auto-create default delivery schedule when editing a request PO with removed batches', () => {
    expect(shouldAutoCreatePoDeliveryScheduleForForm({
      isEditing: true,
      sourceMode: 'from_request',
    })).toBe(false);
  });

  it('uses the default package flow for request PO drafts with an editable delivery schedule', () => {
    expect(getDefaultPurchaseMode('from_request')).toBe('single');
    expect(shouldCreateBatchDuringDraftSave('single')).toBe(true);
    expect(shouldCreateBatchDuringDraftSave('multiple')).toBe(true);
    expect(shouldAutoCreateBatchOnApproval('single')).toBe(true);
    expect(shouldAutoCreateBatchOnApproval('multiple')).toBe(false);
    expect(shouldAutoCreatePoDeliveryScheduleForForm({
      isEditing: false,
      sourceMode: 'from_request',
    })).toBe(true);
  });

  it('shows an inline approved price editor for request packages before total package approval', () => {
    expect(shouldEditInlineRequestUnitPrice({
      sourceMode: 'from_request',
      purchaseMode: 'single',
      isPurchasePackageV2Form: true,
    })).toBe(true);

    expect(shouldEditInlineRequestUnitPrice({
      sourceMode: 'from_request',
      purchaseMode: 'multiple',
      isPurchasePackageV2Form: true,
    })).toBe(true);

    expect(shouldEditInlineRequestUnitPrice({
      sourceMode: 'from_request',
      purchaseMode: 'single',
      isPurchasePackageV2Form: false,
    })).toBe(false);
  });

  it('starts new delivery draft lines empty for request POs after deleted batches', () => {
    expect(getPoDeliveryDraftInitialLineValues({
      remainingQty: 16,
      unitPrice: 103750,
      sourceMode: 'from_request',
    })).toEqual({
      issuedQty: '',
      deliveryUnitPrice: '',
    });
  });

  it('keeps default delivery draft values for proactive POs', () => {
    expect(getPoDeliveryDraftInitialLineValues({
      remainingQty: 16,
      unitPrice: 103750,
      sourceMode: 'proactive_project',
    })).toEqual({
      issuedQty: '16',
      deliveryUnitPrice: '103750',
    });
  });

  it('starts added schedule lines at zero for request POs so old prices do not return', () => {
    expect(getPoDeliveryScheduleLineInitialValues({
      remainingQty: 16,
      unitPrice: 103750,
      sourceMode: 'from_request',
    })).toEqual({
      plannedQty: 0,
      deliveryUnitPrice: 0,
    });
  });

  it('keeps added schedule defaults for proactive POs', () => {
    expect(getPoDeliveryScheduleLineInitialValues({
      remainingQty: 16,
      unitPrice: 103750,
      sourceMode: 'proactive_project',
    })).toEqual({
      plannedQty: 16,
      deliveryUnitPrice: 103750,
    });
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

  it('zeros unmatched request PO lines when another line already has a delivery schedule', () => {
    const schedule: PurchaseOrderDeliveryBatch[] = [
      {
        id: 'batch-1',
        purchaseOrderId: 'po-1',
        deliveryNo: 1,
        plannedDeliveryDate: '2026-07-06',
        status: 'planned',
        lines: [
          {
            id: 'line-2-b1',
            deliveryBatchId: 'batch-1',
            purchaseOrderId: 'po-1',
            purchaseOrderLineId: 'line-2',
            itemId: 'item-2',
            plannedQty: 4,
            deliveryUnitPrice: 500,
          },
        ],
      },
    ];

    const [synced] = syncPoItemsFromDeliverySchedule(
      [{ ...poItem, qty: 16, unitPrice: 103750 }],
      schedule,
      { unmatchedLineBehavior: 'zero_qty_and_price' },
    );

    expect(synced.qty).toBe(0);
    expect(synced.unitPrice).toBe(0);
  });

  it('zeros request PO lines that have a zero-quantity schedule line with an old price', () => {
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
            plannedQty: 0,
            deliveryUnitPrice: 103750,
          },
        ],
      },
    ];

    const [synced] = syncPoItemsFromDeliverySchedule(
      [{ ...poItem, qty: 16, unitPrice: 103750 }],
      schedule,
      { unmatchedLineBehavior: 'zero_qty_and_price' },
    );

    expect(synced.qty).toBe(0);
    expect(synced.unitPrice).toBe(0);
  });

  it('keeps unmatched request demand but zeros price when saving without a delivery schedule for that line', () => {
    const schedule: PurchaseOrderDeliveryBatch[] = [
      {
        id: 'batch-1',
        purchaseOrderId: 'po-1',
        deliveryNo: 1,
        plannedDeliveryDate: '2026-07-06',
        status: 'planned',
        lines: [
          {
            id: 'line-2-b1',
            deliveryBatchId: 'batch-1',
            purchaseOrderId: 'po-1',
            purchaseOrderLineId: 'line-2',
            itemId: 'item-2',
            plannedQty: 4,
            deliveryUnitPrice: 500,
          },
        ],
      },
    ];

    const [synced] = syncPoItemPricesFromDeliverySchedule(
      [{ ...poItem, qty: 16, unitPrice: 103750 }],
      schedule,
      { unmatchedLineBehavior: 'zero_price' },
    );

    expect(synced.qty).toBe(16);
    expect(synced.unitPrice).toBe(0);
  });

  it('keeps MR package baseline values even when no delivery batch exists yet', () => {
    const [synced] = resolvePurchaseOrderItemsForScheduledPricing({
      items: [{ ...poItem, qty: 7000, unitPrice: 5600 }],
      batches: [],
      sourceMode: 'from_request',
    });

    expect(synced.qty).toBe(7000);
    expect(synced.unitPrice).toBe(5600);
    expect(calculateLineTotal(synced)).toBe(39200000);
  });

  it('keeps request PO baseline prices instead of syncing them from delivery schedules', () => {
    const schedule: PurchaseOrderDeliveryBatch[] = [
      {
        id: 'batch-1',
        purchaseOrderId: 'po-1',
        deliveryNo: 1,
        plannedDeliveryDate: '2026-07-25',
        status: 'planned',
        lines: [
          {
            id: 'line-1-b1',
            deliveryBatchId: 'batch-1',
            purchaseOrderId: 'po-1',
            purchaseOrderLineId: 'line-1',
            itemId: 'item-1',
            plannedQty: 7000,
            deliveryUnitPrice: 5600,
          },
        ],
      },
    ];

    const [synced] = resolvePurchaseOrderItemsForScheduledPricing({
      items: [{ ...poItem, qty: 7000, unitPrice: 5600 }],
      batches: schedule,
      sourceMode: 'from_request',
    });
    const totalAmount = calculateLineTotal(synced);
    const summary = getPurchaseOrderReleaseSummary({
      id: 'po-1',
      vendorId: 'vendor-1',
      poNumber: 'PO-157',
      items: [synced],
      totalAmount,
      approvedTotalAmount: totalAmount,
      orderDate: '2026-07-25',
      status: 'draft',
      sourceMode: 'from_request',
      createdAt: '2026-07-25T00:00:00.000Z',
    }, schedule);

    expect(synced.qty).toBe(7000);
    expect(synced.unitPrice).toBe(5600);
    expect(totalAmount).toBe(39200000);
    expect(summary.actualPlannedAmount).toBe(39200000);
    expect(summary.overAmount).toBe(0);
  });

  it('uses the edited request package PO item price when saving a stale delivery schedule price', () => {
    expect(getPoDeliveryScheduleUnitPriceForSave({
      item: { ...poItem, unitPrice: 2_783_932.347 },
      sourceMode: 'from_request',
      purchaseMode: 'single',
      existingDeliveryUnitPrice: 2_567_000,
    })).toBe(2_783_932.347);
  });
});
