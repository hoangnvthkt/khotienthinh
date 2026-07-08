import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplierPayableDocument, SupplierPaymentAllocation, SupplierPaymentBatch } from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import {
  allocateSupplierPayment,
  assertSupplierPaymentBatchCanPost,
  supplierPaymentBatchService,
} from '../supplierPaymentBatchService';

const query = (response: { data?: any; error?: any }) => {
  const api: any = {
    select: vi.fn(() => api),
    order: vi.fn(() => api),
    eq: vi.fn(() => api),
    delete: vi.fn(() => api),
    upsert: vi.fn(() => api),
    single: vi.fn(() => Promise.resolve(response)),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return api;
};

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
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

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

  it('lists supplier payment batches with scoped filters and maps snake case rows', async () => {
    const batchQuery = query({
      data: [{
        id: 'batch-1',
        code: 'PAY-20260715-0001',
        project_id: 'project-1',
        construction_site_id: 'site-1',
        supplier_id: 'supplier-a',
        supplier_name_snapshot: 'NCC A',
        period_month: '2026-07-01',
        payment_date: '2026-07-15',
        payment_method: 'bank_transfer',
        document_ref: 'UNC-001',
        payment_amount: 300_000_000,
        currency: 'VND',
        status: 'paid',
        allocation_mode: 'fifo',
        qr_token: 'pay-batch-1',
        metadata: { bank: 'VCB' },
        created_at: '2026-07-15T00:00:00.000Z',
        updated_at: '2026-07-15T00:00:00.000Z',
      }],
      error: null,
    });
    supabaseMocks.from.mockReturnValue(batchQuery);

    const rows = await supplierPaymentBatchService.listBatches({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      supplierId: 'supplier-a',
      status: 'paid',
      periodMonth: '2026-07-01',
    });

    expect(supabaseMocks.from).toHaveBeenCalledWith('supplier_payment_batches');
    expect(batchQuery.select).toHaveBeenCalledWith('*');
    expect(batchQuery.order).toHaveBeenCalledWith('payment_date', { ascending: false });
    expect(batchQuery.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(batchQuery.eq).toHaveBeenCalledWith('construction_site_id', 'site-1');
    expect(batchQuery.eq).toHaveBeenCalledWith('supplier_id', 'supplier-a');
    expect(batchQuery.eq).toHaveBeenCalledWith('status', 'paid');
    expect(batchQuery.eq).toHaveBeenCalledWith('period_month', '2026-07-01');
    expect(rows[0].paymentAmount).toBe(300_000_000);
    expect(rows[0].amount).toBe(300_000_000);
    expect(rows[0].supplierNameSnapshot).toBe('NCC A');
  });

  it('loads a payment batch detail with allocations', async () => {
    const batchQuery = query({
      data: {
        id: 'batch-1',
        code: 'PAY-20260715-0001',
        supplier_name_snapshot: 'NCC A',
        payment_date: '2026-07-15',
        payment_amount: 300_000_000,
        status: 'paid',
        allocation_mode: 'fifo',
        created_at: '2026-07-15T00:00:00.000Z',
      },
      error: null,
    });
    const allocationQuery = query({
      data: [{
        id: 'allocation-1',
        payment_batch_id: 'batch-1',
        payable_document_id: 'ap-1',
        document_no_snapshot: 'PO-001',
        allocated_amount: 200_000_000,
        discount_amount: 0,
        withholding_amount: 0,
        allocation_mode: 'fifo',
        created_at: '2026-07-15T00:00:00.000Z',
      }],
      error: null,
    });
    supabaseMocks.from
      .mockReturnValueOnce(batchQuery)
      .mockReturnValueOnce(allocationQuery);

    const detail = await supplierPaymentBatchService.getBatchDetail('batch-1');

    expect(supabaseMocks.from).toHaveBeenNthCalledWith(1, 'supplier_payment_batches');
    expect(supabaseMocks.from).toHaveBeenNthCalledWith(2, 'supplier_payment_allocations');
    expect(batchQuery.eq).toHaveBeenCalledWith('id', 'batch-1');
    expect(allocationQuery.eq).toHaveBeenCalledWith('payment_batch_id', 'batch-1');
    expect(detail.batch.id).toBe('batch-1');
    expect(detail.allocations).toHaveLength(1);
    expect(detail.allocations[0].allocatedAmount).toBe(200_000_000);
  });

  it('updates a draft batch by replacing its allocations', async () => {
    const batch: SupplierPaymentBatch = {
      id: 'batch-1',
      code: 'PAY-20260715-0001',
      supplierNameSnapshot: 'NCC A',
      paymentDate: '2026-07-15',
      paymentAmount: 300_000_000,
      amount: 300_000_000,
      status: 'draft',
      allocationMode: 'manual',
      createdAt: '2026-07-15T00:00:00.000Z',
    };
    const allocations: SupplierPaymentAllocation[] = [{
      id: 'allocation-1',
      paymentBatchId: 'batch-1',
      payableDocumentId: 'ap-1',
      allocatedAmount: 300_000_000,
      discountAmount: 0,
      withholdingAmount: 0,
      allocationMode: 'manual',
      createdAt: '2026-07-15T00:00:00.000Z',
    }];
    const batchQuery = query({
      data: {
        id: 'batch-1',
        code: 'PAY-20260715-0001',
        supplier_name_snapshot: 'NCC A',
        payment_date: '2026-07-15',
        payment_amount: 300_000_000,
        status: 'draft',
        allocation_mode: 'manual',
        created_at: '2026-07-15T00:00:00.000Z',
      },
      error: null,
    });
    const deleteQuery = query({ data: [], error: null });
    const allocationQuery = query({ data: [], error: null });
    supabaseMocks.from
      .mockReturnValueOnce(batchQuery)
      .mockReturnValueOnce(deleteQuery)
      .mockReturnValueOnce(allocationQuery);

    const result = await supplierPaymentBatchService.updateDraft(batch, allocations);

    expect(batchQuery.upsert).toHaveBeenCalled();
    expect(deleteQuery.delete).toHaveBeenCalled();
    expect(deleteQuery.eq).toHaveBeenCalledWith('payment_batch_id', 'batch-1');
    expect(allocationQuery.upsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        payment_batch_id: 'batch-1',
        payable_document_id: 'ap-1',
        allocated_amount: 300_000_000,
      }),
    ]), { onConflict: 'payment_batch_id,payable_document_id' });
    expect(result.id).toBe('batch-1');
  });
});
