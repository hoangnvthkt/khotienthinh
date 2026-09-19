import { describe, expect, it } from 'vitest';
import { openCommitment } from '../companyProcurementCommitment';

describe('openCommitment', () => {
  it('derives the unreceived quantity from an attributed receipt', () => {
    expect(openCommitment({ ordered: 80, receivedAttributed: 30, terminal: false })).toBe(50);
    expect(Math.max(0, 100 - 30 - 50)).toBe(20);
  });

  it('releases terminal commitments and preserves unknown attribution', () => {
    expect(openCommitment({ ordered: 80, receivedAttributed: 30, terminal: true })).toBe(0);
    expect(openCommitment({ ordered: 80, receivedAttributed: null, terminal: false })).toBeNull();
  });

  it.each([
    { ordered: -1, receivedAttributed: 0 },
    { ordered: Number.NaN, receivedAttributed: 0 },
    { ordered: 1, receivedAttributed: -1 },
    { ordered: 1, receivedAttributed: Number.POSITIVE_INFINITY },
  ])('rejects malformed legacy boundary quantities: %o', input => {
    expect(() => openCommitment({ ...input, terminal: false })).toThrow('Invalid commitment quantity');
  });
});
