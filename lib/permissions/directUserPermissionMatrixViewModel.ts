import type { UserPermissionGrant } from '../../types';
import type { PermissionScopeType } from './permissionTypes';

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

const draftKey = (
  grant: Pick<UserPermissionGrant, 'userId' | 'permissionCode' | 'scopeType' | 'scopeId' | 'expiresAt'>,
): string => [
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
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      expiresAt: grant.expiresAt,
    };
    byKey.set(draftKey(normalized), normalized);
  }

  return [...byKey.values()].sort((left, right) =>
    `${left.permissionCode}:${left.scopeType}:${left.scopeId}:${left.expiresAt || ''}`
      .localeCompare(`${right.permissionCode}:${right.scopeType}:${right.scopeId}:${right.expiresAt || ''}`));
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
