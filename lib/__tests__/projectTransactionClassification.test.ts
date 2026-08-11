import { describe, expect, it } from 'vitest';
import type { ProjectTransaction } from '../../types';
import {
  isActualCostExpenseTransaction,
  isCashOutExpenseTransaction,
  isSupplierPayableRecognitionTransaction,
  isSupplierPaymentLedgerTransaction,
} from '../projectTransactionClassification';

const transaction = (patch: Partial<ProjectTransaction>): ProjectTransaction => ({
  id: 'tx-1',
  projectFinanceId: 'finance-1',
  constructionSiteId: 'site-1',
  type: 'expense',
  category: 'materials',
  amount: 1_000,
  description: 'Giao dịch',
  date: '2026-08-08',
  source: 'workflow',
  attachments: [],
  createdBy: 'user-1',
  createdAt: '2026-08-08T00:00:00.000Z',
  ...patch,
});

describe('project transaction classification', () => {
  it('keeps supplier PAY and reversal rows in the ledger but excludes both from actual cost', () => {
    const payment = transaction({ sourceRef: 'supplier_payment_batch:batch-1' });
    const reversal = transaction({
      sourceRef: 'supplier_payment_batch:batch-1:reversal',
      amount: -1_000,
    });

    expect(isSupplierPaymentLedgerTransaction(payment)).toBe(true);
    expect(isSupplierPaymentLedgerTransaction(reversal)).toBe(true);
    expect(isActualCostExpenseTransaction(payment)).toBe(false);
    expect(isActualCostExpenseTransaction(reversal)).toBe(false);
    expect(isCashOutExpenseTransaction(payment)).toBe(true);
    expect(isCashOutExpenseTransaction(reversal)).toBe(true);
  });

  it('counts AP recognition as actual cost without treating it as cash out', () => {
    const recognition = transaction({ sourceRef: 'supplier_payable_document:document-1:recognition' });
    const receiptRecognition = transaction({ sourceRef: 'purchase_receipt:delivery-batch-1' });
    const invoiceAdjustment = transaction({ sourceRef: 'supplier_invoice_adjustment:invoice-1', amount: 50 });
    const receiptReturn = transaction({ sourceRef: 'purchase_receipt_return:return-1', amount: -100 });

    expect(isSupplierPayableRecognitionTransaction(recognition)).toBe(true);
    expect(isSupplierPayableRecognitionTransaction(receiptRecognition)).toBe(true);
    expect(isSupplierPayableRecognitionTransaction(invoiceAdjustment)).toBe(true);
    expect(isSupplierPayableRecognitionTransaction(receiptReturn)).toBe(true);
    expect(isActualCostExpenseTransaction(recognition)).toBe(true);
    expect(isActualCostExpenseTransaction(receiptRecognition)).toBe(true);
    expect(isCashOutExpenseTransaction(recognition)).toBe(false);
    expect(isCashOutExpenseTransaction(receiptRecognition)).toBe(false);
    expect(isCashOutExpenseTransaction(invoiceAdjustment)).toBe(false);
    expect(isCashOutExpenseTransaction(receiptReturn)).toBe(false);
  });

  it('counts ordinary expense rows as both actual cost and cash out, and rejects revenue rows', () => {
    const ordinaryExpense = transaction({ sourceRef: 'manual-expense:1' });
    expect(isActualCostExpenseTransaction(ordinaryExpense)).toBe(true);
    expect(isCashOutExpenseTransaction(ordinaryExpense)).toBe(true);
    expect(isActualCostExpenseTransaction(transaction({ type: 'revenue_received', category: 'other' }))).toBe(false);
    expect(isCashOutExpenseTransaction(transaction({ type: 'revenue_received', category: 'other' }))).toBe(false);
  });
});
