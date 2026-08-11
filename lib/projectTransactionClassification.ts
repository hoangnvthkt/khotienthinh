import type { ProjectTransaction } from '../types';

const SUPPLIER_PAYMENT_SOURCE_PREFIX = 'supplier_payment_batch:';
const SUPPLIER_PAYABLE_RECOGNITION_SOURCE_PREFIX = 'supplier_payable_document:';

export const isSupplierPaymentLedgerTransaction = (
  transaction: Pick<ProjectTransaction, 'sourceRef'>,
): boolean => String(transaction.sourceRef || '').startsWith(SUPPLIER_PAYMENT_SOURCE_PREFIX);

export const isSupplierPayableRecognitionTransaction = (
  transaction: Pick<ProjectTransaction, 'sourceRef'>,
): boolean => {
  const sourceRef = String(transaction.sourceRef || '');
  return (
    sourceRef.startsWith(SUPPLIER_PAYABLE_RECOGNITION_SOURCE_PREFIX)
      && sourceRef.endsWith(':recognition')
  )
    || sourceRef.startsWith('purchase_receipt:')
    || sourceRef.startsWith('supplier_invoice_adjustment:')
    || sourceRef.startsWith('purchase_receipt_return:');
};

export const isActualCostExpenseTransaction = (
  transaction: Pick<ProjectTransaction, 'type' | 'sourceRef'>,
): boolean => transaction.type === 'expense' && !isSupplierPaymentLedgerTransaction(transaction);

export const isCashOutExpenseTransaction = (
  transaction: Pick<ProjectTransaction, 'type' | 'sourceRef'>,
): boolean => transaction.type === 'expense' && !isSupplierPayableRecognitionTransaction(transaction);
