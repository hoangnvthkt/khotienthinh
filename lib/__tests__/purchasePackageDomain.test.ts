import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import { getPurchasePackageSummary } from '../purchasePackageDomain';

const makePackage = (input: { qty: number; unitPrice: number; vatRate: number }): PurchaseOrder => ({
  id: 'po-1',
  vendorId: 'vendor-1',
  poNumber: 'PO01',
  items: [{
    lineId: 'po-line-1',
    itemId: 'item-1',
    sku: 'VT-1',
    name: 'Vat tu test',
    unit: 'Kg',
    qty: input.qty,
    unitPrice: input.unitPrice,
  }],
  totalAmount: input.qty * input.unitPrice,
  referenceGrossAmount: input.qty * input.unitPrice * (1 + input.vatRate / 100),
  purchaseMode: 'single',
  vatRate: input.vatRate,
  orderDate: '2026-07-25',
  status: 'confirmed',
  sourceMode: 'from_request',
  createdAt: '2026-07-25T00:00:00.000Z',
});

const makeBatch = (input: {
  id: string;
  plannedQty: number;
  acceptedQty: number;
  unitPrice: number;
  vatRate: number;
}): PurchaseOrderDeliveryBatch => ({
  id: input.id,
  purchaseOrderId: 'po-1',
  deliveryNo: Number(input.id.slice(-1)),
  status: input.acceptedQty > 0 ? 'received_short' : 'receiving',
  vatRate: input.vatRate,
  lines: [{
    id: `${input.id}-line-1`,
    deliveryBatchId: input.id,
    purchaseOrderId: 'po-1',
    purchaseOrderLineId: 'po-line-1',
    itemId: 'item-1',
    plannedQty: input.plannedQty,
    acceptedQty: input.acceptedQty,
    deliveryUnitPrice: input.unitPrice,
  }],
});

describe('getPurchasePackageSummary', () => {
  it('keeps a first-time 7,000 Kg package at zero released quantity', () => {
    const summary = getPurchasePackageSummary({
      id: 'po-mr-2026-9753',
      poNumber: 'PO-157',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      vendorId: 'vendor-1',
      items: [{
        lineId: 'line-1',
        itemId: 'VT0000288',
        sku: 'VT0000288',
        name: 'Sika mau xam',
        unit: 'Kg',
        qty: 7000,
        unitPrice: 5600,
      }],
      totalAmount: 39_200_000,
      approvedTotalAmount: 39_200_000,
      referenceGrossAmount: 39_200_000,
      purchaseMode: 'single',
      vatRate: 0,
      orderDate: '2026-07-25',
      status: 'draft',
      sourceMode: 'from_request',
      materialRequestId: 'MR-2026-9753',
      createdAt: '2026-07-25T00:00:00.000Z',
    }, []);

    expect(summary.releasedQty).toBe(0);
    expect(summary.releasedGross).toBe(0);
    expect(summary.releasedGrossVariance).toBe(-39_200_000);
    expect(summary.uiStatus).toBe('draft');
  });

  it('allows 500 Kg plus 510 Kg against a 1,000 Kg baseline', () => {
    const summary = getPurchasePackageSummary(
      makePackage({ qty: 1000, unitPrice: 10_000, vatRate: 0 }),
      [
        makeBatch({ id: 'batch-1', plannedQty: 500, acceptedQty: 0, unitPrice: 10_000, vatRate: 0 }),
        makeBatch({ id: 'batch-2', plannedQty: 510, acceptedQty: 0, unitPrice: 10_000, vatRate: 0 }),
      ],
    );
    expect(summary.releasedQty).toBe(1010);
    expect(summary.releasedVarianceQty).toBe(10);
    expect(summary.receivedNetQty).toBe(0);
  });

  it('summarizes an independent multiple-delivery package in the MR unit while valuing the commercial quantity', () => {
    const multiplePo: PurchaseOrder = {
      ...makePackage({ qty: 1187, unitPrice: 0, vatRate: 0 }),
      procurementFlowVersion: 3,
      purchaseMode: 'multiple',
      items: [{
        ...makePackage({ qty: 1187, unitPrice: 0, vatRate: 0 }).items[0],
        unit: 'Cay', requestedQtySnapshot: 1187, requestedUnitSnapshot: 'Cay', purchaseUnitSnapshot: 'Kg',
      }],
      referenceGrossAmount: 0,
    };
    const batch = makeBatch({ id: 'batch-1', plannedQty: 21176, acceptedQty: 0, unitPrice: 15072, vatRate: 0 });
    batch.lines[0].stockPlannedQty = 1187;

    const summary = getPurchasePackageSummary(multiplePo, [batch]);
    expect(summary.referenceQty).toBe(1187);
    expect(summary.releasedQty).toBe(1187);
    expect(summary.releasedGross).toBe(21176 * 15072);
  });

  it('does not infer flow v3 from a requested snapshot on a legacy v2 PO', () => {
    const legacyPo: PurchaseOrder = {
      ...makePackage({ qty: 21_176, unitPrice: 15_072, vatRate: 0 }),
      procurementFlowVersion: 2,
      purchaseMode: 'multiple',
      items: [{
        ...makePackage({ qty: 21_176, unitPrice: 15_072, vatRate: 0 }).items[0],
        requestedQtySnapshot: 1_187,
        requestedUnitSnapshot: 'Cây',
      }],
    };
    const batch = makeBatch({ id: 'batch-1', plannedQty: 21_176, acceptedQty: 0, unitPrice: 15_072, vatRate: 0 });
    batch.lines[0].stockPlannedQty = 1_187;

    const summary = getPurchasePackageSummary(legacyPo, [batch]);

    expect(summary.referenceQty).toBe(21_176);
    expect(summary.releasedQty).toBe(21_176);
  });

  it('recognizes only 90 accepted from a 100 delivery', () => {
    const summary = getPurchasePackageSummary(
      makePackage({ qty: 100, unitPrice: 10_000, vatRate: 10 }),
      [makeBatch({ id: 'batch-1', plannedQty: 100, acceptedQty: 90, unitPrice: 10_000, vatRate: 10 })],
    );
    expect(summary.acceptedQty).toBe(90);
    expect(summary.receivedGross).toBe(990_000);
    expect(summary.remainingNeedQty).toBe(10);
  });

  it('uses the request package reference amount when delivery schedule price is stale', () => {
    const summary = getPurchasePackageSummary({
      id: 'po-251',
      vendorId: 'vendor-1',
      poNumber: 'PO-251',
      items: [{
        lineId: 'alc-panel',
        itemId: 'item-alc',
        sku: 'VT0000861',
        name: 'Tam vach ALC be tong',
        unit: 'm3',
        qty: 473,
        unitPrice: 2_783_932.347,
      }],
      totalAmount: 1_316_800_000,
      approvedTotalAmount: 1_316_800_000,
      referenceGrossAmount: 1_316_800_000,
      purchaseMode: 'single',
      vatRate: 0,
      orderDate: '2026-07-29',
      status: 'draft',
      sourceMode: 'from_request',
      createdAt: '2026-07-29T00:00:00.000Z',
    }, [
      makeBatch({ id: 'batch-1', plannedQty: 473, acceptedQty: 0, unitPrice: 2_567_000, vatRate: 0 }),
    ]);

    expect(summary.releasedGross).toBe(1_316_800_000);
    expect(summary.releasedGrossVariance).toBe(0);
  });
});
