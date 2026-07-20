import { matchPath } from 'react-router-dom';
import { Role, User, UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from './authorizationGovernanceTypes';
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

const isViewAction = (action: PermissionActionDefinition): boolean => action.action === 'view';

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

const effectiveSourceIsCurrent = (
  source: EffectivePermissionSource,
  now = new Date(),
): boolean => {
  const startsAt = source.startsAt !== undefined && source.startsAt !== null
    ? new Date(source.startsAt).getTime()
    : null;
  const expiresAt = source.expiresAt !== undefined && source.expiresAt !== null
    ? new Date(source.expiresAt).getTime()
    : null;
  if (startsAt !== null && (!Number.isFinite(startsAt) || startsAt > now.getTime())) return false;
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())) return false;
  return true;
};

const effectiveSourceMatches = (
  source: EffectivePermissionSource,
  permissionCode: string,
  scope?: PermissionScope,
  now = new Date(),
): boolean => {
  if (source.permissionCode !== permissionCode || !effectiveSourceIsCurrent(source, now)) return false;
  return scopeMatches({
    userId: '',
    permissionCode: source.permissionCode,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    isActive: true,
  }, scope);
};

export const userHasEffectivePermission = (
  user: Pick<User, 'effectivePermissions'> | null | undefined,
  permissionCode: string,
  scope?: PermissionScope,
): boolean => Boolean(user?.effectivePermissions?.some(source =>
  effectiveSourceMatches(source, permissionCode, scope)
));

const userHasEffectivePermissionForNavigation = (
  user: Pick<User, 'effectivePermissions'>,
  permissionCode: string,
  scope?: PermissionScope,
): boolean => Boolean(user.effectivePermissions?.some(source => {
  if (!effectiveSourceIsCurrent(source) || source.permissionCode !== permissionCode) return false;
  return scope ? effectiveSourceMatches(source, permissionCode, scope) : true;
}));

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
    routeMatches('/wf/instances/:id', route) &&
    (allowedSubs.includes('/wf') || adminSubs.includes('/wf'))
  ) return true;
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

const hasAnyActiveProjectGrant = (
  user: Pick<User, 'permissionGrants' | 'effectivePermissions'> | null | undefined,
): boolean => {
  if (user?.effectivePermissions !== undefined) {
    return user.effectivePermissions.some(source =>
      source.permissionCode.startsWith('project.') && effectiveSourceIsCurrent(source)
    );
  }
  return Boolean(user?.permissionGrants?.some(grant =>
    grant.permissionCode.startsWith('project.') && isGrantActive(grant)
  ));
};

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
  user: Pick<User, 'role' | 'allowedModules' | 'adminModules' | 'allowedSubModules' | 'adminSubModules' | 'permissionGrants' | 'effectivePermissions'> | null | undefined,
  permissionCode: string,
  scope?: PermissionScope,
): boolean => {
  if (!user) return false;
  if (user.effectivePermissions !== undefined) {
    return userHasEffectivePermission(user, permissionCode, scope);
  }
  if (userHasPermissionGrant(user, permissionCode, scope)) return true;

  const action = getPermissionActionByCode(permissionCode);
  if (!action) return false;
  if (user.role === Role.ADMIN) return action.isBusinessApproval !== true;
  return hasLegacyPermission(user, action);
};

const moduleMatchesIdentifier = (moduleCode: string, legacyModuleKey: string | undefined, identifier: string): boolean =>
  moduleCode === identifier || legacyModuleKey === identifier;

const canViewModuleFromEffectiveSources = (
  user: Pick<User, 'effectivePermissions'>,
  moduleCodeOrLegacyKey: string,
  scope?: PermissionScope,
): boolean => getPermissionModules()
  .filter(module => moduleMatchesIdentifier(module.code, module.legacyModuleKey, moduleCodeOrLegacyKey))
  .some(module => module.actions.some(action =>
    isViewAction(action) && userHasEffectivePermissionForNavigation(user, action.permissionCode, scope)
  ));

export const canViewModule = (
  user: Parameters<typeof canPerform>[0],
  moduleCodeOrLegacyKey: string,
  scope?: PermissionScope,
): boolean => {
  if (!user) return false;
  if (user.effectivePermissions !== undefined) {
    return canViewModuleFromEffectiveSources(user, moduleCodeOrLegacyKey, scope);
  }
  if (moduleCodeOrLegacyKey === 'DA' && hasAnyActiveProjectGrant(user)) return true;
  const viewAction = getPrimaryViewPermissionForModule(moduleCodeOrLegacyKey);
  if (viewAction) return canPerform(user, viewAction.permissionCode, scope);
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
  if (user.effectivePermissions !== undefined) {
    return getPermissionModules().some(module => module.actions.some(action => {
      if (!isViewAction(action)) return false;
      if (!userHasEffectivePermissionForNavigation(user, action.permissionCode, scope)) return false;
      const moduleRoutes = module.routes || [];
      const moduleRouteMatches = moduleRoutes.some(moduleRoute => routeMatches(moduleRoute, route));
      const actionRoute = action.legacyRoute;
      if (actionRoute && routeMatches(actionRoute, route)) return true;
      if (actionRoute && (actionRoute === route || actionRoute.startsWith(`${route}/`))) return true;
      if (!moduleRouteMatches) return false;
      if (isViewAction(action)) return true;
      if (!actionRoute || moduleRoutes.length === 1) return true;
      return route.startsWith(`${actionRoute}/`);
    }));
  }
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
  if (user.effectivePermissions !== undefined) {
    return getPermissionModules().some(module => {
      const moduleRouteMatches = (module.routes || []).some(moduleRoute => routeMatches(moduleRoute, route));
      return moduleRouteMatches && module.actions.some(action =>
        action.action === 'manage' &&
        userHasEffectivePermissionForNavigation(user, action.permissionCode, scope)
      );
    });
  }
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
