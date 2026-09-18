import { isSupabaseConfigured, supabase } from '../supabase';
import { mapAuthorizationRpcError } from './authorizationUpdateValidation';
import { PermissionScopeType } from './permissionTypes';

export interface BusinessRoleItem {
  permissionCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  sortOrder: number;
}

export interface BusinessRoleAssignment {
  id: string;
  targetUserId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  startsAt: string;
  expiresAt?: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  assignedReason: string;
  updatedAt: string;
}

export interface BusinessRoleTemplate {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  isSystem: boolean;
  version: number;
  dynamic: boolean;
  locked: boolean;
  futureActionPolicy: 'auto_include' | 'manual_review';
  effectiveActionCount: number;
  items: BusinessRoleItem[];
  assignments: BusinessRoleAssignment[];
}

export interface BusinessRoleAdminSnapshot {
  generatedAt: string;
  templates: BusinessRoleTemplate[];
}

export interface BusinessRoleFinding {
  ruleCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  message?: string;
}

export interface BusinessRoleAssignmentPreview {
  roleTemplateId: string;
  roleCode: string;
  roleVersion: number;
  dynamic: boolean;
  futureActionPolicy: 'auto_include' | 'manual_review';
  assignmentScopeType: PermissionScopeType;
  assignmentScopeId: string;
  permissionCount: number;
  sensitivePermissionCount: number;
  businessApprovalPermissionCount: number;
  permissions: Array<{ permissionCode: string; scopeType: PermissionScopeType; scopeId: string }>;
  hardDenies: BusinessRoleFinding[];
  warnings: BusinessRoleFinding[];
  fingerprint: string;
}

export interface SodWarningAcceptance {
  ruleCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  reason: string;
  controlOwnerUserId: string;
  compensatingControls: string;
  expiresAt: string;
}

export interface BusinessRoleGateway {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message?: string; details?: string; code?: string } | null;
  }>;
}

const gateway = (custom?: BusinessRoleGateway): BusinessRoleGateway => {
  if (custom) return custom;
  if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
  return supabase as unknown as BusinessRoleGateway;
};

const rpcError = (error: { message?: string; details?: string; code?: string }) => {
  if (error.message?.includes('AUTHORIZATION_STALE_ROLE_VERSION')) {
    return new Error('Mẫu quyền đã thay đổi. Vui lòng tải lại trước khi lưu.');
  }
  if (error.message?.includes('AUTHORIZATION_STALE_ASSIGNMENT_PREVIEW')) {
    return new Error('Preview đã cũ. Vui lòng kiểm tra tác động lại trước khi gán.');
  }
  return mapAuthorizationRpcError(error);
};

export const getBusinessRoleAdminSnapshot = async (
  custom?: BusinessRoleGateway,
): Promise<BusinessRoleAdminSnapshot> => {
  const { data, error } = await gateway(custom).rpc('get_business_role_admin_snapshot');
  if (error) throw rpcError(error);
  const snapshot = data as BusinessRoleAdminSnapshot | null;
  if (!snapshot || !Array.isArray(snapshot.templates)) {
    throw new Error('Dữ liệu mẫu quyền không hợp lệ.');
  }
  return snapshot;
};

export const previewBusinessRoleAssignment = async (input: {
  targetUserId: string;
  roleTemplateId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
}, custom?: BusinessRoleGateway): Promise<BusinessRoleAssignmentPreview> => {
  const { data, error } = await gateway(custom).rpc('preview_business_role_assignment_v2', {
    p_target_user_id: input.targetUserId,
    p_role_template_id: input.roleTemplateId,
    p_scope_type: input.scopeType,
    p_scope_id: input.scopeId,
  });
  if (error) throw rpcError(error);
  const preview = data as BusinessRoleAssignmentPreview | null;
  if (!preview?.fingerprint || !Array.isArray(preview.hardDenies) || !Array.isArray(preview.warnings)) {
    throw new Error('Preview phân quyền không hợp lệ.');
  }
  return preview;
};

export const saveBusinessRole = async (input: {
  roleTemplateId?: string;
  expectedRoleVersion?: number;
  code: string;
  name: string;
  description?: string;
  items: readonly BusinessRoleItem[];
  reason: string;
}, custom?: BusinessRoleGateway): Promise<{ roleTemplateId: string; version: number; savedAt: string }> => {
  if (input.name.trim().length < 3 || input.reason.trim().length < 10) {
    throw new Error('Tên mẫu và lý do thay đổi chưa hợp lệ.');
  }
  const { data, error } = await gateway(custom).rpc('save_business_role_v2', {
    p_role_template_id: input.roleTemplateId || null,
    p_expected_role_version: input.expectedRoleVersion ?? (input.roleTemplateId ? null : 0),
    p_code: input.code,
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
    p_items: input.items.map(item => ({
      permission_code: item.permissionCode,
      scope_type: item.scopeType,
      scope_id: item.scopeId,
      sort_order: item.sortOrder,
    })),
    p_reason: input.reason.trim(),
  });
  if (error) throw rpcError(error);
  return data as { roleTemplateId: string; version: number; savedAt: string };
};

export const assignBusinessRole = async (input: {
  targetUserId: string;
  roleTemplateId: string;
  expectedRoleVersion: number;
  scopeType: PermissionScopeType;
  scopeId: string;
  expiresAt?: string;
  reason: string;
  warningAcceptances: readonly SodWarningAcceptance[];
  expectedPreviewFingerprint: string;
}, custom?: BusinessRoleGateway): Promise<{ assignmentId: string; assignedAt: string }> => {
  if (input.reason.trim().length < 10) throw new Error('Lý do gán mẫu phải có ít nhất 10 ký tự.');
  const { data, error } = await gateway(custom).rpc('assign_business_role_v2', {
    p_target_user_id: input.targetUserId,
    p_role_template_id: input.roleTemplateId,
    p_expected_role_version: input.expectedRoleVersion,
    p_scope_type: input.scopeType,
    p_scope_id: input.scopeId,
    p_starts_at: new Date().toISOString(),
    p_expires_at: input.expiresAt || null,
    p_reason: input.reason.trim(),
    p_warning_acceptances: input.warningAcceptances,
    p_expected_preview_fingerprint: input.expectedPreviewFingerprint,
  });
  if (error) throw rpcError(error);
  return data as { assignmentId: string; assignedAt: string };
};

export const revokeBusinessRoleAssignment = async (
  assignmentId: string,
  reason: string,
  custom?: BusinessRoleGateway,
): Promise<void> => {
  if (reason.trim().length < 10) throw new Error('Lý do thu hồi phải có ít nhất 10 ký tự.');
  const { error } = await gateway(custom).rpc('revoke_business_role_assignment', {
    p_assignment_id: assignmentId,
    p_reason: reason.trim(),
  });
  if (error) throw rpcError(error);
};
