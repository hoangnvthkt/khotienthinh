import { describe, expect, it } from 'vitest';
import { Transaction, TransactionStatus, TransactionType } from '../../types';
import { canEditTransactionVoucher } from '../transactionVoucherMetadata';

const transaction: Transaction = {
  id: 'tx-1',
  type: TransactionType.IMPORT,
  date: '2026-07-22T12:00:00.000Z',
  items: [],
  requesterId: 'requester-1',
  status: TransactionStatus.PENDING,
};

describe('canEditTransactionVoucher', () => {
  it('allows the requester to edit the creation date and voucher note while pending', () => {
    expect(canEditTransactionVoucher(transaction, 'requester-1', false)).toBe(true);
  });

  it('allows the warehouse approver to edit a pending voucher', () => {
    expect(canEditTransactionVoucher(transaction, 'warehouse-1', true)).toBe(true);
  });

  it('keeps approved vouchers immutable', () => {
    expect(canEditTransactionVoucher({ ...transaction, status: TransactionStatus.COMPLETED }, 'requester-1', true)).toBe(false);
  });
});
