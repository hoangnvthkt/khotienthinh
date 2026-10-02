import type { LeaveBalance } from '../types';

// Annual days still available (G2b): accrued + carried − expired carry − used paid days.
export const leaveBalanceAvailable = (balance: Pick<LeaveBalance, 'accruedDays' | 'usedPaidDays'> & Partial<Pick<LeaveBalance, 'carriedDays' | 'carryExpiredDays'>>): number =>
  (Number(balance.accruedDays) || 0) + (Number(balance.carriedDays) || 0)
  - (Number(balance.carryExpiredDays) || 0) - (Number(balance.usedPaidDays) || 0);
