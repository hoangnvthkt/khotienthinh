export type DailyLogDocumentMode = 'author' | 'summarize' | 'review' | 'verified';
export type DailyLogPhysicalNumber = number | string | null;

export interface DailyLogPhysicalLaborRow {
  peopleCount?: DailyLogPhysicalNumber;
  totalLaborHours?: DailyLogPhysicalNumber;
  count?: DailyLogPhysicalNumber;
  hours?: DailyLogPhysicalNumber;
}

export interface DailyLogPhysicalMachineRow {
  machineCount?: DailyLogPhysicalNumber;
  totalMachineHours?: DailyLogPhysicalNumber;
  shifts?: DailyLogPhysicalNumber;
  hours?: DailyLogPhysicalNumber;
}

export interface DailyLogPhysicalSummary {
  uniqueWbsCount: number;
  laborPersonEntries: number | null;
  totalLaborHours: number | null;
  machineEntries: number | null;
  totalMachineHours: number | null;
}

const UNKNOWN = 'Chưa xác định';
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const dateFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const quantityFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 });

const parseDocumentDate = (value: string, requireTime: boolean): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (!match) return null;
  const [, year, month, day, suffix] = match;
  const calendarDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime())
    || calendarDate.getUTCFullYear() !== Number(year)
    || calendarDate.getUTCMonth() + 1 !== Number(month)
    || calendarDate.getUTCDate() !== Number(day)) return null;
  if (suffix === '') return requireTime ? null : calendarDate;
  // Action timestamps must have an explicit timezone; never use the host's timezone.
  const clock = /^T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(suffix);
  if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const formatDailyLogDate = (value: string): string => {
  const date = parseDocumentDate(value, false);
  return date ? dateFormat.format(date) : UNKNOWN;
};

export const formatDailyLogTime = (value: string): string => {
  const date = parseDocumentDate(value, true);
  return date ? timeFormat.format(date) : UNKNOWN;
};

export const formatDailyLogQuantity = (value: number | null | undefined, unit?: string | null): string => {
  if (value == null || !Number.isFinite(value)) return UNKNOWN;
  const suffix = unit?.trim();
  return `${quantityFormat.format(value)}${suffix ? ` ${suffix}` : ''}`;
};

const sumPhysicalMetric = (values: ReadonlyArray<DailyLogPhysicalNumber | undefined>): number | null => {
  let total = 0;
  for (const value of values) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    total += number;
  }
  return Number.isFinite(total) ? Math.round(total * 10_000) / 10_000 : null;
};

export const summarizeDailyLogPhysicalRows = (input: {
  workItems: ReadonlyArray<{ taskId: string }>;
  labor: ReadonlyArray<DailyLogPhysicalLaborRow>;
  machines: ReadonlyArray<DailyLogPhysicalMachineRow>;
}): DailyLogPhysicalSummary => ({
  uniqueWbsCount: new Set(input.workItems.map(item => item.taskId)).size,
  // These are entries per work item, not unique people/machines. Legacy fields
  // intentionally do not supply fallback physical semantics.
  laborPersonEntries: sumPhysicalMetric(input.labor.map(row => row.peopleCount)),
  totalLaborHours: sumPhysicalMetric(input.labor.map(row => row.totalLaborHours)),
  machineEntries: sumPhysicalMetric(input.machines.map(row => row.machineCount)),
  totalMachineHours: sumPhysicalMetric(input.machines.map(row => row.totalMachineHours)),
});
