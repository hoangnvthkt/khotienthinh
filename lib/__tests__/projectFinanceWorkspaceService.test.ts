import { describe, expect, it, vi } from 'vitest';
import { ProjectTransaction, PurchaseOrder } from '../../types';
import { buildPurchaseOrderPayableRow, calculatePoRecognizedPayable } from '../projectFinanceWorkspaceService';

vi.mock('../supabase', () => ({
  supabase: {},
}));

describe('projectFinanceWorkspaceService', () => {
  const basePo = (overrides: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
    id: 'po-1',
    poNumber: 'PO-001',
    vendorName: 'NCC A',
    status: 'approved',
    totalAmount: 20_000_000,
    createdAt: '2026-07-01T00:00:00.000Z',
    orderDate: '2026-07-01',
    expectedDeliveryDate: '2026-07-10',
    items: [
      {
        itemId: 'steel',
        sku: 'D10',
        name: 'Thép D10',
        unit: 'Kg',
        qty: 1000,
        unitPrice: 20_000,
        receivedQty: 600,
      },
    ],
    ...overrides,
  } as PurchaseOrder);

  const paymentTx = (id: string, amount: number, sourceRef: string, description = 'Thanh toán PO-001'): ProjectTransaction => ({
    id,
    projectFinanceId: 'finance-1',
    constructionSiteId: 'site-1',
    type: 'expense',
    category: 'materials',
    amount,
    description,
    date: '2026-07-04',
    source: 'manual',
    sourceRef,
    attachments: [],
    createdAt: '2026-07-04T00:00:00.000Z',
  });

  it('recognizes supplier payable from net received PO quantity, not ordered quantity', () => {
    const payable = calculatePoRecognizedPayable({
      totalAmount: 20_000_000,
      items: [
        {
          itemId: 'steel',
          sku: 'D10',
          name: 'Thép D10',
          unit: 'Kg',
          qty: 1000,
          unitPrice: 20_000,
          receivedQty: 600,
        },
      ],
    });

    expect(payable).toBe(12_000_000);
  });

  it('deducts supplier returns from recognized payable', () => {
    const payable = calculatePoRecognizedPayable({
      totalAmount: 20_000_000,
      items: [
        {
          itemId: 'steel',
          sku: 'D10',
          name: 'Thép D10',
          unit: 'Kg',
          qty: 1000,
          unitPrice: 20_000,
          receivedQty: 600,
          returnedQty: 100,
        },
      ],
    });

    expect(payable).toBe(10_000_000);
  });

  it('marks received PO payable as unpaid when there is no payment transaction', () => {
    const row = buildPurchaseOrderPayableRow(basePo(), []);

    expect(row.paidAmount).toBe(0);
    expect(row.recognizedAmount).toBe(12_000_000);
    expect(row.outstandingAmount).toBe(12_000_000);
    expect(row.status).toBe('payable');
  });

  it('sums multiple PO payment transactions by purchase order source ref prefix', () => {
    const row = buildPurchaseOrderPayableRow(basePo(), [
      paymentTx('tx-1', 4_000_000, 'purchase_order:po-1:payment:one'),
      paymentTx('tx-2', 3_500_000, 'purchase_order:po-1:payment:two'),
      paymentTx('tx-other', 1_000_000, 'purchase_order:po-other:payment:one', 'Thanh toán PO khác'),
    ]);

    expect(row.paidAmount).toBe(7_500_000);
    expect(row.outstandingAmount).toBe(4_500_000);
    expect(row.status).toBe('partial');
  });

  it('marks PO payable as paid once payment transactions cover the recognized amount', () => {
    const row = buildPurchaseOrderPayableRow(basePo(), [
      paymentTx('tx-1', 7_000_000, 'purchase_order:po-1:payment:one'),
      paymentTx('tx-2', 5_000_000, 'purchase_order:po-1:payment:two'),
    ]);

    expect(row.paidAmount).toBe(12_000_000);
    expect(row.outstandingAmount).toBe(0);
    expect(row.status).toBe('paid');
  });
});
