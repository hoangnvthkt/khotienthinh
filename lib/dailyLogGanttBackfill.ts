// "Ghi bù theo Gantt" (chủ SP 21/10/2026): CHT ghi ngày xong thực tế trên Gantt nhưng nhật ký chưa ghi đủ 100%, nên tiến độ
// tổng thấp hơn thực tế và việc bị tính chậm. Phiếu kỹ sư gợi ý thêm đúng các việc đó với lũy kế 100% để CHT duyệt như phiếu thường.
import type { ProjectTask } from '../types';

export interface GanttBackfillTask { taskId: string; wbsCode: string; name: string; actualEndDate: string; progress: number }

const byWbs = (a: GanttBackfillTask, b: GanttBackfillTask) => a.wbsCode.localeCompare(b.wbsCode, 'vi', { numeric: true });

/** Việc lá đã xong thực tế (tới ngày phiếu) mà tiến độ chính thức chưa đủ 100% và chưa có trên phiếu. */
export const ganttBackfillTasks = (tasks: ProjectTask[], slipTaskIds: Iterable<string>, slipDate: string): GanttBackfillTask[] => {
  const parents = new Set(tasks.map(task => task.parentId).filter(Boolean));
  const onSlip = new Set(slipTaskIds);
  return tasks.flatMap(task => {
    const end = task.actualEndDate?.slice(0, 10);
    if (!end || end > slipDate || parents.has(task.id) || onSlip.has(task.id) || Number(task.progress || 0) >= 100) return [];
    return [{ taskId: task.id, wbsCode: task.wbsCode || '', name: task.name, actualEndDate: end, progress: Number(task.progress || 0) }];
  }).sort(byWbs);
};

export const ganttBackfillNote = (actualEndDate: string) => `Bù theo Gantt — xong thực tế ${actualEndDate.slice(8, 10)}/${actualEndDate.slice(5, 7)}`;
