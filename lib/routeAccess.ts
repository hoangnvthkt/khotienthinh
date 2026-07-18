import { matchPath } from 'react-router-dom';
import { ROUTE_TO_MODULE } from '../constants/routes';
import { Role, User } from '../types';
import { canViewRoute } from './permissions/permissionService';

const AUTHENTICATED_OPEN_ROUTE_PATTERNS = [
  '/',
  '/notifications',
  '/my-profile',
  '/employee-dashboard',
  '/feedback',
  '/leaderboard',
  '/safety-card/:qrToken',
  '/settings',
  '/users',
];

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

export const isAuthenticatedOpenRoute = (route: string): boolean => {
  const pathname = normalizeRoutePath(route);
  return AUTHENTICATED_OPEN_ROUTE_PATTERNS.some(routePattern => {
    if (routePattern.includes(':')) {
      return !!matchPath({ path: routePattern, end: true }, pathname);
    }
    return routePattern === pathname;
  });
};

export const canAccessRoute = (
  user: Pick<User, 'role' | 'allowedModules' | 'allowedSubModules' | 'adminModules' | 'adminSubModules' | 'permissionGrants' | 'effectivePermissions'> | null | undefined,
  route?: string,
): boolean => {
  if (!route) return true;
  if (!user) return false;

  const pathname = normalizeRoutePath(route);
  if (isAuthenticatedOpenRoute(pathname)) return true;

  if (user.effectivePermissions !== undefined) {
    return canViewRoute(user, pathname);
  }
  if (user.role === Role.ADMIN) return true;

  const moduleKey = getRouteModuleKey(pathname);
  if (!moduleKey && !canViewRoute(user, pathname)) return false;

  return canViewRoute(user, pathname);
};
