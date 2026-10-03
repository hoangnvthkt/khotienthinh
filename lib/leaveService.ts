// Leave requests (G2): every change goes through server RPCs that pick the approvers,
// count working days, move the balance and notify people.
import { supabase } from './supabase';
import { compressImageWithinLimit } from './vehicleBookingService';

const EVIDENCE_BUCKET = 'hrm-leave-evidence';
export const LEAVE_MAX_ATTACHMENTS = 4;

export type LeaveSession = 'full' | 'morning' | 'afternoon';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** A reason inside a leave type (e.g. "Kết hôn"), with its own day limit. */
export interface LeaveSubtype {
  name: string;
  maxDays: number | null;
}

export interface LeaveTypeOption {
  code: string;
  name: string;
  description: string | null;
  paidBy: 'company' | 'social_insurance' | 'none';
  deductsAnnual: boolean;
  unit: 'day' | 'minute';
  /** Add the director step when the request is longer than this many working days; null = never. */
  secondStepAfterDays: number | null;
  /** HR checks last (late/early explanations, overtime). */
  hrStep: boolean;
  requiresOfficial: boolean;
  subtypes: LeaveSubtype[];
  requiresAttachment: boolean;
  attachmentHint: string | null;
  isSystem: boolean;
  isActive: boolean;
}

/** What HR edits on a leave type. */
export interface LeaveTypeDraft {
  name: string;
  description: string;
  paidBy: LeaveTypeOption['paidBy'];
  secondStepAfterDays: number | null;
  hrStep: boolean;
  requiresOfficial: boolean;
  subtypes: LeaveSubtype[];
  requiresAttachment: boolean;
  attachmentHint: string;
}

export interface LeavePolicyLogRow {
  id: string;
  target: string;
  action: 'create' | 'update' | 'activate' | 'deactivate';
  changes: Record<string, { from: unknown; to: unknown }>;
  actorName: string | null;
  createdAt: string;
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
  attachmentPaths: string[];
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
  secondStepApproverUserId: string | null;
  secondStepLabel: string;
  lateEarlyMaxMinutes: number;
  saturdayIsWorkday: boolean;
}

export interface LeaveLedgerBalance {
  year: number;
  accruedDays: number;
  usedPaidDays: number;
  usedUnpaidDays: number;
  carriedDays: number;
  carryUsedDays: number;
  carryExpiredDays: number;
  carryExpiresOn: string | null;
  /** Carried days still usable today (0 after 31/03). */
  carryLeft: number;
  availableDays: number;
  pendingDays: number;
}

export type LeaveLedgerKind = 'opening' | 'accrual' | 'leave' | 'leave_cancel' | 'carry_in' | 'carry_expire' | 'adjust';

export interface LeaveLedgerEntry {
  id: string;
  kind: LeaveLedgerKind;
  days: number;
  carryDays: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
  leaveRequestId: string | null;
  leaveCode: string | null;
  leaveStart: string | null;
  leaveEnd: string | null;
  actorName: string | null;
}

export interface LeaveBalanceRow {
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  orgUnitName: string | null;
  officialDate: string | null;
  balance: LeaveLedgerBalance | null;
}

const toBalance = (value: unknown): LeaveLedgerBalance | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const num = (key: string) => Number(row[key]) || 0;
  return {
    year: num('year'), accruedDays: num('accruedDays'), usedPaidDays: num('usedPaidDays'), usedUnpaidDays: num('usedUnpaidDays'),
    carriedDays: num('carriedDays'), carryUsedDays: num('carryUsedDays'), carryExpiredDays: num('carryExpiredDays'),
    carryExpiresOn: (row.carryExpiresOn as string | null) ?? null, carryLeft: num('carryLeft'),
    availableDays: num('availableDays'), pendingDays: num('pendingDays'),
  };
};

export interface LeaveLogRow {
  id: string;
  action: string;
  actedBy: string | null;
  comment: string | null;
  createdAt: string;
}

const REQUEST_SELECT = 'id,code,"employeeId",type,"startDate","endDate","totalDays",reason,status,approvers,current_step,start_session,end_session,minutes,subtype,"rejectionReason",cancel_reason,attachment_paths,"createdAt"';

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
  attachmentPaths: Array.isArray(row.attachment_paths) ? row.attachment_paths as string[] : [],
  createdAt: String(row.createdAt),
});

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

const uploadEvidence = async (employeeId: string, file: File): Promise<string> => {
  const isPdf = file.type === 'application/pdf';
  if (isPdf && file.size > 5 * 1024 * 1024) throw new Error('File PDF vượt quá 5 MB.');
  const body = isPdf ? file : await compressImageWithinLimit(file, 1);
  const path = `${employeeId}/${crypto.randomUUID()}.${isPdf ? 'pdf' : 'jpg'}`;
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, body, {
    contentType: isPdf ? 'application/pdf' : 'image/jpeg', upsert: false,
  });
  if (error) throw new Error('Không tải được giấy tờ đính kèm. Kiểm tra mạng rồi thử lại.');
  return path;
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
      .select('code,name,description,paid_by,deducts_annual,unit,second_step_after_days,second_step_hr,requires_official,subtypes,requires_attachment,attachment_hint,is_system,is_active,sort_order')
      .order('sort_order').limit(100);
    if (error) fail(error, 'Không tải được loại đơn.');
    return (data || []).map(row => ({
      code: row.code, name: row.name, description: row.description, paidBy: row.paid_by,
      deductsAnnual: row.deducts_annual, unit: row.unit,
      secondStepAfterDays: row.second_step_after_days === null ? null : Number(row.second_step_after_days),
      hrStep: row.second_step_hr, requiresOfficial: row.requires_official,
      subtypes: (Array.isArray(row.subtypes) ? row.subtypes : []).map((item: { name: string; maxDays?: number | null }) => ({
        name: String(item.name), maxDays: item.maxDays === null || item.maxDays === undefined ? null : Number(item.maxDays),
      })),
      requiresAttachment: row.requires_attachment, attachmentHint: row.attachment_hint,
      isSystem: row.is_system, isActive: row.is_active,
    }));
  },

  /** Create (code null) or update a leave type; returns its code. HR Manage / Admin only. */
  async saveType(code: string | null, draft: LeaveTypeDraft): Promise<string> {
    const { data, error } = await supabase.rpc('save_hrm_leave_type', { p_code: code, p_payload: draft });
    if (error) fail(error, 'Không lưu được loại đơn.');
    return String(data);
  },

  async listPolicyLog(): Promise<LeavePolicyLogRow[]> {
    const { data, error } = await supabase.rpc('list_hrm_leave_policy_log', { p_limit: 200 });
    if (error) fail(error, 'Không tải được lịch sử thay đổi.');
    return (data || []) as LeavePolicyLogRow[];
  },

  async getSettings(): Promise<LeaveSettings | null> {
    const { data, error } = await supabase.from('hrm_leave_settings')
      .select('second_step_approver_user_id,second_step_label,late_early_max_minutes,saturday_is_workday')
      .limit(1).maybeSingle();
    if (error) fail(error, 'Không tải được chính sách nghỉ.');
    if (!data) return null;
    return {
      secondStepApproverUserId: data.second_step_approver_user_id,
      secondStepLabel: data.second_step_label,
      lateEarlyMaxMinutes: data.late_early_max_minutes,
      saturdayIsWorkday: data.saturday_is_workday,
    };
  },

  async saveSettings(settings: LeaveSettings): Promise<void> {
    const { error } = await supabase.rpc('save_hrm_leave_settings', { p_payload: settings });
    if (error) fail(error, 'Không lưu được quy tắc chung.');
  },

  async setTypeActive(code: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_hrm_leave_type_active', { p_code: code, p_active: isActive });
    if (error) fail(error, 'Không cập nhật được loại đơn.');
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

  /** Balance with carried days and every add / deduct line (own ledger, or anyone's for HR). */
  async ledger(employeeId: string, year: number): Promise<{ balance: LeaveLedgerBalance | null; entries: LeaveLedgerEntry[] }> {
    const { data, error } = await supabase.rpc('get_hrm_leave_ledger', { p_employee_id: employeeId, p_year: year });
    if (error) fail(error, 'Không tải được sổ phép.');
    const value = (data || {}) as { balance?: unknown; entries?: Array<Record<string, unknown>> };
    return {
      balance: toBalance(value.balance),
      entries: (value.entries || []).map(entry => ({
        ...(entry as unknown as LeaveLedgerEntry),
        days: Number(entry.days) || 0, carryDays: Number(entry.carryDays) || 0, balanceAfter: Number(entry.balanceAfter) || 0,
      })),
    };
  },

  async listBalances(year: number): Promise<LeaveBalanceRow[]> {
    const { data, error } = await supabase.rpc('list_hrm_leave_balances', { p_year: year });
    if (error) fail(error, 'Không tải được số phép toàn công ty.');
    return ((data || []) as Array<Record<string, unknown>>).map(row => ({
      ...(row as unknown as LeaveBalanceRow), balance: toBalance(row.balance),
    }));
  },

  async adjustBalance(employeeId: string, year: number, remaining: number, reason: string): Promise<void> {
    const { error } = await supabase.rpc('adjust_hrm_leave_balance', {
      p_employee_id: employeeId, p_year: year, p_remaining: remaining, p_reason: reason,
    });
    if (error) fail(error, 'Không điều chỉnh được số phép.');
  },

  async preview(input: { type: string; start: string; end: string; startSession: LeaveSession; endSession: LeaveSession; minutes: number | null; subtype?: string | null }): Promise<LeavePreview> {
    const { data, error } = await supabase.rpc('preview_my_leave_request', {
      p_type: input.type, p_start: input.start, p_end: input.end,
      p_start_session: input.startSession, p_end_session: input.endSession, p_minutes: input.minutes,
      p_subtype: input.subtype ?? null,
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

  async submit(input: {
    type: string; start: string; end: string; startSession: LeaveSession; endSession: LeaveSession;
    minutes: number | null; subtype: string | null; reason: string; employeeId?: string; files?: File[];
  }): Promise<void> {
    const paths: string[] = [];
    if (input.files?.length && input.employeeId) {
      for (const file of input.files.slice(0, LEAVE_MAX_ATTACHMENTS)) paths.push(await uploadEvidence(input.employeeId, file));
    }
    const { error } = await supabase.rpc('submit_my_leave_request', {
      p_type: input.type, p_start: input.start, p_end: input.end,
      p_start_session: input.startSession, p_end_session: input.endSession,
      p_minutes: input.minutes, p_subtype: input.subtype, p_reason: input.reason, p_attachment_paths: paths,
    });
    if (error) fail(error, 'Không gửi được đơn.');
  },

  /** Short-lived links to a request's papers (owner, its approvers, HR). */
  async attachmentUrls(paths: string[]): Promise<Array<{ path: string; url: string | null; isPdf: boolean }>> {
    if (paths.length === 0) return [];
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, 600);
    return paths.map(path => ({
      path, isPdf: path.endsWith('.pdf'),
      url: data?.find(item => item.path === path)?.signedUrl || null,
    }));
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
