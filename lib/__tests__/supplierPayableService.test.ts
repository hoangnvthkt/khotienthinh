import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOrder, SupplierPayableDocument, SupplierPaymentAllocation } from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
  eq: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import {
  buildInvoiceReconciliation,
  buildPayableDocumentFromPurchaseOrder,
  buildSupplierPayableBalances,
  calculateDeliveryReceiptGross,
  calculatePurchaseOrderRecognizedAmount,
  supplierPayableService,
  validateSupplierInvoiceLinks,
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
  beforeEach(() => {
    const query = {
      select: supabaseMocks.select,
      order: supabaseMocks.order,
      eq: supabaseMocks.eq,
      limit: supabaseMocks.limit,
      data: [],
      error: null,
    };
    supabaseMocks.from.mockReset().mockReturnValue(query);
    supabaseMocks.rpc.mockReset();
    supabaseMocks.select.mockReset().mockReturnValue(query);
    supabaseMocks.order.mockReset().mockReturnValue(query);
    supabaseMocks.eq.mockReset().mockReturnValue(query);
    supabaseMocks.limit.mockReset().mockReturnValue(query);
  });

  it('recognizes PO payable from net received quantity only', () => {
    expect(calculatePurchaseOrderRecognizedAmount(basePo())).toBe(10_000_000);
  });

  it('recognizes over-received PO payable from actual quantity, then nets returns', () => {
    expect(calculatePurchaseOrderRecognizedAmount(basePo({
      items: [{
        itemId: 'steel',
        sku: 'D10',
        name: 'Thep D10',
        unit: 'kg',
        qty: 2000,
        unitPrice: 20_000,
        receivedQty: 2010,
        returnedQty: 0,
      }],
    }))).toBe(40_200_000);

    expect(calculatePurchaseOrderRecognizedAmount(basePo({
      items: [{
        itemId: 'steel',
        sku: 'D10',
        name: 'Thep D10',
        unit: 'kg',
        qty: 2000,
        unitPrice: 20_000,
        receivedQty: 2010,
        returnedQty: 10,
      }],
    }))).toBe(40_000_000);
  });

  it('calculates delivery receipt gross from accepted quantities and VAT', () => {
    expect(calculateDeliveryReceiptGross({
      vatRate: 10,
      lines: [{ acceptedQty: 90, deliveryUnitPrice: 10_000 }],
    })).toBe(990_000);
  });

  it('calculates supplier invoice variance against linked receipt AP gross', () => {
    expect(buildInvoiceReconciliation({
      linkedPayablesGross: 990_000,
      invoiceGross: 1_000_000,
    })).toEqual({
      varianceAmount: 10_000,
      hasVariance: true,
    });
  });

  it('validates supplier invoice many-to-many payable allocations', () => {
    expect(validateSupplierInvoiceLinks({
      supplierId: 'vendor-1',
      grossAmount: 1_000_000,
      links: [
        { payableSupplierId: 'vendor-1', allocatedGrossAmount: 600_000 },
        { payableSupplierId: 'vendor-1', allocatedGrossAmount: 400_000 },
      ],
    })).toEqual({ allocatedGrossAmount: 1_000_000 });

    expect(() => validateSupplierInvoiceLinks({
      supplierId: 'vendor-1',
      grossAmount: 1_000_000,
      links: [
        { payableSupplierId: 'vendor-2', allocatedGrossAmount: 1_000_000 },
      ],
    })).toThrow('Tất cả AP được link phải cùng nhà cung cấp với hóa đơn.');
  });

  it('maps duplicate supplier invoice numbers to a Vietnamese error', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_supplier_invoice_header_number"',
      },
    });

    await expect(supplierPayableService.recordSupplierInvoiceReconciliation({
      invoice: {
        supplierId: 'vendor-1',
        supplierNameSnapshot: 'NCC 1',
        invoiceNumber: 'HD-001',
        invoiceDate: '2026-07-26',
        netAmount: 900_000,
        vatAmount: 100_000,
        grossAmount: 1_000_000,
        varianceReason: null,
        attachments: [],
      },
      links: [{ payableDocumentId: 'ap-1', allocatedGrossAmount: 1_000_000 }],
      actorUserId: 'user-1',
    })).rejects.toThrow('Số hóa đơn đã tồn tại cho NCC này.');
  });

  it('maps an invoice replay conflict to a Vietnamese error', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '22023',
        message: 'SUPPLIER_INVOICE_REPLAY_CONFLICT',
      },
    });

    await expect(supplierPayableService.recordSupplierInvoiceReconciliation({
      invoice: {
        supplierId: 'vendor-1',
        supplierNameSnapshot: 'NCC 1',
        invoiceNumber: 'HD-001',
        invoiceDate: '2026-09-20',
        netAmount: 90,
        vatAmount: 10,
        grossAmount: 100,
        varianceReason: null,
        attachments: [],
      },
      links: [{ payableDocumentId: 'ap-1', allocatedGrossAmount: 100 }],
      actorUserId: 'user-1',
    })).rejects.toThrow('Số hóa đơn đã tồn tại với nội dung đối soát khác.');
  });

  it('maps unsupported partial invoice coverage to an actionable error', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '0A000',
        message: 'SUPPLIER_INVOICE_COVERAGE_UNSUPPORTED',
      },
    });

    await expect(supplierPayableService.recordSupplierInvoiceReconciliation({
      invoice: {
        supplierId: 'vendor-1',
        supplierNameSnapshot: 'NCC 1',
        invoiceNumber: 'HD-PARTIAL-001',
        invoiceDate: '2026-09-20',
        netAmount: 60,
        vatAmount: 0,
        grossAmount: 60,
        varianceReason: null,
        attachments: [],
      },
      links: [{ payableDocumentId: 'ap-1', allocatedGrossAmount: 60 }],
      actorUserId: 'user-1',
    })).rejects.toThrow('Chưa hỗ trợ hóa đơn phân bổ một phần hoặc có chênh lệch. Hãy đối soát đủ giá trị AP.');
  });

  it('maps unsupported multi-scope invoice matching to an actionable error', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '0A000',
        message: 'SUPPLIER_INVOICE_MULTI_SCOPE_UNSUPPORTED',
      },
    });

    await expect(supplierPayableService.recordSupplierInvoiceReconciliation({
      invoice: {
        supplierId: 'vendor-1',
        supplierNameSnapshot: 'NCC 1',
        invoiceNumber: 'HD-MULTI-001',
        invoiceDate: '2026-09-20',
        netAmount: 200,
        vatAmount: 0,
        grossAmount: 200,
        varianceReason: null,
        attachments: [],
      },
      links: [
        { payableDocumentId: 'ap-1', allocatedGrossAmount: 100 },
        { payableDocumentId: 'ap-2', allocatedGrossAmount: 100 },
      ],
      actorUserId: 'user-1',
    })).rejects.toThrow('Chưa hỗ trợ đối soát một hóa đơn qua nhiều phạm vi dự án/công trường.');
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

  it('filters AP documents by source type and source id when loading a PO cockpit', async () => {
    await supplierPayableService.listDocuments({
      projectId: 'project-1',
      sourceType: 'purchase_order',
      sourceId: 'po-1',
    });

    expect(supabaseMocks.from).toHaveBeenCalledWith('supplier_payable_document_balances');
    expect(supabaseMocks.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(supabaseMocks.eq).toHaveBeenCalledWith('source_type', 'purchase_order');
    expect(supabaseMocks.eq).toHaveBeenCalledWith('source_id', 'po-1');
  });

  const installPoDossierReadMock = (input?: {
    failSourceType?: string;
    error?: unknown;
    batchCount?: number;
  }) => {
    const queryCalls: Array<{
      table: string;
      eq: Array<[string, unknown]>;
      in: Array<[string, unknown[]]>;
    }> = [];
    const batchCount = input?.batchCount ?? 2;
    const batches = Array.from({ length: batchCount }, (_, index) => ({
      id: `batch-${index + 1}`,
      purchase_order_id: 'po-1',
      project_id: 'project-1',
      construction_site_id: 'site-1',
    }));
    const documents = [
      {
        id: 'ap-po', source_type: 'purchase_order', source_id: 'po-1', project_id: 'project-1', construction_site_id: 'site-1',
        supplier_name_snapshot: 'NCC A', document_no: 'PO-001', currency: 'VND', committed_amount: 100, recognized_amount: 100,
        paid_amount: 0, credit_amount: 0, outstanding_amount: 100, status: 'open', metadata: {}, created_at: '2026-09-19T00:00:00Z',
      },
      {
        id: 'ap-duplicate', source_type: 'purchase_order', source_id: 'po-1', project_id: 'project-1', construction_site_id: 'site-1',
        supplier_name_snapshot: 'NCC A', document_no: 'PO-001-D', currency: 'VND', committed_amount: 50, recognized_amount: 50,
        paid_amount: 0, credit_amount: 0, outstanding_amount: 50, status: 'open', metadata: {}, created_at: '2026-09-19T00:00:00Z',
      },
      {
        id: 'ap-receipt', source_type: 'purchase_delivery_receipt', source_id: 'batch-1', project_id: 'project-1', construction_site_id: 'site-1',
        supplier_name_snapshot: 'NCC A', document_no: 'RCPT-001', currency: 'VND', committed_amount: 80, recognized_amount: 80,
        paid_amount: 0, credit_amount: 0, outstanding_amount: 80, status: 'open', metadata: {}, created_at: '2026-09-19T01:00:00Z',
      },
      {
        id: 'ap-duplicate', source_type: 'purchase_delivery_receipt', source_id: 'batch-2', project_id: 'project-1', construction_site_id: 'site-1',
        supplier_name_snapshot: 'NCC A', document_no: 'RCPT-D', currency: 'VND', committed_amount: 50, recognized_amount: 50,
        paid_amount: 0, credit_amount: 0, outstanding_amount: 50, status: 'open', metadata: {}, created_at: '2026-09-19T01:00:00Z',
      },
      {
        id: 'ap-statement', source_type: 'supplier_delivery_statement', source_id: 'statement-1', project_id: 'project-1', construction_site_id: 'site-1',
        supplier_name_snapshot: 'NCC A', document_no: 'ST-001', currency: 'VND', committed_amount: 90, recognized_amount: 90,
        paid_amount: 0, credit_amount: 0, outstanding_amount: 90, status: 'open', metadata: {}, created_at: '2026-09-19T02:00:00Z',
      },
      ...(batchCount > 2 ? [{
        id: 'ap-last-batch', source_type: 'purchase_delivery_receipt', source_id: `batch-${batchCount}`, project_id: 'project-1', construction_site_id: 'site-1',
        supplier_name_snapshot: 'NCC A', document_no: 'RCPT-LAST', currency: 'VND', committed_amount: 10, recognized_amount: 10,
        paid_amount: 0, credit_amount: 0, outstanding_amount: 10, status: 'open', metadata: {}, created_at: '2026-09-19T03:00:00Z',
      }] : []),
    ];

    supabaseMocks.from.mockImplementation((table: string) => {
      const call = { table, eq: [] as Array<[string, unknown]>, in: [] as Array<[string, unknown[]]> };
      queryCalls.push(call);
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          call.eq.push([column, value]);
          return query;
        }),
        in: vi.fn((column: string, values: unknown[]) => {
          call.in.push([column, values]);
          return query;
        }),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        gt: vi.fn(() => query),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const sourceType = call.eq.find(([column]) => column === 'source_type')?.[1];
          if (input?.failSourceType && sourceType === input.failSourceType) {
            return Promise.resolve({ data: null, error: input?.error }).then(resolve, reject);
          }
          const sourceId = call.eq.find(([column]) => column === 'source_id')?.[1];
          const sourceIds = call.in.find(([column]) => column === 'source_id')?.[1];
          const projectId = call.eq.find(([column]) => column === 'project_id')?.[1];
          const siteId = call.eq.find(([column]) => column === 'construction_site_id')?.[1];
          const rows = table === 'purchase_order_delivery_batches'
            ? batches
            : documents.filter(row => (
              (!sourceType || row.source_type === sourceType)
              && (!sourceId || row.source_id === sourceId)
              && (!sourceIds || sourceIds.includes(row.source_id))
              && (!projectId || row.project_id === projectId)
              && (!siteId || row.construction_site_id === siteId)
            ));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    });

    return queryCalls;
  };

  it('loads legacy PO and receipt AP documents for every scoped delivery batch, then deduplicates by id', async () => {
    const queryCalls = installPoDossierReadMock();

    const documents = await supplierPayableService.listDocumentsByPurchaseOrder({
      purchaseOrderId: 'po-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
    });

    expect(queryCalls.map(call => call.table)).toEqual([
      'purchase_order_delivery_batches',
      'supplier_payable_document_balances',
      'supplier_payable_document_balances',
    ]);
    expect(queryCalls.every(call => call.eq.some(filter => filter[0] === 'project_id' && filter[1] === 'project-1'))).toBe(true);
    expect(queryCalls.every(call => call.eq.some(filter => filter[0] === 'construction_site_id' && filter[1] === 'site-1'))).toBe(true);
    expect(queryCalls[2].eq).toContainEqual(['source_type', 'purchase_delivery_receipt']);
    expect(queryCalls[2].in).toContainEqual(['source_id', ['batch-1', 'batch-2']]);
    expect(documents.map(document => document.id)).toEqual(['ap-receipt', 'ap-duplicate', 'ap-po']);
    expect(documents.map(document => document.id)).not.toContain('ap-statement');
  });

  it.each([
    { code: '42501', message: 'denied' },
    { code: '42P01', message: 'missing relation' },
    { code: 'NETWORK', message: 'network failed' },
  ])('rejects a $code error from the receipt AP branch', async error => {
    installPoDossierReadMock({ failSourceType: 'purchase_delivery_receipt', error });

    await expect(supplierPayableService.listDocumentsByPurchaseOrder({
      purchaseOrderId: 'po-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
    })).rejects.toBe(error);
  });

  it('chunks all delivery batch ids before reading receipt AP documents', async () => {
    const queryCalls = installPoDossierReadMock({ batchCount: 101 });

    const documents = await supplierPayableService.listDocumentsByPurchaseOrder({
      purchaseOrderId: 'po-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
    });

    const receiptCalls = queryCalls.filter(call => (
      call.eq.some(filter => filter[0] === 'source_type' && filter[1] === 'purchase_delivery_receipt')
    ));
    expect(receiptCalls).toHaveLength(2);
    expect(receiptCalls[0].in[0][1]).toHaveLength(100);
    expect(receiptCalls[1].in[0]).toEqual(['source_id', ['batch-101']]);
    expect(documents.map(document => document.id)).toContain('ap-last-batch');
  });

  it('returns an empty dossier only when every scoped source is legitimately empty', async () => {
    supabaseMocks.from.mockImplementation(() => {
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        gt: vi.fn(() => query),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return query;
    });

    await expect(supplierPayableService.listDocumentsByPurchaseOrder({
      purchaseOrderId: 'po-empty',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
    })).resolves.toEqual([]);
  });

  it('syncs AP document from a site direct purchase through the posting RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'ap-direct-1',
        code: 'AP-MN-001',
        source_type: 'site_direct_purchase',
        source_id: 'direct-1',
        supplier_name_snapshot: 'NCC A',
        document_no: 'MN-001',
        document_date: '2026-07-08',
        currency: 'VND',
        committed_amount: 500_000,
        recognized_amount: 500_000,
        paid_amount: 0,
        credit_amount: 0,
        outstanding_amount: 500_000,
        status: 'open',
        created_at: '2026-07-08T00:00:00.000Z',
      },
      error: null,
    });

    const document = await supplierPayableService.syncSiteDirectPurchaseById('direct-1');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('sync_supplier_payable_from_site_direct_purchase', {
      p_direct_purchase_id: 'direct-1',
    });
    expect(document.sourceType).toBe('site_direct_purchase');
    expect(document.sourceId).toBe('direct-1');
    expect(document.outstandingAmount).toBe(500_000);
  });

  it('syncs AP document from a supplier delivery statement and keeps contract metadata', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'ap-statement-1',
        code: 'AP-DCHD-001',
        source_type: 'supplier_delivery_statement',
        source_id: 'statement-1',
        supplier_id: 'supplier-a',
        supplier_name_snapshot: 'NCC A',
        supplier_contract_id: 'contract-1',
        supplier_contract_code: 'HD-NCC-001',
        document_no: 'DCHD-001',
        document_date: '2026-07-31',
        currency: 'VND',
        committed_amount: 12_375_000,
        recognized_amount: 12_375_000,
        paid_amount: 0,
        credit_amount: 0,
        outstanding_amount: 12_375_000,
        status: 'open',
        metadata: {
          supplierContractId: 'contract-1',
          supplierContractCode: 'HD-NCC-001',
        },
        created_at: '2026-07-31T00:00:00.000Z',
      },
      error: null,
    });

    const document = await supplierPayableService.syncDeliveryStatementById('statement-1');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('sync_supplier_payable_from_delivery_statement', {
      p_statement_id: 'statement-1',
    });
    expect(document.sourceType).toBe('supplier_delivery_statement');
    expect(document.supplierContractId).toBe('contract-1');
    expect(document.supplierContractCode).toBe('HD-NCC-001');
  });
});
