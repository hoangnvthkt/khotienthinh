// Month timesheet computed on the server from shifts, punches and approved requests (G4).
import { supabase } from './supabase';

export type TimesheetDayStatus =
  | 'present' | 'missing_punch' | 'absent' | 'leave' | 'holiday' | 'off' | 'off_day_work' | 'future' | 'business_trip';

export interface TimesheetDay {
  date: string;
  weekday: number;
  shiftName: string;
  shiftStart: string;
  shiftEnd: string;
  checkIn: string | null;
  checkOut: string | null;
  status: TimesheetDayStatus | string;
  leaveType: string | null;
  leaveName: string | null;
  leavePart: 'full' | 'morning' | 'afternoon' | null;
  workCredit: number;
  lateMinutes: number;
  earlyMinutes: number;
  lateBlock: number;
  earlyBlock: number;
  excusedLate: number;
  excusedEarly: number;
  extraMinutes: number;
  workedMinutes: number;
  locationName: string | null;
  flags: string[];
}

export interface TimesheetTotals {
  workDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  leaveByType: Record<string, number>;
  holidays: number;
  absentDays: number;
  missingPunchDays: number;
  lateCount: number;
  lateBlockMinutes: number;
  earlyCount: number;
  earlyBlockMinutes: number;
  excusedMinutes: number;
  extraMinutes: number;
  overtimeApprovedMinutes: number;
  overtimePendingMinutes: number;
  overtimeUnclaimedMinutes: number;
  workedMinutes: number;
}

export interface EmployeeTimesheet {
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  orgUnitName: string | null;
  timesheet: { days: TimesheetDay[]; totals: TimesheetTotals };
}

export const formatMinutes = (minutes: number): string => {
  if (!minutes) return '0';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}g${rest ? String(rest).padStart(2, '0') : ''}` : `${rest}p`;
};

export const timesheetService = {
  async month(year: number, month: number, employeeId: string | null = null): Promise<EmployeeTimesheet[]> {
    const { data, error } = await supabase.rpc('get_hrm_timesheet', { p_year: year, p_month: month, p_employee_id: employeeId });
    if (error) throw new Error(error.message || 'Không tải được bảng công.');
    return (data || []) as EmployeeTimesheet[];
  },
};
