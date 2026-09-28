import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../types';
import { computeDailyLogMonthStats } from '../dailyLogMonthStats';

const log = (input: Partial<DailyLog> & { id: string; date: string }): DailyLog => ({
  weather: 'sunny', workerCount: 0, description: '', photos: [], createdBy: 'x', createdAt: input.date,
  verified: false, ...input,
} as DailyLog);

const summary = (id: string, date: string, people: number[], extra: Partial<DailyLog> = {}) => log({
  id, date, summarySourceType: 'member_contributions', normalizedWbs: true,
  laborDetails: people.map(peopleCount => ({ laborType: 'Tổ', count: peopleCount, peopleCount } as any)),
  ...extra,
});

describe('computeDailyLogMonthStats', () => {
  it('counts workers from source-slip summaries instead of the empty legacy head count', () => {
    const stats = computeDailyLogMonthStats([
      summary('a', '2026-09-25', [5]),
      summary('b', '2026-09-27', [4, 6]),
    ], '2026-09');
    expect(stats).toMatchObject({ avgWorkers: 8, workerDays: 2, monthDays: 2 });
  });

  it('uses only the summary on a day that also has engineer logs, so nobody is counted twice', () => {
    const stats = computeDailyLogMonthStats([
      summary('s', '2026-09-25', [10]),
      log({ id: 'e1', date: '2026-09-25', workerCount: 6 }),
      log({ id: 'e2', date: '2026-09-25', workerCount: 4 }),
    ], '2026-09');
    expect(stats.avgWorkers).toBe(10);
  });

  it('reports unknown workers as null, never zero', () => {
    const stats = computeDailyLogMonthStats([summary('a', '2026-09-25', [])], '2026-09');
    expect(stats.avgWorkers).toBeNull();
    expect(stats.workerDays).toBe(0);
  });

  it('counts incident days from summaries, individual logs and sent slips once per day', () => {
    const stats = computeDailyLogMonthStats([
      summary('a', '2026-09-25', [5], { issues: 'Mưa ngập hố móng' }),
      log({ id: 'b', date: '2026-09-25', workerCount: 3, issues: 'Thiếu thép' }),
      summary('c', '2026-09-26', [5]),
    ], '2026-09', ['2026-09-26', '2026-09-26', '2026-08-30']);
    expect(stats.issueDays).toBe(2);
  });

  it('ignores superseded summaries and other months, and counts rainy days per day', () => {
    const stats = computeDailyLogMonthStats([
      summary('old', '2026-09-25', [50], { supersededByDailyLogId: 'new', weather: 'rainy' }),
      summary('new', '2026-09-25', [5], { weather: 'rainy' }),
      log({ id: 'aug', date: '2026-08-31', workerCount: 99, weather: 'storm' }),
    ], '2026-09');
    expect(stats).toMatchObject({ avgWorkers: 5, rainyDays: 1, monthDays: 1, daysWithLogs: 2 });
  });
});
