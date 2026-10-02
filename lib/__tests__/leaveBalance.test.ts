import { describe, expect, it } from 'vitest';
import { leaveBalanceAvailable } from '../leaveBalance';

describe('leaveBalanceAvailable', () => {
  it('counts carried days until they expire', () => {
    expect(leaveBalanceAvailable({ accruedDays: 5, usedPaidDays: 2, carriedDays: 3, carryExpiredDays: 0 })).toBe(6);
    expect(leaveBalanceAvailable({ accruedDays: 5, usedPaidDays: 1, carriedDays: 3, carryExpiredDays: 3 })).toBe(4);
  });

  it('works for balances saved before carried days existed', () => {
    expect(leaveBalanceAvailable({ accruedDays: 10, usedPaidDays: 0.5 })).toBe(9.5);
  });
});
