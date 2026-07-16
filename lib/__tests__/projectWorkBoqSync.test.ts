import { describe, expect, it } from 'vitest';
import type { ProjectTask, ProjectWorkBoqItem } from '../../types';
import { buildWorkBoqRowsFromTasks } from '../projectService';

const task = (patch: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 'task-1',
  name: 'Xây tường gạch chân tường',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  duration: 1,
  progress: 0,
  isMilestone: false,
  order: 1,
  wbsCode: '1.1',
  fallbackUnit: 'm2',
  provisionalQuantity: 34.008,
  ...patch,
});

const workBoq = (patch: Partial<ProjectWorkBoqItem> = {}): ProjectWorkBoqItem => ({
  id: 'work-1',
  projectId: 'project-1',
  sourceTaskId: 'task-1',
  parentId: null,
  wbsCode: '1.1',
  name: 'Xây tường gạch chân tường',
  unit: 'm2',
  plannedQty: 34008,
  unitPrice: 125000,
  sortOrder: 1,
  syncStatus: 'synced',
  notes: 'Giữ lại ghi chú BOQ',
  ...patch,
});

describe('work BOQ sync', () => {
  it('maps the task provisional quantity to linked BOQ planned quantity', () => {
    const { rows, preview: result } = buildWorkBoqRowsFromTasks('project-1', null, [task()], [workBoq()]);

    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(rows[0].plannedQty).toBe(34.008);
    expect(rows[0].unitPrice).toBe(125000);
    expect(rows[0].notes).toBe('Giữ lại ghi chú BOQ');
  });

  it('skips linked BOQ rows only when mapped values are unchanged', () => {
    const { preview: result } = buildWorkBoqRowsFromTasks('project-1', null, [task()], [workBoq({ plannedQty: 34.008 })]);

    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
