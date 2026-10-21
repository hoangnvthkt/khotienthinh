import { describe, expect, it } from 'vitest';
import type { ProjectTask } from '../../types';
import { ganttBackfillNote, ganttBackfillTasks } from '../dailyLogGanttBackfill';

const task = (id: string, extra: Partial<ProjectTask> = {}) => ({ id, name: id, wbsCode: id, startDate: '2026-10-01', endDate: '2026-10-05', duration: 4, progress: 0, isMilestone: false, order: 0, ...extra } as ProjectTask);

describe('Ghi bù theo Gantt', () => {
  it('chỉ lấy việc lá đã xong thực tế tới ngày phiếu, chưa đủ 100% và chưa có trên phiếu', () => {
    const tasks = [
      task('2.1'), task('2.1.10', { parentId: '2.1', actualEndDate: '2026-10-02' }), task('2.1.9', { parentId: '2.1', actualEndDate: '2026-10-02' }),
      task('2.1.8', { parentId: '2.1', actualEndDate: '2026-10-02', progress: 100 }),
      task('2.2.1', { parentId: '2.1', actualEndDate: '2026-10-25' }),
      task('2.2.2', { parentId: '2.1', actualStartDate: '2026-10-05' }),
      task('3.3.4', { parentId: '2.1', actualEndDate: '2026-10-06', progress: 30 }),
      task('3.3.5', { parentId: '2.1', actualEndDate: '2026-10-11' }),
    ];
    expect(ganttBackfillTasks(tasks, ['3.3.5'], '2026-10-21').map(item => [item.taskId, item.progress])).toEqual([['2.1.9', 0], ['2.1.10', 0], ['3.3.4', 30]]);
    expect(ganttBackfillNote('2026-10-02')).toBe('Bù theo Gantt — xong thực tế 02/10');
  });
});
