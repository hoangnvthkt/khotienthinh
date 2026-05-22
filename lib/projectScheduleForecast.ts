import type { ProjectDelayEvent, ProjectTask } from '../types';
import { computeCriticalPath, rippleEffect, type CriticalPathResult } from './criticalPathEngine';

const DAY_MS = 86400000;
const ACTIVE_DELAY_STATUSES = new Set<ProjectDelayEvent['status']>(['reported', 'accepted']);

const daysBetween = (a: string, b: string): number => {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.ceil((d2.getTime() - d1.getTime()) / DAY_MS);
};

const maxEndDate = (tasks: ProjectTask[]): string => {
  const dates = tasks.map(task => task.endDate).filter(Boolean).sort();
  return dates[dates.length - 1] || '';
};

const sameSchedule = (a: ProjectTask, b: ProjectTask): boolean =>
  a.startDate === b.startDate && a.endDate === b.endDate && Number(a.duration || 0) === Number(b.duration || 0);

export interface ScheduleForecastTaskMeta {
  taskId: string;
  deltaDays: number;
  wasCritical: boolean;
  floatBefore: number;
  sourceDelayDays: number;
}

export interface ScheduleForecastResult {
  activeDelayEvents: ProjectDelayEvent[];
  forecastTasks: ProjectTask[];
  forecastTaskMap: Map<string, ProjectTask>;
  changedTasks: ProjectTask[];
  changedTaskIds: Set<string>;
  impactedTaskIds: Set<string>;
  taskForecastMeta: Map<string, ScheduleForecastTaskMeta>;
  baseCriticalPath: CriticalPathResult | null;
  forecastCriticalPath: CriticalPathResult | null;
  baseProjectEndDate: string;
  forecastProjectEndDate: string;
  projectEndDeltaDays: number;
}

export const buildScheduleForecast = (
  tasks: ProjectTask[],
  delayEvents: ProjectDelayEvent[],
): ScheduleForecastResult => {
  const activeDelayEvents = delayEvents
    .filter(event => ACTIVE_DELAY_STATUSES.has(event.status) && !!event.taskId && Number(event.impactDays || 0) > 0)
    .slice()
    .sort((a, b) => `${a.occurredOn || ''}${a.createdAt || ''}`.localeCompare(`${b.occurredOn || ''}${b.createdAt || ''}`));

  const originalById = new Map(tasks.map(task => [task.id, task]));
  const sourceDelayByTaskId = new Map<string, number>();
  let forecastTasks: ProjectTask[] = tasks.map(task => ({ ...task, dependencies: task.dependencies ? [...task.dependencies] : undefined }));

  for (const event of activeDelayEvents) {
    const taskId = event.taskId || '';
    if (!taskId || !originalById.has(taskId)) continue;
    const impactDays = Math.ceil(Number(event.impactDays || 0));
    if (impactDays <= 0) continue;

    sourceDelayByTaskId.set(taskId, (sourceDelayByTaskId.get(taskId) || 0) + impactDays);
    const current = forecastTasks.find(task => task.id === taskId);
    if (!current) continue;
    forecastTasks = rippleEffect(forecastTasks, taskId, addDays(current.endDate, impactDays));
  }

  const forecastTaskMap = new Map(forecastTasks.map(task => [task.id, task]));
  const baseCriticalPath = tasks.length > 0 ? computeCriticalPath(tasks) : null;
  const forecastCriticalPath = forecastTasks.length > 0 ? computeCriticalPath(forecastTasks) : null;
  const baseProjectEndDate = maxEndDate(tasks);
  const forecastProjectEndDate = maxEndDate(forecastTasks);
  const changedTasks = forecastTasks.filter(task => {
    const original = originalById.get(task.id);
    return !!original && !sameSchedule(original, task);
  });
  const changedTaskIds = new Set(changedTasks.map(task => task.id));
  const impactedTaskIds = new Set(changedTasks.filter(task => !sourceDelayByTaskId.has(task.id)).map(task => task.id));
  const taskForecastMeta = new Map<string, ScheduleForecastTaskMeta>();

  changedTasks.forEach(task => {
    const original = originalById.get(task.id)!;
    const baseSchedule = baseCriticalPath?.taskSchedule.get(task.id);
    taskForecastMeta.set(task.id, {
      taskId: task.id,
      deltaDays: daysBetween(original.endDate, task.endDate),
      wasCritical: !!baseSchedule?.isCritical,
      floatBefore: baseSchedule?.float || 0,
      sourceDelayDays: sourceDelayByTaskId.get(task.id) || 0,
    });
  });

  return {
    activeDelayEvents,
    forecastTasks,
    forecastTaskMap,
    changedTasks,
    changedTaskIds,
    impactedTaskIds,
    taskForecastMeta,
    baseCriticalPath,
    forecastCriticalPath,
    baseProjectEndDate,
    forecastProjectEndDate,
    projectEndDeltaDays: baseProjectEndDate && forecastProjectEndDate
      ? daysBetween(baseProjectEndDate, forecastProjectEndDate)
      : 0,
  };
};

const addDays = (date: string, days: number): string => {
  const dt = new Date(date);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().split('T')[0];
};
