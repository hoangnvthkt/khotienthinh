// Employee change requests, HR reminders and direct managers (HRM G3b).
import { supabase } from './supabase';
import { compressImageWithinLimit } from './vehicleBookingService';
import type { ProfileChangeKind } from './hrmProfileFields';

const EVIDENCE_BUCKET = 'hrm-profile-evidence';
const MAX_ATTACHMENTS = 4;

export type ProfileChangeStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ProfileChangeRequest {
  id: string;
  employeeId: string;
  kind: ProfileChangeKind;
  kindLabel: string;
  payload: Record<string, unknown>;
  note: string | null;
  attachmentPaths: string[];
  status: ProfileChangeStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  employeeCode: string | null;
  fullName: string;
  orgUnitName: string | null;
  needsCompensationManager: boolean;
}

export type HrReminderKind = 'contract' | 'identity' | 'certification' | 'probation';

export interface HrReminder {
  kind: HrReminderKind;
  recordId: string;
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  orgUnitName: string | null;
  label: string;
  dueDate: string;
  daysLeft: number;
}

export type DirectManagerSource = 'org_chart' | 'designated' | 'none';

export interface DirectManagerRow {
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  orgUnitName: string | null;
  positionName: string | null;
  hasAccount: boolean;
  managerUserId: string | null;
  managerName: string | null;
  source: DirectManagerSource;
  designatedManagerUserId: string | null;
  leaveApproverName: string | null;
  leaveApproverLabel: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  HRM_PROFILE_CHANGE_NO_EMPLOYEE: 'Tài khoản chưa gắn với hồ sơ nhân sự đang làm việc.',
  HRM_PROFILE_CHANGE_NOTE_REQUIRED: 'Hãy ghi rõ thông tin cần sửa.',
  HRM_PROFILE_CHANGE_EMPTY: 'Chưa nhập thông tin cần cập nhật.',
  HRM_PROFILE_CHANGE_TOO_MANY_PENDING: 'Bạn đang có 10 đề nghị chờ duyệt. Chờ HR xử lý bớt rồi gửi tiếp.',
  HRM_PROFILE_CHANGE_ATTACHMENT_FORBIDDEN: 'Ảnh đính kèm không hợp lệ. Tải lại trang rồi thử lại.',
  HRM_PROFILE_CHANGE_NOT_PENDING: 'Đề nghị này đã được xử lý.',
  HRM_PROFILE_CHANGE_SELF_DECISION: 'Không tự duyệt đề nghị của chính mình. Nhờ HR khác duyệt.',
  HRM_PROFILE_CHANGE_REJECT_REASON_REQUIRED: 'Ghi lý do từ chối để nhân viên biết cần bổ sung gì.',
  HRM_PROFILE_CHANGE_HR_ONLY: 'Chỉ HR xem được danh sách này.',
  HRM_COMPENSATION_MANAGE_REQUIRED: 'Tài khoản ngân hàng và thuế cần HR Manage duyệt.',
  HRM_DOCUMENT_MANAGE_REQUIRED: 'Bạn chưa có quyền quản lý bằng cấp, chứng chỉ.',
  HRM_SENSITIVE_EDIT_REQUIRED: 'Bạn chưa có quyền sửa giấy tờ, bảo hiểm.',
  HRM_ADDRESS_INPUT_INVALID: 'Địa chỉ cần đủ loại, tỉnh / thành, xã / phường và số nhà.',
  HRM_DIRECT_MANAGER_INVALID: 'Người được chọn không hợp lệ (chính người đó, tài khoản đã khóa hoặc đang là cấp dưới).',
  HRM_DIRECT_MANAGER_NO_ACCOUNT: 'Nhân viên chưa có tài khoản Vioo nên chưa gán được người duyệt.',
  HRM_DIRECT_MANAGER_HR_ONLY: 'Chỉ HR chỉ định được người duyệt.',
  HRM_PROFILE_SECTION_ACCESS_DENIED: 'Không thao tác được trên hồ sơ này (có thể là hồ sơ của chính bạn).',
  HRM_MUTATION_REASON_TOO_SHORT: 'Lý do cần ít nhất 10 ký tự.',
};

export const profileChangeErrorMessage = (error: unknown, fallback: string): string => {
  const raw = error instanceof Error ? error.message : (error as { message?: string } | null)?.message || '';
  const code = Object.keys(ERROR_MESSAGES).find(key => raw.includes(key));
  if (code) return ERROR_MESSAGES[code];
  if (/REQUIRED/.test(raw)) return 'Bạn chưa có quyền ghi phần hồ sơ này.';
  return raw && !/^[A-Z_]+$/.test(raw) ? raw : fallback;
};

const rpc = async <T>(name: string, params: Record<string, unknown>, fallback: string): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(profileChangeErrorMessage(error, fallback));
  return data as T;
};

const uploadEvidence = async (employeeId: string, file: File): Promise<string> => {
  const isPdf = file.type === 'application/pdf';
  if (isPdf && file.size > 5 * 1024 * 1024) throw new Error('File PDF vượt quá 5 MB.');
  const body = isPdf ? file : await compressImageWithinLimit(file, 1);
  const path = `${employeeId}/${crypto.randomUUID()}.${isPdf ? 'pdf' : 'jpg'}`;
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, body, {
    contentType: isPdf ? 'application/pdf' : 'image/jpeg', upsert: false,
  });
  if (error) throw new Error('Không tải được ảnh đính kèm. Kiểm tra mạng rồi thử lại.');
  return path;
};

export const hrmProfileChangeService = {
  MAX_ATTACHMENTS,

  async submit(input: {
    employeeId: string; kind: ProfileChangeKind; payload: Record<string, unknown>;
    note: string; files: File[];
  }): Promise<string> {
    const paths: string[] = [];
    for (const file of input.files.slice(0, MAX_ATTACHMENTS)) paths.push(await uploadEvidence(input.employeeId, file));
    return rpc<string>('submit_my_hrm_profile_change', {
      p_kind: input.kind, p_payload: input.payload, p_note: input.note.trim() || null, p_attachment_paths: paths,
    }, 'Không gửi được đề nghị.');
  },

  listMine(): Promise<ProfileChangeRequest[]> {
    return rpc<ProfileChangeRequest[] | null>('list_my_hrm_profile_changes', {}, 'Không tải được đề nghị của bạn.')
      .then(rows => rows || []);
  },

  cancel(id: string): Promise<void> {
    return rpc<void>('cancel_my_hrm_profile_change', { p_id: id }, 'Không hủy được đề nghị.');
  },

  listForHr(status: 'pending' | 'done' = 'pending'): Promise<ProfileChangeRequest[]> {
    return rpc<ProfileChangeRequest[] | null>('list_hrm_profile_change_requests', { p_status: status }, 'Không tải được đề nghị cập nhật.')
      .then(rows => rows || []);
  },

  decide(id: string, approve: boolean, note: string, payload: Record<string, unknown> | null): Promise<ProfileChangeRequest> {
    return rpc<ProfileChangeRequest>('decide_hrm_profile_change', {
      p_id: id, p_approve: approve, p_note: note.trim() || null, p_payload: payload,
    }, approve ? 'Không duyệt được đề nghị.' : 'Không từ chối được đề nghị.');
  },

  async attachmentUrls(paths: string[]): Promise<Array<{ path: string; url: string | null; isPdf: boolean }>> {
    if (paths.length === 0) return [];
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, 600);
    return paths.map(path => ({
      path, isPdf: path.endsWith('.pdf'),
      url: data?.find(item => item.path === path)?.signedUrl || null,
    }));
  },

  listReminders(days = 45): Promise<HrReminder[]> {
    return rpc<HrReminder[] | null>('list_hrm_hr_reminders', { p_days: days }, 'Không tải được việc sắp đến hạn.')
      .then(rows => rows || []);
  },

  listDirectManagers(): Promise<DirectManagerRow[]> {
    return rpc<DirectManagerRow[] | null>('list_hrm_direct_managers', {}, 'Không tải được danh sách người duyệt.')
      .then(rows => rows || []);
  },

  setDesignatedManager(employeeId: string, managerUserId: string | null, reason: string): Promise<void> {
    return rpc<void>('set_hrm_designated_manager', {
      p_employee_id: employeeId, p_manager_user_id: managerUserId, p_reason: reason,
    }, 'Không lưu được người duyệt.');
  },
};
