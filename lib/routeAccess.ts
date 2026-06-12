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
  user: Pick<User, 'role' | 'allowedModules' | 'allowedSubModules'> | null | undefined,
  route?: string,
): boolean => {
  if (!route) return true;
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;

  const pathname = normalizeRoutePath(route);
  const moduleKey = getRouteModuleKey(pathname);
  if (!moduleKey) return true;

  if (user.allowedModules !== undefined && !user.allowedModules.includes(moduleKey)) {
    return false;
  }

  const hasSubModuleRestriction = Object.prototype.hasOwnProperty.call(user.allowedSubModules || {}, moduleKey);
  const allowedSubs = user.allowedSubModules?.[moduleKey] || [];
  if (!hasSubModuleRestriction) return true;
  if (allowedSubs.length === 0) return false;

  if (allowedSubs.includes(pathname)) return true;
  if (moduleKey === 'DA' && pathname === '/da' && hasProjectTabPermissionRoute(allowedSubs)) return true;

  return allowedSubs.some(allowedRoute =>
    allowedRoute.includes(':') && !!matchPath({ path: allowedRoute, end: true }, pathname)
  );
};
