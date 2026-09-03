import { describe, expect, it } from 'vitest';

import type { ProjectTask } from '../../types';
import { applyImportedParentAssignments } from '../projectScheduleImport';

const task = (patch: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 'task-1',
  name: 'Hạng mục',
  startDate: '2026-08-01',
  endDate: '2026-08-02',
  duration: 2,
  progress: 0,
  isMilestone: false,
  order: 1,
  ...patch,
});

describe('applyImportedParentAssignments', () => {
  it('moves an existing task under the parent addressed by its WBS', () => {
    const tasks = [
      task({ id: 'parent', name: 'Hạng mục cha', wbsCode: '1' }),
      task({ id: 'child', name: 'Hạng mục cần chuyển', wbsCode: '2', progress: 45 }),
    ];

    const result = applyImportedParentAssignments(tasks, [{ taskId: 'child', parentWbs: '1' }]);

    expect(result.errors).toEqual({});
    expect(result.tasks.find(item => item.id === 'child')).toMatchObject({
      parentId: 'parent',
      progress: 45,
    });
  });

  it('keeps an existing parent when the update cell is blank', () => {
    const tasks = [
      task({ id: 'parent', wbsCode: '1' }),
      task({ id: 'child', wbsCode: '1.1', parentId: 'parent' }),
    ];

    const result = applyImportedParentAssignments(tasks, [{ taskId: 'child', parentWbs: '' }]);

    expect(result.errors).toEqual({});
    expect(result.tasks.find(item => item.id === 'child')?.parentId).toBe('parent');
  });

  it('rejects an unknown parent WBS without changing that task', () => {
    const tasks = [task({ id: 'child', wbsCode: '1' })];

    const result = applyImportedParentAssignments(tasks, [{ taskId: 'child', parentWbs: '9.9' }]);

    expect(result.errors).toEqual({ child: 'Không tìm thấy Mã cha "9.9" trong dự án' });
    expect(result.tasks.find(item => item.id === 'child')?.parentId).toBeUndefined();
  });

  it('rejects batch parent assignments that would create a cycle', () => {
    const tasks = [
      task({ id: 'a', wbsCode: '1' }),
      task({ id: 'b', wbsCode: '2' }),
    ];

    const result = applyImportedParentAssignments(tasks, [
      { taskId: 'a', parentWbs: '2' },
      { taskId: 'b', parentWbs: '1' },
    ]);

    expect(result.errors).toEqual({
      a: 'Cấu trúc cha/con đang tạo vòng lặp',
      b: 'Cấu trúc cha/con đang tạo vòng lặp',
    });
    expect(result.tasks.map(item => item.parentId)).toEqual([undefined, undefined]);
  });
});
