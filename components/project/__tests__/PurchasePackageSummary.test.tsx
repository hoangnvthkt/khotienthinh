import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../../types';
import PurchasePackageSummary from '../PurchasePackageSummary';

const VARIANCE_WARNING = 'Đợt giao đang lệch baseline Gói mua hàng';

const makePackage = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-1',
  vendorId: 'vendor-1',
  poNumber: 'PO-171',
  items: [{
    lineId: 'line-1',
    itemId: 'item-1',
    sku: 'VT0001110',
    name: 'Áo lưới bảo hộ lao động công nhân công trình',
    unit: 'Cái',
    qty: 100,
    unitPrice: 1_000,
  }],
  totalAmount: 100_000,
  referenceGrossAmount: 100_000,
  purchaseMode: 'single',
  vatRate: 0,
  orderDate: '2026-07-26',
  status: 'draft',
  sourceMode: 'from_request',
  createdAt: '2026-07-26T00:00:00.000Z',
  ...patch,
});

const makeBatch = ({
  plannedQty,
  unitPrice = 1_000,
}: {
  plannedQty: number;
  unitPrice?: number;
}): PurchaseOrderDeliveryBatch => ({
  id: 'batch-1',
  purchaseOrderId: 'po-1',
  deliveryNo: 1,
  status: 'receiving',
  plannedDeliveryDate: '2026-07-27',
  vatRate: 0,
  lines: [{
    id: 'batch-1-line-1',
    deliveryBatchId: 'batch-1',
    purchaseOrderId: 'po-1',
    purchaseOrderLineId: 'line-1',
    itemId: 'item-1',
    plannedQty,
    deliveryUnitPrice: unitPrice,
  }],
});

const renderSummary = (
  purchaseOrder: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
) => renderToStaticMarkup(
  <PurchasePackageSummary purchaseOrder={purchaseOrder} deliveryBatches={deliveryBatches} />,
);

describe('PurchasePackageSummary', () => {
  it('does not warn while a request package draft has no delivery batches yet', () => {
    const html = renderSummary(makePackage(), []);

    expect(html).toContain('Nhu cầu gốc');
    expect(html).toContain('Còn nhu cầu');
    expect(html).not.toContain(VARIANCE_WARNING);
  });

  it('does not warn for a partial release that stays under the package baseline', () => {
    const html = renderSummary(
      makePackage({ status: 'confirmed', purchaseMode: 'multiple' }),
      [makeBatch({ plannedQty: 40 })],
    );

    expect(html).not.toContain(VARIANCE_WARNING);
  });

  it('warns when delivery batches exceed the package quantity baseline', () => {
    const html = renderSummary(
      makePackage({ status: 'confirmed' }),
      [makeBatch({ plannedQty: 101 })],
    );

    expect(html).toContain(VARIANCE_WARNING);
  });

  it('does not warn when only the stale delivery batch price exceeds the package gross baseline', () => {
    const html = renderSummary(
      makePackage({ status: 'confirmed' }),
      [makeBatch({ plannedQty: 100, unitPrice: 1_200 })],
    );

    expect(html).not.toContain(VARIANCE_WARNING);
  });
});
