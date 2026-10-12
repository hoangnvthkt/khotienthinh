// Gợi ý "Như hôm qua" cho nhật ký chi tiết (chủ SP 11/10/2026): điền sẵn theo nhật ký gần nhất, người ghi nhận rồi sửa.
// Không cần AI: 54% dòng máy và 43% tổ đội lặp lại y hệt hôm trước (đo 60 ngày SMB/DA29).
import type { DailyLog, DailyLogLabor, DailyLogMachine, WeatherType } from '../types';

export interface DailyLogPrefill {
  /** Nhật ký lấy nhân công / máy. */
  sourceLogId: string;
  sourceDate: string;
  byMe: boolean;
  labor: DailyLogLabor[];
  machines: DailyLogMachine[];
  /** Thời tiết theo nhật ký gần nhất của công trường (có thể là nhật ký khác nguồn nhân công). */
  weather: WeatherType;
  weatherDate: string;
}

const day = (value?: string | null) => String(value || '').slice(0, 10);

/** Chỉ giữ các cột nghiệp vụ: bỏ id, liên kết nhật ký cũ và thành tiền (tính lại theo số mới). */
const laborRow = (row: DailyLogLabor): DailyLogLabor => ({
  laborType: row.laborType,
  ...(row.catalogItemId ? { catalogItemId: row.catalogItemId, catalogCode: row.catalogCode, catalogName: row.catalogName } : {}),
  ...(row.groupName ? { groupName: row.groupName } : {}),
  ...(row.partnerId || row.partnerName ? { partnerId: row.partnerId, partnerName: row.partnerName } : {}),
  ...(row.taskId || row.taskName ? { taskId: row.taskId, taskName: row.taskName } : {}),
  count: Number(row.count) || 0,
  hours: Number(row.hours) || 8,
  ...(row.unit ? { unit: row.unit } : {}),
  ...(row.unitCost ? { unitCost: Number(row.unitCost) } : {}),
});

const machineRow = (row: DailyLogMachine): DailyLogMachine => ({
  machineName: row.machineName || row.catalogName || '',
  machineType: row.machineType || 'other',
  ...(row.catalogItemId ? { catalogItemId: row.catalogItemId, catalogCode: row.catalogCode, catalogName: row.catalogName } : {}),
  ...(row.groupName ? { groupName: row.groupName } : {}),
  ...(row.partnerId || row.partnerName ? { partnerId: row.partnerId, partnerName: row.partnerName } : {}),
  ...(row.taskId || row.taskName ? { taskId: row.taskId, taskName: row.taskName } : {}),
  shifts: Number(row.shifts) || 0,
  hours: Number(row.hours) || 0,
  ...(row.unit ? { unit: row.unit } : {}),
  ...(row.unitCost ? { unitCost: Number(row.unitCost) } : {}),
});

const usableLabor = (log: DailyLog) => (log.laborDetails || []).filter(row => Number(row.count) > 0 && String(row.laborType || row.catalogName || row.groupName || '').trim());
const usableMachines = (log: DailyLog) => (log.machines || []).filter(row => (Number(row.shifts) > 0 || Number(row.hours) > 0) && String(row.machineName || row.catalogName || '').trim());

/**
 * Nhật ký gần nhất trước ngày đang ghi. Nhân công / máy ưu tiên nhật ký của chính người ghi (mỗi kỹ sư một mũi);
 * không có thì lấy nhật ký gần nhất của công trường có dòng. Không chép khối lượng, vật tư, ảnh — đó là số của ngày mới.
 */
export const buildDailyLogPrefill = (logs: DailyLog[], input: { date: string; userId?: string | null }): DailyLogPrefill | null => {
  const date = day(input.date);
  if (!date) return null;
  const earlier = logs.filter(log => day(log.date) < date)
    .sort((a, b) => day(b.date).localeCompare(day(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!earlier.length) return null;
  const withRows = earlier.filter(log => usableLabor(log).length || usableMachines(log).length);
  const mine = input.userId ? withRows.find(log => log.createdById === input.userId) : undefined;
  const source = mine || withRows[0] || earlier[0];
  return {
    sourceLogId: source.id,
    sourceDate: day(source.date),
    byMe: Boolean(input.userId && source.createdById === input.userId),
    labor: usableLabor(source).map(laborRow),
    machines: usableMachines(source).map(machineRow),
    weather: earlier[0].weather,
    weatherDate: day(earlier[0].date),
  };
};

/** "11/10" cho nhãn nguồn gợi ý. */
export const shortDate = (value: string) => {
  const [y, m, d] = day(value).split('-');
  return y && m && d ? `${Number(d)}/${Number(m)}` : value;
};
