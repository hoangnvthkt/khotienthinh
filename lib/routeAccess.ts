import { matchPath } from 'react-router-dom';
import { ROUTE_TO_MODULE } from '../constants/routes';
import { User } from '../types';
import {
  canPerform,
  canPerformHrmTemplatePermission,
  canViewModule,
  canViewRoute,
} from './permissions/permissionService';
import { getPermissionModulesByLegacyKey } from './permissions/permissionRegistry';
import { PermissionScope } from './permissions/permissionTypes';
import { isViooWorkEnabled } from './featureFlags';
import { canConfigureWork } from './work/workConfigurationAccess';

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

const ASSIGNED_SCOPE: Required<PermissionScope> = {
  scopeType: 'assigned',
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
  '/hrm/shifts': {
    permissionCode: 'hrm.master_data.view',
    scope: GLOBAL_SCOPE,
  },
  '/hrm/contracts': {
    permissionCode: 'hrm.contract.view',
    scope: GLOBAL_SCOPE,
    templateOnly: true,
  },
  '/hrm/documents': {
    permissionCode: 'hrm.document.view',
    scope: GLOBAL_SCOPE,
    templateOnly: true,
  },
  '/hrm/reports': {
    permissionCode: 'hrm.employee.view_sensitive',
    scope: GLOBAL_SCOPE,
    templateOnly: true,
  },
  '/hrm/ranking': {
    permissionCode: 'hrm.employee.view_sensitive',
    scope: GLOBAL_SCOPE,
    templateOnly: true,
  },
};

const isWorkRoute = (pathname: string): boolean =>
  pathname === '/work' || pathname.startsWith('/work/');

const isRequestTemplateEditorRoute = (pathname: string): boolean =>
  pathname === '/rq/templates/new'
  || (pathname.startsWith('/rq/templates/') && pathname !== '/rq/templates/');

const isWorkflowInstanceRoute = (pathname: string): boolean =>
  pathname === '/wf'
  || pathname === '/wf/dashboard'
  || (!!matchPath({ path: '/wf/:instanceId', end: true }, pathname)
    && pathname !== '/wf/templates'
    && pathname !== '/wf/dashboard'
    && !pathname.startsWith('/wf/builder/'))
  || !!matchPath({ path: '/wf/instances/:id', end: true }, pathname);

const canViewWorkflowInstances = (user: Parameters<typeof canPerform>[0]): boolean =>
  [OWN_SCOPE, ASSIGNED_SCOPE, GLOBAL_SCOPE].some(scope =>
    canPerform(user, 'workflow.instance.view', scope)
  );

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
  if (isRequestTemplateEditorRoute(pathname)) {
    return canPerform(user, 'request.template.manage', GLOBAL_SCOPE);
  }
  if (isWorkflowInstanceRoute(pathname)) {
    return canViewWorkflowInstances(user);
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

const getConcreteModuleNavigationRoutes = (
  moduleKey: string,
  preferredRoute?: string,
): string[] => [...new Set([
  preferredRoute,
  ...getPermissionModulesByLegacyKey(moduleKey).flatMap(module => module.routes || []),
].filter((route): route is string => Boolean(route) && !route.includes(':')))];

/** Resolve the first concrete route that the user can actually open. */
export const getAuthorizedModuleRoute = (
  user: Parameters<typeof canAccessRoute>[0],
  moduleKey: string,
  preferredRoute?: string,
  options?: { requirePreferredRoute?: boolean },
): string | null => options?.requirePreferredRoute
  ? preferredRoute && canAccessRoute(user, preferredRoute) ? preferredRoute : null
  : getConcreteModuleNavigationRoutes(moduleKey, preferredRoute)
    .find(route => canAccessRoute(user, route)) || null;

/** Navigation surfaces must have at least one route the user can open. */
export const canAccessNavigationModule = (
  user: Parameters<typeof canAccessRoute>[0],
  moduleKey: string,
  preferredRoute?: string,
  options?: { requirePreferredRoute?: boolean },
): boolean => canViewModule(user, moduleKey)
  && Boolean(getAuthorizedModuleRoute(user, moduleKey, preferredRoute, options));

/** Choose a permitted landing after a denied route; never consult retained legacy fields. */
export const getAuthorizedRouteFallback = (
  user: Parameters<typeof canAccessRoute>[0],
  deniedRoute: string,
): '/' | '/da' => normalizeRoutePath(deniedRoute) !== '/da'
  && getRouteModuleKey(deniedRoute) === 'DA'
  && canAccessRoute(user, '/da') ? '/da' : '/';
