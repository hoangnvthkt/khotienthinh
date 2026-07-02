import { describe, expect, it } from 'vitest';
import type {
  DailyLogVolume,
  ProjectDailyTaskProgress,
  ProjectTask,
  ProjectWorkBoqItem,
} from '../../types';
import { buildDailyLogVolumesFromDailyProgress } from '../dailyLogProgressImport';

const task = (patch: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 'task-1',
  projectId: 'project-1',
  constructionSiteId: null,
  name: 'Lắp dựng kết cấu',
  startDate: '2026-07-01',
  endDate: '2026-07-05',
  duration: 4,
  progress: 0,
  isMilestone: false,
  order: 1,
  fallbackUnit: 'm3',
  provisionalQuantity: 100,
  ...patch,
});

const workBoqItem = (patch: Partial<ProjectWorkBoqItem> = {}): ProjectWorkBoqItem => ({
  id: 'boq-1',
  projectId: 'project-1',
  constructionSiteId: null,
  sourceTaskId: 'task-1',
  parentId: null,
  wbsCode: '1.1',
  name: 'BOQ lắp dựng kết cấu',
  unit: 'm2',
  plannedQty: 100,
  unitPrice: 0,
  sortOrder: 1,
  syncStatus: 'synced',
  ...patch,
});

const dailyProgress = (patch: Partial<ProjectDailyTaskProgress> = {}): ProjectDailyTaskProgress => ({
  scopeKey: 'project-1',
  projectId: 'project-1',
  constructionSiteId: null,
  taskId: 'task-1',
  progressDate: '2026-07-01',
  weekStart: '2026-06-29',
  progressPercent: 50,
  quantityDone: 50,
  dailyQuantityDone: 10,
  note: 'Hoàn thành khu A',
  attachments: [],
  updatedAt: '2026-07-01T08:00:00.000Z',
  ...patch,
});

describe('buildDailyLogVolumesFromDailyProgress', () => {
  it('uses dailyQuantityDone instead of cumulative quantityDone', () => {
    const result = buildDailyLogVolumesFromDailyProgress({
      dailyProgressRows: [dailyProgress({ quantityDone: 80, dailyQuantityDone: 12 })],
      tasks: [task()],
      workBoqItems: [],
    });

    expect(result.volumes).toHaveLength(1);
    expect(result.volumes[0].quantity).toBe(12);
    expect(result.volumes[0].quantity).not.toBe(80);
  });

  it('links task and work BOQ metadata with unit preference from BOQ', () => {
    const result = buildDailyLogVolumesFromDailyProgress({
      dailyProgressRows: [dailyProgress()],
      tasks: [task({ fallbackUnit: 'm3' })],
      workBoqItems: [workBoqItem({ unit: 'm2' })],
    });

    expect(result.volumes[0]).toMatchObject({
      taskId: 'task-1',
      taskName: 'Lắp dựng kết cấu',
      workBoqItemId: 'boq-1',
      workBoqItemName: 'BOQ lắp dựng kết cấu',
      contractItemName: 'BOQ lắp dựng kết cấu',
      unit: 'm2',
      note: 'Hoàn thành khu A',
    });
  });

  it('skips non-positive daily quantities', () => {
    const result = buildDailyLogVolumesFromDailyProgress({
      dailyProgressRows: [
        dailyProgress({ taskId: 'task-1', dailyQuantityDone: 0 }),
        dailyProgress({ taskId: 'task-2', dailyQuantityDone: -3 }),
        dailyProgress({ taskId: 'task-3', dailyQuantityDone: 5 }),
      ],
      tasks: [task(), task({ id: 'task-2' }), task({ id: 'task-3' })],
      workBoqItems: [],
    });

    expect(result.volumes.map(volume => volume.taskId)).toEqual(['task-3']);
    expect(result.skippedNonPositiveCount).toBe(2);
  });

  it('skips existing volumes by task or work BOQ target', () => {
    const existingVolumes: DailyLogVolume[] = [
      { taskId: 'task-1', taskName: 'Lắp dựng kết cấu', quantity: 4, unit: 'm3' },
      { taskId: 'task-2', workBoqItemId: 'boq-2', quantity: 7, unit: 'm2' },
    ];

    const result = buildDailyLogVolumesFromDailyProgress({
      dailyProgressRows: [
        dailyProgress({ taskId: 'task-1', dailyQuantityDone: 10 }),
        dailyProgress({ taskId: 'task-2', dailyQuantityDone: 15 }),
        dailyProgress({ taskId: 'task-3', dailyQuantityDone: 20 }),
      ],
      tasks: [
        task({ id: 'task-1' }),
        task({ id: 'task-2', name: 'Công tác đã có BOQ' }),
        task({ id: 'task-3', name: 'Công tác mới' }),
      ],
      workBoqItems: [
        workBoqItem({ id: 'boq-2', sourceTaskId: 'task-2' }),
        workBoqItem({ id: 'boq-3', sourceTaskId: 'task-3' }),
      ],
      existingVolumes,
    });

    expect(result.volumes).toHaveLength(1);
    expect(result.volumes[0].taskId).toBe('task-3');
    expect(result.skippedDuplicateCount).toBe(2);
  });
});
