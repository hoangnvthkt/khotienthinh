import { describe, expect, it } from 'vitest';
import type { SupplierPayableDocument } from '../../types';
import {
  allocateSupplierPayment,
  assertSupplierPaymentBatchCanPost,
} from '../supplierPaymentBatchService';

const doc = (
  id: string,
  outstandingAmount: number,
  documentDate: string,
  patch: Partial<SupplierPayableDocument> = {},
): SupplierPayableDocument => ({
  id,
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  supplierId: 'supplier-a',
  supplierNameSnapshot: 'NCC A',
  sourceType: 'purchase_order',
  sourceId: id.replace('ap-', 'po-'),
  documentNo: id.toUpperCase(),
  documentDate,
  dueDate: documentDate,
  currency: 'VND',
  committedAmount: outstandingAmount,
  recognizedAmount: outstandingAmount,
  paidAmount: 0,
  creditAmount: 0,
  outstandingAmount,
  status: 'payable',
  qrToken: `token-${id}`,
  metadata: {},
  createdAt: `${documentDate}T00:00:00.000Z`,
  updatedAt: `${documentDate}T00:00:00.000Z`,
  ...patch,
});

describe('supplierPaymentBatchService helpers', () => {
  it('allocates a partial supplier payment FIFO across payable documents', () => {
    const allocations = allocateSupplierPayment({
      mode: 'fifo',
      paymentBatchId: 'batch-1',
      amount: 300_000_000,
      documents: [
        doc('ap-2', 400_000_000, '2026-07-12'),
        doc('ap-1', 200_000_000, '2026-07-01'),
        doc('ap-3', 400_000_000, '2026-07-20'),
      ],
    });

    expect(allocations.map(row => [row.payableDocumentId, row.allocatedAmount])).toEqual([
      ['ap-1', 200_000_000],
      ['ap-2', 100_000_000],
    ]);
  });

  it('keeps NCC A outstanding at 700 million after a 300 million batch against 1 billion AP', () => {
    const documents = [
      doc('ap-1', 200_000_000, '2026-07-01'),
      doc('ap-2', 400_000_000, '2026-07-12'),
      doc('ap-3', 400_000_000, '2026-07-20'),
    ];

    const allocations = allocateSupplierPayment({
      mode: 'fifo',
      paymentBatchId: 'batch-1',
      amount: 300_000_000,
      documents,
    });
    const paid = allocations.reduce((sum, row) => sum + row.allocatedAmount, 0);
    const recognized = documents.reduce((sum, row) => sum + row.recognizedAmount, 0);

    expect(recognized).toBe(1_000_000_000);
    expect(paid).toBe(300_000_000);
    expect(recognized - paid).toBe(700_000_000);
  });

  it('rejects overpayment before posting the batch', () => {
    expect(() => assertSupplierPaymentBatchCanPost({
      amount: 120_000_000,
      allocations: [
        {
          id: 'allocation-1',
          paymentBatchId: 'batch-1',
          payableDocumentId: 'ap-1',
          allocatedAmount: 120_000_000,
          discountAmount: 0,
          withholdingAmount: 0,
          allocationMode: 'manual',
          createdAt: '2026-07-15T00:00:00.000Z',
        },
      ],
      documents: [doc('ap-1', 100_000_000, '2026-07-01')],
    })).toThrow(/vượt công nợ/i);
  });
});
