import { matchPath } from 'react-router-dom';
import { ROUTE_TO_MODULE } from '../constants/routes';
import { User } from '../types';
import {
  canPerform,
  canPerformHrmTemplatePermission,
  canViewRoute,
} from './permissions/permissionService';
import { PermissionScope } from './permissions/permissionTypes';
import { isViooWorkEnabled } from './featureFlags';

const AUTHENTICATED_OPEN_ROUTE_PATTERNS = [
  '/',
  '/notifications',
  '/my-profile',
  '/my-payroll',
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
  templateOnly?: boolean;
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
  '/hrm/payroll': {
    permissionCode: 'hrm.payroll.view',
    scope: GLOBAL_SCOPE,
    templateOnly: true,
  },
};

const isWorkRoute = (pathname: string): boolean =>
  pathname === '/work' || pathname.startsWith('/work/');

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
  user: Pick<User, 'role' | 'permissionGrants' | 'effectivePermissionSources' | 'authorizationSnapshot'> | null | undefined,
  route?: string,
): boolean => {
  if (!route) return true;
  if (!user) return false;

  const pathname = normalizeRoutePath(route);
  if (isAuthenticatedOpenRoute(pathname)) return true;
  if (isWorkRoute(pathname)) {
    return isViooWorkEnabled
      && getRouteModuleKey(pathname) === 'work.module'
      && canPerform(user, 'work.module.access', GLOBAL_SCOPE)
      && (pathname !== '/work/settings' || canConfigureWork(user));
  }

  const moduleKey = getRouteModuleKey(pathname);
  if (!moduleKey) return false;

  const requirement = HRM_ROUTE_PERMISSION_REQUIREMENTS[pathname];
  if (requirement) {
    return requirement.templateOnly
      ? canPerformHrmTemplatePermission(user, requirement.permissionCode, requirement.scope)
      : canPerform(user, requirement.permissionCode, requirement.scope);
  }

  return canViewRoute(user, pathname);
};
import { canConfigureWork } from './work/workConfigurationAccess';
