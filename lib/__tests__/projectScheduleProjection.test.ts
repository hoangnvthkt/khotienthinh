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

