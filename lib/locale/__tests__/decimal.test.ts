import { describe, expect, it } from 'vitest';
import {
  formatCurrencyVi,
  formatViDecimal,
  formatViPercent,
  formatViQuantity,
  parseCanonicalDecimal,
  parseViDecimal,
  toCanonicalDecimal,
  type DecimalPolicy,
} from '../decimal';

const quantityPolicy: DecimalPolicy = {
  kind: 'quantity',
  maxFractionDigits: 6,
  min: 0,
  allowNegative: false,
};

describe('Vietnamese decimal contract', () => {
  it.each([
    ['1.234,56', 1234.56, '1234.56'],
    ['0,001', 0.001, '0.001'],
    ['1.234', 1234, '1234'],
    ['1234', 1234, '1234'],
    ['000.001,2500', 1.25, '1.25'],
  ])('parses strict vi text %s', (input, value, canonical) => {
    expect(parseViDecimal(input, quantityPolicy)).toEqual({
      ok: true,
      value,
      canonical,
    });
  });

  it.each(['12.34', '1.23.456', '1..234', '.123']) (
    'rejects malformed thousands grouping: %s',
    input => {
      expect(parseViDecimal(input, quantityPolicy)).toMatchObject({
        ok: false,
        code: 'invalid_grouping',
      });
    },
  );

  it('does not reinterpret an English-formatted value as Vietnamese input', () => {
    expect(parseViDecimal('1,234.56', quantityPolicy)).toMatchObject({
      ok: false,
      code: 'ambiguous',
    });
  });

  it('rejects values beyond the configured quantity scale', () => {
    expect(parseViDecimal('0,1234567', quantityPolicy)).toMatchObject({
      ok: false,
      code: 'too_many_fraction_digits',
    });
  });

  it('enforces empty, finite, range, and negative policies', () => {
    expect(parseViDecimal('  ', quantityPolicy)).toEqual({ ok: false, code: 'empty' });
    expect(parseViDecimal('-1,25', quantityPolicy)).toMatchObject({ ok: false, code: 'out_of_range' });
    expect(parseCanonicalDecimal('Infinity', quantityPolicy)).toMatchObject({ ok: false, code: 'invalid' });
    expect(parseCanonicalDecimal('1e3', quantityPolicy)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('keeps machine payloads canonical and rejects localized punctuation', () => {
    expect(parseCanonicalDecimal('1234.5600', quantityPolicy)).toEqual({
      ok: true,
      value: 1234.56,
      canonical: '1234.56',
    });
    expect(parseCanonicalDecimal('1.234,56', quantityPolicy)).toMatchObject({ ok: false, code: 'invalid' });
    expect(toCanonicalDecimal(0.25, quantityPolicy)).toBe('0.25');
  });

  it('formats quantities and decimals with the same Vietnamese separators', () => {
    expect(formatViDecimal(1234.56, { maximumFractionDigits: 6 })).toBe('1.234,56');
    expect(formatViQuantity('2.375000')).toBe('2,375');
  });

  it('uses the locked VND, foreign-currency, and percent precision profiles', () => {
    expect(formatCurrencyVi(1234.56, 'VND')).toBe('1.235\u00a0₫');
    expect(formatCurrencyVi(1234.56, 'USD')).toBe('1.234,56\u00a0US$');
    expect(formatViPercent(12.5)).toBe('12,5%');
  });
});
