// Ngày nghỉ việc / đi làm lại / vào làm (19/10/2026). Server rules live in
// supabase/migrations/20261020150000_hrm_work_status_events.sql; these mirror them so HR sees the problem before saving.
import type { Employee } from '../types';
import { vnToday } from './businessDate';
import { supabase } from './supabase';

export type WorkStatus = Employee['status'];
export const ACTIVE: WorkStatus = 'Đang làm việc';
export const RESIGNED: WorkStatus = 'Đã nghỉ việc';

export type EmploymentDateKind = 'exit' | 'return' | 'start';

export interface WorkStatusInput {
  date: string;
  note: string;
  reference: string;
}

export const emptyWorkStatusInput = (): WorkStatusInput => ({ date: '', note: '', reference: '' });

/** What a status change from → to asks for; null when nothing changes. */
export const statusChangeKind = (from: WorkStatus | undefined, to: WorkStatus | undefined): EmploymentDateKind | null => {
  if (!from || !to || from === to) return null;
  return to === RESIGNED ? 'exit' : 'return';
};

export const KIND_TEXT: Record<EmploymentDateKind, { title: string; dateLabel: string; notes: string[] }> = {
  exit: { title: 'Nghỉ việc', dateLabel: 'Ngày nghỉ việc', notes: ['Tự xin nghỉ', 'Hết hợp đồng', 'Cho thôi việc', 'Nghỉ hưu'] },
  return: { title: 'Đi làm lại', dateLabel: 'Ngày đi làm lại', notes: ['Quay lại làm việc', 'Ký hợp đồng mới'] },
  start: { title: 'Ngày vào làm', dateLabel: 'Ngày vào làm', notes: [] },
};

const viDay = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** First problem with the input, or null. `floor` = ngày vào làm (exit) or ngày nghỉ (return). */
export const validateEmploymentDate = (
  kind: EmploymentDateKind,
  input: WorkStatusInput,
  bounds: { startDate?: string | null; exitDate?: string | null },
  today = vnToday(),
): string | null => {
  const date = input.date.trim();
  if (!date) return `Chọn ${KIND_TEXT[kind].dateLabel.toLowerCase()}.`;
  if (date > today) return `${KIND_TEXT[kind].dateLabel} không được sau hôm nay.`;
  if (kind === 'exit' && bounds.startDate && date < bounds.startDate) return `Ngày nghỉ việc không được trước ngày vào làm ${viDay(bounds.startDate)}.`;
  if (kind === 'return' && bounds.exitDate && date <= bounds.exitDate) return `Ngày đi làm lại phải sau ngày nghỉ ${viDay(bounds.exitDate)}.`;
  if (kind === 'start' && bounds.exitDate && date > bounds.exitDate) return `Ngày vào làm không được sau ngày nghỉ ${viDay(bounds.exitDate)}.`;
  if (kind !== 'start' && input.note.trim().length < 2) return 'Ghi lý do ngắn.';
  return null;
};

const SERVER_MESSAGES: Record<string, string> = {
  HRM_WORK_STATUS_DATE_REQUIRED: 'Cần ngày nghỉ việc / đi làm lại để đổi trạng thái.',
  HRM_WORK_STATUS_DATE_IN_FUTURE: 'Ngày không được sau hôm nay.',
  HRM_WORK_STATUS_DATE_BEFORE_START: 'Ngày nghỉ việc không được trước ngày vào làm hoặc ngày đi làm lại gần nhất.',
  HRM_WORK_STATUS_DATE_BEFORE_EXIT: 'Ngày đi làm lại phải sau ngày nghỉ việc.',
  HRM_WORK_STATUS_NOTE_REQUIRED: 'Ghi lý do ngắn.',
  HRM_WORK_STATUS_UNCHANGED: 'Người này đang làm việc rồi.',
  HRM_WORK_STATUS_CREATE_ACTIVE_ONLY: 'Hồ sơ mới luôn ở trạng thái Đang làm việc.',
  HRM_START_DATE_ALREADY_SET: 'Người này đã có ngày vào làm. Tải lại để xem.',
  HRM_START_DATE_AFTER_EXIT: 'Ngày vào làm không được sau ngày nghỉ việc.',
  HRM_PROFILE_EDIT_REQUIRED: 'Bạn chưa có quyền sửa hồ sơ nhân sự.',
};

export const workStatusErrorMessage = (error: unknown, fallback: string): string => {
  const text = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  const code = Object.keys(SERVER_MESSAGES).find(key => text.includes(key));
  return code ? SERVER_MESSAGES[code] : text || fallback;
};

/** Audit reason (server wants ≥ 10 characters). */
export const workStatusAuditReason = (kind: EmploymentDateKind, employee: Pick<Employee, 'employeeCode' | 'fullName'>, input: WorkStatusInput): string => {
  const who = employee.employeeCode || employee.fullName;
  const what = kind === 'exit' ? 'Nghỉ việc' : kind === 'return' ? 'Đi làm lại' : 'Bổ sung ngày vào làm';
  return `${what} ${who} từ ${viDay(input.date)}${input.note.trim() ? `: ${input.note.trim()}` : ''}`;
};

export interface EmploymentDateGaps {
  resignedNoExit: Employee[];
  activeNoStart: Employee[];
}

/** HR to-do: people the headcount chart cannot place in a month. */
export const employmentDateGaps = (employees: Employee[]): EmploymentDateGaps => {
  const byName = (a: Employee, b: Employee) => a.fullName.localeCompare(b.fullName, 'vi');
  return {
    resignedNoExit: employees.filter(e => e.status === RESIGNED && !e.exitDate).sort(byName),
    activeNoStart: employees.filter(e => e.status === ACTIVE && !e.startDate).sort(byName),
  };
};

export const hrmWorkStatusService = {
  async setStatus(employee: Employee, status: WorkStatus, input: WorkStatusInput): Promise<{ status: WorkStatus; exitDate: string | null }> {
    const kind = status === RESIGNED ? 'exit' : 'return';
    const { data, error } = await supabase.rpc('set_hrm_employee_work_status', {
      p_employee_id: employee.id,
      p_status: status,
      p_effective_date: input.date,
      p_note: input.note.trim(),
      p_source_reference: input.reference.trim() || null,
      p_reason: workStatusAuditReason(kind, employee, input),
    });
    if (error) throw new Error(error.message || 'Không lưu được trạng thái làm việc.');
    const row = (data || {}) as { status?: WorkStatus; exitDate?: string | null };
    return { status: row.status || status, exitDate: row.exitDate || null };
  },

  async setStartDate(employee: Employee, date: string): Promise<void> {
    const { error } = await supabase.rpc('set_hrm_employee_start_date', {
      p_employee_id: employee.id,
      p_start_date: date,
      p_reason: workStatusAuditReason('start', employee, { date, note: '', reference: '' }),
    });
    if (error) throw new Error(error.message || 'Không lưu được ngày vào làm.');
  },
};
