import { canPerform, canViewRoute } from './permissionService';

const GLOBAL_SCOPE = { scopeType: 'global' as const, scopeId: '*' };

type PermissionUser = Parameters<typeof canPerform>[0];

const can = (user: PermissionUser, permissionCode: string): boolean =>
  canPerform(user, permissionCode, GLOBAL_SCOPE);

export const getAiAssistantCapabilities = (user: PermissionUser) => {
  const canUse = can(user, 'ai.assistant.use');
  return {
    canView: canViewRoute(user, '/ai', GLOBAL_SCOPE) || canUse,
    canUse,
  };
};

export const getAiExecutiveCapabilities = (user: PermissionUser) => {
  const canView = can(user, 'ai.executive.view');
  return {
    canView: canViewRoute(user, '/ai/executive', GLOBAL_SCOPE) || canView,
  };
};

export const getAiReportCapabilities = (user: PermissionUser) => {
  const canGenerate = can(user, 'ai.report.generate');
  return {
    canView: canViewRoute(user, '/ai/reports', GLOBAL_SCOPE) || canGenerate,
    canGenerate,
  };
};

export const getStorageCapabilities = (user: PermissionUser) => {
  const canManage = can(user, 'storage.manage');
  return {
    canView: canViewRoute(user, '/storage', GLOBAL_SCOPE) || canManage,
    canManage,
  };
};

export const getKnowledgeBaseCapabilities = (user: PermissionUser) => {
  const canManage = can(user, 'kb.manage');
  return {
    canView: canViewRoute(user, '/knowledge-base', GLOBAL_SCOPE) || canManage,
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
