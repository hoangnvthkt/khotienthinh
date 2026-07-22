import { describe, expect, it } from 'vitest';
import { dateInputToTransactionTimestamp } from '../transactionVoucherDates';

describe('dateInputToTransactionTimestamp', () => {
  it('turns a voucher date into a stable midday UTC transaction timestamp', () => {
    expect(dateInputToTransactionTimestamp('2026-07-22')).toBe('2026-07-22T12:00:00.000Z');
  });

  it('returns undefined when the optional date is not provided', () => {
    expect(dateInputToTransactionTimestamp('')).toBeUndefined();
  });
});
