import type { ProjectTask } from '../types';

export interface ImportedParentAssignment {
  taskId: string;
  parentWbs: string;
}

export interface ImportedParentAssignmentResult {
  tasks: ProjectTask[];
  errors: Record<string, string>;
}

const findParentCycleTaskIds = (tasks: ProjectTask[]): Set<string> => {
  const parentByTaskId = new Map(tasks.map(task => [task.id, task.parentId]));
  const cycleTaskIds = new Set<string>();

  for (const task of tasks) {
    const path: string[] = [];
    const indexByTaskId = new Map<string, number>();
    let cursor: string | undefined = task.id;

    while (cursor) {
      const cycleStart = indexByTaskId.get(cursor);
      if (cycleStart !== undefined) {
        path.slice(cycleStart).forEach(taskId => cycleTaskIds.add(taskId));
        break;
      }
      indexByTaskId.set(cursor, path.length);
      path.push(cursor);
      cursor = parentByTaskId.get(cursor);
    }
  }

  return cycleTaskIds;
};

/**
 * Resolves non-empty parent WBS values from the update workbook. Empty cells
 * intentionally preserve the current parent, matching other partial updates.
 */
export const applyImportedParentAssignments = (
  tasks: ProjectTask[],
  assignments: ImportedParentAssignment[],
): ImportedParentAssignmentResult => {
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const taskIdByWbs = new Map(
    tasks
      .filter(task => task.wbsCode?.trim())
      .map(task => [task.wbsCode!.trim().toLocaleLowerCase(), task.id]),
  );
  const errors: Record<string, string> = {};
  const parentIdByTaskId = new Map<string, string>();

  for (const assignment of assignments) {
    const parentWbs = assignment.parentWbs.trim();
    if (!parentWbs) continue;

    if (!taskById.has(assignment.taskId)) {
      errors[assignment.taskId] = 'Hạng mục cần cập nhật không còn tồn tại';
      continue;
    }

    const parentId = taskIdByWbs.get(parentWbs.toLocaleLowerCase());
    if (!parentId) {
      errors[assignment.taskId] = `Không tìm thấy Mã cha "${parentWbs}" trong dự án`;
      continue;
    }
    if (parentId === assignment.taskId) {
      errors[assignment.taskId] = 'Cấu trúc cha/con đang tạo vòng lặp';
      continue;
    }
    parentIdByTaskId.set(assignment.taskId, parentId);
  }

  const candidateTasks = tasks.map(task => (
    !errors[task.id] && parentIdByTaskId.has(task.id)
      ? { ...task, parentId: parentIdByTaskId.get(task.id) }
      : task
  ));
  for (const taskId of findParentCycleTaskIds(candidateTasks)) {
    errors[taskId] = 'Cấu trúc cha/con đang tạo vòng lặp';
  }

  return {
    errors,
    tasks: tasks.map(task => (
      errors[task.id] || !parentIdByTaskId.has(task.id)
        ? task
        : { ...task, parentId: parentIdByTaskId.get(task.id) }
    )),
  };
};
