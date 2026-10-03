// Server calls for Chốt công tháng. The server keeps the computed timesheet, lays HR adjustments on top,
// and blocks changes to a closed month.
import { supabase } from './supabase';
import type { AdjustmentKind, TimesheetCloseBoard } from './timesheetClose';
import type { LeaveSession } from './leaveService';

const rpc = async <T>(name: string, params: Record<string, unknown>, fallback: string): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message || fallback);
  return data as T;
};

export const timesheetCloseService = {
  board(year: number, month: number): Promise<TimesheetCloseBoard> {
    return rpc('get_hrm_timesheet_close_board', { p_year: year, p_month: month }, 'Không tải được bảng chốt công.');
  },
  open(year: number, month: number): Promise<void> {
    return rpc('open_hrm_timesheet_period', { p_year: year, p_month: month }, 'Không bắt đầu chốt công được.');
  },
  adjust(employeeId: string, date: string, kind: Exclude<AdjustmentKind, 'leave'>, value: number, reason: string): Promise<void> {
    return rpc('adjust_hrm_timesheet_day', { p_employee_id: employeeId, p_date: date, p_kind: kind, p_value: value, p_reason: reason }, 'Không lưu được điều chỉnh.');
  },
  removeAdjustment(id: string, reason: string): Promise<void> {
    return rpc('remove_hrm_timesheet_adjustment', { p_id: id, p_reason: reason }, 'Không bỏ được điều chỉnh.');
  },
  /** HR records an approved leave for the person (balance and leave ledger move as usual). */
  recordLeave(input: { employeeId: string; type: string; start: string; end: string; startSession: LeaveSession; endSession: LeaveSession; reason: string }): Promise<string> {
    return rpc('record_hrm_leave_on_behalf', {
      p_employee_id: input.employeeId, p_type: input.type, p_start: input.start, p_end: input.end,
      p_start_session: input.startSession, p_end_session: input.endSession, p_reason: input.reason,
    }, 'Không ghi được đơn nghỉ.');
  },
  submit(year: number, month: number): Promise<void> {
    return rpc('submit_hrm_timesheet_period', { p_year: year, p_month: month }, 'Không gửi duyệt được.');
  },
  decide(year: number, month: number, approve: boolean, note: string | null): Promise<void> {
    return rpc('decide_hrm_timesheet_period', { p_year: year, p_month: month, p_approve: approve, p_note: note }, 'Không lưu được quyết định.');
  },
  reopen(year: number, month: number, reason: string): Promise<void> {
    return rpc('reopen_hrm_timesheet_period', { p_year: year, p_month: month, p_reason: reason }, 'Không mở lại được kỳ công.');
  },
  sendFeedback(year: number, month: number, date: string | null, message: string): Promise<void> {
    return rpc('submit_my_timesheet_feedback', { p_year: year, p_month: month, p_date: date, p_message: message }, 'Không gửi được phản hồi.');
  },
  setNotRequired(employeeId: string, notRequired: boolean, reason: string | null): Promise<void> {
    return rpc('set_hrm_attendance_not_required', { p_employee_id: employeeId, p_not_required: notRequired, p_reason: reason }, 'Không lưu được.');
  },
  resolveFeedback(id: string, reply: string): Promise<void> {
    return rpc('resolve_hrm_timesheet_feedback', { p_id: id, p_reply: reply }, 'Không trả lời được phản hồi.');
  },
};
