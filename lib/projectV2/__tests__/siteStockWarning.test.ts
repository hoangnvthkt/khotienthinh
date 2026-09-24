import { describe, expect, it } from 'vitest';
import { evaluateSiteStockWarning } from '../siteStockWarning';

describe('site warehouse availability warning', () => {
  it('warns only above the current available stock, regardless of BOQ remaining', () => {
    expect(evaluateSiteStockWarning('100', '100')).toEqual({ state: 'within_stock', shortage: null });
    expect(evaluateSiteStockWarning('101', '100')).toEqual({ state: 'over_stock', shortage: '1' });
    expect(evaluateSiteStockWarning('100', '100')).toEqual({ state: 'within_stock', shortage: null });
  });

  it('keeps an unknown stock balance unknown instead of treating it as zero', () => {
    expect(evaluateSiteStockWarning('101', null)).toEqual({ state: 'unknown', shortage: null });
  });

  it('compares six-decimal quantities exactly', () => {
    expect(evaluateSiteStockWarning('100.000001', '100')).toEqual({ state: 'over_stock', shortage: '0.000001' });
    expect(evaluateSiteStockWarning('99.999999', '100')).toEqual({ state: 'within_stock', shortage: null });
  });

  it('does not warn on an incomplete quantity entry', () => {
    expect(evaluateSiteStockWarning('', '100')).toEqual({ state: 'invalid_input', shortage: null });
    expect(evaluateSiteStockWarning('abc', '100')).toEqual({ state: 'invalid_input', shortage: null });
  });

  it('reads Vietnamese grouped and decimal input without changing the threshold', () => {
    expect(evaluateSiteStockWarning('1.000', '999')).toEqual({ state: 'over_stock', shortage: '1' });
    expect(evaluateSiteStockWarning('100,000001', '100')).toEqual({ state: 'over_stock', shortage: '0.000001' });
    expect(evaluateSiteStockWarning('1.000,5', '1000.5')).toEqual({ state: 'within_stock', shortage: null });
  });
});
