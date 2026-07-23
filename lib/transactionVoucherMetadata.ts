import { Transaction, TransactionStatus } from '../types';

/** Pending vouchers can be corrected by their creator or the approving keeper. */
export const canEditTransactionVoucher = (
  transaction: Transaction,
  userId: string,
  canApprove: boolean,
): boolean =>
  transaction.status === TransactionStatus.PENDING
  && (transaction.requesterId === userId || canApprove);
