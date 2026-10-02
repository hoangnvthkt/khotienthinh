import { describe, expect, it } from 'vitest';
import { formatMinutes } from '../timesheetService';

describe('timesheet minutes', () => {
  it('shows minutes the way payroll reads them', () => {
    expect(formatMinutes(0)).toBe('0');
    expect(formatMinutes(30)).toBe('30p');
    expect(formatMinutes(60)).toBe('1g');
    expect(formatMinutes(90)).toBe('1g30');
    expect(formatMinutes(605)).toBe('10g05');
  });
});
