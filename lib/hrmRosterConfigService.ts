// Cấu hình Hồ sơ nhân sự: approvers of Bảng nhân sự requests and HR's extra columns.
// Only Admin / HR Manage change it; the server checks and keeps an audit trail.
import { supabase } from './supabase';
import type { CustomFieldDraft, RosterApprovalSettings, RosterConfig, RosterCustomField } from './hrmRosterConfig';

const ERROR_MESSAGES: Record<string, string> = {
  HRM_ROSTER_CONFIG_FORBIDDEN: 'Chỉ Admin và HR Manage được sửa cấu hình.',
  HRM_ROSTER_APPROVER_INVALID: 'Có người duyệt không còn hoạt động. Tải lại rồi chọn lại.',
  HRM_ROSTER_CUSTOM_FIELD_INVALID: 'Cột chưa hợp lệ: kiểm tra tên, kiểu và danh sách chọn.',
  HRM_ROSTER_CUSTOM_FIELD_DUPLICATE: 'Đã có cột cùng tên.',
  HRM_ROSTER_CUSTOM_FIELD_IN_USE: 'Cột đã có dữ liệu nên không xóa được. Hãy ẩn cột.',
  HRM_ROSTER_CUSTOM_FIELD_PENDING: 'Cột đang có trong phiếu chờ duyệt. Chờ duyệt xong rồi đổi kiểu cột.',
  HRM_ROSTER_CUSTOM_FIELD_TYPE_LOCKED: 'Cột đã có dữ liệu nên không đổi được kiểu.',
  HRM_ROSTER_CUSTOM_FIELD_OPTION_IN_USE: 'Có người đang dùng lựa chọn bạn vừa bỏ. Đổi giá trị của họ trước rồi bỏ lựa chọn.',
};

const message = (error: unknown, fallback: string) => {
  const raw = error instanceof Error ? error.message : (error as { message?: string } | null)?.message || '';
  const code = Object.keys(ERROR_MESSAGES).find(key => raw.includes(key));
  return code ? ERROR_MESSAGES[code] : raw && !/^[A-Z_]+$/.test(raw) ? raw : fallback;
};

const rpc = async <T>(name: string, params: Record<string, unknown>, fallback: string): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(message(error, fallback));
  return data as T;
};

export const hrmRosterConfigService = {
  load(): Promise<RosterConfig> {
    return rpc<RosterConfig>('get_hrm_roster_config', {}, 'Không tải được cấu hình.');
  },

  saveApprovals(settings: RosterApprovalSettings): Promise<RosterConfig> {
    return rpc<RosterConfig>('save_hrm_roster_approvals', { p_settings: settings }, 'Không lưu được người duyệt.');
  },

  saveCustomField(id: string | null, draft: CustomFieldDraft): Promise<RosterCustomField> {
    return rpc<RosterCustomField>('save_hrm_roster_custom_field', {
      p_id: id, p_label: draft.label.trim(), p_group: draft.group, p_type: draft.type,
      p_options: draft.type === 'select' ? draft.options.map(option => option.trim()).filter(Boolean) : [],
      p_required: draft.required, p_pay_only: draft.payOnly || draft.group === 'pay', p_hint: draft.hint.trim() || null,
    }, 'Không lưu được cột.');
  },

  setCustomFieldActive(id: string, active: boolean): Promise<RosterCustomField> {
    return rpc<RosterCustomField>('set_hrm_roster_custom_field_active', { p_id: id, p_active: active }, 'Không đổi được trạng thái cột.');
  },

  reorderCustomFields(ids: string[]): Promise<void> {
    return rpc<void>('reorder_hrm_roster_custom_fields', { p_ids: ids }, 'Không đổi được thứ tự cột.');
  },

  deleteCustomField(id: string): Promise<void> {
    return rpc<void>('delete_hrm_roster_custom_field', { p_id: id }, 'Không xóa được cột.');
  },
};
