import { describe, expect, it } from 'vitest';
import type { DailyLog, ProjectTask } from '../../types';
import { buildExecutiveScheduleSummary } from '../projectExecutiveScheduleService';

const task = (patch: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 'task-1',
  name: 'Hạng mục kiểm thử',
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  duration: 9,
  progress: 0,
  isMilestone: false,
  order: 1,
  ...patch,
});

const verifiedLog = (patch: Partial<DailyLog> = {}): DailyLog => ({
  id: 'log-1',
  date: '2026-01-03',
  title: 'Nhật ký kiểm thử',
  status: 'verified',
  verified: true,
  volumes: [],
  laborDetails: [],
  machines: [],
  delayTasks: [],
  ...patch,
} as DailyLog);

describe('buildExecutiveScheduleSummary', () => {
  it('builds an on-track project summary with calendar and verified daily-log days', () => {
    const result = buildExecutiveScheduleSummary({
      todayIso: '2026-01-05',
      tasks: [task({ progress: 50 })],
      dailyLogs: [
        verifiedLog({ id: 'log-1', date: '2026-01-03', volumes: [{ taskId: 'task-1', quantity: 1 }] } as any),
        verifiedLog({ id: 'log-2', date: '2026-01-05', volumes: [{ taskId: 'task-1', quantity: 1 }] } as any),
      ],
    });

    expect(result.projectDurationDays).toBe(10);
    expect(result.calendarElapsedDays).toBe(5);
    expect(result.verifiedLogDays).toBe(2);
    expect(result.actualProgress).toBe(50);
    expect(result.activeRows).toHaveLength(1);
    expect(result.lateRows).toHaveLength(0);
  });

  it('flags late tasks when actual progress is behind the planned curve', () => {
    const result = buildExecutiveScheduleSummary({
      todayIso: '2026-01-09',
      tasks: [task({ progress: 20 })],
    });

    expect(result.progressVariance).toBeLessThan(0);
    expect(result.lateRows[0]?.taskId).toBe('task-1');
  });

  it('keeps ahead completed tasks in the completed list with negative day delta', () => {
    const result = buildExecutiveScheduleSummary({
      todayIso: '2026-01-10',
      tasks: [
        task({
          progress: 100,
          actualStartDate: '2026-01-01',
          actualEndDate: '2026-01-08',
        }),
      ],
    });

    expect(result.completedRows).toHaveLength(1);
    expect(result.completedRows[0].dayDelta).toBe(-2);
    expect(result.forecastDeltaDays).toBeLessThan(0);
  });

  it('returns an empty summary for projects without tasks', () => {
    const result = buildExecutiveScheduleSummary({
      todayIso: '2026-01-10',
      tasks: [],
    });

    expect(result.projectDurationDays).toBe(0);
    expect(result.calendarElapsedDays).toBe(0);
    expect(result.rows).toHaveLength(0);
    expect(result.actualProgress).toBe(0);
  });
});
