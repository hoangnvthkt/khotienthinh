import { describe, expect, it } from 'vitest';
import { formatLocaleDecimalInput, formatViLiveInput, parseNonNegativeLocaleNumber } from '../localeNumberInput';

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

  it('formats live inputs with dot for thousands and comma for decimal', () => {
    expect(formatViLiveInput('1000')).toBe('1.000');
    expect(formatViLiveInput('35680')).toBe('35.680');
    expect(formatViLiveInput('35680,')).toBe('35.680,');
    expect(formatViLiveInput('35680,5')).toBe('35.680,5');
    expect(formatViLiveInput('32112000')).toBe('32.112.000');
    expect(formatViLiveInput(35680)).toBe('35.680');
  });

  it('normalizes comma-grouped live inputs to Vietnamese thousand dots', () => {
    expect(formatViLiveInput('1,000')).toBe('1.000');
  });

  it('keeps Vietnamese grouped decimal money stable while typing', () => {
    const typed = '2.783.932,347';
    const rendered = [...typed].reduce((value, char) => formatViLiveInput(`${value}${char}`), '');

    expect(rendered).toBe('2.783.932,347');
    expect(parseNonNegativeLocaleNumber(rendered)).toBe(2783932.347);
  });

  it('keeps raw typed Vietnamese decimal money stable while live grouping', () => {
    const typed = '2783932,347';
    const rendered = [...typed].reduce((value, char) => formatViLiveInput(`${value}${char}`), '');

    expect(rendered).toBe('2.783.932,347');
    expect(parseNonNegativeLocaleNumber(rendered)).toBe(2783932.347);
  });

  it('recovers a previously collapsed Vietnamese money input', () => {
    expect(formatViLiveInput('2,783932347')).toBe('2.783.932,347');
    expect(parseNonNegativeLocaleNumber(formatViLiveInput('2,783932347'))).toBe(2783932.347);
  });
});
