// Tiến độ thực tế một tuần (chủ SP duyệt 15/10/2026): số lấy từ nhật ký CHT đã duyệt; tuần chỉ "Xác nhận" để khóa.
// Hàm thuần — dữ liệu từ get_project_actual_progress_week_v1.
import type { ProjectTask } from '../types';
import { getTaskProgressWeight } from './projectScheduleRules';

export interface ActualProgressWeekDay {
  date: string;
  summaryId: string | null;
  summaryStatus: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  authors: string | null;
  photos: number;
  progressRows: number;
}

export interface ActualProgressWeekTask {
  id: string;
  wbsCode: string | null;
  name: string;
  sortOrder: number | null;
  groupId: string | null;
  groupName: string | null;
  groupWbs: string | null;
  unit: string | null;
  plannedQuantity: number | null;
  currentPercent: number | null;
  progressMode: string | null;
  startDate: string;
  endDate: string;
  duration: number | null;
  isMilestone: boolean | null;
  resourceCount: number | null;
  estimatedCostPerDay: number | null;
  beforePercent: number | null;
  beforeQuantity: number | null;
}

export interface ActualProgressEntry {
  id: string;
  taskId: string;
  date: string;
  percent: number;
  quantity: number | null;
  dailyQuantity: number | null;
  sourceDailyLogId: string | null;
  updatedAt: string;
}

export interface ActualProgressPending {
  taskId: string;
  date: string;
  percent: number;
  dailyQuantity: number | null;
}

export interface ActualProgressWeek {
  weekStart: string;
  source: 'daily_log' | 'manual';
  cutoverDate: string | null;
  /** Ngày gần nhất có nhật ký CHT đã duyệt (cả dự án). */
  latestApprovedDate?: string | null;
  canConfirm: boolean;
  canEditException: boolean;
  state: { isLocked: boolean; lockedAt: string | null; lockedByName: string | null; unlockedAt: string | null; unlockReason: string | null } | null;
  days: ActualProgressWeekDay[];
  tasks: ActualProgressWeekTask[];
  entries: ActualProgressEntry[];
  pending: ActualProgressPending[];
}

export type ActualDayStatus = 'approved' | 'pending' | 'not_sent' | 'missing' | 'today' | 'future' | 'off' | 'before_cutover';

export const ACTUAL_DAY_LABEL: Record<ActualDayStatus, string> = {
  approved: 'Đã duyệt',
  pending: 'Chờ CHT duyệt',
  not_sent: 'Chưa gửi CHT',
  missing: 'Chưa có nhật ký',
  today: 'Hôm nay',
  future: '—',
  off: 'Nghỉ',
  before_cutover: 'Chốt tay',
};

const EPS = 1e-6;
export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return addDays(iso, -((d.getDay() + 6) % 7));
};
export const isoWeekNumber = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  return 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
};

export const getActualDayStatus = (day: ActualProgressWeekDay, today: string, cutoverDate: string | null): ActualDayStatus => {
  if (day.date > today) return 'future';
  if (cutoverDate && day.date < cutoverDate) return day.progressRows > 0 ? 'before_cutover' : 'missing';
  if (day.summaryStatus === 'verified') return 'approved';
  if (day.summaryStatus === 'submitted') return 'pending';
  if (day.summaryStatus || day.authors) return day.date === today ? 'today' : 'not_sent';
  if (day.date === today) return 'today';
  return new Date(`${day.date}T00:00:00`).getDay() === 0 ? 'off' : 'missing';
};

/** Ngày có số tiến độ được tính (đã duyệt, hoặc chốt tay trước mốc chính thức). */
export const dayCounts = (status: ActualDayStatus) => status === 'approved' || status === 'before_cutover';

export interface ActualProgressRow {
  task: ActualProgressWeekTask;
  beforePercent: number;
  beforeQuantity: number | null;
  periodQuantity: number;
  afterPercent: number;
  afterQuantity: number | null;
  pendingQuantity: number;
  pendingPercent: number | null;
  moved: boolean;
  recordedDates: string[];
}

const baselineOf = (task: ActualProgressWeekTask, hasEntries: boolean) => ({
  percent: task.beforePercent ?? (hasEntries ? 0 : Number(task.currentPercent || 0)),
  quantity: task.beforeQuantity,
});

/** Dòng mỗi việc lá cho cả tuần (day = null) hoặc một ngày. Chỉ tính ngày có số chính thức. */
export const buildActualProgressRows = (
  week: ActualProgressWeek,
  countedDates: Set<string>,
  day: string | null,
): ActualProgressRow[] => {
  const entriesByTask = new Map<string, ActualProgressEntry[]>();
  for (const entry of week.entries) {
    if (!countedDates.has(entry.date)) continue;
    const list = entriesByTask.get(entry.taskId) || [];
    list.push(entry);
    entriesByTask.set(entry.taskId, list);
  }
  for (const list of entriesByTask.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt));

  return week.tasks.map(task => {
    const entries = entriesByTask.get(task.id) || [];
    const base = baselineOf(task, entries.length > 0 || task.beforePercent != null);
    const priorEntries = day ? entries.filter(e => e.date < day) : [];
    const prior = priorEntries[priorEntries.length - 1];
    const beforePercent = prior ? Number(prior.percent) : base.percent;
    const beforeQuantity = prior ? prior.quantity : base.quantity;
    const inPeriod = day ? entries.filter(e => e.date === day) : entries;
    const last = inPeriod[inPeriod.length - 1];
    const afterPercent = last ? Number(last.percent) : beforePercent;
    const afterQuantity = last ? last.quantity : beforeQuantity;
    const periodQuantity = inPeriod.reduce((sum, e) => sum + Math.max(0, Number(e.dailyQuantity || 0)), 0);
    const pending = week.pending.filter(p => p.taskId === task.id && (!day || p.date === day));
    const pendingQuantity = pending.reduce((sum, p) => sum + Math.max(0, Number(p.dailyQuantity || 0)), 0);
    const pendingPercent = pending.length ? Math.max(...pending.map(p => Number(p.percent))) : null;
    return {
      task,
      beforePercent,
      beforeQuantity,
      periodQuantity,
      afterPercent,
      afterQuantity,
      pendingQuantity,
      pendingPercent,
      moved: periodQuantity > EPS || afterPercent > beforePercent + EPS,
      recordedDates: Array.from(new Set(entries
        .filter((e, i) => Number(e.dailyQuantity || 0) > EPS
          || Number(e.percent) > (i === 0 ? base.percent : Number(entries[i - 1].percent)) + EPS)
        .map(e => e.date))),
    };
  });
};

const taskWeight = (task: ActualProgressWeekTask) => getTaskProgressWeight({
  id: task.id,
  name: task.name,
  startDate: task.startDate,
  endDate: task.endDate,
  duration: Number(task.duration || 0),
  isMilestone: !!task.isMilestone,
  resourceCount: Number(task.resourceCount || 0),
  estimatedCostPerDay: Number(task.estimatedCostPerDay || 0),
  progress: 0,
} as ProjectTask);

const clampPct = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

/** % tiến độ thi công cả dự án (cùng trọng số với Gantt), trước và sau kỳ. */
export const summarizeActualProgress = (rows: ActualProgressRow[]) => {
  let total = 0, before = 0, after = 0;
  for (const row of rows) {
    const w = taskWeight(row.task);
    total += w;
    before += clampPct(row.beforePercent) * w;
    after += clampPct(row.afterPercent) * w;
  }
  return {
    beforePercent: total > 0 ? before / total : null,
    afterPercent: total > 0 ? after / total : null,
    movedCount: rows.filter(r => r.moved).length,
  };
};

/** Số điểm % dự án tăng trong một ngày (để hiện trên dải ngày). */
export const dayGain = (week: ActualProgressWeek, countedDates: Set<string>, date: string) => {
  const { beforePercent, afterPercent } = summarizeActualProgress(buildActualProgressRows(week, countedDates, date));
  return beforePercent == null || afterPercent == null ? null : afterPercent - beforePercent;
};

export const pendingDayGain = (week: ActualProgressWeek, countedDates: Set<string>, date: string) => {
  const rows = buildActualProgressRows(week, countedDates, date);
  let total = 0, gain = 0;
  for (const row of rows) {
    const w = taskWeight(row.task);
    total += w;
    if (row.pendingPercent != null) gain += (clampPct(row.pendingPercent) - clampPct(row.beforePercent)) * w;
  }
  return total > 0 ? gain / total : null;
};

export type ConfirmBlock = 'not_ended' | 'locked' | 'no_permission' | 'manual' | null;
export const getConfirmBlock = (week: ActualProgressWeek, today: string): ConfirmBlock => {
  if (week.source !== 'daily_log') return 'manual';
  if (week.state?.isLocked) return 'locked';
  if (!week.canConfirm) return 'no_permission';
  if (addDays(week.weekStart, 6) >= today) return 'not_ended';
  return null;
};

/** Lần mở đầu: tuần này chưa có nhật ký duyệt thì mở tuần có nhật ký duyệt gần nhất. */
export const getAutoJumpWeek = (week: ActualProgressWeek): string | null => {
  if (week.source !== 'daily_log' || !week.latestApprovedDate) return null;
  if (week.days.some(d => d.summaryStatus === 'verified')) return null;
  const target = mondayOf(week.latestApprovedDate);
  return target < week.weekStart ? target : null;
};
