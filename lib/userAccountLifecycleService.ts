import type {
  User,
  UserAccountLifecyclePreview,
  UserAccountLifecycleAction,
  UserAccountOperationResult,
} from '../types';
import { isSupabaseConfigured, supabase } from './supabase';
import { getLegacyModuleAssignmentCount } from './permissions/permissionService';
import { readFunctionInvokeErrorMessage } from './userAccountCreation';

export interface UserAccountLifecycleCommand {
  action: UserAccountLifecycleAction;
  targetUserId: string;
  reason: string;
  idempotencyKey: string;
  newPassword?: string;
}

export const buildUserAccountLifecyclePayload = (
  command: UserAccountLifecycleCommand,
) => ({
  action: command.action,
  targetUserId: command.targetUserId.trim(),
  reason: command.reason.trim(),
  idempotencyKey: command.idempotencyKey.trim(),
  ...(command.action === 'REACTIVATE'
    ? { newPassword: command.newPassword || '' }
    : {}),
});

const count = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const normalizeUserAccountLifecyclePreview = (
  value: Record<string, unknown>,
): UserAccountLifecyclePreview => ({
  targetUserId: String(value.targetUserId || ''),
  accountStatus: value.accountStatus === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
  operationStatus: value.operationStatus === 'AUTH_RETRY'
    ? 'AUTH_RETRY'
    : value.operationStatus === 'PENDING'
      ? 'PENDING'
      : 'IDLE',
  operationAction: value.operationAction === 'DISABLE' || value.operationAction === 'REACTIVATE'
    ? value.operationAction
    : undefined,
  hasAuthIdentity: value.hasAuthIdentity === true,
  directGrants: count(value.directGrants),
  businessRoleAssignments: count(value.businessRoleAssignments),
  legacyModules: count(value.legacyModules),
  projectStaffAssignments: count(value.projectStaffAssignments),
  responsibilitySlots: count(value.responsibilitySlots),
  runtimeAssignments: count(value.runtimeAssignments),
  needsReassignment: count(value.responsibilitySlots) + count(value.runtimeAssignments),
});

export const getUserAccountLifecyclePreview = async (
  target: User,
): Promise<UserAccountLifecyclePreview> => {
  if (!isSupabaseConfigured) {
    return normalizeUserAccountLifecyclePreview({
      targetUserId: target.id,
      accountStatus: target.accountStatus || 'ACTIVE',
      operationStatus: target.accountOperationStatus || 'IDLE',
      operationAction: target.accountOperationAction,
      hasAuthIdentity: true,
      directGrants: target.permissionGrants?.filter(grant => grant.isActive !== false).length || 0,
      businessRoleAssignments: 0,
      legacyModules: getLegacyModuleAssignmentCount(target),
      projectStaffAssignments: 0,
      responsibilitySlots: 0,
      runtimeAssignments: 0,
    });
  }

  const { data, error } = await supabase.rpc('get_user_account_lifecycle_preview', {
    p_target_user_id: target.id,
  });
  if (error) throw error;
  return normalizeUserAccountLifecyclePreview(data || {});
};

const lifecycleStatuses: UserAccountOperationResult['status'][] = [
  'PREPARED',
  'DB_APPLIED',
  'AUTH_RETRY',
  'COMPLETED',
];

export const normalizeUserAccountOperationResult = (
  value: Record<string, unknown>,
): UserAccountOperationResult => {
  const rawSummary = value.revocationSummary;
  const summary = rawSummary && typeof rawSummary === 'object'
    ? rawSummary as Record<string, unknown>
    : null;
  const action: UserAccountLifecycleAction = value.action === 'REACTIVATE'
    ? 'REACTIVATE'
    : 'DISABLE';
  const rawStatus = String(value.status || 'PREPARED');
  const status = lifecycleStatuses.includes(
    rawStatus as UserAccountOperationResult['status'],
  )
    ? rawStatus as UserAccountOperationResult['status']
    : 'PREPARED';

  return {
    operationId: String(value.operationId || ''),
    idempotencyKey: String(value.idempotencyKey || ''),
    targetUserId: String(value.targetUserId || ''),
    requestedBy: String(value.requestedBy || ''),
    action,
    status,
    reason: String(value.reason || ''),
    authId: value.authId == null ? null : String(value.authId),
    revocationSummary: summary ? {
      directGrants: count(summary.directGrants),
      businessRoleAssignments: count(summary.businessRoleAssignments),
      projectPermissions: count(summary.projectPermissions),
      projectStaffAssignments: count(summary.projectStaffAssignments),
      responsibilitySlots: count(summary.responsibilitySlots),
      runtimeAssignments: count(summary.runtimeAssignments),
      needsReassignment: count(summary.needsReassignment),
    } : null,
    lastError: value.lastError == null ? null : String(value.lastError),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    completedAt: value.completedAt == null ? null : String(value.completedAt),
  };
};

export const executeUserAccountLifecycle = async (
  command: UserAccountLifecycleCommand,
): Promise<UserAccountOperationResult> => {
  if (!isSupabaseConfigured) {
    return normalizeUserAccountOperationResult({
      operationId: command.idempotencyKey,
      idempotencyKey: command.idempotencyKey,
      targetUserId: command.targetUserId,
      requestedBy: 'mock-admin',
      action: command.action,
      status: 'COMPLETED',
      reason: command.reason.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
  }

  const { data, error } = await supabase.functions.invoke('manage-user-account', {
    body: buildUserAccountLifecyclePayload(command),
  });
  if (error) {
    const message = await readFunctionInvokeErrorMessage(error);
    throw new Error(message || error.message || 'Không thể cập nhật trạng thái tài khoản.');
  }
  if (!data?.operationId || data?.status !== 'COMPLETED') {
    throw new Error(data?.lastError || 'Thao tác tài khoản chưa hoàn tất.');
  }
  return normalizeUserAccountOperationResult(data as Record<string, unknown>);
};
