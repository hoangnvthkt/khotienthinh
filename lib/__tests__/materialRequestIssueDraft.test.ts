import { describe, expect, it } from 'vitest';
import { getMaterialIssueDraftQty } from '../materialRequestIssueDraft';

describe('getMaterialIssueDraftQty', () => {
  it('uses the warehouse on-hand quantity for stock issues', () => {
    expect(getMaterialIssueDraftQty('stock', 100, 60)).toBe(60);
    expect(getMaterialIssueDraftQty('stock', 100, 140)).toBe(140);
  });

  it('uses the remaining requirement for non-stock sources', () => {
    expect(getMaterialIssueDraftQty('po_receipt', 100, 60)).toBe(100);
    expect(getMaterialIssueDraftQty('mixed', 40, 75)).toBe(40);
  });

  it('never creates a negative draft quantity', () => {
    expect(getMaterialIssueDraftQty('stock', 20, -5)).toBe(0);
  });
});
