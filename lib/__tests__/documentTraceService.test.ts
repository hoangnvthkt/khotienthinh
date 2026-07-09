import { describe, expect, it } from 'vitest';
import {
  buildDocumentQrUrl,
  buildDocumentQrPayload,
  buildPaymentBatchTraceGraph,
  buildTraceGraphFromLinks,
  parseDocumentQr,
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

  it('round-trips document QR URLs and rejects malformed payloads', () => {
    const url = buildDocumentQrUrl('supplier_delivery_statement', 'statement-1', 'qr-statement');

    expect(url).toContain('docQr=');
    expect(parseDocumentQr(url)).toEqual({
      v: 1,
      type: 'supplier_delivery_statement',
      id: 'statement-1',
      token: 'qr-statement',
    });

    expect(() => parseDocumentQr(JSON.stringify({
      v: 1,
      type: 'supplier_delivery_statement',
      id: 'statement-1',
    }))).toThrow('QR chứng từ không hợp lệ');
  });

  it('builds a direct-in-out supplier contract trace graph from document links', () => {
    const graph = buildTraceGraphFromLinks({
      seed: { type: 'supplier_contract', id: 'contract-1' },
      nodes: [
        { type: 'supplier_contract', id: 'contract-1', label: 'HĐ NCC', documentNo: 'HD-NCC-001' },
        { type: 'supplier_direct_delivery_note', id: 'note-1', label: 'NCC A', documentNo: 'GHHD-001' },
        { type: 'wms_transaction', id: 'tx-import-1', label: 'Nhập WMS', documentNo: 'tx-import-1', status: 'COMPLETED' },
        { type: 'wms_transaction', id: 'tx-export-1', label: 'Xuất WMS', documentNo: 'tx-export-1', status: 'PENDING' },
        { type: 'supplier_delivery_statement', id: 'statement-1', label: 'Đối soát', documentNo: 'DCHD-001' },
        { type: 'supplier_payable_document', id: 'ap-1', label: 'AP', documentNo: 'AP-001' },
        { type: 'supplier_payment_batch', id: 'pay-1', label: 'Thanh toán', documentNo: 'PAY-001' },
      ],
      links: [
        { id: 'l1', sourceType: 'supplier_contract', sourceId: 'contract-1', targetType: 'supplier_direct_delivery_note', targetId: 'note-1', relationType: 'delivery_note', status: 'active', metadata: {}, createdAt: '', updatedAt: '' },
        { id: 'l2', sourceType: 'supplier_direct_delivery_note', sourceId: 'note-1', targetType: 'wms_transaction', targetId: 'tx-import-1', relationType: 'wms_import', status: 'active', metadata: {}, createdAt: '', updatedAt: '' },
        { id: 'l3', sourceType: 'wms_transaction', sourceId: 'tx-import-1', targetType: 'wms_transaction', targetId: 'tx-export-1', relationType: 'wms_export', status: 'active', metadata: {}, createdAt: '', updatedAt: '' },
        { id: 'l4', sourceType: 'supplier_direct_delivery_note', sourceId: 'note-1', targetType: 'supplier_delivery_statement', targetId: 'statement-1', relationType: 'statement', status: 'active', metadata: {}, createdAt: '', updatedAt: '' },
        { id: 'l5', sourceType: 'supplier_delivery_statement', sourceId: 'statement-1', targetType: 'supplier_payable_document', targetId: 'ap-1', relationType: 'recognizes', status: 'active', metadata: {}, createdAt: '', updatedAt: '' },
        { id: 'l6', sourceType: 'supplier_payable_document', sourceId: 'ap-1', targetType: 'supplier_payment_batch', targetId: 'pay-1', relationType: 'paid_by', status: 'active', metadata: { allocatedAmount: 1000 }, createdAt: '', updatedAt: '' },
        { id: 'l6-duplicate', sourceType: 'supplier_payable_document', sourceId: 'ap-1', targetType: 'supplier_payment_batch', targetId: 'pay-1', relationType: 'paid_by', status: 'active', metadata: { allocatedAmount: 1000 }, createdAt: '', updatedAt: '' },
      ],
    });

    expect(graph.nodes.map(node => `${node.type}:${node.id}`)).toEqual([
      'supplier_contract:contract-1',
      'supplier_direct_delivery_note:note-1',
      'wms_transaction:tx-import-1',
      'wms_transaction:tx-export-1',
      'supplier_delivery_statement:statement-1',
      'supplier_payable_document:ap-1',
      'supplier_payment_batch:pay-1',
    ]);
    expect(graph.edges.map(edge => `${edge.from}->${edge.to}:${edge.relation}`)).toEqual([
      'supplier_contract:contract-1->supplier_direct_delivery_note:note-1:delivery_note',
      'supplier_direct_delivery_note:note-1->wms_transaction:tx-import-1:wms_import',
      'wms_transaction:tx-import-1->wms_transaction:tx-export-1:wms_export',
      'supplier_direct_delivery_note:note-1->supplier_delivery_statement:statement-1:statement',
      'supplier_delivery_statement:statement-1->supplier_payable_document:ap-1:recognizes',
      'supplier_payable_document:ap-1->supplier_payment_batch:pay-1:paid_by',
    ]);
  });

  it('traces a payment batch downstream from source documents without project document links', () => {
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
          sourceType: 'supplier_delivery_statement',
          sourceId: 'statement-1',
          documentNo: 'DCHD-001',
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
      'supplier_delivery_statement:statement-1',
      'supplier_payable_document:ap-1',
      'supplier_payment_batch:batch-1',
    ]);
    expect(graph.edges.map(edge => `${edge.from}->${edge.to}:${edge.relation}`)).toEqual([
      'supplier_delivery_statement:statement-1->supplier_payable_document:ap-1:recognizes',
      'supplier_payable_document:ap-1->supplier_payment_batch:batch-1:paid_by',
    ]);
  });
});
