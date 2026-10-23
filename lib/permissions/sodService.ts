import { UserPermissionGrant } from '../../types';
import { supabase } from '../supabase';

// Đợt 2c: luật kiêm nhiệm. Cấp mới tạo ra cặp quyền kiêm nhiệm (Mua hàng + Duyệt PO, Mua hàng + Thủ kho,
// Xác nhận chi + Quản trị Tài chính) thì Admin phải ghi nhận ngoại lệ; máy chủ kiểm lại (assert_and_record_sod_warnings).

export interface SodWarning {
  ruleCode: string;
  name: string;
  description: string;
  scopeType: string;
  scopeId: string;
  scopeLabel?: string | null;
  permissions: { code: string; label: string; moduleLabel?: string | null }[];
  controls: string[];
}

export interface SodPreview {
  warnings: SodWarning[];
  hardDenies: { ruleCode: string; message?: string }[];
  defaultControlOwnerId: string | null;
}

/** Một lần ghi nhận dùng chung cho mọi cảnh báo trong cùng lần lưu. */
export interface SodAcknowledgement {
  reason: string;
  controlOwnerUserId: string;
  compensatingControls: string;
  expiresAt: string;
}

export interface SodWarningAcceptance extends SodAcknowledgement {
  ruleCode: string;
  scopeType: string;
  scopeId: string;
}

export interface SodRuleGroup {
  ruleCode: string;
  name: string;
  description: string;
  permissions: SodWarning['permissions'];
  controls: string[];
  scopeLabels: string[];
}

export interface UserSodConflict {
  userId: string;
  name: string;
  email: string;
  conflicts: {
    ruleCode: string;
    name: string;
    description: string;
    scopes: { scopeType: string; scopeId: string; scopeLabel?: string | null }[];
    acceptance: { expiresAt: string; reason: string; compensatingControls: string; controlOwnerName: string | null; acceptedAt: string } | null;
  }[];
}

export const SOD_MIN_TEXT = 10;
export const SOD_EXPIRY_MONTHS = [3, 6, 12] as const;

export const emptySodAcknowledgement = (controlOwnerUserId: string | null = null): SodAcknowledgement => ({
  reason: '',
  controlOwnerUserId: controlOwnerUserId || '',
  compensatingControls: '',
  expiresAt: sodExpiryAfterMonths(6),
});

export const sodExpiryAfterMonths = (months: number, from = new Date()): string => {
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
};

/** Lý do chưa đủ để ghi nhận (rỗng = đủ). */
export const sodAcknowledgementIssue = (ack: SodAcknowledgement, actorUserId: string | null, targetUserId: string): string => {
  if (ack.reason.trim().length < SOD_MIN_TEXT) return `Lý do kiêm nhiệm cần ít nhất ${SOD_MIN_TEXT} ký tự.`;
  if (!ack.controlOwnerUserId) return 'Chọn người kiểm soát.';
  if (ack.controlOwnerUserId === targetUserId) return 'Người kiểm soát phải khác người được cấp quyền.';
  if (actorUserId && ack.controlOwnerUserId === actorUserId) return 'Người kiểm soát phải khác người đang cấp quyền.';
  if (ack.compensatingControls.trim().length < SOD_MIN_TEXT) return `Cách kiểm soát bù cần ít nhất ${SOD_MIN_TEXT} ký tự.`;
  if (!ack.expiresAt || Date.parse(ack.expiresAt) <= Date.now()) return 'Chọn hạn ghi nhận ở tương lai.';
  return '';
};

export const toSodAcceptances = (warnings: readonly SodWarning[], ack: SodAcknowledgement): SodWarningAcceptance[] => warnings.map(warning => ({
  ruleCode: warning.ruleCode,
  scopeType: warning.scopeType,
  scopeId: warning.scopeId,
  reason: ack.reason.trim(),
  controlOwnerUserId: ack.controlOwnerUserId,
  compensatingControls: ack.compensatingControls.trim(),
  expiresAt: ack.expiresAt,
}));

/** Gộp cảnh báo cùng luật (mỗi kho một cảnh báo) để hiện một dòng. */
export const groupSodWarnings = (warnings: readonly SodWarning[]): SodRuleGroup[] => {
  const groups = new Map<string, SodRuleGroup>();
  warnings.forEach(warning => {
    const group = groups.get(warning.ruleCode) || {
      ruleCode: warning.ruleCode,
      name: warning.name,
      description: warning.description,
      permissions: warning.permissions,
      controls: warning.controls,
      scopeLabels: [],
    };
    if (warning.scopeType !== 'global') group.scopeLabels.push(warning.scopeLabel || warning.scopeId);
    groups.set(warning.ruleCode, group);
  });
  return [...groups.values()];
};

export const toSodPreview = (data: unknown): SodPreview => {
  const row = (data || {}) as Partial<SodPreview>;
  return {
    warnings: Array.isArray(row.warnings) ? row.warnings.map(warning => ({
      ...warning,
      permissions: Array.isArray(warning.permissions) ? warning.permissions : [],
      controls: Array.isArray(warning.controls) ? warning.controls : [],
    })) : [],
    hardDenies: Array.isArray(row.hardDenies) ? row.hardDenies : [],
    defaultControlOwnerId: row.defaultControlOwnerId || null,
  };
};

const toGrantPayload = (grants: readonly UserPermissionGrant[]) => grants
  .filter(grant => grant.isActive !== false)
  .map(grant => ({
    permission_code: grant.permissionCode,
    scope_type: grant.scopeType || 'global',
    scope_id: grant.scopeId || '*',
    is_active: true,
    expires_at: grant.expiresAt || null,
  }));

export const sodService = {
  /** Cảnh báo kiêm nhiệm nếu lưu bộ quyền riêng này cho người đó. */
  async previewUserGrants(userId: string, grants: readonly UserPermissionGrant[]): Promise<SodPreview> {
    const { data, error } = await supabase.rpc('preview_user_authorization_sod_v1', {
      p_user_id: userId, p_grants: toGrantPayload(grants),
    });
    if (error) throw error;
    return toSodPreview(data);
  },

  async listConflicts(userId?: string): Promise<UserSodConflict[]> {
    const { data, error } = await supabase.rpc('list_user_sod_conflicts_v1', userId ? { p_user_id: userId } : {});
    if (error) throw error;
    return Array.isArray(data) ? data as UserSodConflict[] : [];
  },
};
