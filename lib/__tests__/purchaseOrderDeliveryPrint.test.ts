import { describe, expect, it } from 'vitest';
import type { PurchaseOrder } from '../../types';
import {
  buildPurchaseOrderApprovalDeliveryBatches,
  getPurchaseOrderDeliveryPrintGroupSummary,
} from '../purchaseOrderDeliveryPrint';

const packagePo: PurchaseOrder = {
  id: 'po-261',
  vendorId: 'vendor-1',
  poNumber: 'PO-261',
  purchaseMode: 'single',
  sourceMode: 'from_request',
  vatRate: 0,
  items: [
    {
      lineId: 'd300',
      itemId: 'item-d300',
      sku: 'VT0001217',
      name: 'Cong bi thuong D300',
      unit: 'Met',
      qty: 20,
      unitPrice: 300_000,
    },
    {
      lineId: 'd400',
      itemId: 'item-d400',
      sku: 'VT0000167',
      name: 'Cong bi thuong D400',
      unit: 'Met',
      qty: 217.5,
      unitPrice: 360_000,
    },
  ],
  totalAmount: 84_300_000,
  approvedTotalAmount: 84_300_000,
  referenceGrossAmount: 84_300_000,
  orderDate: '2026-07-30',
  status: 'confirmed',
  createdAt: '2026-07-30T00:00:00.000Z',
};

const staleDeliveryGroup = {
  label: 'Đợt 1',
  plannedDate: '2026-08-10',
  lines: [
    {
      poLineId: 'd300',
      itemId: 'item-d300',
      issuedQty: 20,
      deliveryUnitPrice: 0,
      deliveryUnit: 'Met',
      unit: 'Met',
    },
    {
      poLineId: 'd400',
      itemId: 'item-d400',
      issuedQty: 217.5,
      deliveryUnitPrice: 0,
      deliveryUnit: 'Met',
      unit: 'Met',
    },
  ],
};

describe('purchaseOrderDeliveryPrint', () => {
  it('prices delivery approval request batches from edited PO item prices when delivery line prices are stale', () => {
    const [batch] = buildPurchaseOrderApprovalDeliveryBatches(packagePo, [staleDeliveryGroup]);

    expect(batch.lines).toEqual([
      {
        purchaseOrderLineId: 'd300',
        plannedQty: 20,
        unitPrice: 300_000,
      },
      {
        purchaseOrderLineId: 'd400',
        plannedQty: 217.5,
        unitPrice: 360_000,
      },
    ]);
  });

  it('summarizes delivery print groups from edited PO item prices when delivery line prices are stale', () => {
    expect(getPurchaseOrderDeliveryPrintGroupSummary(packagePo, staleDeliveryGroup)).toEqual({
      totalQty: 237.5,
      totalAmount: 84_300_000,
      unitLabel: 'Met',
      unitPriceLabel: 'Nhiều đơn giá',
    });
  });

  it('matches delivery print lines by item id when the PO line id is missing', () => {
    const [batch] = buildPurchaseOrderApprovalDeliveryBatches(packagePo, [{
      label: 'Đợt 1',
      plannedDate: '2026-08-10',
      lines: [{
        itemId: 'item-d300',
        issuedQty: 20,
        deliveryUnitPrice: 0,
        deliveryUnit: 'Met',
      }],
    }]);

    expect(batch.lines).toEqual([
      {
        purchaseOrderLineId: 'item-d300',
        plannedQty: 20,
        unitPrice: 300_000,
      },
    ]);
  });

  it('uses each delivery batch price for a multi-delivery PO even when the master reference price exists', () => {
    const multiDeliveryPo: PurchaseOrder = {
      ...packagePo,
      purchaseMode: 'multiple',
      items: [{
        lineId: 'd16',
        itemId: 'item-d16',
        sku: 'VT0000828',
        name: 'Thep XD D16',
        unit: 'Kg',
        qty: 21_942.882,
        unitPrice: 0,
      }],
      referenceGrossAmount: 330_723_118,
    };

    const [batch] = buildPurchaseOrderApprovalDeliveryBatches(multiDeliveryPo, [{
      label: 'Đợt 1',
      plannedDate: '2026-08-27',
      lines: [{
        poLineId: 'd16',
        itemId: 'item-d16',
        issuedQty: 21_000,
        deliveryUnitPrice: 1_502,
        deliveryUnit: 'Kg',
      }],
    }]);

    expect(batch.lines).toEqual([{
      purchaseOrderLineId: 'd16',
      plannedQty: 21_000,
      unitPrice: 1_502,
    }]);
    expect(getPurchaseOrderDeliveryPrintGroupSummary(multiDeliveryPo, {
      lines: [{
        poLineId: 'd16',
        itemId: 'item-d16',
        issuedQty: 21_000,
        deliveryUnitPrice: 1_502,
        deliveryUnit: 'Kg',
      }],
    })).toMatchObject({ totalAmount: 31_542_000 });
  });
});
