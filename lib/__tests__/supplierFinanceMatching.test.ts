import { describe, expect, it } from 'vitest';
import type { SupplierInvoicePayableLink, SupplierInvoiceReceiptAllocation } from '../../types';
import { validateSupplierInvoiceMatch } from '../supplierFinanceMatching';

const base = () => ({
  currency: 'VND',
  netAmount: 54,
  vatAmount: 6,
  grossAmount: 60,
  payableLinks: [{
    invoiceId: '', payableDocumentId: 'ap-1', allocatedNetAmount: 54,
    allocatedVatAmount: 6, allocatedGrossAmount: 60, currency: 'VND' as const,
  }] as SupplierInvoicePayableLink[],
  receiptAllocations: [{
    payableDocumentId: 'ap-1', deliveryLineId: 'line-1', quantity: 6, unit: 'bao',
    unitPrice: 9, netAmount: 54, vatAmount: 6, grossAmount: 60, priceSource: 'supplier_invoice',
  }] as SupplierInvoiceReceiptAllocation[],
});

describe('supplier invoice matching contract', () => {
  it('accepts AP100 invoice60 as explicit partial coverage without deriving credit40', () => {
    const input = base();
    input.payableLinks[0].coverageMode = 'partial';
    expect(validateSupplierInvoiceMatch(input)).toEqual({ currency: 'VND', grossAmount: 60 });
  });

  it('accepts allocations across scopes when each AP carries its own scope', () => {
    const input = base();
    input.netAmount = 90;
    input.vatAmount = 10;
    input.grossAmount = 100;
    input.payableLinks = [
      { invoiceId: '', payableDocumentId: 'ap-a', allocatedNetAmount: 54, allocatedVatAmount: 6, allocatedGrossAmount: 60, projectId: 'p-a', currency: 'VND' },
      { invoiceId: '', payableDocumentId: 'ap-b', allocatedNetAmount: 36, allocatedVatAmount: 4, allocatedGrossAmount: 40, projectId: 'p-b', currency: 'VND' },
    ];
    input.receiptAllocations = [];
    expect(validateSupplierInvoiceMatch(input).grossAmount).toBe(100);
  });

  it('rejects currency, VAT and receipt allocation mismatches', () => {
    expect(() => validateSupplierInvoiceMatch({ ...base(), currency: 'USD' })).toThrow(/tiền tệ/i);
    expect(() => validateSupplierInvoiceMatch({ ...base(), vatAmount: 5 })).toThrow(/VAT/i);
    const receiptMismatch = base();
    receiptMismatch.receiptAllocations[0].grossAmount = 59;
    expect(() => validateSupplierInvoiceMatch(receiptMismatch)).toThrow(/dòng nhận mua/i);
  });

  it('rejects invalid invoice unit prices and unsafe money precision', () => {
    const invalidPrice = base();
    invalidPrice.receiptAllocations[0].unitPrice = Number.NaN;
    expect(() => validateSupplierInvoiceMatch(invalidPrice)).toThrow(/Đơn giá hóa đơn/i);
    expect(() => validateSupplierInvoiceMatch({ ...base(), netAmount: Number.MAX_SAFE_INTEGER, grossAmount: Number.MAX_SAFE_INTEGER + 6 })).toThrow(/giới hạn chính xác/i);
  });
});
