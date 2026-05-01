import type { DailyLog, GateStatus, ProjectTask, TaskDependencyType } from '../types';

export type ProjectTaskStatus = 'not_started' | 'in_progress' | 'pending_gate' | 'completed' | 'overdue';

export interface ProjectProgressSummary {
  progressPercent: number;
  totalTasks: number;
  leafTaskCount: number;
  completedLeafCount: number;
  pendingGateCount: number;
  totalWeight: number;
}

export interface ProjectTaskDraft {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  parentId?: string;
  dependencies?: { taskId: string; type: TaskDependencyType; requiresGateApproval?: boolean }[];
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
      pendingGateCount: 0,
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
    completedLeafCount: leafTasks.filter(task => task.progress >= 100 && task.gateStatus === 'approved').length,
    pendingGateCount: leafTasks.filter(task => task.progress >= 100 && task.gateStatus !== 'approved').length,
    totalWeight,
  };
};

export const getProjectTaskStatus = (task: ProjectTask, todayIso = new Date().toISOString().split('T')[0]): ProjectTaskStatus => {
  if (task.progress >= 100) {
    return task.gateStatus === 'approved' ? 'completed' : 'pending_gate';
  }
  if (task.endDate < todayIso) return 'overdue';
  if (task.progress > 0) return 'in_progress';
  return 'not_started';
};

export const getGateBlockedTaskIds = (tasks: ProjectTask[]): Set<string> => {
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const blocked = new Set<string>();

  for (const task of tasks) {
    for (const dep of task.dependencies || []) {
      if (!dep.requiresGateApproval) continue;
      const predecessor = taskMap.get(dep.taskId);
      if (predecessor && predecessor.progress >= 100 && predecessor.gateStatus !== 'approved') {
        blocked.add(task.id);
      }
    }
  }

  return blocked;
};

export const applyProgressGateTransition = (task: ProjectTask, progress: number): ProjectTask => {
  const nextProgress = clampProgress(progress);
  let gateStatus: GateStatus | undefined = task.gateStatus;
  let gateApprovedBy = task.gateApprovedBy;
  let gateApprovedAt = task.gateApprovedAt;

  if (nextProgress >= 100 && task.gateStatus !== 'approved') {
    gateStatus = 'pending';
    gateApprovedBy = undefined;
    gateApprovedAt = undefined;
  } else if (nextProgress < 100 && task.gateStatus !== 'rejected') {
    gateStatus = 'none';
    gateApprovedBy = undefined;
    gateApprovedAt = undefined;
  }

  return {
    ...task,
    progress: nextProgress,
    gateStatus,
    gateApprovedBy,
    gateApprovedAt,
  };
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
