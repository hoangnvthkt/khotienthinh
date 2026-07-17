import type { PermissionRiskLevel } from './permissionTypes';

const SENSITIVE_ACTIONS = new Set([
  'approve',
  'confirm',
  'verify',
  'mark_paid',
  'publish',
  'complete',
  'lock',
  'manage_roles',
  'manage_grants',
  'override',
]);

const IMPORTANT_ACTIONS = new Set([
  'manage',
  'manage_scopes',
  'audit',
  'edit_all',
  'delete_all',
  'export',
  'perform',
  'assign_staff',
  'grant_permissions',
]);

const BUSINESS_APPROVAL_ACTIONS = new Set([
  'approve',
  'confirm',
  'verify',
  'mark_paid',
  'publish',
  'complete',
  'lock',
]);

export const IDENTITY_BOUND_PERMISSION_CODES = new Set([
  'system.settings.manage',
]);

export const isIdentityBoundPermission = (permissionCode: string): boolean =>
  IDENTITY_BOUND_PERMISSION_CODES.has(permissionCode);

export interface PermissionRiskMetadata {
  riskLevel: PermissionRiskLevel;
  isBusinessAction: boolean;
  isBusinessApproval: boolean;
  directGrantRequiresExpiry: boolean;
}

export const classifyPermissionAction = (
  moduleCode: string,
  action: string,
): PermissionRiskMetadata => {
  const isBusinessAction = !moduleCode.startsWith('system.');
  const isBusinessApproval = isBusinessAction
    && BUSINESS_APPROVAL_ACTIONS.has(action);
  const riskLevel: PermissionRiskLevel = SENSITIVE_ACTIONS.has(action)
    ? 'sensitive'
    : IMPORTANT_ACTIONS.has(action)
      ? 'important'
      : 'normal';

  return {
    riskLevel,
    isBusinessAction,
    isBusinessApproval,
    directGrantRequiresExpiry: riskLevel === 'sensitive',
  };
};

export const resolvePermissionRiskMetadata = (
  moduleCode: string,
  action: string,
  riskMetadata?: PermissionRiskMetadata,
): PermissionRiskMetadata => riskMetadata || classifyPermissionAction(moduleCode, action);
