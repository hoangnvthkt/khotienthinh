import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOrder, SupplierPayableDocument, SupplierPaymentAllocation } from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import {
  buildPayableDocumentFromPurchaseOrder,
  buildSupplierPayableBalances,
  calculatePurchaseOrderRecognizedAmount,
  supplierPayableService,
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
      data: [],
      error: null,
    };
    supabaseMocks.from.mockReset().mockReturnValue(query);
    supabaseMocks.rpc.mockReset();
    supabaseMocks.select.mockReset().mockReturnValue(query);
    supabaseMocks.order.mockReset().mockReturnValue(query);
    supabaseMocks.eq.mockReset().mockReturnValue(query);
  });

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
