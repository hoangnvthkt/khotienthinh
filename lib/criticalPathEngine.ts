/**
 * Critical Path Engine — Forward/Backward Pass Algorithm
 * 
 * Tính toán đường găng (Critical Path), Float/Slack cho từng task,
 * và hiệu ứng Ripple khi thay đổi duration.
 * 
 * Thuần pure function — không side-effect, không gọi API.
 */

import { ProjectTask, TaskDependencyType } from '../types';

// ==================== TYPES ====================

export interface CriticalPathResult {
  criticalPath: string[];            // IDs of tasks on critical path
  taskSchedule: Map<string, TaskScheduleInfo>;
  totalProjectDuration: number;      // ngày
  projectEndDate: string;
}

export interface TaskScheduleInfo {
  taskId: string;
  es: number;   // Earliest Start (ngày offset từ project start)
  ef: number;   // Earliest Finish
  ls: number;   // Latest Start
  lf: number;   // Latest Finish
  float: number; // Total Float = LS - ES
  isCritical: boolean;
}

export interface DamageEstimate {
  taskId: string;
  taskName: string;
  delayDays: number;
  laborCostPerDay: number;
  machineCostPerDay: number;
  totalDamage: number;
}

// ==================== HELPERS ====================

const daysBetween = (a: string, b: string): number => {
  const d1 = new Date(a), d2 = new Date(b);
  return Math.ceil((d2.getTime() - d1.getTime()) / 86400000);
};

const addDaysToDate = (d: string, n: number): string => {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split('T')[0];
};

/**
 * Build adjacency maps for predecessors and successors.
 * Only considers root-level dependencies (ignores parent-child tree).
 */
function buildDependencyMaps(tasks: ProjectTask[]) {
  const taskMap = new Map<string, ProjectTask>();
  // predecessors[taskId] = [{predId, type, lagTime}]
  const predecessors = new Map<string, { predId: string; type: TaskDependencyType; lag: number }[]>();
  // successors[taskId] = [{succId, type, lagTime}]
  const successors = new Map<string, { succId: string; type: TaskDependencyType; lag: number }[]>();

  for (const t of tasks) {
    taskMap.set(t.id, t);
    if (!predecessors.has(t.id)) predecessors.set(t.id, []);
    if (!successors.has(t.id)) successors.set(t.id, []);
  }

  for (const t of tasks) {
    if (!t.dependencies || t.dependencies.length === 0) continue;
    for (const dep of t.dependencies) {
      const pred = taskMap.get(dep.taskId);
      if (!pred) continue;
      const lag = t.lagTime || 0;
      predecessors.get(t.id)!.push({ predId: dep.taskId, type: dep.type, lag });
      successors.get(dep.taskId)!.push({ succId: t.id, type: dep.type, lag });
    }
  }

  return { taskMap, predecessors, successors };
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns task IDs in dependency order.
 */
function topologicalSort(
  tasks: ProjectTask[],
  predecessors: Map<string, { predId: string }[]>
): string[] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    if (!adjList.has(t.id)) adjList.set(t.id, []);
  }

  for (const t of tasks) {
    const preds = predecessors.get(t.id) || [];
    inDegree.set(t.id, preds.length);
    for (const p of preds) {
      if (!adjList.has(p.predId)) adjList.set(p.predId, []);
      adjList.get(p.predId)!.push(t.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const succ of (adjList.get(id) || [])) {
      const newDeg = (inDegree.get(succ) || 1) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }

  // If sorted.length < tasks.length, there's a cycle — add remaining tasks at end
  if (sorted.length < tasks.length) {
    const sortedSet = new Set(sorted);
    for (const t of tasks) {
      if (!sortedSet.has(t.id)) sorted.push(t.id);
    }
  }

  return sorted;
}

/**
 * Calculate the dependency constraint for a given dependency type.
 * Returns the earliest allowed start/finish for the successor.
 */
function getDependencyConstraint(
  predES: number, predEF: number, predDuration: number,
  type: TaskDependencyType, lag: number
): { minStart: number } {
  switch (type) {
    case 'FS': // Finish-to-Start: succ starts after pred finishes + lag
      return { minStart: predEF + lag };
    case 'SS': // Start-to-Start: succ starts after pred starts + lag
      return { minStart: predES + lag };
    case 'FF': // Finish-to-Finish: succ finishes after pred finishes + lag
      // succEF >= predEF + lag → succES >= predEF + lag - succDuration
      // Handled by caller using succDuration
      return { minStart: predEF + lag }; // Will be adjusted by caller
    case 'SF': // Start-to-Finish: succ finishes after pred starts + lag
      return { minStart: predES + lag }; // Will be adjusted by caller
    default:
      return { minStart: predEF + lag };
  }
}

// ==================== MAIN ALGORITHM ====================

/**
 * Compute Critical Path using Forward/Backward Pass.
 * 
 * Only processes leaf tasks (tasks without parentId or that are standalone).
 * Parent tasks are treated as summary tasks.
 */
export function computeCriticalPath(allTasks: ProjectTask[]): CriticalPathResult {
  // Filter to only non-parent tasks (leaf tasks that can be scheduled)
  // Summary/parent tasks are excluded from critical path calculation
  const parentIds = new Set(allTasks.filter(t => t.parentId).map(t => t.parentId!));
  const tasks = allTasks.filter(t => {
    // Include tasks that are NOT summary tasks (i.e., have no children)
    const hasChildren = allTasks.some(c => c.parentId === t.id);
    return !hasChildren;
  });

  if (tasks.length === 0) {
    return { criticalPath: [], taskSchedule: new Map(), totalProjectDuration: 0, projectEndDate: '' };
  }

  const { taskMap, predecessors, successors } = buildDependencyMaps(tasks);
  const sorted = topologicalSort(tasks, predecessors);

  // Find project start date (earliest start date across all tasks)
  const projectStartDate = tasks.reduce((min, t) => t.startDate < min ? t.startDate : min, tasks[0].startDate);

  // ── FORWARD PASS ──
  const es = new Map<string, number>();
  const ef = new Map<string, number>();

  for (const id of sorted) {
    const task = taskMap.get(id)!;
    const preds = predecessors.get(id) || [];
    let earliestStart = daysBetween(projectStartDate, task.startDate);

    for (const pred of preds) {
      const predTask = taskMap.get(pred.predId);
      if (!predTask) continue;
      const predEF = ef.get(pred.predId) || 0;
      const predES = es.get(pred.predId) || 0;

      const constraint = getDependencyConstraint(predES, predEF, predTask.duration, pred.type, pred.lag);

      if (pred.type === 'FF') {
        // FF: succEF >= predEF + lag → succES >= predEF + lag - succDuration
        const minES = constraint.minStart - task.duration;
        earliestStart = Math.max(earliestStart, minES);
      } else if (pred.type === 'SF') {
        // SF: succEF >= predES + lag → succES >= predES + lag - succDuration
        const minES = constraint.minStart - task.duration;
        earliestStart = Math.max(earliestStart, minES);
      } else {
        earliestStart = Math.max(earliestStart, constraint.minStart);
      }
    }

    es.set(id, earliestStart);
    ef.set(id, earliestStart + task.duration);
  }

  // Project end = max EF
  let projectDuration = 0;
  for (const [, v] of ef) {
    projectDuration = Math.max(projectDuration, v);
  }

  // ── BACKWARD PASS ──
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();

  // Initialize all LF to project duration
  for (const t of tasks) {
    lf.set(t.id, projectDuration);
    ls.set(t.id, projectDuration - t.duration);
  }

  // Process in reverse topological order
  for (let i = sorted.length - 1; i >= 0; i--) {
    const id = sorted[i];
    const task = taskMap.get(id)!;
    const succs = successors.get(id) || [];

    let latestFinish = projectDuration;

    for (const succ of succs) {
      const succTask = taskMap.get(succ.succId);
      if (!succTask) continue;
      const succLS = ls.get(succ.succId) || projectDuration;
      const succLF = lf.get(succ.succId) || projectDuration;

      switch (succ.type) {
        case 'FS':
          latestFinish = Math.min(latestFinish, succLS - succ.lag);
          break;
        case 'SS':
          latestFinish = Math.min(latestFinish, succLS - succ.lag + task.duration);
          break;
        case 'FF':
          latestFinish = Math.min(latestFinish, succLF - succ.lag);
          break;
        case 'SF':
          latestFinish = Math.min(latestFinish, succLF - succ.lag + task.duration);
          break;
      }
    }

    lf.set(id, latestFinish);
    ls.set(id, latestFinish - task.duration);
  }

  // ── COMPUTE FLOAT & CRITICAL PATH ──
  const schedule = new Map<string, TaskScheduleInfo>();
  const criticalPath: string[] = [];

  for (const t of tasks) {
    const taskES = es.get(t.id) || 0;
    const taskLS = ls.get(t.id) || 0;
    const totalFloat = taskLS - taskES;
    const isCrit = totalFloat <= 0;

    schedule.set(t.id, {
      taskId: t.id,
      es: taskES,
      ef: ef.get(t.id) || 0,
      ls: taskLS,
      lf: lf.get(t.id) || 0,
      float: Math.max(0, totalFloat),
      isCritical: isCrit,
    });

    if (isCrit) criticalPath.push(t.id);
  }

  return {
    criticalPath,
    taskSchedule: schedule,
    totalProjectDuration: projectDuration,
    projectEndDate: addDaysToDate(projectStartDate, projectDuration),
  };
}

// ==================== RIPPLE EFFECT ====================

/**
 * When a task's duration changes, propagate the change through the network.
 * Returns updated tasks with adjusted start/end dates.
 */
export function rippleEffect(
  tasks: ProjectTask[],
  changedTaskId: string,
  newEndDate: string
): ProjectTask[] {
  const updated = tasks.map(t => ({ ...t }));
  const taskMap = new Map(updated.map(t => [t.id, t]));
  const changedTask = taskMap.get(changedTaskId);
  if (!changedTask) return updated;

  // Update the changed task
  changedTask.endDate = newEndDate;
  changedTask.duration = daysBetween(changedTask.startDate, newEndDate);

  // BFS through successors to propagate changes
  const visited = new Set<string>();
  const queue: string[] = [changedTaskId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const current = taskMap.get(currentId)!;

    // Find all tasks that depend on current
    for (const t of updated) {
      if (!t.dependencies) continue;
      for (const dep of t.dependencies) {
        if (dep.taskId !== currentId) continue;
        const lag = t.lagTime || 0;

        let newStart: string | null = null;
        switch (dep.type) {
          case 'FS':
            newStart = addDaysToDate(current.endDate, lag);
            break;
          case 'SS':
            newStart = addDaysToDate(current.startDate, lag);
            break;
          case 'FF':
            // Ensure t finishes after current finishes + lag
            const requiredEnd = addDaysToDate(current.endDate, lag);
            if (t.endDate < requiredEnd) {
              newStart = addDaysToDate(requiredEnd, -t.duration);
            }
            break;
          case 'SF':
            const reqEnd = addDaysToDate(current.startDate, lag);
            if (t.endDate < reqEnd) {
              newStart = addDaysToDate(reqEnd, -t.duration);
            }
            break;
        }

        if (newStart && newStart > t.startDate) {
          t.startDate = newStart;
          t.endDate = addDaysToDate(newStart, t.duration);
          queue.push(t.id);
        }
      }
    }
  }

  return updated;
}

// ==================== DAMAGE CALCULATION ====================

/**
 * Compute financial damage for a delayed task.
 * 
 * Thiệt hại = (Chi phí nhân công/ngày + Chi phí máy/ngày) × Số ngày trễ
 */
export function computeTaskDamage(
  task: ProjectTask,
  delayDays: number,
  avgDailySalary: number = 400000 // VNĐ — trung bình 1 công nhân/ngày
): DamageEstimate {
  const resourceCount = task.resourceCount || 1;
  const costPerDay = task.estimatedCostPerDay || 0;

  const laborCostPerDay = task.resourceType === 'machine' ? 0 : resourceCount * avgDailySalary;
  const machineCostPerDay = task.resourceType === 'machine' ? costPerDay : 0;
  const totalDamage = (laborCostPerDay + machineCostPerDay) * delayDays;

  return {
    taskId: task.id,
    taskName: task.name,
    delayDays,
    laborCostPerDay,
    machineCostPerDay,
    totalDamage,
  };
}

// ==================== UTILITY ====================

/**
 * Compute delay days for a task based on baseline.
 */
export function getDelayDays(task: ProjectTask): number {
  if (!task.baselineEnd) return 0;
  const baseEnd = new Date(task.baselineEnd).getTime();
  const actualEnd = new Date(task.endDate).getTime();
  const diff = Math.ceil((actualEnd - baseEnd) / 86400000);
  return Math.max(0, diff);
}

/**
 * Summary stats from critical path result.
 */
export function getCriticalPathStats(result: CriticalPathResult, tasks: ProjectTask[]) {
  const criticalTasks = tasks.filter(t => result.criticalPath.includes(t.id));
  const totalFloat = Array.from(result.taskSchedule.values()).reduce((s, v) => s + v.float, 0);
  const avgFloat = result.taskSchedule.size > 0 ? totalFloat / result.taskSchedule.size : 0;

  return {
    criticalTaskCount: criticalTasks.length,
    totalTasks: tasks.length,
    totalProjectDuration: result.totalProjectDuration,
    projectEndDate: result.projectEndDate,
    avgFloat: Math.round(avgFloat * 10) / 10,
    criticalTaskNames: criticalTasks.map(t => t.name),
  };
}
