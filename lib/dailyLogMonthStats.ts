import type { DailyLog } from '../types';
import { isDailyLogSummaryRow } from './dailyLogWorkflow';

export interface DailyLogMonthStats {
  /** Distinct days with at least one log, all time. */
  daysWithLogs: number;
  /** Distinct days with at least one log in the month. */
  monthDays: number;
  /** Average workers per day over days that recorded labor; null when none did. */
  avgWorkers: number | null;
  /** Days in the month that recorded labor. */
  workerDays: number;
  rainyDays: number;
  /** Days with an incident on the summary, on an individual log, or on a sent slip. */
  issueDays: number;
}

const dayOf = (value: string) => value.slice(0, 10);

// Source-slip summaries store labor as physical lines per work item; legacy
// logs keep a head count. A zero means "not recorded", never "nobody worked".
const workersOf = (log: DailyLog): number => {
  const lines = log.laborDetails || [];
  if (log.normalizedWbs) {
    return lines.reduce((sum, line) => sum + Math.max(0, Number((line as { peopleCount?: number }).peopleCount ?? line.count ?? 0)), 0);
  }
  if (Number(log.workerCount) > 0) return Number(log.workerCount);
  return lines.reduce((sum, line) => sum + Math.max(0, Number(line.count || 0)), 0);
};

/**
 * Month figures for the Daily Log landing cards. On a day that has a summary,
 * only the summary counts: it already contains the engineers' slips, so adding
 * the individual logs would count the same crew twice.
 */
export const computeDailyLogMonthStats = (
  logs: ReadonlyArray<DailyLog>,
  monthKey: string,
  slipIssueDates: ReadonlyArray<string> = [],
): DailyLogMonthStats => {
  const current = logs.filter(log => !log.supersededByDailyLogId);
  const byDay = new Map<string, DailyLog[]>();
  for (const log of current) {
    if (!log.date?.startsWith(monthKey)) continue;
    const day = dayOf(log.date);
    byDay.set(day, [...(byDay.get(day) || []), log]);
  }

  let workerTotal = 0;
  let workerDays = 0;
  let rainyDays = 0;
  const issueDays = new Set(slipIssueDates.map(dayOf).filter(day => day.startsWith(monthKey)));
  for (const [day, dayLogs] of byDay) {
    const summaries = dayLogs.filter(isDailyLogSummaryRow);
    const authoritative = summaries.length > 0 ? summaries : dayLogs;
    const workers = authoritative.reduce((sum, log) => sum + workersOf(log), 0);
    if (workers > 0) {
      workerTotal += workers;
      workerDays += 1;
    }
    if (authoritative.some(log => log.weather === 'rainy' || log.weather === 'storm')) rainyDays += 1;
    if (dayLogs.some(log => log.issues?.trim())) issueDays.add(day);
  }

  return {
    daysWithLogs: new Set(logs.map(log => dayOf(log.date || '')).filter(Boolean)).size,
    monthDays: byDay.size,
    avgWorkers: workerDays > 0 ? Math.round(workerTotal / workerDays) : null,
    workerDays,
    rainyDays,
    issueDays: issueDays.size,
  };
};
