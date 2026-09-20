import { describe, expect, it } from 'vitest';
import { calculateDemandBalance } from '../procurement/balance';

describe('procurement demand balance', () => {
  it('returns zero availability after the approved quantity is fully fulfilled', () => {
    expect(calculateDemandBalance({
      approved: '100', fulfilled: '100', closed: '0', reserved: '0', committed: '0',
    })).toEqual({
      openNeed: '0', availableToPlan: '0', coverageExcess: '0', receivedExcess: '0',
    });
  });

  it('keeps an unapproved demand unknown rather than converting it to zero', () => {
    expect(calculateDemandBalance({
      approved: null, fulfilled: '0', closed: '0', reserved: '0', committed: '0',
    })).toEqual({
      openNeed: null, availableToPlan: null, coverageExcess: null, receivedExcess: null,
    });
  });

  it('subtracts fulfilled, closure, reservation and commitment exactly once', () => {
    expect(calculateDemandBalance({
      approved: '150', fulfilled: '30', closed: '10', reserved: '20', committed: '40',
    })).toEqual({
      openNeed: '110', availableToPlan: '50', coverageExcess: '0', receivedExcess: '0',
    });
  });
});
