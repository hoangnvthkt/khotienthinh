import type { UserPermissionGrant } from '../../types';
import { canAddDirectGrant } from './permissionReadiness';
import type {
  PermissionModuleDefinition,
  PermissionScope,
  PermissionScopeType,
} from './permissionTypes';
import { toggleUnifiedDirectGrant } from './unifiedPermissionViewModel';

export interface PermissionQuickTemplateDraft {
  id?: string;
  code: string;
  name: string;
  description?: string;
  permissionCodes: readonly string[];
  isActive?: boolean;
}

export interface DirectPermissionClipboardGrant {
  permissionCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  expiresAt?: string;
}

export interface DirectPermissionClipboard {
  copiedAt: string;
  grants: DirectPermissionClipboardGrant[];
}

export interface ApplyPermissionQuickTemplateInput {
  targetUserId: string;
  drafts: readonly UserPermissionGrant[];
  template: PermissionQuickTemplateDraft;
  modules: readonly PermissionModuleDefinition[];
  scope: PermissionScope;
}

const normalizeScope = (scope: PermissionScope): { scopeType: PermissionScopeType; scopeId: string } => ({
  scopeType: (scope.scopeType || 'global') as PermissionScopeType,
  scopeId: scope.scopeId || '*',
});

const draftKey = (grant: Pick<UserPermissionGrant, 'userId' | 'permissionCode' | 'scopeType' | 'scopeId' | 'expiresAt'>): string =>
  [
    grant.userId,
    grant.permissionCode,
    grant.scopeType || 'global',
    grant.scopeId || '*',
    grant.expiresAt || '',
  ].join('\u001f');

export const dedupeDirectGrantDrafts = (
  grants: readonly UserPermissionGrant[],
): UserPermissionGrant[] => {
  const byKey = new Map<string, UserPermissionGrant>();

  for (const grant of grants) {
    if (grant.isActive === false) continue;
    const normalized: UserPermissionGrant = {
      userId: grant.userId,
      permissionCode: grant.permissionCode,
      scopeType: (grant.scopeType || 'global') as PermissionScopeType,
      scopeId: grant.scopeId || '*',
      expiresAt: grant.expiresAt,
    };
    byKey.set(draftKey(normalized), normalized);
  }

  return [...byKey.values()].sort((left, right) =>
    `${left.permissionCode}:${left.scopeType}:${left.scopeId}:${left.expiresAt || ''}`
      .localeCompare(`${right.permissionCode}:${right.scopeType}:${right.scopeId}:${right.expiresAt || ''}`));
};

export const applyPermissionQuickTemplateToDraft = (
  input: ApplyPermissionQuickTemplateInput,
): UserPermissionGrant[] => {
  const scope = normalizeScope(input.scope);
  const moduleCodes = new Set(input.modules.flatMap(module => module.actions.map(action => action.permissionCode)));
  const grantableTemplateCodes = new Set(
    input.modules
      .flatMap(module => module.actions)
      .filter(action => input.template.permissionCodes.includes(action.permissionCode))
      .filter(canAddDirectGrant)
      .map(action => action.permissionCode),
  );
  let next = input.drafts.filter(grant => !(
    grant.userId === input.targetUserId
    && moduleCodes.has(grant.permissionCode)
    && (grant.scopeType || 'global') === scope.scopeType
    && (grant.scopeId || '*') === scope.scopeId
  ));

  for (const module of input.modules) {
    for (const action of module.actions) {
      if (!grantableTemplateCodes.has(action.permissionCode)) continue;
      next = toggleUnifiedDirectGrant({
        module,
        grants: next,
        targetUserId: input.targetUserId,
        permissionCode: action.permissionCode,
        checked: true,
        scope,
      });
    }
  }

  return dedupeDirectGrantDrafts(next);
};

export const copyDirectPermissionDraft = (
  grants: readonly UserPermissionGrant[],
): DirectPermissionClipboard => ({
  copiedAt: new Date().toISOString(),
  grants: dedupeDirectGrantDrafts(grants).map(grant => ({
    permissionCode: grant.permissionCode,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    expiresAt: grant.expiresAt,
  })),
});

export const pasteDirectPermissionClipboard = (
  targetUserId: string,
  clipboard: DirectPermissionClipboard,
): UserPermissionGrant[] => dedupeDirectGrantDrafts(
  clipboard.grants.map(grant => ({
    userId: targetUserId,
    permissionCode: grant.permissionCode,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    expiresAt: grant.expiresAt,
  })),
);
