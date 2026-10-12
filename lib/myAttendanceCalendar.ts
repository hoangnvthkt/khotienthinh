// Lịch công cá nhân: dựng lưới tháng (T2 đầu tuần) từ bảng công + đơn nghỉ của chính người dùng.
import type { LeaveRequestRow } from './leaveService';
import type { TimesheetDay } from './timesheetService';

export interface MyCalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
  timesheet: TimesheetDay | null;
  /** Đơn nghỉ chưa duyệt / bị từ chối phủ ngày này (đơn đã duyệt đã nằm trong bảng công). */
  leaves: LeaveRequestRow[];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const buildMyCalendar = (
  year: number,
  month: number,
  days: TimesheetDay[],
  leaves: LeaveRequestRow[],
): MyCalendarCell[] => {
  const byDate = new Map(days.map(d => [d.date, d]));
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() + 6) % 7; // T2 = 0
  const daysInMonth = new Date(year, month, 0).getDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const shown = leaves.filter(l => l.status === 'pending' || l.status === 'approved' || l.status === 'rejected');
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(year, month - 1, 1 - lead + i);
    const key = dateKey(d);
    return {
      date: key,
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1,
      timesheet: byDate.get(key) || null,
      leaves: shown.filter(l => l.startDate <= key && l.endDate >= key),
    };
  });
};

export const leavePartLabel = (l: LeaveRequestRow, date: string): string => {
  if (l.startDate === date && l.startSession !== 'full') return l.startSession === 'morning' ? ' (sáng)' : ' (chiều)';
  if (l.endDate === date && l.endSession !== 'full') return l.endSession === 'morning' ? ' (sáng)' : ' (chiều)';
  return '';
};
