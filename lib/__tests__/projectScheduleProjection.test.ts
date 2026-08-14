import { describe, expect, it } from 'vitest';
import type { ProjectTask } from '../../types';
import { buildProjectScheduleProjection } from '../projectScheduleProjection';

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

describe('buildProjectScheduleProjection', () => {
  it('converts SPI into projected duration and day variance', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-03-27',
      tasks: [task({
        startDate: '2026-01-01',
        endDate: '2026-07-10',
        duration: 190,
        progress: 43,
      })],
    });

    expect(result.baselineDurationDays).toBe(191);
    expect(result.plannedProgressPercent).toBe(45);
    expect(result.actualProgressPercent).toBe(43);
    expect(result.spi).toBeCloseTo(0.956, 3);
    expect(result.spiDurationDays).toBe(200);
    expect(result.spiDeltaDays).toBe(9);
  });

  it('does not calculate SPI before the project has planned progress', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-01-10',
      tasks: [task({
        startDate: '2026-02-01',
        endDate: '2026-02-10',
        duration: 9,
        progress: 0,
      })],
    });

    expect(result.plannedProgressPercent).toBe(0);
    expect(result.spi).toBeNull();
    expect(result.spiDurationDays).toBeNull();
    expect(result.spiStatus).toBe('insufficient_data');
  });

  it('keeps zero actual progress from causing a divide-by-zero forecast', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-01-20',
      tasks: [task({
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        duration: 9,
        progress: 0,
      })],
    });

    expect(result.plannedProgressPercent).toBe(100);
    expect(result.actualProgressPercent).toBe(0);
    expect(result.spi).toBe(0);
    expect(result.spiDurationDays).toBeNull();
    expect(result.forecastDeltaDays).toBeGreaterThan(0);
  });

  it('uses actual end date for completed tasks', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-01-12',
      tasks: [task({
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        duration: 9,
        progress: 100,
        actualStartDate: '2026-01-01',
        actualEndDate: '2026-01-08',
      })],
    });

    const projection = result.taskProjections.get('task-1');
    expect(projection?.forecastEnd).toBe('2026-01-08');
    expect(projection?.dayDelta).toBe(-2);
    expect(projection?.varianceKind).toBe('completed');
    expect(projection?.varianceLabel).toBe('Nhanh 2 ngày');
  });

  it('does not turn a completed task with no actual end into a delay against the cutoff date', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-08-14',
      tasks: [task({
        startDate: '2026-04-11',
        endDate: '2026-04-11',
        duration: 0,
        progress: 100,
      })],
      dailyLogs: [{
        id: 'log-after-completion-unknown',
        date: '2026-08-10',
        status: 'verified',
        verified: true,
        volumes: [{ taskId: 'task-1', quantity: 1 }],
      } as any],
    });

    const projection = result.taskProjections.get('task-1');
    expect(projection?.actualEnd).toBeUndefined();
    expect(projection?.forecastEnd).toBe('2026-04-11');
    expect(projection?.dayDelta).toBeNull();
    expect(projection?.varianceKind).toBe('missing_actual_end');
    expect(projection?.varianceLabel).toBe('Thiếu ngày KT thực tế');
  });

  it('marks a zero-progress task before its planned start as not due', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2025-12-29',
      tasks: [task({ progress: 0 })],
    });

    const projection = result.taskProjections.get('task-1');
    expect(projection?.dayDelta).toBe(0);
    expect(projection?.varianceKind).toBe('not_due');
    expect(projection?.varianceLabel).toBe('Chưa đến hạn');
  });

  it('measures a zero-progress task from planned start until planned end', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-01-05',
      tasks: [task({ progress: 0 })],
    });

    const projection = result.taskProjections.get('task-1');
    expect(projection?.dayDelta).toBe(4);
    expect(projection?.varianceKind).toBe('late_start');
    expect(projection?.varianceLabel).toBe('Chậm bắt đầu 4 ngày');
  });

  it('measures overdue days from planned end when a task still has zero progress', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-01-15',
      tasks: [task({ progress: 0 })],
    });

    const projection = result.taskProjections.get('task-1');
    expect(projection?.dayDelta).toBe(5);
    expect(projection?.varianceKind).toBe('overdue_not_started');
    expect(projection?.varianceLabel).toBe('Quá hạn 5 ngày – chưa bắt đầu');
  });

  it('treats a task with an actual start as in progress even while its percent is still zero', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-01-05',
      tasks: [task({ progress: 0, actualStartDate: '2026-01-03' })],
    });

    expect(result.taskProjections.get('task-1')).toMatchObject({
      plannedEquivalentDate: '2026-01-01',
      dayDelta: 4,
      varianceKind: 'in_progress',
      varianceLabel: 'Chậm 4 ngày',
    });
  });

  it('measures an in-progress task against the plan-equivalent date for its actual percent', () => {
    const lateResult = buildProjectScheduleProjection({
      todayIso: '2026-01-05',
      tasks: [task({ endDate: '2026-01-11', duration: 10, progress: 20 })],
    });
    const aheadResult = buildProjectScheduleProjection({
      todayIso: '2026-01-05',
      tasks: [task({ endDate: '2026-01-11', duration: 10, progress: 70 })],
    });

    expect(lateResult.taskProjections.get('task-1')).toMatchObject({
      plannedEquivalentDate: '2026-01-03',
      dayDelta: 2,
      varianceKind: 'in_progress',
      varianceLabel: 'Chậm 2 ngày',
    });
    expect(aheadResult.taskProjections.get('task-1')).toMatchObject({
      plannedEquivalentDate: '2026-01-08',
      dayDelta: -3,
      varianceKind: 'in_progress',
      varianceLabel: 'Nhanh 3 ngày',
    });
  });

  it('projects remaining days from actual velocity for in-progress tasks', () => {
    const result = buildProjectScheduleProjection({
      todayIso: '2026-01-10',
      tasks: [task({
        startDate: '2026-01-01',
        endDate: '2026-01-30',
        duration: 29,
        progress: 50,
        actualStartDate: '2026-01-01',
      })],
    });

    const projection = result.taskProjections.get('task-1');
    expect(projection?.remainingDays).toBe(10);
    expect(projection?.forecastEnd).toBe('2026-01-20');
  });
});
