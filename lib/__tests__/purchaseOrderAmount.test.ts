import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import {
  buildPurchaseOrderPrintLineAmounts,
  getPurchaseOrderDisplayAmount,
  getPurchaseOrderDisplayLineAmount,
  getPurchaseOrderPrintAmount,
} from '../purchaseOrderAmount';

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

  it('returns zero for request POs when every delivery batch has been removed', () => {
    expect(getPurchaseOrderDisplayAmount(po, [])).toBe(0);
  });

  it('keeps the approved master PO amount for request POs that intentionally have no schedule yet', () => {
    expect(getPurchaseOrderDisplayAmount({ ...po, approvedTotalAmount: 1660000 }, [])).toBe(1660000);
  });

  it('returns zero when every delivery batch is cancelled', () => {
    const amount = getPurchaseOrderDisplayAmount(po, [
      deliveryBatch('batch-1', 10, 100000, 'cancelled'),
    ]);

    expect(amount).toBe(0);
  });

  it('returns zero line price and total for request POs when every delivery batch has been removed', () => {
    const lineAmount = getPurchaseOrderDisplayLineAmount(po, po.items[0], []);

    expect(lineAmount).toEqual({
      unitPrice: 0,
      totalAmount: 0,
      scheduledQty: 0,
    });
  });

  it('keeps master line price and total for request POs with approved total and no schedule yet', () => {
    const lineAmount = getPurchaseOrderDisplayLineAmount({ ...po, approvedTotalAmount: 1660000 }, po.items[0], []);

    expect(lineAmount).toEqual({
      unitPrice: 103750,
      totalAmount: 1660000,
      scheduledQty: 16,
    });
  });

  it('uses active delivery batches for visible line price and total', () => {
    const lineAmount = getPurchaseOrderDisplayLineAmount(po, po.items[0], [
      deliveryBatch('batch-1', 10, 100000),
      deliveryBatch('batch-2', 6, 110000),
    ]);

    expect(lineAmount).toEqual({
      unitPrice: 103750,
      totalAmount: 1660000,
      scheduledQty: 16,
    });
  });

  it('falls back to saved PO amount when there is no delivery schedule', () => {
    expect(getPurchaseOrderDisplayAmount({ ...po, sourceMode: 'proactive_project' }, [])).toBe(1660000);
  });

  it('builds printable line amounts from active delivery schedules instead of saved PO item totals', () => {
    const steelPo: PurchaseOrder = {
      ...po,
      id: 'po-118',
      poNumber: 'PO-118',
      vatRate: 10,
      items: [
        {
          lineId: 'd10',
          itemId: 'item-d10',
          sku: 'VT0000825',
          name: 'Thep XD D10',
          unit: 'kg',
          qty: 59238.200002,
          unitPrice: 14850,
        },
        {
          lineId: 'wire',
          itemId: 'item-wire',
          sku: 'VT0000834',
          name: 'Thep buoc 1 ly',
          unit: 'kg',
          qty: 1200,
          unitPrice: 17500,
        },
      ],
      totalAmount: 900687270,
      sourceMode: 'from_request',
    };
    const schedule: PurchaseOrderDeliveryBatch[] = [
      {
        id: 'batch-1',
        purchaseOrderId: steelPo.id,
        deliveryNo: 1,
        plannedDeliveryDate: '2026-07-14',
        status: 'planned',
        lines: [
          {
            id: 'batch-1-d10',
            deliveryBatchId: 'batch-1',
            purchaseOrderId: steelPo.id,
            purchaseOrderLineId: 'd10',
            itemId: 'item-d10',
            plannedQty: 35088,
            deliveryUnitPrice: 14850,
          },
          {
            id: 'batch-1-wire',
            deliveryBatchId: 'batch-1',
            purchaseOrderId: steelPo.id,
            purchaseOrderLineId: 'wire',
            itemId: 'item-wire',
            plannedQty: 1200,
            deliveryUnitPrice: 17500,
          },
        ],
      },
    ];

    const lines = buildPurchaseOrderPrintLineAmounts(steelPo, schedule);

    expect(lines).toEqual([
      expect.objectContaining({
        lineKey: 'd10',
        scheduledQty: 35088,
        unitPrice: 14850,
        totalAmount: 521056800,
      }),
      expect.objectContaining({
        lineKey: 'wire',
        scheduledQty: 1200,
        unitPrice: 17500,
        totalAmount: 21000000,
      }),
    ]);
    expect(lines.reduce((sum: number, line: { totalAmount: number }) => sum + line.totalAmount, 0)).toBe(542056800);
  });

  it('displays and prints package-v2 request POs from the approved reference amount instead of delivery stock pricing', () => {
    const packagePo: PurchaseOrder = {
      ...po,
      id: 'po-229',
      poNumber: 'PO-229',
      purchaseMode: 'single',
      sourceMode: 'from_request',
      vatRate: 0,
      items: [
        {
          lineId: 'alc-panel',
          itemId: 'item-alc',
          sku: 'ALC-001',
          name: 'Tam vach ALC be tong',
          unit: 'tam',
          qty: 473,
          unitPrice: 2_783_932.347,
        },
      ],
      totalAmount: 1_316_800_000,
      approvedTotalAmount: 1_316_800_000,
      referenceGrossAmount: 1_316_800_000,
    };
    const warehousePricedDelivery: PurchaseOrderDeliveryBatch = {
      id: 'batch-229',
      purchaseOrderId: packagePo.id,
      deliveryNo: 1,
      plannedDeliveryDate: '2026-07-29',
      status: 'planned',
      lines: [
        {
          id: 'batch-229-alc-panel',
          deliveryBatchId: 'batch-229',
          purchaseOrderId: packagePo.id,
          purchaseOrderLineId: 'alc-panel',
          itemId: 'item-alc',
          plannedQty: 473,
          deliveryUnitPrice: 2_567_000,
        },
      ],
    };

    const displayLine = getPurchaseOrderDisplayLineAmount(packagePo, packagePo.items[0], [warehousePricedDelivery]);
    expect(getPurchaseOrderDisplayAmount(packagePo, [warehousePricedDelivery])).toBe(1_316_800_000);
    expect(displayLine.scheduledQty).toBe(473);
    expect(displayLine.totalAmount).toBe(1_316_800_000);
    expect(displayLine.unitPrice).toBeCloseTo(2_783_932.34672, 5);

    const [printLine] = buildPurchaseOrderPrintLineAmounts(packagePo, [warehousePricedDelivery]);
    expect(getPurchaseOrderPrintAmount(packagePo, [warehousePricedDelivery])).toBe(1_316_800_000);
    expect(printLine.lineKey).toBe('alc-panel');
    expect(printLine.scheduledQty).toBe(473);
    expect(printLine.totalAmount).toBe(1_316_800_000);
    expect(printLine.unitPrice).toBeCloseTo(2_783_932.34672, 5);
  });
});
