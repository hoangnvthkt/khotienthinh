import {
  DailyLog,
  DailyLogStatus,
  LABOR_TYPE_LABELS,
  MACHINE_TYPE_LABELS,
  WeatherType,
} from '../types';

export type DailyLogSummaryMode = 'day' | 'week' | 'month';
export type DailyLogSummaryStatusScope = 'verified' | 'all' | DailyLogStatus;

export interface DailyLogSummaryFilters {
  fromDate?: string;
  toDate?: string;
  mode: DailyLogSummaryMode;
  statusScope: DailyLogSummaryStatusScope;
  creatorId?: string;
}

export interface DailyLogTopItem {
  key: string;
  label: string;
  value: number;
  unit?: string;
}

export interface DailyLogTextEntry {
  logId: string;
  date: string;
  createdBy: string;
  text: string;
  type: 'description' | 'issue' | 'delay';
}

export interface DailyLogPeriodSummary {
  periodKey: string;
  label: string;
  startDate: string;
  endDate: string;
  sourceLogIds: string[];
  logs: DailyLog[];
  workers: {
    total: number;
    averagePerActiveDay: number;
    peak: number;
    activeDays: number;
  };
  labor: DailyLogTopItem[];
  machines: DailyLogTopItem[];
  weather: Record<WeatherType, number>;
  rainyDays: number;
  issues: DailyLogTextEntry[];
  descriptions: DailyLogTextEntry[];
  delays: {
    totalDays: number;
    byCategory: DailyLogTopItem[];
    entries: DailyLogTextEntry[];
  };
  materials: DailyLogTopItem[];
  volumes: DailyLogTopItem[];
  dataQuality: {
    logCount: number;
    verifiedCount: number;
    draftCount: number;
    submittedCount: number;
    rejectedCount: number;
    withPhotos: number;
    withGps: number;
  };
}

export interface DailyLogSummaryResult {
  periods: DailyLogPeriodSummary[];
  filteredLogs: DailyLog[];
  allLogsInRange: DailyLog[];
  missingDates: string[];
  creators: { id: string; name: string }[];
  overview: {
    periodCount: number;
    officialLogCount: number;
    unverifiedLogCount: number;
    activeDays: number;
    missingDays: number;
    totalWorkers: number;
    avgWorkers: number;
    peakWorkers: number;
    totalMachineShifts: number;
    rainyDays: number;
    delayDays: number;
    issueCount: number;
    photoCompliance: number;
    gpsCompliance: number;
  };
  charts: {
    workerTrend: { name: string; workers: number }[];
    weather: { name: string; value: number; key: WeatherType }[];
    labor: DailyLogTopItem[];
    machines: DailyLogTopItem[];
    delays: DailyLogTopItem[];
  };
}

const WEATHER_LABELS: Record<WeatherType, string> = {
  sunny: 'Nắng',
  cloudy: 'Mây',
  rainy: 'Mưa',
  storm: 'Bão',
};

const STATUS_KEYS: DailyLogStatus[] = ['draft', 'submitted', 'verified', 'rejected'];

export const getDailyLogStatus = (log: DailyLog): DailyLogStatus =>
  (log.status || (log.verified ? 'verified' : 'draft')) as DailyLogStatus;

export const getDailyLogWorkerCount = (log: DailyLog): number => {
  const laborTotal = (log.laborDetails || []).reduce((sum, row) => sum + Math.max(0, Number(row.count || 0)), 0);
  return laborTotal > 0 ? laborTotal : Math.max(0, Number(log.workerCount || 0));
};

const toDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

const addDays = (date: Date, days: number): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const startOfWeek = (date: Date): Date => {
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(date, delta);
};

const endOfWeek = (date: Date): Date => addDays(startOfWeek(date), 6);

const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);

const endOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth() + 1, 0);

const clampDateKey = (dateKey?: string, fallback?: string): string => {
  if (dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  return fallback || toDateKey(new Date());
};

const getPeriodBounds = (dateKey: string, mode: DailyLogSummaryMode) => {
  const date = parseDateKey(dateKey);
  if (mode === 'week') {
    return { start: toDateKey(startOfWeek(date)), end: toDateKey(endOfWeek(date)) };
  }
  if (mode === 'month') {
    return { start: toDateKey(startOfMonth(date)), end: toDateKey(endOfMonth(date)) };
  }
  return { start: dateKey, end: dateKey };
};

const getPeriodKey = (dateKey: string, mode: DailyLogSummaryMode): string => {
  const bounds = getPeriodBounds(dateKey, mode);
  if (mode === 'month') return bounds.start.slice(0, 7);
  if (mode === 'week') return `${bounds.start}_${bounds.end}`;
  return dateKey;
};

const formatShortDate = (dateKey: string): string => parseDateKey(dateKey).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

const formatPeriodLabel = (dateKey: string, mode: DailyLogSummaryMode): string => {
  const bounds = getPeriodBounds(dateKey, mode);
  if (mode === 'month') {
    return parseDateKey(bounds.start).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' });
  }
  if (mode === 'week') return `${formatShortDate(bounds.start)} - ${formatShortDate(bounds.end)}`;
  return parseDateKey(dateKey).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

const enumerateDates = (fromDate: string, toDate: string): string[] => {
  const dates: string[] = [];
  let cursor = parseDateKey(fromDate);
  const end = parseDateKey(toDate);
  while (cursor <= end) {
    dates.push(toDateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
};

const createEmptyPeriod = (dateKey: string, mode: DailyLogSummaryMode): DailyLogPeriodSummary => {
  const bounds = getPeriodBounds(dateKey, mode);
  return {
    periodKey: getPeriodKey(dateKey, mode),
    label: formatPeriodLabel(dateKey, mode),
    startDate: bounds.start,
    endDate: bounds.end,
    sourceLogIds: [],
    logs: [],
    workers: { total: 0, averagePerActiveDay: 0, peak: 0, activeDays: 0 },
    labor: [],
    machines: [],
    weather: { sunny: 0, cloudy: 0, rainy: 0, storm: 0 },
    rainyDays: 0,
    issues: [],
    descriptions: [],
    delays: { totalDays: 0, byCategory: [], entries: [] },
    materials: [],
    volumes: [],
    dataQuality: {
      logCount: 0,
      verifiedCount: 0,
      draftCount: 0,
      submittedCount: 0,
      rejectedCount: 0,
      withPhotos: 0,
      withGps: 0,
    },
  };
};

const addToMap = (map: Map<string, DailyLogTopItem>, key: string, label: string, value: number, unit?: string) => {
  const safeValue = Math.max(0, Number(value || 0));
  if (safeValue <= 0) return;
  const existing = map.get(key);
  if (existing) {
    existing.value += safeValue;
    return;
  }
  map.set(key, { key, label, value: safeValue, unit });
};

const topItems = (map: Map<string, DailyLogTopItem>, limit = 8): DailyLogTopItem[] =>
  Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, limit);

const getLaborLabel = (row: NonNullable<DailyLog['laborDetails']>[number]): string => {
  const knownLabel = LABOR_TYPE_LABELS[row.laborType as keyof typeof LABOR_TYPE_LABELS];
  return row.catalogName || row.groupName || knownLabel || row.laborType || 'Nhân công';
};

const getMachineLabel = (row: NonNullable<DailyLog['machines']>[number]): string => {
  const knownLabel = MACHINE_TYPE_LABELS[row.machineType as keyof typeof MACHINE_TYPE_LABELS];
  return row.catalogName || row.groupName || row.machineName || knownLabel || row.machineType || 'Máy thi công';
};

const statusMatchesScope = (status: DailyLogStatus, scope: DailyLogSummaryStatusScope): boolean =>
  scope === 'all' ? true : status === scope;

const getCreatorKey = (log: DailyLog): string => log.createdById || log.submittedById || log.createdBy || 'unknown';

const getCreatorName = (log: DailyLog): string => log.createdBy || log.submittedBy || log.createdById || 'Không rõ';

const getDefaultRange = (logs: DailyLog[]) => {
  const sortedDates = logs.map(log => log.date).filter(Boolean).sort();
  const today = toDateKey(new Date());
  const toDate = sortedDates[sortedDates.length - 1] || today;
  const end = parseDateKey(toDate);
  return { fromDate: toDateKey(addDays(end, -30)), toDate };
};

export const dailyLogSummaryService = {
  weatherLabels: WEATHER_LABELS,

  summarize(logs: DailyLog[], filters: DailyLogSummaryFilters): DailyLogSummaryResult {
    const defaultRange = getDefaultRange(logs);
    const fromDate = clampDateKey(filters.fromDate, defaultRange.fromDate);
    const toDate = clampDateKey(filters.toDate, defaultRange.toDate);
    const normalizedFrom = fromDate <= toDate ? fromDate : toDate;
    const normalizedTo = fromDate <= toDate ? toDate : fromDate;

    const allLogsInRange = logs.filter(log => {
      if (!log.date || log.date < normalizedFrom || log.date > normalizedTo) return false;
      if (filters.creatorId && getCreatorKey(log) !== filters.creatorId) return false;
      return true;
    });

    const filteredLogs = allLogsInRange.filter(log => statusMatchesScope(getDailyLogStatus(log), filters.statusScope));
    const officialLogs = allLogsInRange.filter(log => getDailyLogStatus(log) === 'verified');
    const officialDates = new Set(officialLogs.map(log => log.date));
    const missingDates = enumerateDates(normalizedFrom, normalizedTo).filter(dateKey => !officialDates.has(dateKey));
    const periodMap = new Map<string, DailyLogPeriodSummary>();

    for (const dateKey of enumerateDates(normalizedFrom, normalizedTo)) {
      const key = getPeriodKey(dateKey, filters.mode);
      if (!periodMap.has(key)) periodMap.set(key, createEmptyPeriod(dateKey, filters.mode));
    }

    for (const log of filteredLogs) {
      const key = getPeriodKey(log.date, filters.mode);
      if (!periodMap.has(key)) periodMap.set(key, createEmptyPeriod(log.date, filters.mode));
      const period = periodMap.get(key)!;
      period.logs.push(log);
      period.sourceLogIds.push(log.id);
    }

    const creators = Array.from(
      logs.reduce((map, log) => {
        const key = getCreatorKey(log);
        if (!map.has(key)) map.set(key, { id: key, name: getCreatorName(log) });
        return map;
      }, new Map<string, { id: string; name: string }>())
        .values(),
    ).sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    const periods = Array.from(periodMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));

    for (const period of periods) {
      const laborMap = new Map<string, DailyLogTopItem>();
      const machineMap = new Map<string, DailyLogTopItem>();
      const materialMap = new Map<string, DailyLogTopItem>();
      const volumeMap = new Map<string, DailyLogTopItem>();
      const delayMap = new Map<string, DailyLogTopItem>();
      const workerByDate = new Map<string, number>();
      const rainyDateSet = new Set<string>();

      for (const log of period.logs) {
        const status = getDailyLogStatus(log);
        period.dataQuality.logCount += 1;
        if (status === 'verified') period.dataQuality.verifiedCount += 1;
        if (status === 'draft') period.dataQuality.draftCount += 1;
        if (status === 'submitted') period.dataQuality.submittedCount += 1;
        if (status === 'rejected') period.dataQuality.rejectedCount += 1;
        if ((log.photos || []).length > 0) period.dataQuality.withPhotos += 1;
        if (log.gpsLat || log.gpsLng) period.dataQuality.withGps += 1;

        const workerCount = getDailyLogWorkerCount(log);
        workerByDate.set(log.date, (workerByDate.get(log.date) || 0) + workerCount);

        period.weather[log.weather] = (period.weather[log.weather] || 0) + 1;
        if (log.weather === 'rainy' || log.weather === 'storm') rainyDateSet.add(log.date);

        if (log.description?.trim()) {
          period.descriptions.push({ logId: log.id, date: log.date, createdBy: getCreatorName(log), text: log.description.trim(), type: 'description' });
        }
        if (log.issues?.trim()) {
          period.issues.push({ logId: log.id, date: log.date, createdBy: getCreatorName(log), text: log.issues.trim(), type: 'issue' });
        }

        for (const row of log.laborDetails || []) {
          const label = getLaborLabel(row);
          addToMap(laborMap, label, label, Number(row.count || 0), 'người');
        }

        for (const row of log.machines || []) {
          const label = getMachineLabel(row);
          addToMap(machineMap, label, label, Number(row.shifts || 0), 'ca');
        }

        for (const row of log.materials || []) {
          const label = row.itemName || 'Vật tư';
          const unit = row.unit || '';
          addToMap(materialMap, `${label}_${unit}`, label, Number(row.quantity || 0), unit);
        }

        for (const row of log.volumes || []) {
          const label = row.workBoqItemName || row.taskName || row.contractItemName || 'Khối lượng';
          const unit = row.unit || '';
          addToMap(volumeMap, `${label}_${unit}`, label, Number(row.quantity || 0), unit);
        }

        for (const delay of log.delayTasks || []) {
          const days = Math.max(0, Number(delay.delayDays || 0));
          if (days <= 0) continue;
          const category = delay.category || 'other';
          addToMap(delayMap, category, category, days, 'ngày');
          period.delays.totalDays += days;
          const text = `${delay.taskName || 'Hạng mục'}: ${days} ngày${delay.reason ? ` - ${delay.reason}` : ''}`;
          period.delays.entries.push({ logId: log.id, date: log.date, createdBy: getCreatorName(log), text, type: 'delay' });
        }
      }

      const dailyWorkerTotals = Array.from(workerByDate.values());
      period.workers.total = dailyWorkerTotals.reduce((sum, value) => sum + value, 0);
      period.workers.activeDays = dailyWorkerTotals.length;
      period.workers.peak = dailyWorkerTotals.length ? Math.max(...dailyWorkerTotals) : 0;
      period.workers.averagePerActiveDay = dailyWorkerTotals.length
        ? Math.round(period.workers.total / dailyWorkerTotals.length)
        : 0;
      period.rainyDays = rainyDateSet.size;
      period.labor = topItems(laborMap, 10);
      period.machines = topItems(machineMap, 10);
      period.materials = topItems(materialMap, 10);
      period.volumes = topItems(volumeMap, 10);
      period.delays.byCategory = topItems(delayMap, 10);
    }

    const totalWorkers = periods.reduce((sum, period) => sum + period.workers.total, 0);
    const activeDays = new Set(filteredLogs.map(log => log.date)).size;
    const officialLogCount = officialLogs.length;
    const unverifiedLogCount = allLogsInRange.length - officialLogCount;
    const totalMachineShifts = periods.reduce(
      (sum, period) => sum + period.machines.reduce((inner, item) => inner + item.value, 0),
      0,
    );
    const totalPhotos = filteredLogs.filter(log => (log.photos || []).length > 0).length;
    const totalGps = filteredLogs.filter(log => log.gpsLat || log.gpsLng).length;

    const mergeTopItems = (items: DailyLogTopItem[], limit = 8) => {
      const map = new Map<string, DailyLogTopItem>();
      for (const item of items) addToMap(map, item.key, item.label, item.value, item.unit);
      return topItems(map, limit);
    };

    const labor = mergeTopItems(periods.flatMap(period => period.labor));
    const machines = mergeTopItems(periods.flatMap(period => period.machines));
    const delays = mergeTopItems(periods.flatMap(period => period.delays.byCategory));
    const weatherTotals: Record<WeatherType, number> = { sunny: 0, cloudy: 0, rainy: 0, storm: 0 };
    for (const period of periods) {
      for (const weather of Object.keys(weatherTotals) as WeatherType[]) {
        weatherTotals[weather] += period.weather[weather] || 0;
      }
    }

    return {
      periods,
      filteredLogs,
      allLogsInRange,
      missingDates,
      creators,
      overview: {
        periodCount: periods.length,
        officialLogCount,
        unverifiedLogCount,
        activeDays,
        missingDays: missingDates.length,
        totalWorkers,
        avgWorkers: activeDays ? Math.round(totalWorkers / activeDays) : 0,
        peakWorkers: periods.reduce((max, period) => Math.max(max, period.workers.peak), 0),
        totalMachineShifts,
        rainyDays: new Set(filteredLogs.filter(log => log.weather === 'rainy' || log.weather === 'storm').map(log => log.date)).size,
        delayDays: periods.reduce((sum, period) => sum + period.delays.totalDays, 0),
        issueCount: periods.reduce((sum, period) => sum + period.issues.length, 0),
        photoCompliance: filteredLogs.length ? Math.round((totalPhotos / filteredLogs.length) * 100) : 0,
        gpsCompliance: filteredLogs.length ? Math.round((totalGps / filteredLogs.length) * 100) : 0,
      },
      charts: {
        workerTrend: periods.map(period => ({ name: period.label, workers: period.workers.averagePerActiveDay })),
        weather: (Object.keys(weatherTotals) as WeatherType[]).map(key => ({ key, name: WEATHER_LABELS[key], value: weatherTotals[key] })),
        labor,
        machines,
        delays,
      },
    };
  },
};
