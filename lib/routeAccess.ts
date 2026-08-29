import { matchPath } from 'react-router-dom';
import { ROUTE_TO_MODULE } from '../constants/routes';
import { User } from '../types';
import { canPerform, canViewRoute } from './permissions/permissionService';
import { PermissionScope } from './permissions/permissionTypes';

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

interface RoutePermissionRequirement {
  permissionCode: string;
  scope: Required<PermissionScope>;
}

const GLOBAL_SCOPE: Required<PermissionScope> = {
  scopeType: 'global',
  scopeId: '*',
};

const OWN_SCOPE: Required<PermissionScope> = {
  scopeType: 'own',
  scopeId: '*',
};

export const HRM_ROUTE_PERMISSION_REQUIREMENTS: Readonly<Record<string, RoutePermissionRequirement>> = {
  '/hrm/dashboard': {
    permissionCode: 'hrm.employee.view_sensitive',
    scope: GLOBAL_SCOPE,
  },
  '/hrm/employees': {
    permissionCode: 'hrm.employee.view_directory',
    scope: GLOBAL_SCOPE,
  },
  '/hrm/checkin': {
    permissionCode: 'hrm.attendance.view',
    scope: OWN_SCOPE,
  },
  '/hrm/attendance': {
    permissionCode: 'hrm.attendance.view',
    scope: OWN_SCOPE,
  },
  '/hrm/leave': {
    permissionCode: 'hrm.leave.view',
    scope: OWN_SCOPE,
  },
};

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
  user: Pick<User, 'role' | 'allowedModules' | 'allowedSubModules' | 'adminModules' | 'adminSubModules' | 'permissionGrants'> | null | undefined,
  route?: string,
): boolean => {
  if (!route) return true;
  if (!user) return false;

  const pathname = normalizeRoutePath(route);
  if (isAuthenticatedOpenRoute(pathname)) return true;

  const moduleKey = getRouteModuleKey(pathname);
  if (!moduleKey) return false;

  const requirement = HRM_ROUTE_PERMISSION_REQUIREMENTS[pathname];
  if (requirement) {
    return canPerform(user, requirement.permissionCode, requirement.scope);
  }

  return canViewRoute(user, pathname);
};
