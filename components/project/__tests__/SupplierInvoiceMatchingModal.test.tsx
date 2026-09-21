import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SupplierInvoiceMatchingModal } from '../SupplierInvoiceMatchingModal';

describe('SupplierInvoiceMatchingModal', () => {
  it('explains partial matching and keeps receipt quantities visible', () => {
    const html = renderToStaticMarkup(<SupplierInvoiceMatchingModal supplierName="NCC A" loading={false} error={null} saving={false} onRetry={() => undefined} onClose={() => undefined} onSubmit={() => undefined} candidates={{
      documents: [{ id: 'ap-1', sourceType: 'purchase_delivery_receipt', sourceId: 'batch-1', documentNo: 'REC-1', currency: 'VND', recognizedAmount: 100, creditAmount: 0, paidAmount: 0, outstandingAmount: 100, invoicedToDate: 60, uninvoicedAmount: 40 }],
      receiptLines: [{ deliveryLineId: 'line-1', deliveryBatchId: 'batch-1', purchaseOrderId: 'po-1', purchaseOrderLineId: 'po-line-1', itemId: 'XM-01', acceptedQty: 10, unit: 'bao', receiptUnitPrice: 10, invoicedToDate: 6, uninvoicedQty: 4, vatRate: 0 }],
    }} />);
    expect(html).toContain('không tự tạo credit');
    expect(html).toContain('chưa HĐ 40 VND');
    expect(html).toContain('role="dialog"');
  });

  it('shows an explicit empty state when no AP remains to match', () => {
    const html = renderToStaticMarkup(<SupplierInvoiceMatchingModal supplierName="NCC A" loading={false} error={null} saving={false} onRetry={() => undefined} onClose={() => undefined} onSubmit={() => undefined} candidates={{ documents: [], receiptLines: [] }} />);
    expect(html).toContain('Không còn chứng từ AP cần đối soát');
  });
});
