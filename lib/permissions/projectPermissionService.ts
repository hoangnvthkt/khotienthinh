import { matchPath } from 'react-router-dom';
import { Role, User, UserPermissionGrant } from '../../types';
import {
  LEGACY_PROJECT_SUPPLY_ROUTE,
  PROJECT_FINANCE_LEGACY_TAB_KEYS,
  PROJECT_MATERIAL_TAB_ROUTE_BY_KEY,
  PROJECT_TAB_ROUTE_BY_KEY,
  hasProjectMaterialTabPermissionRoute,
  hasProjectTabPermissionRoute,
  isProjectFinanceLegacyTabKey,
  type ProjectMaterialTabKey,
  type ProjectOverviewTabKey,
} from '../projectTabPermissions';
import { getPermissionModuleByCode, getPermissionModules } from './permissionRegistry';
import {
  PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY,
  PROJECT_TAB_MODULE_CODE_BY_KEY,
  type ProjectPermissionModuleCode,
} from './projectPermissionRegistry';
import { PermissionScopeType } from './permissionTypes';

export type ProjectPermissionScope = {
  scopeType: Extract<PermissionScopeType, 'project' | 'construction_site'>;
  scopeId: string;
  projectId?: string;
  constructionSiteId?: string;
};

type ProjectPermissionUser = Pick<
  User,
  'role' | 'allowedModules' | 'adminModules' | 'allowedSubModules' | 'adminSubModules' | 'permissionGrants'
> | null | undefined;

type LegacyProjectPermissionCode =
  | 'view'
  | 'edit'
  | 'delete'
  | 'submit'
  | 'verify'
  | 'confirm'
  | 'approve'
  | 'view_available_stock';

const routeMatches = (pattern: string, route: string): boolean =>
  pattern === route || (pattern.includes(':') && !!matchPath({ path: pattern, end: true }, route));

const isGrantActive = (grant: UserPermissionGrant, now = new Date()): boolean => {
  if (grant.isActive === false) return false;
  if (!grant.expiresAt) return true;
  return new Date(grant.expiresAt).getTime() > now.getTime();
};

export const getProjectScope = (projectId?: string, constructionSiteId?: string | null): ProjectPermissionScope => {
  if (constructionSiteId) {
    return {
      scopeType: 'construction_site',
      scopeId: constructionSiteId,
      projectId,
      constructionSiteId,
    };
  }
  return {
    scopeType: 'project',
    scopeId: projectId || '*',
    projectId,
    constructionSiteId: undefined,
  };
};

const projectScopeMatches = (grant: UserPermissionGrant, scope: ProjectPermissionScope): boolean => {
  if (grant.scopeType === 'global') return true;
  if (grant.scopeId === '*') return grant.scopeType === scope.scopeType || grant.scopeType === 'project';
  if (grant.scopeType === scope.scopeType && grant.scopeId === scope.scopeId) return true;
  return Boolean(
    scope.constructionSiteId &&
    scope.projectId &&
    grant.scopeType === 'project' &&
    grant.scopeId === scope.projectId
  );
};

const hasExplicitProjectGrant = (
  user: ProjectPermissionUser,
  permissionCode: string,
  scope: ProjectPermissionScope,
): boolean =>
  Boolean(user?.permissionGrants?.some(grant =>
    grant.permissionCode === permissionCode &&
    isGrantActive(grant) &&
    projectScopeMatches(grant, scope)
  ));

export const canPerformProjectAction = (
  user: ProjectPermissionUser,
  permissionCode: string,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;
  if (!permissionCode.startsWith('project.')) return false;
  return hasExplicitProjectGrant(user, permissionCode, getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId));
};

export const checkProjectAction = canPerformProjectAction;

export const requireProjectAction = (
  user: ProjectPermissionUser,
  permissionCode: string,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
  actionLabel = 'thực hiện thao tác này',
): void => {
  if (checkProjectAction(user, permissionCode, scopeInput)) return;
  throw new Error(`Bạn cần quyền "${permissionCode}" để ${actionLabel}.`);
};

const canOpenLegacyProjectRoute = (
  user: ProjectPermissionUser,
  route: string,
): boolean => {
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;
  if (user.allowedModules !== undefined && !user.allowedModules.includes('DA') && !(user.adminModules || []).includes('DA')) {
    return false;
  }

  const allowedRoutes = user.allowedSubModules?.DA || [];
  const adminRoutes = user.adminSubModules?.DA || [];
  const hasDaSubModuleRestriction = Object.prototype.hasOwnProperty.call(user.allowedSubModules || {}, 'DA');
  const hasDaModuleAdmin = (user.adminModules || []).includes('DA');

  if (hasDaModuleAdmin) return true;
  if (!hasDaSubModuleRestriction) return true;
  if (allowedRoutes.length === 0 && adminRoutes.length === 0) return false;
  if (!hasProjectTabPermissionRoute(allowedRoutes) && allowedRoutes.includes('/da')) return true;
  if ([...allowedRoutes, ...adminRoutes].some(allowedRoute => routeMatches(allowedRoute, route))) return true;
  if (route === PROJECT_TAB_ROUTE_BY_KEY.material && allowedRoutes.includes(LEGACY_PROJECT_SUPPLY_ROUTE)) return true;
  if (
    route === PROJECT_TAB_ROUTE_BY_KEY.material &&
    (hasProjectMaterialTabPermissionRoute(allowedRoutes) || hasProjectMaterialTabPermissionRoute(adminRoutes))
  ) {
    return true;
  }
  return false;
};

const canManageLegacyProjectRoute = (
  user: ProjectPermissionUser,
  route: string,
): boolean => {
  if (!user) return false;
  if (user.role === Role.ADMIN) return true;
  if ((user.adminModules || []).includes('DA')) return true;
  const adminRoutes = user.adminSubModules?.DA || [];
  if (route === PROJECT_TAB_ROUTE_BY_KEY.material && adminRoutes.includes(LEGACY_PROJECT_SUPPLY_ROUTE)) return true;
  return adminRoutes.some(adminRoute => routeMatches(adminRoute, route));
};

const getProjectViewPermissionCode = (moduleCode: ProjectPermissionModuleCode): string | undefined =>
  getPermissionModuleByCode(moduleCode)?.actions.find(action => action.action === 'view')?.permissionCode;

const getProjectManagePermissionCodes = (moduleCode: ProjectPermissionModuleCode): readonly string[] =>
  getPermissionModuleByCode(moduleCode)?.actions
    .filter(action => action.action === 'manage' || action.permissionCode === 'project.org.grant_permissions')
    .map(action => action.permissionCode) || [];

export const getProjectViewPermissionCodeForTab = (tabKey: ProjectOverviewTabKey): string | undefined =>
  getProjectViewPermissionCode(PROJECT_TAB_MODULE_CODE_BY_KEY[tabKey]);

export const getProjectViewPermissionCodeForMaterialTab = (tabKey: ProjectMaterialTabKey): string | undefined =>
  getProjectViewPermissionCode(PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY[tabKey]);

export const canViewProjectTab = (
  user: ProjectPermissionUser,
  tabKey: ProjectOverviewTabKey,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  const moduleCode = PROJECT_TAB_MODULE_CODE_BY_KEY[tabKey];
  const viewPermissionCode = getProjectViewPermissionCode(moduleCode);
  const scope = getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId);
  if (viewPermissionCode && hasExplicitProjectGrant(user, viewPermissionCode, scope)) return true;

  if (tabKey === 'finance') {
    return [tabKey, ...PROJECT_FINANCE_LEGACY_TAB_KEYS].some(key =>
      canOpenLegacyProjectRoute(user, PROJECT_TAB_ROUTE_BY_KEY[key])
    );
  }
  if (isProjectFinanceLegacyTabKey(tabKey) && canOpenLegacyProjectRoute(user, PROJECT_TAB_ROUTE_BY_KEY.finance)) {
    return true;
  }
  return canOpenLegacyProjectRoute(user, PROJECT_TAB_ROUTE_BY_KEY[tabKey]);
};

export const canViewProjectMaterialTab = (
  user: ProjectPermissionUser,
  tabKey: ProjectMaterialTabKey,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  const moduleCode = PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY[tabKey];
  const viewPermissionCode = getProjectViewPermissionCode(moduleCode);
  const scope = getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId);
  if (viewPermissionCode && hasExplicitProjectGrant(user, viewPermissionCode, scope)) return true;
  return canOpenLegacyProjectRoute(user, PROJECT_MATERIAL_TAB_ROUTE_BY_KEY[tabKey]) ||
    canOpenLegacyProjectRoute(user, PROJECT_TAB_ROUTE_BY_KEY.material);
};

export const canManageProjectTab = (
  user: ProjectPermissionUser,
  tabKey: ProjectOverviewTabKey,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  const moduleCode = PROJECT_TAB_MODULE_CODE_BY_KEY[tabKey];
  const scope = getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId);
  if (getProjectManagePermissionCodes(moduleCode).some(code => hasExplicitProjectGrant(user, code, scope))) return true;

  if (tabKey === 'finance') {
    return [tabKey, ...PROJECT_FINANCE_LEGACY_TAB_KEYS].some(key =>
      canManageLegacyProjectRoute(user, PROJECT_TAB_ROUTE_BY_KEY[key])
    );
  }
  if (isProjectFinanceLegacyTabKey(tabKey) && canManageLegacyProjectRoute(user, PROJECT_TAB_ROUTE_BY_KEY.finance)) {
    return true;
  }
  return canManageLegacyProjectRoute(user, PROJECT_TAB_ROUTE_BY_KEY[tabKey]);
};

export const canManageProjectMaterialTab = (
  user: ProjectPermissionUser,
  tabKey: ProjectMaterialTabKey,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  const moduleCode = PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY[tabKey];
  const scope = getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId);
  if (getProjectManagePermissionCodes(moduleCode).some(code => hasExplicitProjectGrant(user, code, scope))) return true;
  return canManageLegacyProjectRoute(user, PROJECT_MATERIAL_TAB_ROUTE_BY_KEY[tabKey]) ||
    canManageLegacyProjectRoute(user, PROJECT_TAB_ROUTE_BY_KEY.material);
};

const projectActionCodesByAction = (actions: readonly string[]): readonly string[] =>
  getPermissionModules()
    .filter(module => module.code.startsWith('project.'))
    .flatMap(module => module.actions)
    .filter(action => actions.includes(action.action))
    .map(action => action.permissionCode);

export const legacyProjectCodeToPermissionCodes = (code: LegacyProjectPermissionCode): readonly string[] => {
  switch (code) {
    case 'view':
      return projectActionCodesByAction(['view']);
    case 'edit':
      return projectActionCodesByAction(['create', 'edit', 'edit_own', 'edit_all']);
    case 'delete':
      return projectActionCodesByAction(['delete', 'delete_own', 'delete_all']);
    case 'submit':
      return projectActionCodesByAction(['submit']);
    case 'verify':
      return projectActionCodesByAction(['verify', 'return']);
    case 'confirm':
      return projectActionCodesByAction(['confirm']);
    case 'approve':
      return projectActionCodesByAction(['approve']);
    case 'view_available_stock':
      return ['project.material_request.view_available_stock'];
    default:
      return [];
  }
};
