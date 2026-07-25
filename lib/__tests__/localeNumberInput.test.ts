import { describe, expect, it } from 'vitest';
import { formatLocaleDecimalInput, parseNonNegativeLocaleNumber } from '../localeNumberInput';

describe('locale number input', () => {
  it('parses a Vietnamese decimal separator before saving', () => {
    expect(parseNonNegativeLocaleNumber('420,04')).toBe(420.04);
  });

  it('parses Vietnamese grouped numbers from text inputs and Excel text cells', () => {
    expect(parseNonNegativeLocaleNumber('1.500')).toBe(1500);
    expect(parseNonNegativeLocaleNumber('1.500,75')).toBe(1500.75);
    expect(parseNonNegativeLocaleNumber('1 500,75')).toBe(1500.75);
  });

  it('keeps a single comma as the Vietnamese decimal separator', () => {
    expect(parseNonNegativeLocaleNumber('28,200')).toBe(28.2);
  });

  it('formats persisted numbers with the Vietnamese decimal separator for editing', () => {
    expect(formatLocaleDecimalInput(420.04)).toBe('420,04');
  });
});
