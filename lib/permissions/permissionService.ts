import { matchPath } from 'react-router-dom';
import { Role, User, UserPermissionGrant } from '../../types';
import {
  getAllPermissionActions,
  getPermissionActionByCode,
  getPermissionModuleByCode,
  getPermissionModules,
  getPermissionModulesByLegacyKey,
  getPrimaryViewPermissionForModule,
} from './permissionRegistry';
import { PermissionActionDefinition, PermissionScope } from './permissionTypes';

const DEFAULT_SCOPE: Required<PermissionScope> = { scopeType: 'global', scopeId: '*' };

const routeMatches = (pattern: string, route: string): boolean =>
  pattern === route || (pattern.includes(':') && !!matchPath({ path: pattern, end: true }, route));

const isGrantActive = (grant: UserPermissionGrant, now = new Date()): boolean => {
  if (grant.isActive === false) return false;
  if (!grant.expiresAt) return true;
  return new Date(grant.expiresAt).getTime() > now.getTime();
};

const scopeMatches = (grant: UserPermissionGrant, scope?: PermissionScope): boolean => {
  const requested = {
    scopeType: scope?.scopeType || DEFAULT_SCOPE.scopeType,
    scopeId: scope?.scopeId || DEFAULT_SCOPE.scopeId,
  };
  if (grant.scopeType === 'global') return true;
  if (grant.scopeType !== requested.scopeType) return false;
  return grant.scopeId === '*' || grant.scopeId === requested.scopeId;
};

const hasLegacyModuleView = (user: Pick<User, 'allowedModules' | 'adminModules'>, legacyModuleKey: string): boolean => {
  if (user.allowedModules === undefined) return true;
  return (user.allowedModules || []).includes(legacyModuleKey) || (user.adminModules || []).includes(legacyModuleKey);
};

const hasLegacyModuleManage = (user: Pick<User, 'adminModules'>, legacyModuleKey: string): boolean =>
  (user.adminModules || []).includes(legacyModuleKey);

export const getLegacyModuleAssignmentCount = (
  user: Pick<User, 'allowedModules' | 'adminModules'>,
): number => (user.allowedModules?.length || 0) + (user.adminModules?.length || 0);

const hasLegacyRouteGrant = (
  routesByModule: Record<string, string[]> | undefined,
  legacyModuleKey: string,
  legacyRoute: string,
): boolean =>
  (routesByModule?.[legacyModuleKey] || []).some(route => routeMatches(route, legacyRoute) || routeMatches(legacyRoute, route));

const hasLegacySubModuleGrant = (
  user: Pick<User, 'allowedSubModules' | 'adminSubModules'>,
  action: PermissionActionDefinition,
): boolean => {
  if (!action.legacyModuleKey) return false;
  if (!action.legacyRoute) {
    return (user.allowedSubModules?.[action.legacyModuleKey] || []).length > 0 ||
      (user.adminSubModules?.[action.legacyModuleKey] || []).length > 0;
  }
  return hasLegacyRouteGrant(user.allowedSubModules, action.legacyModuleKey, action.legacyRoute) ||
    hasLegacyRouteGrant(user.adminSubModules, action.legacyModuleKey, action.legacyRoute);
};

const hasLegacySubModuleManageGrant = (
  user: Pick<User, 'adminSubModules'>,
  action: PermissionActionDefinition,
): boolean => {
  if (!action.legacyModuleKey) return false;
  if (!action.legacyRoute) return (user.adminSubModules?.[action.legacyModuleKey] || []).length > 0;
  return hasLegacyRouteGrant(user.adminSubModules, action.legacyModuleKey, action.legacyRoute);
};

const hasLegacyPermission = (
  user: Pick<User, 'allowedModules' | 'adminModules' | 'allowedSubModules' | 'adminSubModules'>,
  action: PermissionActionDefinition,
): boolean => {
  if (!action.legacyModuleKey) return false;
  if (action.legacyAdminOnly || action.action === 'manage') {
    return hasLegacyModuleManage(user, action.legacyModuleKey) || hasLegacySubModuleManageGrant(user, action);
  }
  return hasLegacyModuleView(user, action.legacyModuleKey) || hasLegacySubModuleGrant(user, action);
};

const canOpenLegacyRoute = (
  user: Pick<User, 'allowedModules' | 'adminModules' | 'allowedSubModules' | 'adminSubModules'>,
  legacyModuleKey: string,
  route: string,
): boolean => {
  const allowedSubs = user.allowedSubModules?.[legacyModuleKey] || [];
  const adminSubs = user.adminSubModules?.[legacyModuleKey] || [];
  const isLegacyModuleAdmin = hasLegacyModuleManage(user, legacyModuleKey);
  const hasSubModuleRestriction = Object.prototype.hasOwnProperty.call(user.allowedSubModules || {}, legacyModuleKey);
  const hasModuleView = hasLegacyModuleView(user, legacyModuleKey);
  const hasAnySubModuleGrant = allowedSubs.length > 0 || adminSubs.length > 0 || isLegacyModuleAdmin;

  if (!hasModuleView && !hasAnySubModuleGrant) return false;
  if (!hasSubModuleRestriction) return true;
  if (allowedSubs.length === 0 && adminSubs.length === 0 && !isLegacyModuleAdmin) return false;
  if (isLegacyModuleAdmin) return true;
  if ([...allowedSubs, ...adminSubs].some(allowedRoute => routeMatches(allowedRoute, route))) return true;
  if (
    legacyModuleKey === 'WF' &&
    route.startsWith('/wf/builder/') &&
    (allowedSubs.includes('/wf/templates') || adminSubs.includes('/wf/templates'))
  ) return true;
  if (legacyModuleKey === 'DA' && route === '/da' && allowedSubs.some(allowedRoute => allowedRoute.startsWith('/da/tabs/'))) {
    return true;
  }
  return false;
};

const canManageLegacyRoute = (
  user: Pick<User, 'adminModules' | 'adminSubModules'>,
  legacyModuleKey: string,
  route: string,
): boolean => {
  if (hasLegacyModuleManage(user, legacyModuleKey)) return true;
  const adminSubs = user.adminSubModules?.[legacyModuleKey] || [];
  if (adminSubs.some(adminRoute => routeMatches(adminRoute, route))) return true;
  return legacyModuleKey === 'WF' &&
    route.startsWith('/wf/builder/') &&
    adminSubs.includes('/wf/templates');
};

const hasAnyActiveProjectGrant = (user: Pick<User, 'permissionGrants'> | null | undefined): boolean =>
  Boolean(user?.permissionGrants?.some(grant =>
    grant.permissionCode.startsWith('project.') &&
    isGrantActive(grant)
  ));

export const userHasPermissionGrant = (
  user: Pick<User, 'permissionGrants'> | null | undefined,
  permissionCode: string,
  scope?: PermissionScope,
): boolean =>
  Boolean(user?.permissionGrants?.some(grant =>
    grant.permissionCode === permissionCode &&
    isGrantActive(grant) &&
    scopeMatches(grant, scope)
  ));

export const isPermissionActionScopeAllowed = (
  permissionCode: string,
  scope?: PermissionScope,
): boolean => {
  const action = getPermissionActionByCode(permissionCode);
  if (!action) return false;
  const allowedScopes = action.scopeTypes?.length ? action.scopeTypes : ['global'];
  const requestedScopeType = scope?.scopeType || DEFAULT_SCOPE.scopeType;
  return allowedScopes.includes(requestedScopeType);
};

export const canPerform = (
  user: Pick<User, 'role' | 'allowedModules' | 'adminModules' | 'allowedSubModules' | 'adminSubModules' | 'permissionGrants'> | null | undefined,
  permissionCode: string,
  scope?: PermissionScope,
): boolean => {
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;
  if (userHasPermissionGrant(user, permissionCode, scope)) return true;

  const action = getPermissionActionByCode(permissionCode);
  if (!action) return false;
  return hasLegacyPermission(user, action);
};

export const canViewModule = (
  user: Pick<User, 'role' | 'allowedModules' | 'adminModules' | 'allowedSubModules' | 'adminSubModules' | 'permissionGrants'> | null | undefined,
  moduleCodeOrLegacyKey: string,
  scope?: PermissionScope,
): boolean => {
  if (moduleCodeOrLegacyKey === 'DA' && hasAnyActiveProjectGrant(user)) return true;
  const viewAction = getPrimaryViewPermissionForModule(moduleCodeOrLegacyKey);
  if (viewAction) return canPerform(user, viewAction.permissionCode, scope);
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;
  return hasLegacyModuleView(user, moduleCodeOrLegacyKey);
};

export const canManageMaster = (
  user: Parameters<typeof canPerform>[0],
  permissionCode: string,
  scope?: PermissionScope,
): boolean => canPerform(user, permissionCode, scope);

export const canViewRoute = (
  user: Parameters<typeof canPerform>[0],
  route: string,
  scope?: PermissionScope,
): boolean => {
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;
  if (route === '/da' && hasAnyActiveProjectGrant(user)) return true;

  const routeModules = getPermissionModules().filter(module =>
    (module.routes || []).some(moduleRoute => routeMatches(moduleRoute, route))
  );
  if (routeModules.length === 0) return false;
  return routeModules.some(module => module.actions.some(action =>
    action.action === 'view' &&
    (
      userHasPermissionGrant(user, action.permissionCode, scope) ||
      (module.legacyModuleKey ? canOpenLegacyRoute(user, module.legacyModuleKey, route) : false)
    )
  ));
};

export const canManageRoute = (
  user: Parameters<typeof canPerform>[0],
  route: string,
  scope?: PermissionScope,
): boolean => {
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;

  const routeModules = getPermissionModules().filter(module =>
    (module.routes || []).some(moduleRoute => routeMatches(moduleRoute, route))
  );
  return routeModules.some(module => module.actions.some(action =>
    action.action === 'manage' &&
    (
      userHasPermissionGrant(user, action.permissionCode, scope) ||
      (module.legacyModuleKey ? canManageLegacyRoute(user, module.legacyModuleKey, route) : false)
    )
  ));
};

export const getManagePermissionCodeForRoute = (route: string): string | undefined => {
  const module = getPermissionModules().find(candidate =>
    (candidate.routes || []).some(moduleRoute => routeMatches(moduleRoute, route))
  );
  return module?.actions.find(action => action.action === 'manage')?.permissionCode;
};

export const getInheritedPermissionCodes = (
  user: Pick<User, 'role' | 'allowedModules' | 'adminModules' | 'allowedSubModules' | 'adminSubModules'> | null | undefined,
): readonly string[] => {
  if (!user) return [];
  if (user.role === Role.ADMIN) return getAllPermissionActions().map(action => action.permissionCode);

  return getAllPermissionActions()
    .filter(action => hasLegacyPermission(user, action))
    .map(action => action.permissionCode);
};

export const getModuleViewPermissionCodes = (moduleCodeOrLegacyKey: string): readonly string[] => {
  const modules = getPermissionModuleByCode(moduleCodeOrLegacyKey)
    ? [getPermissionModuleByCode(moduleCodeOrLegacyKey)!]
    : getPermissionModulesByLegacyKey(moduleCodeOrLegacyKey);
  return modules.flatMap(module => module.actions.filter(action => action.action === 'view').map(action => action.permissionCode));
};
