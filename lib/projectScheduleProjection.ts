import type { DailyLog, ProjectTask } from '../types';
import { computeCriticalPath } from './criticalPathEngine';
import { clampProgress, getLeafProjectTasks, getTaskProgressWeight } from './projectScheduleRules';

const DAY_MS = 86400000;

export type ProjectScheduleProjectionStatus = 'ahead' | 'on_track' | 'late' | 'insufficient_data';
export type ProjectScheduleProjectionMethod = 'critical_path' | 'max_end_date' | 'none';

export interface TaskProjectionDates {
  actualStart?: string;
  actualEnd?: string;
}

export interface ProjectScheduleProjectionInput {
  tasks: ProjectTask[];
  dailyLogs?: DailyLog[];
  todayIso: string;
  taskActualDates?: Map<string, TaskProjectionDates> | Record<string, TaskProjectionDates>;
}

export interface TaskScheduleProjection {
  taskId: string;
  plannedPercent: number;
  actualProgress: number;
  weight: number;
  actualStart?: string;
  actualEnd?: string;
  forecastStart: string;
  forecastEnd: string;
  forecastDurationDays: number;
  remainingDays: number;
  dayDelta: number;
  endBasisLabel: 'Kết thúc TT' | 'Dự kiến TT';
}

export interface ProjectScheduleProjectionResult {
  projectStart: string;
  projectEnd: string;
  baselineDurationDays: number;
  plannedProgressPercent: number;
  actualProgressPercent: number;
  progressVariancePercent: number;
  spi: number | null;
  spiDurationDays: number | null;
  spiDeltaDays: number | null;
  spiStatus: ProjectScheduleProjectionStatus;
  forecastProjectEnd: string;
  forecastDurationDays: number;
  forecastDeltaDays: number;
  forecastMethod: ProjectScheduleProjectionMethod;
  criticalTaskIds: string[];
  taskProjections: Map<string, TaskScheduleProjection>;
}

const toIsoDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeIsoDate = (iso?: string | null): string | undefined => {
  if (!iso) return undefined;
  const value = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
};

const parseIsoDate = (iso?: string | null): Date | null => {
  const value = normalizeIsoDate(iso);
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const diffDays = (from?: string, to?: string): number => {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
};

const addDays = (iso: string, amount: number): string => {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
};

const inclusiveDays = (start?: string, end?: string): number => {
  if (!start || !end) return 0;
  return Math.max(1, diffDays(start, end) + 1);
};

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const minIso = (values: string[]): string =>
  values.filter(Boolean).reduce((min, value) => (!min || value < min ? value : min), '');

const maxIso = (values: string[]): string =>
  values.filter(Boolean).reduce((max, value) => (!max || value > max ? value : max), '');

const getPlannedDurationDays = (task: ProjectTask): number =>
  inclusiveDays(task.startDate, task.endDate) || Math.max(1, Number(task.duration || 1));

const getPlannedPercentAt = (task: ProjectTask, todayIso: string): number => {
  const startDate = normalizeIsoDate(task.startDate);
  const endDate = normalizeIsoDate(task.endDate);
  if (!startDate || !endDate || todayIso < startDate) return 0;
  if (todayIso >= endDate) return 100;

  const total = inclusiveDays(startDate, endDate);
  const elapsed = inclusiveDays(startDate, todayIso);
  return total > 0 ? round1(Math.min(100, Math.max(0, (elapsed / total) * 100))) : 0;
};

const getProvidedActualDates = (
  taskId: string,
  dates?: Map<string, TaskProjectionDates> | Record<string, TaskProjectionDates>,
): TaskProjectionDates | undefined => {
  if (!dates) return undefined;
  if (dates instanceof Map) return dates.get(taskId);
  return dates[taskId];
};

const deriveActualDatesFromLogs = (
  task: ProjectTask,
  dailyLogs: DailyLog[] = [],
): TaskProjectionDates => {
  let actualStart = normalizeIsoDate(task.actualStartDate);
  let actualEnd = normalizeIsoDate(task.actualEndDate);

  if (!actualStart || !actualEnd) {
    const linkedDates = dailyLogs
      .filter(log => {
        const verified = log.status === 'verified' || log.verified;
        if (!verified) return false;

        const hasDelayLink = (log.delayTasks || []).some(delay => delay.taskId === task.id);
        const hasVolumeLink = (log.volumes || []).some(volume => volume.taskId === task.id);
        const hasLaborLink = (log.laborDetails || []).some(labor => labor.taskId === task.id);
        const hasMachineLink = (log.machines || []).some(machine => machine.taskId === task.id);
        return hasDelayLink || hasVolumeLink || hasLaborLink || hasMachineLink;
      })
      .map(log => normalizeIsoDate(log.date))
      .filter(Boolean) as string[];

    linkedDates.sort();
    if (linkedDates.length > 0) {
      if (!actualStart) actualStart = linkedDates[0];
      if (!actualEnd && (clampProgress(task.progress) >= 100 || task.gateStatus === 'approved')) {
        actualEnd = linkedDates[linkedDates.length - 1];
      }
    }
  }

  if (!actualEnd && task.gateStatus === 'approved') {
    actualEnd = normalizeIsoDate(task.gateApprovedAt);
  }

  return { actualStart, actualEnd };
};

const getTaskActualDates = (
  task: ProjectTask,
  dailyLogs: DailyLog[],
  provided?: Map<string, TaskProjectionDates> | Record<string, TaskProjectionDates>,
): TaskProjectionDates => {
  const override = getProvidedActualDates(task.id, provided);
  if (override) {
    return {
      actualStart: normalizeIsoDate(override.actualStart),
      actualEnd: normalizeIsoDate(override.actualEnd),
    };
  }

  return deriveActualDatesFromLogs(task, dailyLogs);
};

const buildTaskProjection = (
  task: ProjectTask,
  todayIso: string,
  dailyLogs: DailyLog[],
  taskActualDates?: Map<string, TaskProjectionDates> | Record<string, TaskProjectionDates>,
): TaskScheduleProjection => {
  const progress = clampProgress(task.progress);
  const plannedDurationDays = getPlannedDurationDays(task);
  const plannedPercent = getPlannedPercentAt(task, todayIso);
  const { actualStart, actualEnd } = getTaskActualDates(task, dailyLogs, taskActualDates);

  let forecastStart = actualStart || normalizeIsoDate(task.startDate) || todayIso;
  let forecastEnd = normalizeIsoDate(task.endDate) || todayIso;
  let remainingDays = 0;
  let endBasisLabel: TaskScheduleProjection['endBasisLabel'] = 'Dự kiến TT';

  if (progress >= 100) {
    forecastEnd = actualEnd || todayIso;
    forecastStart = actualStart || normalizeIsoDate(task.startDate) || forecastEnd;
    endBasisLabel = 'Kết thúc TT';
  } else if (progress > 0) {
    forecastStart = actualStart || (task.startDate && task.startDate <= todayIso ? task.startDate : todayIso);
    const elapsedDays = Math.max(1, inclusiveDays(forecastStart, todayIso));
    const velocityPerDay = progress / elapsedDays;
    remainingDays = velocityPerDay > 0 ? Math.max(1, Math.ceil((100 - progress) / velocityPerDay)) : plannedDurationDays;
    forecastEnd = addDays(todayIso, remainingDays);
  } else if (task.startDate && todayIso > task.startDate) {
    forecastStart = todayIso;
    remainingDays = plannedDurationDays;
    forecastEnd = addDays(todayIso, plannedDurationDays - 1);
  } else {
    forecastStart = normalizeIsoDate(task.startDate) || todayIso;
    forecastEnd = normalizeIsoDate(task.endDate) || addDays(forecastStart, plannedDurationDays - 1);
    remainingDays = plannedDurationDays;
  }

  if (progress < 100 && forecastEnd < todayIso) {
    forecastEnd = todayIso;
  }

  return {
    taskId: task.id,
    plannedPercent,
    actualProgress: progress,
    weight: getTaskProgressWeight(task),
    actualStart,
    actualEnd,
    forecastStart,
    forecastEnd,
    forecastDurationDays: inclusiveDays(forecastStart, forecastEnd),
    remainingDays,
    dayDelta: task.endDate ? diffDays(task.endDate, forecastEnd) : 0,
    endBasisLabel,
  };
};

const buildCriticalPathTasks = (
  tasks: ProjectTask[],
  projections: Map<string, TaskScheduleProjection>,
): ProjectTask[] => {
  return tasks.map(task => {
    const projection = projections.get(task.id);
    if (!projection) return task;

    return {
      ...task,
      startDate: projection.forecastStart,
      endDate: projection.forecastEnd,
      duration: Math.max(0, diffDays(projection.forecastStart, projection.forecastEnd)),
    };
  });
};

const getProjectionStatus = (
  spi: number | null,
  progressVariancePercent: number,
): ProjectScheduleProjectionStatus => {
  if (spi === null) return 'insufficient_data';
  if (progressVariancePercent < -5) return 'late';
  if (progressVariancePercent > 5) return 'ahead';
  return 'on_track';
};

export const buildProjectScheduleProjection = ({
  tasks,
  dailyLogs = [],
  todayIso,
  taskActualDates,
}: ProjectScheduleProjectionInput): ProjectScheduleProjectionResult => {
  const normalizedToday = normalizeIsoDate(todayIso) || toIsoDate(new Date());
  const taskProjections = new Map<string, TaskScheduleProjection>();

  for (const task of tasks) {
    taskProjections.set(task.id, buildTaskProjection(task, normalizedToday, dailyLogs, taskActualDates));
  }

  const projectStart = minIso(tasks.map(task => normalizeIsoDate(task.startDate)).filter(Boolean) as string[]);
  const projectEnd = maxIso(tasks.map(task => normalizeIsoDate(task.endDate)).filter(Boolean) as string[]);
  const baselineDurationDays = projectStart && projectEnd ? inclusiveDays(projectStart, projectEnd) : 0;

  const leafTasks = getLeafProjectTasks(tasks);
  const progressTasks = leafTasks.length > 0 ? leafTasks : tasks;
  const totalWeight = progressTasks.reduce((sum, task) => sum + getTaskProgressWeight(task), 0);
  const plannedProgressPercent = totalWeight > 0
    ? round1(progressTasks.reduce((sum, task) => {
      const projection = taskProjections.get(task.id);
      return sum + (projection?.plannedPercent || 0) * getTaskProgressWeight(task);
    }, 0) / totalWeight)
    : 0;
  const actualProgressPercent = totalWeight > 0
    ? round1(progressTasks.reduce((sum, task) => {
      const projection = taskProjections.get(task.id);
      return sum + (projection?.actualProgress || 0) * getTaskProgressWeight(task);
    }, 0) / totalWeight)
    : 0;
  const progressVariancePercent = round1(actualProgressPercent - plannedProgressPercent);
  const spi = plannedProgressPercent > 0 ? round3(actualProgressPercent / plannedProgressPercent) : null;
  const spiDurationDays = spi && spi > 0 && baselineDurationDays > 0
    ? Math.round(baselineDurationDays / spi)
    : null;
  const spiDeltaDays = spiDurationDays !== null ? spiDurationDays - baselineDurationDays : null;

  const forecastRows = progressTasks
    .map(task => taskProjections.get(task.id))
    .filter(Boolean) as TaskScheduleProjection[];
  const fallbackForecastEnd = maxIso(forecastRows.map(row => row.forecastEnd));
  const criticalResult = tasks.length > 0
    ? computeCriticalPath(buildCriticalPathTasks(tasks, taskProjections))
    : { criticalPath: [], taskSchedule: new Map(), totalProjectDuration: 0, projectEndDate: '' };
  const criticalEnd = normalizeIsoDate(criticalResult.projectEndDate);
  const hasCriticalForecast = Boolean(criticalEnd && criticalResult.criticalPath.length > 0);
  const forecastProjectEnd = maxIso([hasCriticalForecast ? criticalEnd! : '', fallbackForecastEnd]);
  const forecastMethod: ProjectScheduleProjectionMethod = hasCriticalForecast
    ? 'critical_path'
    : fallbackForecastEnd
      ? 'max_end_date'
      : 'none';
  const forecastDurationDays = projectStart && forecastProjectEnd ? inclusiveDays(projectStart, forecastProjectEnd) : 0;
  const forecastDeltaDays = projectEnd && forecastProjectEnd ? diffDays(projectEnd, forecastProjectEnd) : 0;

  return {
    projectStart,
    projectEnd,
    baselineDurationDays,
    plannedProgressPercent,
    actualProgressPercent,
    progressVariancePercent,
    spi,
    spiDurationDays,
    spiDeltaDays,
    spiStatus: getProjectionStatus(spi, progressVariancePercent),
    forecastProjectEnd,
    forecastDurationDays,
    forecastDeltaDays,
    forecastMethod,
    criticalTaskIds: criticalResult.criticalPath,
    taskProjections,
  };
};

