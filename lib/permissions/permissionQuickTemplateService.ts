import { isSupabaseConfigured, supabase } from '../supabase';

export interface PermissionQuickTemplate {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  permissionCodes: string[];
  updatedAt?: string;
}

export interface SavePermissionQuickTemplateInput {
  templateId: string | null;
  code: string;
  name: string;
  description?: string;
  permissionCodes: readonly string[];
  reason: string;
}

const throwIfError = (error: unknown): void => {
  if (error) throw error;
};

const mapTemplate = (row: any): PermissionQuickTemplate => ({
  id: String(row.id),
  code: String(row.code),
  name: String(row.name),
  description: row.description || undefined,
  isActive: Boolean(row.is_active ?? row.isActive),
  permissionCodes: Array.isArray(row.permission_codes)
    ? row.permission_codes.map(String)
    : Array.isArray(row.permissionCodes)
      ? row.permissionCodes.map(String)
      : [],
  updatedAt: row.updated_at ?? row.updatedAt,
});

export const permissionQuickTemplateService = {
  async list(): Promise<PermissionQuickTemplate[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.rpc('list_permission_quick_templates');
    throwIfError(error);
    return (Array.isArray(data) ? data : []).map(mapTemplate);
  },

  async save(input: SavePermissionQuickTemplateInput): Promise<string> {
    if (!isSupabaseConfigured) return '';
    const { data, error } = await supabase.rpc('save_permission_quick_template', {
      p_template_id: input.templateId || null,
      p_code: input.code.trim(),
      p_name: input.name.trim(),
      p_description: input.description?.trim() || null,
      p_permission_codes: [...new Set(input.permissionCodes.map(code => code.trim()).filter(Boolean))],
      p_reason: input.reason.trim(),
    });
    throwIfError(error);
    return String(data);
  },

  async deactivate(templateId: string, reason: string): Promise<void> {
    if (!isSupabaseConfigured || !templateId) return;
    const { error } = await supabase.rpc('deactivate_permission_quick_template', {
      p_template_id: templateId,
      p_reason: reason.trim(),
    });
    throwIfError(error);
  },
};
