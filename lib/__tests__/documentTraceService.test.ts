import { describe, expect, it } from 'vitest';
import {
  buildDocumentQrPayload,
  buildPaymentBatchTraceGraph,
  parseDocumentQrPayload,
} from '../documentTraceService';

describe('documentTraceService helpers', () => {
  it('round-trips the unified QR payload', () => {
    const payload = buildDocumentQrPayload('supplier_payment_batch', 'batch-1', 'qr-secret');

    expect(parseDocumentQrPayload(JSON.stringify(payload))).toEqual({
      v: 1,
      type: 'supplier_payment_batch',
      id: 'batch-1',
      token: 'qr-secret',
    });
  });

  it('traces a payment batch back to paid AP documents and source POs', () => {
    const graph = buildPaymentBatchTraceGraph({
      batch: {
        id: 'batch-1',
        code: 'PAY-202607-001',
        supplierId: 'supplier-a',
        supplierNameSnapshot: 'NCC A',
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        paymentDate: '2026-07-15',
        amount: 300_000_000,
        status: 'paid',
        qrToken: 'qr-batch',
        allocationMode: 'fifo',
        metadata: {},
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
      documents: [
        {
          id: 'ap-1',
          sourceType: 'purchase_order',
          sourceId: 'po-1',
          documentNo: 'PO-001',
          supplierId: 'supplier-a',
          supplierNameSnapshot: 'NCC A',
          currency: 'VND',
          committedAmount: 200_000_000,
          recognizedAmount: 200_000_000,
          paidAmount: 200_000_000,
          creditAmount: 0,
          outstandingAmount: 0,
          status: 'paid',
          qrToken: 'qr-ap-1',
          metadata: {},
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      allocations: [
        {
          id: 'allocation-1',
          paymentBatchId: 'batch-1',
          payableDocumentId: 'ap-1',
          allocatedAmount: 200_000_000,
          discountAmount: 0,
          withholdingAmount: 0,
          allocationMode: 'fifo',
          createdAt: '2026-07-15T00:00:00.000Z',
        },
      ],
    });

    expect(graph.nodes.map(node => `${node.type}:${node.id}`)).toEqual([
      'supplier_payment_batch:batch-1',
      'supplier_payable_document:ap-1',
      'purchase_order:po-1',
    ]);
    expect(graph.edges.map(edge => `${edge.from}->${edge.to}:${edge.relation}`)).toEqual([
      'supplier_payment_batch:batch-1->supplier_payable_document:ap-1:pays',
      'supplier_payable_document:ap-1->purchase_order:po-1:recognizes',
    ]);
  });
});
