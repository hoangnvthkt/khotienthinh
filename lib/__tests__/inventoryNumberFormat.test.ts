import { describe, expect, it } from 'vitest';
import { formatInventoryQuantity } from '../inventoryNumberFormat';

describe('inventory number format', () => {
  it('uses Vietnamese separators for stock quantities', () => {
    expect(formatInventoryQuantity(28200)).toBe('28.200');
    expect(formatInventoryQuantity(27300.5)).toBe('27.300,5');
  });
});
