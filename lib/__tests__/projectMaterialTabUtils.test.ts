import { describe, expect, it } from 'vitest';
import { formatVietnameseMoney, importNumber, parseVietnameseMoney, parseVietnameseNumber } from '../projectMaterialTabUtils';

describe('projectMaterialTabUtils Vietnamese number parsing', () => {
  it('parses dot thousands and comma decimals', () => {
    expect(parseVietnameseNumber('14,000')).toBe(14);
    expect(parseVietnameseNumber('343.000,00')).toBe(343000);
    expect(parseVietnameseNumber('4.802.000')).toBe(4802000);
    expect(parseVietnameseNumber('1.000,000')).toBe(1000);
    expect(parseVietnameseNumber('0,5')).toBe(0.5);
  });

  it('treats dots as thousands separators for BOQ imports', () => {
    expect(importNumber('8.914')).toBe(8914);
    expect(importNumber('8,914')).toBe(8.914);
  });

  it('parses unit prices and money values with comma thousands from Excel formatting', () => {
    expect(parseVietnameseNumber('343,000')).toBe(343);
    expect(parseVietnameseMoney('343,000')).toBe(343000);
    expect(parseVietnameseMoney('343.000,00')).toBe(343000);
    expect(formatVietnameseMoney(343000)).toBe('343.000,00');
  });
});
