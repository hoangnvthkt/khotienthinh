import { describe, expect, it } from 'vitest';
import type { ProjectDailyTaskProgress, ProjectTask, ProjectWeeklyTaskProgress } from '../../types';
import {
  buildProgressSegments,
  fetchPagedRows,
  mergeDailyProgressRows,
  mergeWeeklyProgressRows,
  rollupDailyRowsToWeeklyRows,
} from '../projectWeeklyProgressService';

const task = (patch: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 'task-1',
  name: 'Hạng mục kiểm thử',
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  duration: 29,
  progress: 0,
  isMilestone: false,
  order: 1,
  ...patch,
});

const daily = (patch: Partial<ProjectDailyTaskProgress> = {}): ProjectDailyTaskProgress => ({
  scopeKey: 'scope-1',
  projectId: 'project-1',
  constructionSiteId: null,
  taskId: 'task-1',
  progressDate: '2026-06-22',
  weekStart: '2026-06-22',
  progressPercent: 0,
  quantityDone: 0,
  dailyQuantityDone: 0,
  attachments: [],
  updatedBy: 'user-1',
  updatedAt: '2026-06-22T08:00:00.000Z',
  ...patch,
});

const weekly = (patch: Partial<ProjectWeeklyTaskProgress> = {}): ProjectWeeklyTaskProgress => ({
  scopeKey: 'scope-1',
  projectId: 'project-1',
  constructionSiteId: null,
  taskId: 'task-1',
  weekStart: '2026-06-15',
  progressPercent: 0,
  quantityDone: 0,
  attachments: [],
  updatedBy: 'user-1',
  updatedAt: '2026-06-15T08:00:00.000Z',
  ...patch,
});

describe('project daily/weekly progress helpers', () => {
  it('keeps the latest daily row for the same task and date', () => {
    const rows = mergeDailyProgressRows(
      [daily({ progressPercent: 60, quantityDone: 60, updatedAt: '2026-06-23T09:00:00.000Z' })],
      [daily({ progressPercent: 75, quantityDone: 75, updatedAt: '2026-06-23T15:00:00.000Z' })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].progressPercent).toBe(75);
    expect(rows[0].quantityDone).toBe(75);
  });

  it('rolls daily progress up to the latest progress in the selected week', () => {
    const rows = rollupDailyRowsToWeeklyRows({
      tasks: [task()],
      dailyRows: [
        daily({ progressDate: '2026-06-22', progressPercent: 30, quantityDone: 30 }),
        daily({ progressDate: '2026-06-23', progressPercent: 97, quantityDone: 97 }),
      ],
      scopeKey: 'scope-1',
      projectId: 'project-1',
      constructionSiteId: null,
      weekStart: '2026-06-22',
      updatedBy: 'user-1',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].weekStart).toBe('2026-06-22');
    expect(rows[0].progressPercent).toBe(97);
  });

  it('inherits the latest progress before the week when a task has no daily row in that week', () => {
    const rows = rollupDailyRowsToWeeklyRows({
      tasks: [task()],
      dailyRows: [
        daily({
          progressDate: '2026-06-20',
          weekStart: '2026-06-15',
          progressPercent: 45,
          quantityDone: 45,
        }),
      ],
      scopeKey: 'scope-1',
      projectId: 'project-1',
      constructionSiteId: null,
      weekStart: '2026-06-22',
      updatedBy: 'user-1',
    });

    expect(rows[0].progressPercent).toBe(45);
  });

  it('builds weekly segments from cumulative progress deltas', () => {
    const segments = buildProgressSegments([
      { key: '2026-06-15', label: 'W25/2026', progress: 30, color: 'purple' },
      { key: '2026-06-22', label: 'W26/2026', progress: 97, color: 'yellow' },
    ]);

    expect(segments.map(segment => segment.percent)).toEqual([30, 67]);
    expect(segments[1].cumulativeProgress).toBe(97);
  });

  it('builds weekly range segments using a baseline before the loaded window', () => {
    const segments = buildProgressSegments([
      { key: '2026-06-22', label: 'W26/2026', progress: 99, color: 'yellow' },
    ], 30);

    expect(segments).toHaveLength(1);
    expect(segments[0].percent).toBe(69);
    expect(segments[0].cumulativeProgress).toBe(99);
  });

  it('builds daily segments from a week-only load with a previous baseline', () => {
    const segments = buildProgressSegments([
      { key: '2026-06-22', label: '22/06', progress: 45, color: 'cyan' },
      { key: '2026-06-23', label: '23/06', progress: 75, color: 'blue' },
    ], 30);

    expect(segments.map(segment => segment.percent)).toEqual([15, 30]);
    expect(segments[1].cumulativeProgress).toBe(75);
  });

  it('fetches all Supabase pages beyond the default 1000 row limit', async () => {
    const allRows = Array.from({ length: 1328 }, (_, index) => ({ index }));

    const result = await fetchPagedRows(async (from, to) => ({
      data: allRows.slice(from, to + 1),
      error: null,
    }));

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1328);
    expect(result.data[1327]).toEqual({ index: 1327 });
  });

  it('keeps the just-saved weekly row when a reload response is stale', () => {
    const immediateRows = mergeWeeklyProgressRows(
      [weekly({ weekStart: '2026-06-15', progressPercent: 30 })],
      [weekly({ weekStart: '2026-06-22', progressPercent: 97, updatedAt: '2026-06-23T10:00:00.000Z' })],
    );

    const rowsAfterStaleReload = mergeWeeklyProgressRows(
      mergeWeeklyProgressRows(immediateRows, [weekly({ weekStart: '2026-06-15', progressPercent: 30 })]),
      [weekly({ weekStart: '2026-06-22', progressPercent: 97, updatedAt: '2026-06-23T10:00:00.000Z' })],
    );

    expect(rowsAfterStaleReload.map(row => row.weekStart)).toEqual(['2026-06-15', '2026-06-22']);
    expect(rowsAfterStaleReload.find(row => row.weekStart === '2026-06-22')?.progressPercent).toBe(97);
  });

  it('prefers an existing weekly row when there is no daily row for the task', () => {
    const rows = rollupDailyRowsToWeeklyRows({
      tasks: [task({ progress: 10 })],
      dailyRows: [],
      existingWeeklyRows: [weekly({ weekStart: '2026-06-22', progressPercent: 88, quantityDone: 88 })],
      scopeKey: 'scope-1',
      projectId: 'project-1',
      constructionSiteId: null,
      weekStart: '2026-06-22',
      updatedBy: 'user-1',
    });

    expect(rows[0].progressPercent).toBe(88);
  });
});
