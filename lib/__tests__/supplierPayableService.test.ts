import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, SupplierPayableDocument, SupplierPaymentAllocation } from '../../types';
import {
  buildPayableDocumentFromPurchaseOrder,
  buildSupplierPayableBalances,
  calculatePurchaseOrderRecognizedAmount,
} from '../supplierPayableService';

const basePo = (overrides: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-1',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  vendorId: 'supplier-a',
  vendorName: 'NCC A',
  poNumber: 'PO-001',
  items: [
    {
      itemId: 'steel',
      sku: 'D10',
      name: 'Thep D10',
      unit: 'kg',
      qty: 1000,
      unitPrice: 20_000,
      receivedQty: 600,
      returnedQty: 100,
    },
  ],
  totalAmount: 20_000_000,
  orderDate: '2026-07-01',
  expectedDeliveryDate: '2026-07-10',
  status: 'partial',
  sourceMode: 'from_request',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

describe('supplierPayableService helpers', () => {
  it('recognizes PO payable from net received quantity only', () => {
    expect(calculatePurchaseOrderRecognizedAmount(basePo())).toBe(10_000_000);
  });

  it('builds an AP document snapshot from a received purchase order', () => {
    const document = buildPayableDocumentFromPurchaseOrder(basePo());

    expect(document.sourceType).toBe('purchase_order');
    expect(document.sourceId).toBe('po-1');
    expect(document.supplierId).toBe('supplier-a');
    expect(document.supplierNameSnapshot).toBe('NCC A');
    expect(document.recognizedAmount).toBe(10_000_000);
    expect(document.outstandingAmount).toBe(10_000_000);
    expect(document.qrToken).toMatch(/^ap_/);
  });

  it('aggregates supplier balances from AP documents and paid allocations', () => {
    const docs: SupplierPayableDocument[] = [
      buildPayableDocumentFromPurchaseOrder(basePo({ id: 'po-1', poNumber: 'PO-001' })),
      buildPayableDocumentFromPurchaseOrder(basePo({
        id: 'po-2',
        poNumber: 'PO-002',
        items: [
          {
            itemId: 'cement',
            sku: 'XM',
            name: 'Xi mang',
            unit: 'bao',
            qty: 500,
            unitPrice: 100_000,
            receivedQty: 500,
          },
        ],
        totalAmount: 50_000_000,
      })),
    ];
    const allocations: SupplierPaymentAllocation[] = [
      {
        id: 'allocation-1',
        paymentBatchId: 'batch-1',
        payableDocumentId: docs[0].id,
        allocatedAmount: 3_000_000,
        discountAmount: 0,
        withholdingAmount: 0,
        allocationMode: 'fifo',
        createdAt: '2026-07-15T00:00:00.000Z',
      },
    ];

    const [balance] = buildSupplierPayableBalances(docs, allocations);

    expect(balance.supplierId).toBe('supplier-a');
    expect(balance.recognizedAmount).toBe(60_000_000);
    expect(balance.paidAmount).toBe(3_000_000);
    expect(balance.outstandingAmount).toBe(57_000_000);
    expect(balance.documentCount).toBe(2);
  });
});
