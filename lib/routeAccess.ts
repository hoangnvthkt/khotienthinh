import { matchPath } from 'react-router-dom';
import { ROUTE_TO_MODULE } from '../constants/routes';
import { hasProjectTabPermissionRoute } from './projectTabPermissions';
import { Role, User } from '../types';

export const normalizeRoutePath = (route: string): string => {
  const path = route.split('?')[0].split('#')[0].trim();
  return path || '/';
};

export const getRouteModuleKey = (route: string): string | undefined => {
  const pathname = normalizeRoutePath(route);
  return ROUTE_TO_MODULE[pathname] ||
    Object.entries(ROUTE_TO_MODULE).find(([routePattern]) =>
      routePattern.includes(':') && matchPath({ path: routePattern, end: true }, pathname)
    )?.[1];
};

export const canAccessRoute = (
  user: Pick<User, 'role' | 'allowedModules' | 'allowedSubModules' | 'adminModules' | 'adminSubModules'> | null | undefined,
  route?: string,
): boolean => {
  if (!route) return true;
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;

  const pathname = normalizeRoutePath(route);
  const moduleKey = getRouteModuleKey(pathname);
  if (!moduleKey) return true;

  const hasSubModuleGrant =
    (user.allowedSubModules?.[moduleKey] || []).length > 0 ||
    (user.adminSubModules?.[moduleKey] || []).length > 0 ||
    (user.adminModules || []).includes(moduleKey);
  if (user.allowedModules !== undefined && !user.allowedModules.includes(moduleKey) && !hasSubModuleGrant) {
    return false;
  }

  const hasSubModuleRestriction = Object.prototype.hasOwnProperty.call(user.allowedSubModules || {}, moduleKey);
  const allowedSubs = user.allowedSubModules?.[moduleKey] || [];
  const adminSubs = user.adminSubModules?.[moduleKey] || [];
  const isLegacyModuleAdmin = (user.adminModules || []).includes(moduleKey);
  if (!hasSubModuleRestriction) return true;
  if (allowedSubs.length === 0 && adminSubs.length === 0 && !isLegacyModuleAdmin) return false;

  if (allowedSubs.includes(pathname) || adminSubs.includes(pathname) || isLegacyModuleAdmin) return true;
  if (
    moduleKey === 'WF' &&
    pathname.startsWith('/wf/builder/') &&
    (allowedSubs.includes('/wf/templates') || adminSubs.includes('/wf/templates') || isLegacyModuleAdmin)
  ) return true;
  if (moduleKey === 'DA' && pathname === '/da' && hasProjectTabPermissionRoute(allowedSubs)) return true;

  return [...allowedSubs, ...adminSubs].some(allowedRoute =>
    allowedRoute.includes(':') && !!matchPath({ path: allowedRoute, end: true }, pathname)
  );
};
