import { describe, expect, it } from 'vitest';
import { formatProcurementQuantity, presentDemandBalance, summarizeProcurementSelection } from '../procurement/presentation';

describe('procurement demand presentation', () => {
  it('formats exact database decimals for Vietnamese users without trailing storage precision', () => {
    expect(formatProcurementQuantity('1234567.500000')).toBe('1.234.567,5');
    expect(formatProcurementQuantity('0.000000')).toBe('0');
    expect(formatProcurementQuantity(null)).toBe('Chưa xác định');
  });

  it('explains A100 F30 M50 as open70 and available20', () => {
    expect(presentDemandBalance({
      approved: '100', fulfilled: '30', closed: '0', reserved: '0', committed: '50', unit: 'kg',
    })).toEqual({
      approved: '100 kg', fulfilled: '30 kg', closed: '0 kg', reserved: '0 kg',
      committed: '50 kg', openNeed: '70 kg', availableToPlan: '20 kg', known: true,
    });
  });

  it('keeps unknown approval distinct from zero', () => {
    const result = presentDemandBalance({
      approved: null, fulfilled: '0', closed: '0', reserved: '0', committed: '0', unit: 'kg',
    });
    expect(result.known).toBe(false);
    expect(result.availableToPlan).toBe('Chưa xác định');
  });

  it('summarizes mixed units as lines and units without a fake grand quantity', () => {
    expect(summarizeProcurementSelection([
      { quantity: '10', unit: 'cây' }, { quantity: '20', unit: 'kg' },
    ])).toBe('2 dòng · 2 đơn vị');
    expect(summarizeProcurementSelection([
      { quantity: '10', unit: 'kg' }, { quantity: '20', unit: 'kg' },
    ])).toBe('30 kg · 2 dòng');
  });
});
