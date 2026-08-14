import type { DailyLog, ProjectTask, TaskDependencyType } from '../types';

export type ProjectTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';

export interface ProjectProgressSummary {
  progressPercent: number;
  totalTasks: number;
  leafTaskCount: number;
  completedLeafCount: number;
  totalWeight: number;
}

export interface ProjectTaskDraft {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  parentId?: string;
  dependencies?: { taskId: string; type: TaskDependencyType }[];
  isMilestone?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const DAY_MS = 86400000;

export const daysBetweenDates = (a: string, b: string): number => {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.ceil((d2.getTime() - d1.getTime()) / DAY_MS);
};

export const clampProgress = (progress: number): number => {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
};

export const getLeafProjectTasks = (tasks: ProjectTask[]): ProjectTask[] => {
  const parentIds = new Set(tasks.map(t => t.parentId).filter(Boolean) as string[]);
  return tasks.filter(t => !parentIds.has(t.id));
};

const getTaskDuration = (task: Pick<ProjectTask, 'duration' | 'startDate' | 'endDate' | 'isMilestone'>): number => {
  if (task.isMilestone) return 1;
  const duration = Number(task.duration);
  if (Number.isFinite(duration) && duration > 0) return duration;
  return Math.max(1, daysBetweenDates(task.startDate, task.endDate));
};

export const getTaskProgressWeight = (task: ProjectTask): number => {
  const duration = getTaskDuration(task);
  const costWeight = (task.estimatedCostPerDay || 0) * duration;
  if (costWeight > 0) return costWeight;
  return duration * Math.max(1, task.resourceCount || 1);
};

export const calculateProjectProgress = (tasks: ProjectTask[]): ProjectProgressSummary => {
  const leafTasks = getLeafProjectTasks(tasks);
  if (leafTasks.length === 0) {
    return {
      progressPercent: 0,
      totalTasks: tasks.length,
      leafTaskCount: 0,
      completedLeafCount: 0,
      totalWeight: 0,
    };
  }

  const totalWeight = leafTasks.reduce((sum, task) => sum + getTaskProgressWeight(task), 0);
  const weightedProgress = leafTasks.reduce((sum, task) => {
    return sum + clampProgress(task.progress) * getTaskProgressWeight(task);
  }, 0);

  return {
    progressPercent: totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : 0,
    totalTasks: tasks.length,
    leafTaskCount: leafTasks.length,
    completedLeafCount: leafTasks.filter(task => task.progress >= 100).length,
    totalWeight,
  };
};

export const getProjectTaskStatus = (task: ProjectTask, todayIso = new Date().toISOString().split('T')[0]): ProjectTaskStatus => {
  if (task.progress >= 100) return 'completed';
  if (task.endDate < todayIso) return 'overdue';
  if (task.progress > 0) return 'in_progress';
  return 'not_started';
};

export const deriveProjectTaskProgress = (
  tasks: ProjectTask[],
  dailyLogs: DailyLog[] = [],
  todayIso = new Date().toISOString().split('T')[0]
): ProjectTask[] => {
  const childrenByParent = new Map<string, ProjectTask[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const children = childrenByParent.get(task.parentId) || [];
    children.push(task);
    childrenByParent.set(task.parentId, children);
  }

  const verifiedDailyQtyByTask = new Map<string, number>();
  const verifiedDailyQtyByTaskAndDate = new Map<string, Map<string, number>>();
  for (const log of dailyLogs) {
    const verified = log.status === 'verified' || log.verified;
    if (!verified) continue;
    for (const volume of log.volumes || []) {
      if (!volume.taskId) continue;
      const quantity = Number(volume.quantity || 0);
      const acceptedQuantity = Math.max(0, quantity);
      verifiedDailyQtyByTask.set(volume.taskId, (verifiedDailyQtyByTask.get(volume.taskId) || 0) + acceptedQuantity);
      const quantityByDate = verifiedDailyQtyByTaskAndDate.get(volume.taskId) || new Map<string, number>();
      quantityByDate.set(log.date, (quantityByDate.get(log.date) || 0) + acceptedQuantity);
      verifiedDailyQtyByTaskAndDate.set(volume.taskId, quantityByDate);
    }
  }

  const getFirstDailyCompletionDate = (taskId: string, plannedQuantity: number): string | undefined => {
    if (!(plannedQuantity > 0)) return undefined;
    const quantitiesByDate = verifiedDailyQtyByTaskAndDate.get(taskId);
    if (!quantitiesByDate) return undefined;

    let cumulativeQuantity = 0;
    for (const [date, quantity] of [...quantitiesByDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      cumulativeQuantity += quantity;
      if (cumulativeQuantity >= plannedQuantity) return date;
    }
    return undefined;
  };

  const taskById = new Map(tasks.map(task => [task.id, task]));
  const calculated = new Map<string, ProjectTask>();

  const getDerived = (taskId: string): ProjectTask => {
    if (calculated.has(taskId)) return calculated.get(taskId)!;
    const source = taskById.get(taskId);
    if (!source) throw new Error(`Missing task ${taskId}`);

    const children = (childrenByParent.get(taskId) || []).map(child => getDerived(child.id));
    let next = Object.fromEntries(
      Object.entries(source).filter(([key]) => !key.startsWith('gate')),
    ) as ProjectTask;
    next.dependencies = (source.dependencies || []).map(dep => ({ taskId: dep.taskId, type: dep.type }));

    if (children.length > 0) {
      const allChildrenWeighted = children.every(child => Number(child.provisionalQuantity || 0) > 0);
      const nextProgress = allChildrenWeighted
        ? Math.round(children.reduce((sum, child) => sum + clampProgress(child.progress) * Number(child.provisionalQuantity || 0), 0) /
            children.reduce((sum, child) => sum + Number(child.provisionalQuantity || 0), 0))
        : Math.round(children.reduce((sum, child) => sum + clampProgress(child.progress), 0) / children.length);

      next = {
        ...next,
        progress: clampProgress(nextProgress),
        progressMode: 'children_auto',
      };
      const completedChildDates = children
        .filter(child => clampProgress(child.progress) >= 100)
        .map(child => child.actualEndDate)
        .filter(Boolean) as string[];
      if (
        next.progress >= 100 &&
        !next.actualEndDate &&
        completedChildDates.length === children.length
      ) {
        next.actualEndDate = completedChildDates.sort().at(-1);
      }
    } else if (next.progressMode === 'daily_log' || (!next.progressMode && verifiedDailyQtyByTask.has(taskId))) {
      const plannedQuantity = Number(next.provisionalQuantity || 0);
      const verifiedQuantity = verifiedDailyQtyByTask.get(taskId) || 0;
      const nextProgress = plannedQuantity > 0
        ? Math.round((verifiedQuantity / plannedQuantity) * 100)
        : clampProgress(next.progress);

      next = {
        ...next,
        progress: plannedQuantity > 0 ? clampProgress(nextProgress) : clampProgress(next.progress),
        progressMode: 'daily_log',
      };
      if (next.progress >= 100 && !next.actualEndDate) {
        next.actualEndDate = getFirstDailyCompletionDate(taskId, plannedQuantity);
      }
    }

    calculated.set(taskId, next);
    return next;
  };

  return tasks.map(task => getDerived(task.id));
};

export const collectDescendantTaskIds = (tasks: ProjectTask[], rootId: string): Set<string> => {
  const descendants = new Set<string>();
  const queue = [rootId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = tasks.filter(task => task.parentId === parentId);
    for (const child of children) {
      if (descendants.has(child.id)) continue;
      descendants.add(child.id);
      queue.push(child.id);
    }
  }

  return descendants;
};

export const removeTasksAndReferences = (tasks: ProjectTask[], idsToRemove: Set<string>): ProjectTask[] => {
  return tasks
    .filter(task => !idsToRemove.has(task.id))
    .map(task => ({
      ...task,
      dependencies: (task.dependencies || []).filter(dep => !idsToRemove.has(dep.taskId)),
    }));
};

const hasDependencyCycle = (tasks: ProjectTask[]): boolean => {
  const depsByTask = new Map(tasks.map(task => [task.id, (task.dependencies || []).map(dep => dep.taskId)]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;

    visiting.add(taskId);
    for (const depId of depsByTask.get(taskId) || []) {
      if (depsByTask.has(depId) && visit(depId)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };

  return tasks.some(task => visit(task.id));
};

const hasParentCycle = (tasks: ProjectTask[]): boolean => {
  const parentByTask = new Map(tasks.map(task => [task.id, task.parentId]));

  for (const task of tasks) {
    const seen = new Set<string>();
    let cursor = task.parentId;
    while (cursor) {
      if (cursor === task.id || seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = parentByTask.get(cursor);
    }
  }

  return false;
};

export const validateProjectTaskDraft = (
  draft: ProjectTaskDraft,
  existingTasks: ProjectTask[],
  editingId?: string
): ValidationResult => {
  const errors: string[] = [];
  const taskId = editingId || draft.id || '__new_task__';
  const name = draft.name.trim();
  const dependencies = draft.dependencies || [];
  const knownIds = new Set(existingTasks.map(task => task.id));

  if (!name) errors.push('Vui lòng nhập tên hạng mục.');
  if (!draft.startDate || !draft.endDate) errors.push('Vui lòng nhập ngày bắt đầu và kết thúc.');
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.push('Ngày kết thúc không được trước ngày bắt đầu.');
  }
  if (draft.parentId === taskId) errors.push('Hạng mục không thể là cha của chính nó.');
  if (draft.parentId && !knownIds.has(draft.parentId)) errors.push('Hạng mục cha không còn tồn tại.');

  const dependencyIds = new Set<string>();
  dependencies.forEach((dep, index) => {
    if (!dep.taskId) errors.push(`Phụ thuộc dòng ${index + 1} chưa chọn hạng mục.`);
    if (dep.taskId === taskId) errors.push('Hạng mục không thể phụ thuộc chính nó.');
    if (dep.taskId && !knownIds.has(dep.taskId)) errors.push('Có phụ thuộc trỏ tới hạng mục không còn tồn tại.');
    if (dep.taskId && dependencyIds.has(dep.taskId)) errors.push('Không nên khai báo trùng một hạng mục phụ thuộc.');
    if (dep.taskId) dependencyIds.add(dep.taskId);
  });

  if (errors.length === 0) {
    const simulatedTask: ProjectTask = {
      ...(existingTasks.find(task => task.id === editingId) || {
        id: taskId,
        constructionSiteId: existingTasks[0]?.constructionSiteId || '',
        progress: 0,
        duration: Math.max(0, daysBetweenDates(draft.startDate, draft.endDate)),
        isMilestone: !!draft.isMilestone,
        order: existingTasks.length,
      }),
      id: taskId,
      name,
      startDate: draft.startDate,
      endDate: draft.endDate,
      parentId: draft.parentId || undefined,
      dependencies,
      isMilestone: !!draft.isMilestone,
    };
    const simulated = editingId
      ? existingTasks.map(task => task.id === editingId ? simulatedTask : task)
      : [...existingTasks, simulatedTask];

    if (hasParentCycle(simulated)) errors.push('Cấu trúc cha/con đang tạo vòng lặp.');
    if (hasDependencyCycle(simulated)) errors.push('Chuỗi phụ thuộc đang tạo vòng lặp, critical path sẽ không đáng tin cậy.');
  }

  return { valid: errors.length === 0, errors };
};

export const getTaskRelatedPhotoLog = (task: ProjectTask, dailyLogs: DailyLog[]): DailyLog | undefined => {
  const logsWithPhotos = dailyLogs.filter(log => log.photos && log.photos.length > 0);
  const explicitlyLinked = logsWithPhotos.filter(log => (log.delayTasks || []).some(delay => delay.taskId === task.id));
  if (explicitlyLinked.length > 0) return explicitlyLinked[0];

  return logsWithPhotos.find(log => {
    const hasTaskLinks = (log.delayTasks || []).length > 0;
    return !hasTaskLinks && log.date >= task.startDate && log.date <= task.endDate;
  });
};
