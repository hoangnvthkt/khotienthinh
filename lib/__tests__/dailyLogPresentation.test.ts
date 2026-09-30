import { describe, expect, it } from 'vitest';
import {
  formatDailyLogDate,
  formatDailyLogTime,
  formatDailyLogQuantity,
  summarizeDailyLogPhysicalRows,
  splitDailyLogDaysByCutover,
} from '../dailyLogPresentation';

describe('Daily Log document presentation', () => {
  it('formats_unknown_separately_from_zero', () => {
    expect(formatDailyLogQuantity(null, 'm³')).toBe('Chưa xác định');
    expect(formatDailyLogQuantity(undefined, 'm³')).toBe('Chưa xác định');
    expect(formatDailyLogQuantity(0, 'm³')).toBe('0 m³');
  });

  it('never displays non-finite values as a measured quantity', () => {
    expect(formatDailyLogQuantity(Number.NaN, 'm³')).toBe('Chưa xác định');
    expect(formatDailyLogQuantity(Infinity)).toBe('Chưa xác định');
  });

  it('formats physical decimals without guessing an absent unit', () => {
    expect(formatDailyLogQuantity(12.5, 'm³')).toBe('12,5 m³');
    expect(formatDailyLogQuantity(30, null)).toBe('30');
  });

  it('formats_vietnam_date_and_time', () => {
    expect(formatDailyLogDate('2026-09-25')).toBe('25/09/2026');
    expect(formatDailyLogTime('2026-09-25T06:39:00Z')).toBe('13:39');
    expect(formatDailyLogDate('2026-09-24T18:39:00Z')).toBe('25/09/2026');
  });

  it.each(['', 'not-a-date', '2026-02-30', '2026-13-01'])('rejects invalid dates: %s', value => {
    expect(formatDailyLogDate(value)).toBe('Chưa xác định');
  });

  it('does not reinterpret a date-only value or timezone-less time as an action timestamp', () => {
    expect(formatDailyLogTime('2026-09-25')).toBe('Chưa xác định');
    expect(formatDailyLogTime('2026-09-25T06:39:00')).toBe('Chưa xác định');
    expect(formatDailyLogTime('not-a-date')).toBe('Chưa xác định');
  });

  it.each(['2026-09-25T24:00:00Z', '2026-09-25T23:60:00Z', '2026-09-25T12:00:60Z'])('rejects invalid clock values rather than normalizing them: %s', value => {
    expect(formatDailyLogDate(value)).toBe('Chưa xác định');
    expect(formatDailyLogTime(value)).toBe('Chưa xác định');
  });

  it('totals_hours_without_claiming_unique_headcount', () => {
    const rows = {
      workItems: [{ taskId: 'concrete' }, { taskId: 'concrete' }, { taskId: 'rebar' }],
      labor: [{ peopleCount: 5, totalLaborHours: 20 }, { peopleCount: 5, totalLaborHours: 20 }],
      machines: [{ machineCount: 2, totalMachineHours: 12 }],
    };
    expect(summarizeDailyLogPhysicalRows(rows)).toEqual({
      uniqueWbsCount: 2, laborPersonEntries: 10, totalLaborHours: 40,
      machineEntries: 2, totalMachineHours: 12,
    });
    expect(rows.labor[0]).toEqual({ peopleCount: 5, totalLaborHours: 20 });
  });

  it('accepts decimal values serialized by the Cloud without string concatenation', () => {
    expect(summarizeDailyLogPhysicalRows({
      workItems: [], labor: [{ peopleCount: '5', totalLaborHours: '12.5' }, { peopleCount: '2', totalLaborHours: '3.5' }],
      machines: [],
    })).toMatchObject({ laborPersonEntries: 7, totalLaborHours: 16 });
  });

  it('shows zero for known empty collections', () => {
    expect(summarizeDailyLogPhysicalRows({ workItems: [], labor: [], machines: [] })).toEqual({
      uniqueWbsCount: 0, laborPersonEntries: 0, totalLaborHours: 0, machineEntries: 0, totalMachineHours: 0,
    });
  });

  it('keeps only the missing physical metric unknown', () => {
    expect(summarizeDailyLogPhysicalRows({
      workItems: [{ taskId: 'concrete' }],
      labor: [{ peopleCount: 5, totalLaborHours: 40 }, { peopleCount: 2, totalLaborHours: null }],
      machines: [{ machineCount: null, totalMachineHours: 12 }],
    })).toMatchObject({ laborPersonEntries: 7, totalLaborHours: null, machineEntries: null, totalMachineHours: 12 });
  });

  it('does not infer physical semantics from legacy count, hours, or shifts', () => {
    const legacyLabor = [{ count: 5, hours: 8 }];
    const legacyMachines = [{ shifts: 2, hours: 12 }];
    expect(summarizeDailyLogPhysicalRows({ workItems: [], labor: legacyLabor, machines: legacyMachines })).toEqual({
      uniqueWbsCount: 0, laborPersonEntries: null, totalLaborHours: null, machineEntries: null, totalMachineHours: null,
    });
  });

  it.each([Number.NaN, -1, '', 'invalid', Infinity])('keeps invalid totals unknown: %s', value => {
    expect(summarizeDailyLogPhysicalRows({ workItems: [], labor: [{ peopleCount: value, totalLaborHours: 8 }], machines: [] }))
      .toMatchObject({ laborPersonEntries: null, totalLaborHours: 8 });
  });
});

describe('history split at the workflow cutover', () => {
  const rows = [
    { date: '2026-10-02', officialStatus: 'draft' },
    { date: '2026-10-01', officialStatus: null },
    { date: '2026-09-30', officialStatus: 'submitted' },
    { date: '2026-09-29', officialStatus: 'verified' },
  ];
  it('keeps every day in one list for a project not on the slip workflow', () => {
    expect(splitDailyLogDaysByCutover(rows, null)).toEqual({ current: rows, legacy: [], legacyPendingApproval: 0 });
  });
  it('lists the cutover day with the new workflow and counts old days still awaiting approval', () => {
    const split = splitDailyLogDaysByCutover(rows, '2026-10-01');
    expect(split.current.map(row => row.date)).toEqual(['2026-10-02', '2026-10-01']);
    expect(split.legacy.map(row => row.date)).toEqual(['2026-09-30', '2026-09-29']);
    expect(split.legacyPendingApproval).toBe(1);
  });
});
