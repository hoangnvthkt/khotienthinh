import { describe, expect, it } from 'vitest';
import { closedLabel, dayBefore, daysBetween, periodLabel, stageOf } from '../siteAssignment';

describe('site assignment stages', () => {
  const today = '2026-10-03';
  it('puts pending, future, running and finished records in their step', () => {
    expect(stageOf({ status: 'pending', startDate: '2026-10-10', endDate: null }, today)).toBe('pending');
    expect(stageOf({ status: 'approved', startDate: '2026-10-07', endDate: null }, today)).toBe('upcoming');
    expect(stageOf({ status: 'approved', startDate: '2026-10-03', endDate: '2026-10-03' }, today)).toBe('active');
    expect(stageOf({ status: 'approved', startDate: '2026-09-15', endDate: '2026-10-02' }, today)).toBe('closed');
    expect(stageOf({ status: 'cancelled', startDate: '2026-10-07', endDate: null }, today)).toBe('closed');
  });

  it('names why a record closed', () => {
    expect(closedLabel({ status: 'rejected', endedEarlyReason: null })).toBe('Từ chối');
    expect(closedLabel({ status: 'approved', endedEarlyReason: 'Xong sớm' })).toBe('Kết thúc sớm');
    expect(closedLabel({ status: 'approved', endedEarlyReason: null })).toBe('Hết hạn');
  });

  it('formats periods and counts days', () => {
    expect(periodLabel({ startDate: '2026-10-06', endDate: null })).toBe('06/10/2026 → không thời hạn');
    expect(daysBetween('2026-10-03', '2026-10-06')).toBe(3);
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
  });
});
