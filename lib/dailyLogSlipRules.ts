// Phiếu kỹ sư v3 (chủ SP duyệt 04/10/2026): quy tắc nhập tại dòng, không phụ thuộc giao diện.
import type {
  DailyLogBaselineQuantityState, DailyLogEntryMode, DailyLogLaborInput, DailyLogMachineInput, DailyLogResourceProvider,
} from '../types';
import type { DailyLogRecentArea } from './dailyLogWbsService';

/** Có KL kế hoạch, đơn vị và số lũy kế hôm trước thì nhập "KL hôm nay"; còn lại nhập % lũy kế. */
export const defaultEntryMode = (input: { unit?: string | null; plannedQuantity?: number | null; baselineQuantityState: DailyLogBaselineQuantityState }): DailyLogEntryMode =>
  input.unit?.trim() && Number(input.plannedQuantity) > 0 && input.baselineQuantityState !== 'unknown' ? 'daily_quantity' : 'percent';

/** Ngày kế hoạch đã qua thì không lấy làm ngày dự kiến xong — để trống cho kỹ sư ghi ngày mới. */
export const defaultForecast = (scheduleFinishDate: string | null | undefined, slipDate: string): string | null => {
  const planned = scheduleFinishDate?.slice(0, 10) || null;
  return planned && planned >= slipDate ? planned : null;
};

export type ForecastProblem = 'new_date_required' | 'reason_required' | null;

/**
 * Hạng mục quá ngày kế hoạch mà chưa xong phải có ngày dự kiến xong mới (từ ngày phiếu trở đi);
 * mọi ngày khác ngày kế hoạch phải có lý do.
 */
export const forecastProblem = (input: {
  scheduleFinishDate?: string | null; forecastFinishDate?: string | null; forecastChangeReason?: string | null;
  cumulativePercent?: number | null; slipDate: string;
}): ForecastProblem => {
  const planned = input.scheduleFinishDate?.slice(0, 10) || null;
  const forecast = input.forecastFinishDate?.slice(0, 10) || null;
  const unfinished = Number(input.cumulativePercent ?? 0) < 100;
  if (planned && planned < input.slipDate && unfinished && (!forecast || forecast < input.slipDate)) return 'new_date_required';
  if (forecast && forecast !== planned && !input.forecastChangeReason?.trim()) return 'reason_required';
  return null;
};

/** Mã mũi ổn định theo tên (để nhận ra cùng một mũi qua các ngày). */
export const areaCodeFromName = (name: string): string => name.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'MUI';

export const normalizeSearch = (value?: string | null) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** Giữ đúng hình dạng nguồn cung cấp theo chế độ (danh mục / gõ tay) để qua được kiểm tra của máy chủ. */
export const cleanProvider = (provider: DailyLogResourceProvider): DailyLogResourceProvider => provider.entryMode === 'manual'
  ? { entryMode: 'manual', manualProviderType: provider.manualProviderType || 'other', manualProviderName: provider.manualProviderName || '',
    ...(provider.manualProviderNote ? { manualProviderNote: provider.manualProviderNote } : {}) }
  : { entryMode: 'catalog', partnerId: provider.partnerId || null, providerCodeSnapshot: provider.providerCodeSnapshot || null,
    providerNameSnapshot: provider.providerNameSnapshot || null };

export const providerName = (provider: DailyLogResourceProvider) =>
  (provider.entryMode === 'manual' ? provider.manualProviderName : provider.providerNameSnapshot)?.trim() || '';

/**
 * "Chép từ phiếu trước": hạng mục còn trong phạm vi, tổ đội + máy theo hạng mục, ngày dự kiến xong còn hiệu lực.
 * Không chép khối lượng, công tác, ảnh — đó là số của ngày mới.
 */
export const copyFromArea = (input: {
  area: DailyLogRecentArea; slipDate: string; taskIds: ReadonlySet<string>; newKey: () => string;
}) => {
  const keyByTask = new Map<string, string>();
  const items = input.area.items.filter(item => input.taskIds.has(item.taskId) && !keyByTask.has(item.taskId)
    && Number(item.cumulativePercent ?? 0) < 100).map(item => {
    const clientKey = input.newKey();
    keyByTask.set(item.taskId, clientKey);
    const keep = Boolean(item.forecastFinishDate && item.forecastFinishDate.slice(0, 10) >= input.slipDate);
    return { taskId: item.taskId, workBoqItemId: item.workBoqItemId || null, clientKey,
      forecastFinishDate: keep ? item.forecastFinishDate!.slice(0, 10) : null, forecastChangeReason: keep ? item.forecastChangeReason || null : null };
  });
  const labor: DailyLogLaborInput[] = input.area.labor.filter(line => keyByTask.has(line.taskId)).map(line => ({
    workItemClientKey: keyByTask.get(line.taskId)!, laborType: line.laborType || '', peopleCount: Number(line.peopleCount) || 1,
    hoursPerPerson: Number(line.hoursPerPerson) || 8, provider: cleanProvider(line.provider), contractItemId: line.contractItemId || null }));
  const machines: DailyLogMachineInput[] = input.area.machines.filter(line => keyByTask.has(line.taskId)).map(line => ({
    workItemClientKey: keyByTask.get(line.taskId)!, machineType: line.machineType || '', machineCount: Number(line.machineCount) || 1,
    hoursPerMachine: Number(line.hoursPerMachine) || 8, provider: cleanProvider(line.provider) }));
  return { items, labor, machines };
};
