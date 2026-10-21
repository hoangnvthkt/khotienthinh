// Bảng nhân sự: reads the roster and change requests; every write goes through a request
// that HR Manage approves. The server checks permissions and re-reads old values on apply.
import { supabase } from './supabase';
import { fieldLabel, type RosterBatch, type RosterBatchSource, type RosterChangeItem, type RosterData } from './hrmRoster';

const ERROR_MESSAGES: Record<string, string> = {
  HRM_ROSTER_HR_ONLY: 'Chỉ HR xem và sửa được Bảng nhân sự.',
  HRM_ROSTER_PAY_FORBIDDEN: 'Lương và phụ cấp chỉ HR Manage được đổi.',
  HRM_ROSTER_EMPTY: 'Phiếu chưa có thay đổi nào.',
  HRM_ROSTER_REASON_REQUIRED: 'Lý do cần ít nhất 10 ký tự.',
  HRM_ROSTER_FIELD_PENDING: 'Có ô đang chờ duyệt ở phiếu khác. Chờ phiếu đó xong rồi gửi tiếp.',
  HRM_ROSTER_STALE: 'Dữ liệu đã thay đổi từ lúc bạn mở. Tải lại bảng rồi soạn lại.',
  HRM_ROSTER_NOT_PENDING: 'Phiếu này đã được xử lý.',
  HRM_ROSTER_SELF_DECISION: 'Không tự duyệt phiếu của chính mình hoặc phiếu đổi thông tin của mình.',
  HRM_ROSTER_NOT_APPROVER: 'Bạn không nằm trong danh sách người duyệt phiếu này.',
  HRM_ROSTER_CODE_TAKEN: 'Mã NV mới trùng với người khác. Kiểm tra lại số CCCD.',
  HRM_ROSTER_ID_TAKEN: 'Số CCCD này đã gắn với một người khác.',
  HRM_ROSTER_VALUE_INVALID: 'Có ô giá trị không hợp lệ (ngày, số, CCCD hoặc mục không còn trong danh mục). Kiểm tra lại rồi gửi.',
  HRM_ROSTER_FIELD_UNKNOWN: 'Có cột không được phép đổi. Tải lại trang rồi soạn lại.',
  HRM_ROSTER_EFFECTIVE_DATE_INVALID: 'Ngày hiệu lực chỉ trong vòng 1 năm quanh hôm nay.',
  HRM_ROSTER_NO_APPROVER: 'Không ai duyệt được phiếu này: người duyệt trùng người gửi hoặc có tên trong phiếu. Nhờ Admin thêm người duyệt ở Cấu hình.',
  HRM_ROSTER_TOO_MANY: 'Phiếu quá lớn (tối đa 6.000 ô). Chia file làm nhiều lần.',
  HRM_ROSTER_NOT_FOUND: 'Không tìm thấy phiếu.',
};

export const rosterErrorMessage = (error: unknown, fallback: string): string => {
  const raw = error instanceof Error ? error.message : (error as { message?: string } | null)?.message || '';
  const detail = String((error as { details?: string } | null)?.details || '').trim();
  const code = Object.keys(ERROR_MESSAGES).find(key => raw.includes(key));
  if (code === 'HRM_ROSTER_VALUE_INVALID' && detail) return `Ô "${fieldLabel(detail)}" có giá trị không hợp lệ. Kiểm tra lại rồi gửi.`;
  if (code === 'HRM_ROSTER_FIELD_PENDING' && detail) return `Có ô đang chờ duyệt ở phiếu ${detail}. Chờ phiếu đó xong rồi gửi tiếp.`;
  if (code === 'HRM_ROSTER_ID_TAKEN' && detail) return `Số CCCD ${detail} đã gắn với một người khác.`;
  if (code) return ERROR_MESSAGES[code];
  return raw && !/^[A-Z_]+$/.test(raw) ? raw : fallback;
};

const rpc = async <T>(name: string, params: Record<string, unknown>, fallback: string): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(rosterErrorMessage(error, fallback));
  return data as T;
};

export interface RosterSubmitInput {
  source: RosterBatchSource;
  title: string;
  reason: string;
  effectiveDate: string;
  items: RosterChangeItem[];
  fileName?: string | null;
}

export type RosterBatchScope = 'pending' | 'returned' | 'approved';

export const hrmRosterService = {
  load(): Promise<RosterData> {
    return rpc<RosterData>('get_hrm_roster', {}, 'Không tải được Bảng nhân sự.');
  },

  listBatches(scope: RosterBatchScope): Promise<RosterBatch[]> {
    return rpc<RosterBatch[] | null>('list_hrm_roster_batches', { p_scope: scope }, 'Không tải được phiếu thay đổi.')
      .then(rows => rows || []);
  },

  getBatch(id: string): Promise<RosterBatch> {
    return rpc<RosterBatch>('get_hrm_roster_batch', { p_id: id }, 'Không mở được phiếu.');
  },

  /** Rows about an approver are split into their own request: `codes` lists every request created. */
  submit(input: RosterSubmitInput): Promise<{ id: string; code: string; codes: string[]; approverNames: string[] }> {
    return rpc('submit_hrm_roster_batch', {
      p_source: input.source, p_title: input.title, p_reason: input.reason.trim(), p_effective_date: input.effectiveDate,
      p_items: input.items.map(item => ({
        employeeId: item.employeeId, personKey: item.personKey, field: item.field, oldValue: item.oldValue, newValue: item.newValue, fullName: item.fullName,
      })),
      p_file_name: input.fileName || null,
    }, 'Không gửi được phiếu.');
  },

  decide(id: string, approve: boolean, note: string): Promise<RosterBatch> {
    return rpc<RosterBatch>('decide_hrm_roster_batch', { p_id: id, p_approve: approve, p_note: note.trim() || null },
      approve ? 'Không duyệt được phiếu.' : 'Không trả lại được phiếu.');
  },

  cancel(id: string, reason: string): Promise<void> {
    return rpc<void>('cancel_hrm_roster_batch', { p_id: id, p_reason: reason.trim() }, 'Không rút được phiếu.');
  },
};
