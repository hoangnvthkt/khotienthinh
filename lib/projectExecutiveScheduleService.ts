import type { DailyLog, ProjectTask, ProjectTaskCompletionRequest } from '../types';
import { buildProjectScheduleProjection, type TaskProjectionDates } from './projectScheduleProjection';
import {
  clampProgress,
  deriveProjectTaskProgress,
  getLeafProjectTasks,
} from './projectScheduleRules';

const DAY_MS = 86400000;

export type ExecutiveScheduleTaskStatus =
  | 'active'
  | 'completed'
  | 'late'
  | 'upcoming'
  | 'not_started'
  | 'on_track';

export interface ExecutiveScheduleTaskRow {
  taskId: string;
  name: string;
  wbsCode?: string;
  assignee?: string;
  level: number;
  hasChildren: boolean;
  isLeaf: boolean;
  startDate?: string;
  plannedEndDate?: string;
  actualStart?: string;
  actualEnd?: string;
  forecastEnd: string;
  endBasisLabel: string;
  plannedDays: number;
  plannedPercent: number;
  actualProgress: number;
  progressDelta: number;
  dayDelta: number;
  startDelta: number;
  delayDays: number;
  status: ExecutiveScheduleTaskStatus;
  note: string;
}

export interface ExecutiveScheduleSummary {
  todayIso: string;
  projectStart: string;
  projectEnd: string;
  projectDurationDays: number;
  calendarElapsedDays: number;
  verifiedLogDays: number;
  forecastProjectEnd: string;
  forecastDurationDays: number;
  forecastDeltaDays: number;
  plannedProgress: number;
  actualProgress: number;
  progressVariance: number;
  rows: ExecutiveScheduleTaskRow[];
  activeRows: ExecutiveScheduleTaskRow[];
  completedRows: ExecutiveScheduleTaskRow[];
  lateRows: ExecutiveScheduleTaskRow[];
  upcomingRows: ExecutiveScheduleTaskRow[];
  notStartedRows: ExecutiveScheduleTaskRow[];
}

export interface BuildExecutiveScheduleSummaryInput {
  tasks: ProjectTask[];
  dailyLogs?: DailyLog[];
  completionRequests?: ProjectTaskCompletionRequest[];
  todayIso?: string;
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

const inclusiveDays = (start?: string, end?: string): number => {
  if (!start || !end) return 0;
  return Math.max(1, diffDays(start, end) + 1);
};

const addDays = (iso: string, amount: number): string => {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
};

const compareWbsCodes = (a = '', b = ''): number => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const max = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < max; i += 1) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (!Number.isFinite(va) || !Number.isFinite(vb)) return a.localeCompare(b, 'vi');
    if (va !== vb) return va - vb;
  }

  return a.localeCompare(b, 'vi');
};

const buildLevelMap = (tasks: ProjectTask[]): Map<string, number> => {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const cache = new Map<string, number>();

  const getLevel = (task: ProjectTask): number => {
    if (cache.has(task.id)) return cache.get(task.id)!;
    if (!task.parentId || !byId.has(task.parentId)) {
      cache.set(task.id, 0);
      return 0;
    }
    const parent = byId.get(task.parentId)!;
    const level = Math.min(6, getLevel(parent) + 1);
    cache.set(task.id, level);
    return level;
  };

  tasks.forEach(getLevel);
  return cache;
};

const buildDelayMap = (dailyLogs: DailyLog[]): Map<string, { days: number; reasons: string[] }> => {
  const map = new Map<string, { days: number; reasons: string[] }>();

  for (const log of dailyLogs) {
    for (const delay of log.delayTasks || []) {
      if (!delay.taskId) continue;
      const current = map.get(delay.taskId) || { days: 0, reasons: [] };
      const reason = delay.reason?.trim();
      map.set(delay.taskId, {
        days: current.days + Number(delay.delayDays || 0),
        reasons: reason && !current.reasons.includes(reason)
          ? [...current.reasons, reason]
          : current.reasons,
      });
    }
  }

  return map;
};

const logTouchesTask = (log: DailyLog, taskId: string): boolean => {
  const hasDelayLink = (log.delayTasks || []).some(delay => delay.taskId === taskId);
  const hasVolumeLink = (log.volumes || []).some(volume => volume.taskId === taskId);
  const hasLaborLink = (log.laborDetails || []).some(labor => labor.taskId === taskId);
  const hasMachineLink = (log.machines || []).some(machine => machine.taskId === taskId);
  return hasDelayLink || hasVolumeLink || hasLaborLink || hasMachineLink;
};

const deriveActualDates = (task: ProjectTask, dailyLogs: DailyLog[]): TaskProjectionDates => {
  let actualStart = normalizeIsoDate(task.actualStartDate);
  let actualEnd = normalizeIsoDate(task.actualEndDate);

  if (!actualStart || !actualEnd) {
    const dates = dailyLogs
      .filter(log => (log.status === 'verified' || log.verified) && logTouchesTask(log, task.id))
      .map(log => normalizeIsoDate(log.date))
      .filter(Boolean) as string[];

    dates.sort();
    if (dates.length > 0) {
      if (!actualStart) actualStart = dates[0];
      if (!actualEnd && (clampProgress(task.progress) >= 100 || task.gateStatus === 'approved')) {
        actualEnd = dates[dates.length - 1];
      }
    }
  }

  if (!actualEnd && task.gateStatus === 'approved') {
    actualEnd = normalizeIsoDate(task.gateApprovedAt);
  }

  return { actualStart, actualEnd };
};

const getTaskStatus = (row: {
  startDate?: string;
  plannedPercent: number;
  actualProgress: number;
  dayDelta: number;
  todayIso: string;
}): ExecutiveScheduleTaskStatus => {
  if (row.actualProgress >= 100) return 'completed';
  if (row.dayDelta > 0 || row.actualProgress + 5 < row.plannedPercent) return 'late';
  if (row.actualProgress > 0) return 'active';
  if (row.startDate && row.todayIso < row.startDate && row.startDate <= addDays(row.todayIso, 14)) return 'upcoming';
  if (row.actualProgress <= 0) return 'not_started';
  return 'on_track';
};

const getVerifiedLogDays = (dailyLogs: DailyLog[]): number => {
  const dates = new Set<string>();
  for (const log of dailyLogs) {
    if (!(log.status === 'verified' || log.verified)) continue;
    const date = normalizeIsoDate(log.date);
    if (date) dates.add(date);
  }
  return dates.size;
};

const sortRows = (rows: ExecutiveScheduleTaskRow[]): ExecutiveScheduleTaskRow[] => (
  [...rows].sort((a, b) =>
    compareWbsCodes(a.wbsCode, b.wbsCode) ||
    a.name.localeCompare(b.name, 'vi'))
);

export const buildExecutiveScheduleSummary = ({
  tasks,
  dailyLogs = [],
  completionRequests = [],
  todayIso,
}: BuildExecutiveScheduleSummaryInput): ExecutiveScheduleSummary => {
  const normalizedToday = normalizeIsoDate(todayIso) || toIsoDate(new Date());
  const derivedTasks = deriveProjectTaskProgress(tasks, completionRequests, dailyLogs, normalizedToday);
  const childCount = new Map<string, number>();
  derivedTasks.forEach(task => {
    if (!task.parentId) return;
    childCount.set(task.parentId, (childCount.get(task.parentId) || 0) + 1);
  });

  const leafIds = new Set(getLeafProjectTasks(derivedTasks).map(task => task.id));
  const levelMap = buildLevelMap(derivedTasks);
  const delayMap = buildDelayMap(dailyLogs);
  const actualDatesByTask = new Map<string, TaskProjectionDates>();

  for (const task of derivedTasks) {
    actualDatesByTask.set(task.id, deriveActualDates(task, dailyLogs));
  }

  const projection = buildProjectScheduleProjection({
    tasks: derivedTasks,
    dailyLogs,
    todayIso: normalizedToday,
    taskActualDates: actualDatesByTask,
  });

  const rows = sortRows(derivedTasks.map(task => {
    const taskProjection = projection.taskProjections.get(task.id);
    const actualDates = actualDatesByTask.get(task.id) || {};
    const plannedDays = inclusiveDays(task.startDate, task.endDate) || Math.max(1, Number(task.duration || 1));
    const plannedPercent = taskProjection?.plannedPercent || 0;
    const actualProgress = taskProjection?.actualProgress ?? clampProgress(task.progress);
    const forecastEnd = taskProjection?.forecastEnd || task.endDate || normalizedToday;
    const dayDelta = taskProjection?.dayDelta ?? (task.endDate ? diffDays(task.endDate, actualProgress >= 100 ? (actualDates.actualEnd || forecastEnd) : forecastEnd) : 0);
    const startDelta = actualDates.actualStart && task.startDate ? diffDays(task.startDate, actualDates.actualStart) : 0;
    const delayInfo = delayMap.get(task.id);
    const status = getTaskStatus({
      startDate: task.startDate,
      plannedPercent,
      actualProgress,
      dayDelta,
      todayIso: normalizedToday,
    });

    return {
      taskId: task.id,
      name: task.name,
      wbsCode: task.wbsCode,
      assignee: task.assignee,
      level: levelMap.get(task.id) || 0,
      hasChildren: (childCount.get(task.id) || 0) > 0,
      isLeaf: leafIds.has(task.id),
      startDate: task.startDate,
      plannedEndDate: task.endDate,
      actualStart: actualDates.actualStart,
      actualEnd: actualDates.actualEnd,
      forecastEnd,
      endBasisLabel: taskProjection?.endBasisLabel || 'Dự kiến TT',
      plannedDays,
      plannedPercent,
      actualProgress,
      progressDelta: Math.round(actualProgress - plannedPercent),
      dayDelta,
      startDelta,
      delayDays: delayInfo?.days || 0,
      status,
      note: [
        task.delayReason,
        delayInfo?.reasons.slice(0, 2).join('; '),
        task.notes,
        dayDelta > 0 && !task.delayReason && !delayInfo?.reasons.length ? 'Cần cập nhật nguyên nhân chậm' : '',
      ].filter(Boolean)[0] || '-',
    };
  }));

  const activeRows = rows.filter(row => row.isLeaf && row.actualProgress > 0 && row.actualProgress < 100);
  const completedRows = rows.filter(row => row.isLeaf && row.actualProgress >= 100);
  const lateRows = rows.filter(row => row.isLeaf && (row.status === 'late' || row.dayDelta > 0));
  const upcomingRows = rows.filter(row =>
    row.isLeaf &&
    row.actualProgress < 100 &&
    row.status !== 'late' &&
    Boolean(row.plannedEndDate) &&
    row.plannedEndDate! >= normalizedToday &&
    row.plannedEndDate! <= addDays(normalizedToday, 14)
  );
  const notStartedRows = rows.filter(row => row.isLeaf && row.actualProgress <= 0 && row.status !== 'upcoming');

  return {
    todayIso: normalizedToday,
    projectStart: projection.projectStart,
    projectEnd: projection.projectEnd,
    projectDurationDays: projection.baselineDurationDays,
    calendarElapsedDays: projection.projectStart ? Math.max(0, inclusiveDays(projection.projectStart, normalizedToday)) : 0,
    verifiedLogDays: getVerifiedLogDays(dailyLogs),
    forecastProjectEnd: projection.forecastProjectEnd,
    forecastDurationDays: projection.forecastDurationDays,
    forecastDeltaDays: projection.forecastDeltaDays,
    plannedProgress: Math.round(projection.plannedProgressPercent),
    actualProgress: Math.round(projection.actualProgressPercent),
    progressVariance: Math.round(projection.progressVariancePercent),
    rows,
    activeRows,
    completedRows,
    lateRows,
    upcomingRows,
    notStartedRows,
  };
};
