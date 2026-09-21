import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import { supplierFinanceControlService } from '../supplierFinanceControlService';

describe('supplierFinanceControlService', () => {
  beforeEach(() => rpc.mockReset());

  it('records a partial receipt-line invoice allocation through V3', async () => {
    rpc.mockResolvedValueOnce({ data: { invoice: {
      id: 'inv-1', supplier_id: 'supplier-1', supplier_name_snapshot: 'NCC 1', invoice_number: 'HD-1',
      invoice_date: '2026-09-21', net_amount: 54, vat_amount: 6, gross_amount: 60, currency: 'VND',
      status: 'posted', matching_version: 2, row_version: 1, attachments: [],
    } }, error: null });
    const invoice = await supplierFinanceControlService.recordInvoiceMatch({
      invoice: { supplierId: 'supplier-1', supplierNameSnapshot: 'NCC 1', invoiceNumber: 'HD-1', invoiceDate: '2026-09-21', netAmount: 54, vatAmount: 6, grossAmount: 60, currency: 'VND', status: 'posted', matchingVersion: 2, rowVersion: 1, attachments: [] },
      payableLinks: [{ invoiceId: '', payableDocumentId: 'ap-1', allocatedNetAmount: 54, allocatedVatAmount: 6, allocatedGrossAmount: 60, coverageMode: 'partial', currency: 'VND' }],
      receiptAllocations: [{ payableDocumentId: 'ap-1', deliveryLineId: 'line-1', quantity: 6, unit: 'bao', unitPrice: 9, netAmount: 54, vatAmount: 6, grossAmount: 60, priceSource: 'supplier_invoice' }],
      idempotencyKey: 'command-1',
    });
    expect(rpc).toHaveBeenCalledWith('record_supplier_invoice_reconciliation_v3', expect.objectContaining({ p_idempotency_key: 'command-1' }));
    expect(invoice).toMatchObject({ id: 'inv-1', grossAmount: 60, matchingVersion: 2, rowVersion: 1 });
  });

  it('preserves an unknown valuation amount returned by the server', async () => {
    rpc.mockResolvedValueOnce({ data: {
      asOf: '2026-09-21T00:00:00Z', projectId: 'p-1', authoritative: false,
      issues: ['VALUATION_SOURCE_MISSING'], layers: [{
        layer: 'consumption', amount: null, currency: 'VND', completeness: 'unknown',
        source: 'inventory_ledger_entries', documentCount: 2, issues: ['VALUATION_SOURCE_MISSING'],
      }],
    }, error: null });
    const snapshot = await supplierFinanceControlService.getSnapshot({ projectId: 'p-1' });
    expect(snapshot.layers[0].amount).toBeNull();
    expect(snapshot.authoritative).toBe(false);
  });

  it('maps AP and receipt-line matching candidates without inventing quantities', async () => {
    rpc.mockResolvedValueOnce({ data: {
      documents: [{ id: 'ap-1', source_type: 'purchase_delivery_receipt', source_id: 'batch-1', document_no: 'REC-1', currency: 'VND', recognized_amount: 100, credit_amount: 0, paid_amount: 0, outstanding_amount: 100, invoiced_to_date: 60, uninvoiced_amount: 40 }],
      receiptLines: [{ deliveryLineId: 'line-1', deliveryBatchId: 'batch-1', purchaseOrderId: 'po-1', purchaseOrderLineId: 'po-line-1', itemId: 'item-1', acceptedQty: 10, unit: 'bao', receiptUnitPrice: 10, invoicedToDate: 6, uninvoicedQty: 4, vatRate: 0 }],
    }, error: null });
    const result = await supplierFinanceControlService.getInvoiceCandidates({ projectId: 'p-1', supplierId: 'supplier-1' });
    expect(result.documents[0]).toMatchObject({ id: 'ap-1', recognizedAmount: 100, invoicedToDate: 60, uninvoicedAmount: 40 });
    expect(result.receiptLines[0]).toMatchObject({ deliveryLineId: 'line-1', uninvoicedQty: 4 });
  });
});
