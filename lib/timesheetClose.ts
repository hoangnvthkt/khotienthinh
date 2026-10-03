// Chốt công tháng (H4): HR reviews the month's timesheet, fixes days with a reason, sends it to
// HR Manage; once approved the month is closed and its snapshot is what payroll will read.
import type { EmployeeTimesheet, TimesheetDay } from './timesheetService';

export type TimesheetPeriodStatus = 'open' | 'reviewing' | 'submitted' | 'closed';

export interface TimesheetPeriod {
  year: number;
  month: number;
  status: TimesheetPeriodStatus;
  version: number;
  openedByName: string | null;
  openedAt: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** Why HR Manage sent it back, or why it was reopened. */
  returnNote: string | null;
}

export type AdjustmentKind = 'credit' | 'excuse' | 'leave';

/** One HR fix layered on top of the computed day; the computed value stays visible. */
export interface TimesheetAdjustment {
  id: string;
  employeeId: string;
  date: string;
  kind: AdjustmentKind;
  /** credit: new work credit (0, 0.5, 1); excuse: minutes forgiven; leave: leave code recorded on behalf. */
  value: number | string;
  before: number | string | null;
  reason: string;
  byName: string;
  at: string;
  leaveCode?: string | null;
}

export interface TimesheetFeedback {
  id: string;
  employeeId: string;
  date: string | null;
  message: string;
  status: 'open' | 'resolved';
  reply: string | null;
  createdAt: string;
}

export interface PendingItem {
  kind: 'leave' | 'makeup' | 'explain';
  employeeId: string;
  date: string;
  endDate?: string;
  label: string;
  code?: string | null;
}

export interface TimesheetCloseBoard {
  period: TimesheetPeriod;
  employees: EmployeeTimesheet[];
  adjustments: TimesheetAdjustment[];
  feedback: TimesheetFeedback[];
  pending: PendingItem[];
  holidays: Array<{ date: string; name: string }>;
  notRequired: Array<{ employeeId: string; fullName: string; employeeCode: string | null; reason: string; setByName: string | null; setAt: string }>;
  can: { review: boolean; approve: boolean; isSubmitter: boolean };
}

export type IssueKind = 'pending' | 'feedback' | 'missing_punch' | 'absent';

export interface TimesheetIssue {
  kind: IssueKind;
  employeeId: string;
  employeeName: string;
  date: string | null;
  label: string;
  /** Pending requests block sending for approval; the rest are review points. */
  blocking: boolean;
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  pending: 'Đơn còn chờ duyệt',
  feedback: 'Phản hồi của nhân viên',
  missing_punch: 'Thiếu lượt chấm',
  absent: 'Vắng không phép',
};

export const PERIOD_STEP: Record<TimesheetPeriodStatus, number> = { open: 1, reviewing: 2, submitted: 3, closed: 4 };

/** Symbol shown in a day cell, like a paper timesheet. */
export const daySymbol = (day: TimesheetDay): string => {
  if (day.status === 'future') return '';
  if (day.status === 'not_employed') return '–';
  if (day.status === 'off') return '';
  if (day.status === 'holiday') return 'L';
  if (day.status === 'business_trip') return 'CT';
  if (day.status === 'absent') return 'V';
  if (day.status === 'missing_punch') return '!';
  if (day.status === 'leave') {
    const code = day.leaveType === 'annual' ? 'P' : day.leaveType === 'unpaid' || day.leaveType === 'personal_unpaid' ? 'KL'
      : day.leaveType === 'sick' || day.leaveType === 'maternity' ? 'BH' : 'R';
    return day.leavePart && day.leavePart !== 'full' ? `${code}½` : code;
  }
  if (day.workCredit === 0.5) return '½';
  return 'X';
};

export const workCreditOf = (day: TimesheetDay, adjustment?: TimesheetAdjustment) =>
  adjustment?.kind === 'credit' ? Number(adjustment.value) : day.workCredit;

/** "Công tính lương" = worked days + company-paid leave + holidays (insurance-paid leave is not the company's). */
export const payableDays = (totals: { workDays: number; paidLeaveDays: number; holidays: number }) =>
  Math.round((totals.workDays + totals.paidLeaveDays + totals.holidays) * 100) / 100;

/** Everything HR should look at before sending the month for approval. */
export const collectIssues = (board: Pick<TimesheetCloseBoard, 'employees' | 'adjustments' | 'feedback' | 'pending'>): TimesheetIssue[] => {
  const nameOf = new Map(board.employees.map(row => [row.employeeId, row.fullName]));
  const adjusted = new Set(board.adjustments.map(item => `${item.employeeId}|${item.date}`));
  const issues: TimesheetIssue[] = [];
  for (const item of board.pending) {
    issues.push({ kind: 'pending', employeeId: item.employeeId, employeeName: nameOf.get(item.employeeId) || 'Nhân viên', date: item.date, label: item.label, blocking: true });
  }
  for (const item of board.feedback.filter(entry => entry.status === 'open')) {
    issues.push({ kind: 'feedback', employeeId: item.employeeId, employeeName: nameOf.get(item.employeeId) || 'Nhân viên', date: item.date, label: item.message, blocking: false });
  }
  for (const row of board.employees) {
    for (const day of row.timesheet.days) {
      if (adjusted.has(`${row.employeeId}|${day.date}`)) continue;
      if (day.status === 'missing_punch') {
        issues.push({ kind: 'missing_punch', employeeId: row.employeeId, employeeName: row.fullName, date: day.date,
          label: day.checkIn ? `Vào ${day.checkIn}, thiếu lượt ra` : 'Thiếu lượt vào', blocking: false });
      } else if (day.status === 'absent') {
        issues.push({ kind: 'absent', employeeId: row.employeeId, employeeName: row.fullName, date: day.date, label: 'Không chấm công, không có đơn nghỉ', blocking: false });
      }
    }
  }
  const order: Record<IssueKind, number> = { pending: 0, feedback: 1, missing_punch: 2, absent: 3 };
  return issues.sort((a, b) => order[a.kind] - order[b.kind] || (a.date || '').localeCompare(b.date || '') || a.employeeName.localeCompare(b.employeeName, 'vi'));
};
