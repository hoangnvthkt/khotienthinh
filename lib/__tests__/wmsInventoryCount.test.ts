import { describe, expect, it } from 'vitest';
import { deriveInventoryCountVariance } from '../wmsInventoryCount';

describe('deriveInventoryCountVariance', () => {
  it('includes movements posted after the count snapshot', () => {
    expect(deriveInventoryCountVariance({ snapshotQty: '100', movementQty: '-10', countedQty: '88' })).toEqual({
      expectedQtyAtPost: '90',
      varianceQty: '-2',
    });
  });
});
