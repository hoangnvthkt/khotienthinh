import { describe, expect, it } from 'vitest';
import { addCivilDays, civilOf, civilRange, formatCivilRange, fromCivil, inCivilRange, isCivilDate, toCivil } from '../civilDate';

describe('civil dates (yyyy-mm-dd)', () => {
  it('round-trips through local Date without the UTC off-by-one', () => {
    const date = fromCivil('2026-10-07');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 7, 0]);
    expect(toCivil(date)).toBe('2026-10-07');
    expect(toCivil(fromCivil('2026-01-01'))).toBe('2026-01-01');
  });

  it('keeps date-only strings as they are and reads timestamps in Vietnam time', () => {
    expect(civilOf('2026-10-07')).toBe('2026-10-07');
    // 18:30 UTC ngày 6 = 01:30 sáng 7/10 ở Việt Nam.
    expect(civilOf('2026-10-06T18:30:00Z')).toBe('2026-10-07');
    expect(civilOf('2026-10-07T16:59:59Z')).toBe('2026-10-07');
    expect(civilOf('2026-10-07T17:00:00Z')).toBe('2026-10-08');
    expect(civilOf('2026-02-30')).toBeNull();
    expect(civilOf('bad')).toBeNull();
    expect(civilOf(null)).toBeNull();
  });

  it('validates, adds days across months and normalises ranges', () => {
    expect(isCivilDate('2026-02-28')).toBe(true);
    expect(isCivilDate('2026-02-29')).toBe(false);
    expect(addCivilDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addCivilDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(civilRange('2026-10-13', '2026-10-07')).toEqual({ from: '2026-10-07', to: '2026-10-13' });
    expect(civilRange('2026-10-07')).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(inCivilRange('2026-10-13', { from: '2026-10-07', to: '2026-10-13' })).toBe(true);
    expect(inCivilRange('2026-10-14', { from: '2026-10-07', to: '2026-10-13' })).toBe(false);
    expect(inCivilRange(null, { from: '2026-10-07', to: '2026-10-13' })).toBe(false);
  });

  it('formats a day or a range', () => {
    expect(formatCivilRange({ from: '2026-10-07', to: '2026-10-07' })).toBe('07/10/2026');
    expect(formatCivilRange({ from: '2026-10-07', to: '2026-10-13' })).toBe('07/10 – 13/10/2026');
    expect(formatCivilRange({ from: '2026-12-29', to: '2027-01-04' })).toBe('29/12/2026 – 04/01/2027');
  });
});
