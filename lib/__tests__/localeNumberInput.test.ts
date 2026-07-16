import { describe, expect, it } from 'vitest';
import { formatLocaleDecimalInput, parseNonNegativeLocaleNumber } from '../localeNumberInput';

describe('locale number input', () => {
  it('parses a Vietnamese decimal separator before saving', () => {
    expect(parseNonNegativeLocaleNumber('420,04')).toBe(420.04);
  });

  it('formats persisted numbers with the Vietnamese decimal separator for editing', () => {
    expect(formatLocaleDecimalInput(420.04)).toBe('420,04');
  });
});
