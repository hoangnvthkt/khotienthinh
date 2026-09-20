import { describe, expect, it } from 'vitest';
import { formatDecimal6, parseQuantity6, sumQuantitiesInUnit } from '../procurement/decimal';

describe('procurement decimal contract', () => {
  it('preserves six-decimal quantities without floating point arithmetic', () => {
    expect(formatDecimal6(parseQuantity6('98.500001'))).toBe('98.500001');
    expect(sumQuantitiesInUnit([
      { quantity: '0.1', unit: 'kg' },
      { quantity: '0.2', unit: 'kg' },
    ], 'kg')).toBe('0.3');
  });

  it('rejects negative, excessive precision, malformed, and mixed-unit quantities', () => {
    expect(() => parseQuantity6('-1')).toThrow('INVALID_QUANTITY');
    expect(() => parseQuantity6('1.0000001')).toThrow('INVALID_QUANTITY');
    expect(() => parseQuantity6('1\n')).toThrow('INVALID_QUANTITY');
    expect(() => sumQuantitiesInUnit([{ quantity: '1', unit: 'bao' }], 'kg')).toThrow('INVALID_UNIT');
  });
});
