import type { UserPermissionGrant } from '../../types';
import { isSupabaseConfigured, supabase } from '../supabase';
import { buildDirectGrantReplacementPayload } from './permissionAdminService';
import type {
  AssignBusinessRoleInput,
  AuthorizationAuditEvent,
  AuthorizationDecision,
  AuthorizationOverrideInput,
  AuthorizationPrincipal,
  AuthorizationSodRule,
  BusinessRole,
  BusinessRoleImpactPreview,
  BusinessRoleItem,
  EffectivePermissionSource,
  PreviewAuthorizationChangeInput,
  PreviewBusinessRoleAssignmentInput,
  PrincipalRoleAssignment,
  SaveBusinessRoleInput,
} from './authorizationGovernanceTypes';

const EMPTY_DECISION: AuthorizationDecision = { hardDenies: [], warnings: [] };

const throwIfError = (error: unknown): void => {
  if (error) throw error;
};

export const mapEffectivePermissionSource = (row: any): EffectivePermissionSource => ({
  permissionCode: row.permission_code ?? row.permissionCode,
  sourceType: row.source_type ?? row.sourceType,
  sourceId: row.source_id ?? row.sourceId,
  sourceCode: row.source_code ?? row.sourceCode,
  sourceLabel: row.source_label ?? row.sourceLabel,
  scopeType: row.scope_type ?? row.scopeType,
  scopeId: row.scope_id ?? row.scopeId,
  startsAt: row.starts_at !== undefined ? row.starts_at : row.startsAt,
  expiresAt: row.expires_at !== undefined ? row.expires_at : row.expiresAt,
  riskLevel: row.risk_level ?? row.riskLevel,
  isBusinessApproval: Boolean(row.is_business_approval ?? row.isBusinessApproval),
  metadata: row.metadata || {},
});

export const buildAssignBusinessRoleRpcArgs = (input: AssignBusinessRoleInput) => ({
  p_target_user_id: input.targetUserId,
  p_role_template_id: input.roleTemplateId,
  p_scope_type: input.scopeType,
  p_scope_id: input.scopeId,
  p_starts_at: input.startsAt || null,
  p_expires_at: input.expiresAt || null,
  p_reason: input.reason.trim(),
  p_warning_acceptances: input.warningAcceptances,
});

export const buildPreviewAuthorizationChangeRpcArgs = (
  input: PreviewAuthorizationChangeInput,
) => ({
  p_target_user_id: input.targetUserId,
  p_proposed_permission_codes: input.proposedPermissionCodes,
  p_scope_type: input.scopeType,
  p_scope_id: input.scopeId,
  p_change_mode: input.changeMode,
});

export const buildPreviewBusinessRoleAssignmentRpcArgs = (
  input: PreviewBusinessRoleAssignmentInput,
) => ({
  p_target_user_id: input.targetUserId,
  p_role_template_id: input.roleTemplateId,
  p_scope_type: input.scopeType,
  p_scope_id: input.scopeId,
});

export const buildOverrideRpcArgs = (input: AuthorizationOverrideInput) => ({
  p_rule_code: input.ruleCode,
  p_subject_type: input.subjectType,
  p_subject_id: input.subjectId,
  p_scope_type: input.scopeType,
  p_scope_id: input.scopeId,
  p_reason: input.reason.trim(),
  p_control_owner_user_id: input.controlOwnerUserId,
  p_expires_at: input.expiresAt,
  p_idempotency_key: input.idempotencyKey,
});

const mapBusinessRoleItem = (row: any): BusinessRoleItem => ({
  permissionCode: row.permission_code ?? row.permissionCode,
  scopeType: row.scope_type ?? row.scopeType,
  scopeId: row.scope_id ?? row.scopeId,
  sortOrder: row.sort_order ?? row.sortOrder ?? 0,
});

const mapBusinessRole = (row: any): BusinessRole => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description ?? undefined,
  isActive: Boolean(row.is_active ?? row.isActive),
  isSystem: Boolean(row.is_system ?? row.isSystem),
  version: Number(row.version ?? 1),
  items: (row.role_permission_template_items ?? row.items ?? [])
    .map(mapBusinessRoleItem)
    .sort((left: BusinessRoleItem, right: BusinessRoleItem) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)),
});

const mapPrincipalRoleAssignment = (row: any): PrincipalRoleAssignment => ({
  id: row.id,
  principalType: row.principal_type ?? row.principalType,
  principalId: row.principal_id ?? row.principalId,
  roleTemplateId: row.role_template_id ?? row.roleTemplateId,
  scopeType: row.scope_type ?? row.scopeType,
  scopeId: row.scope_id ?? row.scopeId,
  startsAt: row.starts_at ?? row.startsAt,
  expiresAt: row.expires_at !== undefined ? row.expires_at : row.expiresAt,
  status: row.status,
  assignedBy: row.assigned_by ?? row.assignedBy,
  assignedReason: row.assigned_reason ?? row.assignedReason,
  revokedAt: row.revoked_at !== undefined ? row.revoked_at : row.revokedAt,
  revokedBy: row.revoked_by !== undefined ? row.revoked_by : row.revokedBy,
  revokedReason: row.revoked_reason !== undefined ? row.revoked_reason : row.revokedReason,
});

const mapDecision = (data: any): AuthorizationDecision => ({
  hardDenies: Array.isArray(data?.hardDenies) ? data.hardDenies : [],
  warnings: Array.isArray(data?.warnings) ? data.warnings : [],
});

export const authorizationGovernanceService = {
  async listAuthorizationPrincipals(): Promise<AuthorizationPrincipal[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.rpc('list_authorization_principals');
    throwIfError(error);
    return (data || []).map((row: any) => ({
      userId: row.user_id ?? row.userId,
      name: row.name,
      email: row.email,
      accountStatus: row.account_status ?? row.accountStatus,
    }));
  },

  async listPermissionAuditEvents(limit = 100): Promise<AuthorizationAuditEvent[]> {
    if (!isSupabaseConfigured) return [];
    const boundedLimit = Math.min(100, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 100)));
    const { data, error } = await supabase
      .from('permission_audit_events')
      .select('id,actor_user_id,target_user_id,event_type,before_grants,after_grants,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(boundedLimit);
    throwIfError(error);
    return (data || []).map((row: any) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      targetUserId: row.target_user_id,
      eventType: row.event_type,
      beforeGrants: row.before_grants,
      afterGrants: row.after_grants,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  },

  async listOverridableSodRules(): Promise<AuthorizationSodRule[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('authorization_sod_rules')
      .select('rule_code,name,description,rule_type,effect,operation_code,subject_type,overridable')
      .eq('is_active', true)
      .eq('effect', 'REQUIRE_OVERRIDE')
      .eq('overridable', true)
      .order('rule_code', { ascending: true });
    throwIfError(error);
    return (data || []).map((row: any) => ({
      ruleCode: row.rule_code,
      name: row.name,
      description: row.description,
      ruleType: row.rule_type,
      effect: row.effect,
      operationCode: row.operation_code,
      subjectType: row.subject_type,
      overridable: Boolean(row.overridable),
    }));
  },

  async listBusinessRoles(): Promise<BusinessRole[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('role_permission_templates')
      .select('id,code,name,description,is_active,is_system,version,role_permission_template_items(permission_code,scope_type,scope_id,sort_order)')
      .order('code', { ascending: true });
    throwIfError(error);
    return (data || []).map(mapBusinessRole);
  },

  async listPrincipalRoleAssignments(targetUserId: string): Promise<PrincipalRoleAssignment[]> {
    if (!isSupabaseConfigured || !targetUserId) return [];
    const { data, error } = await supabase
      .from('principal_role_assignments')
      .select('id,principal_type,principal_id,role_template_id,scope_type,scope_id,starts_at,expires_at,status,assigned_by,assigned_reason,revoked_at,revoked_by,revoked_reason')
      .eq('principal_type', 'user')
      .eq('principal_id', targetUserId)
      .order('starts_at', { ascending: false });
    throwIfError(error);
    return (data || []).map(mapPrincipalRoleAssignment);
  },

  async listEffectivePermissionSources(targetUserId: string): Promise<EffectivePermissionSource[]> {
    if (!isSupabaseConfigured || !targetUserId) return [];
    const { data, error } = await supabase.rpc('get_effective_permission_sources', {
      p_target_user_id: targetUserId,
    });
    throwIfError(error);
    return (data || []).map(mapEffectivePermissionSource);
  },

  async previewAuthorizationChange(input: PreviewAuthorizationChangeInput): Promise<AuthorizationDecision> {
    if (!isSupabaseConfigured) return EMPTY_DECISION;
    const { data, error } = await supabase.rpc(
      'preview_authorization_change',
      buildPreviewAuthorizationChangeRpcArgs(input),
    );
    throwIfError(error);
    return mapDecision(data);
  },

  async previewBusinessRoleAssignment(input: PreviewBusinessRoleAssignmentInput): Promise<AuthorizationDecision> {
    if (!isSupabaseConfigured) return EMPTY_DECISION;
    const { data, error } = await supabase.rpc(
      'preview_business_role_assignment',
      buildPreviewBusinessRoleAssignmentRpcArgs(input),
    );
    throwIfError(error);
    return mapDecision(data);
  },

  async previewDirectGrantReplacement(
    targetUserId: string,
    grants: readonly UserPermissionGrant[],
  ): Promise<AuthorizationDecision> {
    if (!isSupabaseConfigured || !targetUserId) return EMPTY_DECISION;
    const { data, error } = await supabase.rpc('preview_direct_grant_replacement', {
      p_user_id: targetUserId,
      p_grants: buildDirectGrantReplacementPayload(grants),
    });
    throwIfError(error);
    return mapDecision(data);
  },

  async previewBusinessRoleChange(
    roleTemplateId: string | null,
    items: BusinessRoleItem[],
  ): Promise<BusinessRoleImpactPreview> {
    if (!isSupabaseConfigured) {
      return { affectedPrincipalCount: 0, affectedScopeCount: 0, addedPermissionKeys: [], removedPermissionKeys: [] };
    }
    const { data, error } = await supabase.rpc('preview_business_role_change', {
      p_role_template_id: roleTemplateId,
      p_items: items,
    });
    throwIfError(error);
    return data as unknown as BusinessRoleImpactPreview;
  },

  async saveBusinessRole(input: SaveBusinessRoleInput): Promise<string> {
    if (!isSupabaseConfigured) return '';
    const { data, error } = await supabase.rpc('save_business_role', {
      p_role_template_id: input.roleTemplateId || null,
      p_code: input.code.trim(),
      p_name: input.name.trim(),
      p_description: input.description?.trim() || null,
      p_items: input.items,
      p_reason: input.reason.trim(),
    });
    throwIfError(error);
    return String(data);
  },

  async assignBusinessRole(input: AssignBusinessRoleInput): Promise<string> {
    if (!isSupabaseConfigured) return '';
    const { data, error } = await supabase.rpc('assign_business_role', buildAssignBusinessRoleRpcArgs(input));
    throwIfError(error);
    return String(data);
  },

  async revokeBusinessRoleAssignment(assignmentId: string, reason: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.rpc('revoke_business_role_assignment', {
      p_assignment_id: assignmentId,
      p_reason: reason.trim(),
    });
    throwIfError(error);
  },

  async recordAuthorizationOverride(input: AuthorizationOverrideInput): Promise<string> {
    if (!isSupabaseConfigured) return '';
    const { data, error } = await supabase.rpc('record_authorization_override', buildOverrideRpcArgs(input));
    throwIfError(error);
    return String(data);
  },
};
