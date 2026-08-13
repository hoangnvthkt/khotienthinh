import { describe, expect, it } from 'vitest';

import type { DailyLog, ProjectTask } from '../../types';
import {
  calculateProjectProgress,
  deriveProjectTaskProgress,
  getProjectTaskStatus,
} from '../projectScheduleRules';

const task = (patch: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 'task-1',
  name: 'Task 1',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  duration: 31,
  progress: 0,
  isMilestone: false,
  order: 1,
  ...patch,
});

describe('authoritative project schedule rules', () => {
  it('treats progress at 100 as completed without a gate', () => {
    const completed = task({ progress: 100, gateStatus: 'pending' });

    expect(getProjectTaskStatus(completed, '2026-08-13')).toBe('completed');
    expect(calculateProjectProgress([completed])).toMatchObject({
      completedLeafCount: 1,
      progressPercent: 100,
    });
    expect(calculateProjectProgress([completed])).not.toHaveProperty('pendingGateCount');
  });

  it('derives verified Daily Log quantity and completion date without completion requests', () => {
    const logs = [{
      id: 'log-1',
      date: '2026-08-13',
      status: 'verified',
      volumes: [{ taskId: 'task-1', quantity: 10 }],
    }] as DailyLog[];

    const [derived] = deriveProjectTaskProgress([
      task({ progressMode: 'daily_log', provisionalQuantity: 10 }),
    ], logs, '2026-08-13');

    expect(derived).toMatchObject({
      progress: 100,
      progressMode: 'daily_log',
      actualEndDate: '2026-08-13',
    });
  });

  it('keeps child rollup authoritative without writing gate metadata', () => {
    const parent = task({ id: 'parent', name: 'Parent' });
    const childA = task({ id: 'child-a', parentId: 'parent', progress: 100 });
    const childB = task({ id: 'child-b', parentId: 'parent', progress: 50 });

    const [derivedParent] = deriveProjectTaskProgress(
      [parent, childA, childB], [], '2026-08-13',
    );

    expect(derivedParent).toMatchObject({ progress: 75, progressMode: 'children_auto' });
    expect(derivedParent).not.toHaveProperty('gateStatus');
  });
});
