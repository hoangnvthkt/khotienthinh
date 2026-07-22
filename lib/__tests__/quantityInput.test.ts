import { describe, expect, it } from 'vitest';
import { formatQuantityInput, parseQuantityInput, sanitizeQuantityInput } from '../quantityInput';

describe('quantity input', () => {
  it('keeps a comma while entering a decimal quantity and parses it correctly', () => {
    expect(sanitizeQuantityInput('12,5')).toBe('12,5');
    expect(parseQuantityInput('12,5')).toBe(12.5);
    expect(formatQuantityInput(12.5)).toBe('12,5');
  });

  it('accepts an ungrouped thousands value', () => {
    expect(sanitizeQuantityInput('1250')).toBe('1250');
    expect(parseQuantityInput('1250')).toBe(1250);
  });

  it('rejects a dot decimal separator and grouping characters', () => {
    expect(sanitizeQuantityInput('12.5', { previousValue: '12,' })).toBe('12,');
    expect(sanitizeQuantityInput('1.250', { previousValue: '1250' })).toBe('1250');
  });
});
