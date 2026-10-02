// Leave requests (G2): every change goes through server RPCs that pick the approvers,
// count working days, move the balance and notify people.
import { supabase } from './supabase';

export type LeaveSession = 'full' | 'morning' | 'afternoon';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveTypeOption {
  code: string;
  name: string;
  description: string | null;
  paidBy: 'company' | 'social_insurance' | 'none';
  deductsAnnual: boolean;
  unit: 'day' | 'minute';
  needsSecondStep: boolean;
  isActive: boolean;
}

export interface LeaveStep {
  order: number;
  kind: 'manager' | 'director' | 'hr';
  userId: string | null;
  label: string;
  status: 'waiting' | 'approved' | 'rejected';
  name?: string;
  decidedBy?: string;
  decidedAt?: string;
  comment?: string | null;
  onBehalf?: boolean;
}

export interface LeaveRequestRow {
  id: string;
  code: string | null;
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  approvers: LeaveStep[];
  currentStep: number | null;
  startSession: LeaveSession;
  endSession: LeaveSession;
  minutes: number | null;
  subtype: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface LeavePreview {
  days: number;
  minutes: number | null;
  annualRemaining: number | null;
  steps: LeaveStep[];
  problems: string[];
  paidBy: LeaveTypeOption['paidBy'];
  /** Overtime confirmations: extra minutes of the month not yet claimed. */
  unclaimedMinutes: number | null;
}

export interface LeaveSettings {
  secondStepThresholdDays: number;
  secondStepApproverUserId: string | null;
  secondStepLabel: string;
  lateEarlyMaxMinutes: number;
  saturdayIsWorkday: boolean;
}

export interface LeaveLogRow {
  id: string;
  action: string;
  actedBy: string | null;
  comment: string | null;
  createdAt: string;
}

const REQUEST_SELECT = 'id,code,"employeeId",type,"startDate","endDate","totalDays",reason,status,approvers,current_step,start_session,end_session,minutes,subtype,"rejectionReason",cancel_reason,"createdAt"';

const mapRequest = (row: Record<string, unknown>): LeaveRequestRow => ({
  id: String(row.id),
  code: (row.code as string) || null,
  employeeId: String(row.employeeId),
  type: String(row.type),
  startDate: String(row.startDate),
  endDate: String(row.endDate),
  totalDays: Number(row.totalDays) || 0,
  reason: String(row.reason || ''),
  status: row.status as LeaveStatus,
  approvers: Array.isArray(row.approvers) ? row.approvers as LeaveStep[] : [],
  currentStep: row.current_step === null || row.current_step === undefined ? null : Number(row.current_step),
  startSession: (row.start_session as LeaveSession) || 'full',
  endSession: (row.end_session as LeaveSession) || 'full',
  minutes: row.minutes === null || row.minutes === undefined ? null : Number(row.minutes),
  subtype: (row.subtype as string) || null,
  rejectionReason: (row.rejectionReason as string) || null,
  cancelReason: (row.cancel_reason as string) || null,
  createdAt: String(row.createdAt),
});

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

/** The step waiting for a decision, or null when the request is closed. */
export const currentLeaveStep = (request: Pick<LeaveRequestRow, 'status' | 'approvers' | 'currentStep'>): LeaveStep | null => {
  if (request.status !== 'pending') return null;
  const index = (request.currentStep || 1) - 1;
  return request.approvers[index] || null;
};

export const leaveService = {
  async listTypes(): Promise<LeaveTypeOption[]> {
    const { data, error } = await supabase.from('hrm_leave_types')
      .select('code,name,description,paid_by,deducts_annual,unit,needs_second_step,is_active,sort_order')
      .order('sort_order').limit(50);
    if (error) fail(error, 'Không tải được loại đơn.');
    return (data || []).map(row => ({
      code: row.code, name: row.name, description: row.description, paidBy: row.paid_by,
      deductsAnnual: row.deducts_annual, unit: row.unit, needsSecondStep: row.needs_second_step, isActive: row.is_active,
    }));
  },

  async getSettings(): Promise<LeaveSettings | null> {
    const { data, error } = await supabase.from('hrm_leave_settings')
      .select('second_step_threshold_days,second_step_approver_user_id,second_step_label,late_early_max_minutes,saturday_is_workday')
      .limit(1).maybeSingle();
    if (error) fail(error, 'Không tải được chính sách nghỉ.');
    if (!data) return null;
    return {
      secondStepThresholdDays: Number(data.second_step_threshold_days),
      secondStepApproverUserId: data.second_step_approver_user_id,
      secondStepLabel: data.second_step_label,
      lateEarlyMaxMinutes: data.late_early_max_minutes,
      saturdayIsWorkday: data.saturday_is_workday,
    };
  },

  async saveSettings(settings: LeaveSettings): Promise<void> {
    const { data, error } = await supabase.from('hrm_leave_settings').update({
      second_step_threshold_days: settings.secondStepThresholdDays,
      second_step_approver_user_id: settings.secondStepApproverUserId,
      second_step_label: settings.secondStepLabel,
      late_early_max_minutes: settings.lateEarlyMaxMinutes,
      saturday_is_workday: settings.saturdayIsWorkday,
      updated_at: new Date().toISOString(),
    }).eq('singleton', true).select('singleton');
    if (error) fail(error, 'Không lưu được chính sách.');
    if (!data?.length) throw new Error('Chỉ HR Manage được sửa chính sách nghỉ.');
  },

  async setTypeActive(code: string, isActive: boolean): Promise<void> {
    const { data, error } = await supabase.from('hrm_leave_types').update({ is_active: isActive }).eq('code', code).select('code');
    if (error) fail(error, 'Không cập nhật được loại đơn.');
    if (!data?.length) throw new Error('Chỉ HR Manage được bật/tắt loại đơn.');
  },

  /** Requests the caller may see: own, assigned to approve, or all (HR) — RLS decides. */
  async listVisible(): Promise<LeaveRequestRow[]> {
    const { data, error } = await supabase.from('hrm_leave_requests').select(REQUEST_SELECT)
      .order('createdAt', { ascending: false }).limit(1000);
    if (error) fail(error, 'Không tải được đơn nghỉ.');
    return (data || []).map(row => mapRequest(row as Record<string, unknown>));
  },

  async listLogs(requestId: string): Promise<LeaveLogRow[]> {
    const { data, error } = await supabase.from('hrm_leave_logs').select('id,action,acted_by,comment,created_at')
      .eq('leave_request_id', requestId).order('created_at').limit(100);
    if (error) fail(error, 'Không tải được lịch sử đơn.');
    return (data || []).map(row => ({ id: row.id, action: row.action, actedBy: row.acted_by, comment: row.comment, createdAt: row.created_at }));
  },

  async myAnnualBalance(employeeId: string, year: number): Promise<{ accrued: number; used: number } | null> {
    const { data, error } = await supabase.from('hrm_leave_balances').select('"accruedDays","usedPaidDays"')
      .eq('employeeId', employeeId).eq('year', year).limit(1).maybeSingle();
    if (error) fail(error, 'Không tải được số phép.');
    return data ? { accrued: Number(data.accruedDays) || 0, used: Number(data.usedPaidDays) || 0 } : null;
  },

  async preview(input: { type: string; start: string; end: string; startSession: LeaveSession; endSession: LeaveSession; minutes: number | null }): Promise<LeavePreview> {
    const { data, error } = await supabase.rpc('preview_my_leave_request', {
      p_type: input.type, p_start: input.start, p_end: input.end,
      p_start_session: input.startSession, p_end_session: input.endSession, p_minutes: input.minutes,
    });
    if (error) fail(error, 'Không xem trước được đơn.');
    const value = data as Record<string, unknown>;
    return {
      days: Number(value.days) || 0,
      minutes: value.minutes === null ? null : Number(value.minutes),
      annualRemaining: value.annualRemaining === null || value.annualRemaining === undefined ? null : Number(value.annualRemaining),
      steps: (value.steps as LeaveStep[]) || [],
      problems: (value.problems as string[]) || [],
      paidBy: value.paidBy as LeavePreview['paidBy'],
      unclaimedMinutes: value.unclaimedMinutes === null || value.unclaimedMinutes === undefined ? null : Number(value.unclaimedMinutes),
    };
  },

  async submit(input: { type: string; start: string; end: string; startSession: LeaveSession; endSession: LeaveSession; minutes: number | null; subtype: string | null; reason: string }): Promise<void> {
    const { error } = await supabase.rpc('submit_my_leave_request', {
      p_type: input.type, p_start: input.start, p_end: input.end,
      p_start_session: input.startSession, p_end_session: input.endSession,
      p_minutes: input.minutes, p_subtype: input.subtype, p_reason: input.reason,
    });
    if (error) fail(error, 'Không gửi được đơn.');
  },

  async decide(requestId: string, decision: 'approve' | 'reject', comment: string | null): Promise<void> {
    const { error } = await supabase.rpc('decide_leave_request', { p_request_id: requestId, p_decision: decision, p_comment: comment });
    if (error) fail(error, 'Không lưu được quyết định.');
  },

  async cancel(requestId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('cancel_leave_request', { p_request_id: requestId, p_reason: reason });
    if (error) fail(error, 'Không hủy được đơn.');
  },
};
