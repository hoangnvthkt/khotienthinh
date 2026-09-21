import { describe, expect, it } from 'vitest';
import { classifyInventoryReconciliation } from '../wmsInventoryReconciliation';

describe('classifyInventoryReconciliation', () => {
  it('marks a matching cache and ledger pair authoritative', () => {
    expect(classifyInventoryReconciliation({ cacheQty: '12.5', ledgerQty: '12.5' })).toEqual({
      classification: 'matched',
      difference: '0',
      authoritative: true,
    });
  });

  it('does not hide cache-missing or negative quantities as zero', () => {
    expect(classifyInventoryReconciliation({ cacheQty: null, ledgerQty: '12.5' })).toEqual({
      classification: 'cache_missing',
      difference: null,
      authoritative: false,
    });
    expect(classifyInventoryReconciliation({ cacheQty: '-1', ledgerQty: '-1' })).toEqual(expect.objectContaining({
      classification: 'negative_quantity',
      authoritative: false,
    }));
  });
});
