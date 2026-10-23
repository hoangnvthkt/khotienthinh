import { supabase } from './supabase';

// Đợt 2b: một người theo một mẫu quyền ("gói sống"). Sửa mẫu là cập nhật mọi người đang theo mẫu;
// quyền Admin bỏ riêng không bị cấp lại, quyền thêm riêng không bị gỡ (server: user_template_assignments).

export interface UserTemplateAssignment {
  userId: string;
  templateCode: string;
  templateName: string;
  options: string[];
  excludedCount: number;
  appliedCount: number;
  assignedAt: string;
  updatedAt: string;
  assignedByName: string | null;
}

export interface TemplateAssignmentPreviewItem {
  permissionCode: string;
  scopeType: string;
  label: string;
  moduleCode: string;
  moduleLabel?: string | null;
}

export interface TemplateAssignmentPreview {
  add: TemplateAssignmentPreviewItem[];
  remove: TemplateAssignmentPreviewItem[];
  excludedCount: number;
}

export interface TemplateAssignmentResult {
  added: number;
  removed: number;
}

const toAssignment = (row: any): UserTemplateAssignment | null => (row ? {
  userId: row.userId,
  templateCode: row.templateCode,
  templateName: row.templateName,
  options: Array.isArray(row.options) ? row.options : [],
  excludedCount: Array.isArray(row.excluded) ? row.excluded.length : 0,
  appliedCount: Array.isArray(row.applied) ? row.applied.length : 0,
  assignedAt: row.assignedAt,
  updatedAt: row.updatedAt,
  assignedByName: row.assignedByName ?? null,
} : null);

export const userTemplateAssignmentService = {
  async get(userId: string): Promise<UserTemplateAssignment | null> {
    const { data, error } = await supabase.rpc('get_user_template_assignment_v1', { p_user_id: userId });
    if (error) throw error;
    return toAssignment(data);
  },

  async preview(userId: string, templateCode: string, options: readonly string[]): Promise<TemplateAssignmentPreview> {
    const { data, error } = await supabase.rpc('preview_user_template_assignment_v1', {
      p_user_id: userId, p_template_code: templateCode, p_options: [...options],
    });
    if (error) throw error;
    return {
      add: (data as any)?.add || [],
      remove: (data as any)?.remove || [],
      excludedCount: Number((data as any)?.excludedCount || 0),
    };
  },

  async save(userId: string, templateCode: string, options: readonly string[], reason: string): Promise<TemplateAssignmentResult> {
    const { data, error } = await supabase.rpc('save_user_template_assignment_v1', {
      p_user_id: userId, p_template_code: templateCode, p_options: [...options], p_reason: reason,
    });
    if (error) throw error;
    return { added: Number((data as any)?.added || 0), removed: Number((data as any)?.removed || 0) };
  },

  async remove(userId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('remove_user_template_assignment_v1', { p_user_id: userId, p_reason: reason });
    if (error) throw error;
  },
};
