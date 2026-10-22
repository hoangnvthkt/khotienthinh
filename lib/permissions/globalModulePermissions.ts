import { canPerform, canViewRoute } from './permissionService';

const GLOBAL_SCOPE = { scopeType: 'global' as const, scopeId: '*' };

type PermissionUser = Parameters<typeof canPerform>[0];

const can = (user: PermissionUser, permissionCode: string): boolean =>
  canPerform(user, permissionCode, GLOBAL_SCOPE);

export const getStorageCapabilities = (user: PermissionUser) => {
  const canManage = can(user, 'storage.manage');
  return {
    canView: canViewRoute(user, '/storage', GLOBAL_SCOPE) || canManage,
    canManage,
  };
};

export const getAnalyticsCapabilities = (user: PermissionUser) => {
  const canExport = can(user, 'analytics.export');
  return {
    canView: canViewRoute(user, '/analytics', GLOBAL_SCOPE) || canExport,
    canExport,
  };
};
