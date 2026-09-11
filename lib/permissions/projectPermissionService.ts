import { matchPath } from 'react-router-dom';
import { User } from '../../types';
import {
  PROJECT_FINANCE_LEGACY_TAB_KEYS,
  PROJECT_MATERIAL_TAB_ROUTE_BY_KEY,
  PROJECT_TAB_ROUTE_BY_KEY,
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
import type { ProjectPermissionRoomCode } from './projectPermissionRooms';
import { PermissionScopeType } from './permissionTypes';
import { evaluateCapability, hasRoomAction } from './authorizationEvaluator';
import { getUserAuthorizationSnapshot } from './permissionService';

export type ProjectPermissionScope = {
  scopeType: Extract<PermissionScopeType, 'project' | 'construction_site'>;
  scopeId: string;
  projectId?: string;
  constructionSiteId?: string;
};

type ProjectPermissionUser = Pick<
  User,
  | 'role'
  | 'permissionGrants'
  | 'effectivePermissionSources'
  | 'authorizationSnapshot'
> | null | undefined;

export type LegacyProjectPermissionCode =
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

const hasProjectCapability = (
  user: ProjectPermissionUser,
  permissionCode: string,
  scope: ProjectPermissionScope,
): boolean => {
  const decision = evaluateCapability(
    getUserAuthorizationSnapshot(user),
    permissionCode,
    scope,
  );
  return decision.allowed;
};

const hasProjectNavigationCapability = (
  user: ProjectPermissionUser,
  permissionCode: string,
  scope: ProjectPermissionScope,
): boolean => evaluateCapability(
  getUserAuthorizationSnapshot(user),
  permissionCode,
  scope,
).allowed;

export const canPerformProjectAction = (
  user: ProjectPermissionUser,
  permissionCode: string,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  if (!user) return false;
  if (!permissionCode.startsWith('project.')) return false;
  return hasProjectCapability(user, permissionCode, getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId));
};

export const canPerformProjectRoomAction = (
  user: ProjectPermissionUser,
  roomCode: string,
  actionCode: string,
  scopeInput: { projectId: string; constructionSiteId?: string | null },
): boolean => hasRoomAction(
  getUserAuthorizationSnapshot(user),
  scopeInput.projectId,
  scopeInput.constructionSiteId,
  roomCode,
  actionCode,
);

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

const getProjectViewPermissionCode = (moduleCode: ProjectPermissionModuleCode): string | undefined =>
  getPermissionModuleByCode(moduleCode)?.actions.find(action => action.action === 'view')?.permissionCode;

const hasExplicitProjectViewGrantForRoute = (
  user: ProjectPermissionUser,
  route: string,
  scope: ProjectPermissionScope,
): boolean => getPermissionModules().some(module =>
  (module.routes || []).some(moduleRoute => routeMatches(moduleRoute, route)) &&
  module.actions.some(action =>
    action.action === 'view' && hasProjectNavigationCapability(user, action.permissionCode, scope)
  )
);

const hasProjectViewCapabilityForRoutes = (
  user: ProjectPermissionUser,
  routes: readonly string[],
  scope: ProjectPermissionScope,
): boolean => routes.some(route => hasExplicitProjectViewGrantForRoute(user, route, scope));

const hasProjectManageCapabilityForModules = (
  user: ProjectPermissionUser,
  moduleCodes: readonly ProjectPermissionModuleCode[],
  scope: ProjectPermissionScope,
): boolean => moduleCodes.some(moduleCode =>
  getProjectManagePermissionCodes(moduleCode).some(code => hasProjectNavigationCapability(user, code, scope))
);

const getProjectManagePermissionCodes = (moduleCode: ProjectPermissionModuleCode): readonly string[] =>
  getPermissionModuleByCode(moduleCode)?.actions
    .filter(action => action.action === 'manage' || action.permissionCode === 'project.org.grant_permissions')
    .map(action => action.permissionCode) || [];

const PROJECT_TAB_ROOM_CODES_BY_KEY: Partial<Record<ProjectOverviewTabKey, readonly ProjectPermissionRoomCode[]>> = {
  finance: ['quantity_acceptance', 'payment'],
  gantt: ['gantt'],
  weekly_progress: ['weekly_progress'],
  dailylog: ['daily_log'],
  material: ['material_planning', 'material_request', 'material_po'],
  quality: ['quality'],
  safety: ['safety'],
  payment: ['payment'],
};

const PROJECT_MATERIAL_TAB_ROOM_CODE_BY_KEY: Partial<Record<ProjectMaterialTabKey, ProjectPermissionRoomCode>> = {
  boq: 'material_planning',
  request: 'material_request',
  po: 'material_po',
};

const hasProjectRoomView = (
  user: ProjectPermissionUser,
  roomCodes: readonly ProjectPermissionRoomCode[] | undefined,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  if (!scopeInput.projectId || !roomCodes) return false;
  return roomCodes.some(roomCode => hasRoomAction(
    getUserAuthorizationSnapshot(user),
    scopeInput.projectId,
    scopeInput.constructionSiteId,
    roomCode,
    'view',
  ));
};

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
  if (viewPermissionCode && hasProjectNavigationCapability(user, viewPermissionCode, scope)) return true;
  if (hasExplicitProjectViewGrantForRoute(user, PROJECT_TAB_ROUTE_BY_KEY[tabKey], scope)) return true;
  if (hasProjectRoomView(user, PROJECT_TAB_ROOM_CODES_BY_KEY[tabKey], scopeInput)) return true;

  if (tabKey === 'finance') {
    return hasProjectViewCapabilityForRoutes(
      user,
      [tabKey, ...PROJECT_FINANCE_LEGACY_TAB_KEYS].map(key => PROJECT_TAB_ROUTE_BY_KEY[key]),
      scope,
    );
  }
  if (isProjectFinanceLegacyTabKey(tabKey) && hasExplicitProjectViewGrantForRoute(user, PROJECT_TAB_ROUTE_BY_KEY.finance, scope)) {
    return true;
  }
  return false;
};

export const canViewProjectMaterialTab = (
  user: ProjectPermissionUser,
  tabKey: ProjectMaterialTabKey,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  const moduleCode = PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY[tabKey];
  const viewPermissionCode = getProjectViewPermissionCode(moduleCode);
  const scope = getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId);
  if (viewPermissionCode && hasProjectNavigationCapability(user, viewPermissionCode, scope)) return true;
  if (hasExplicitProjectViewGrantForRoute(user, PROJECT_MATERIAL_TAB_ROUTE_BY_KEY[tabKey], scope)) return true;
  const roomCode = PROJECT_MATERIAL_TAB_ROOM_CODE_BY_KEY[tabKey];
  if (roomCode && hasProjectRoomView(user, [roomCode], scopeInput)) return true;
  return hasExplicitProjectViewGrantForRoute(user, PROJECT_TAB_ROUTE_BY_KEY.material, scope);
};

export const canManageProjectTab = (
  user: ProjectPermissionUser,
  tabKey: ProjectOverviewTabKey,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  const moduleCode = PROJECT_TAB_MODULE_CODE_BY_KEY[tabKey];
  const scope = getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId);
  if (getProjectManagePermissionCodes(moduleCode).some(code => hasProjectNavigationCapability(user, code, scope))) return true;

  if (tabKey === 'finance') {
    return hasProjectManageCapabilityForModules(
      user,
      [tabKey, ...PROJECT_FINANCE_LEGACY_TAB_KEYS].map(key => PROJECT_TAB_MODULE_CODE_BY_KEY[key]),
      scope,
    );
  }
  if (isProjectFinanceLegacyTabKey(tabKey) && hasProjectManageCapabilityForModules(
    user,
    [PROJECT_TAB_MODULE_CODE_BY_KEY.finance],
    scope,
  )) {
    return true;
  }
  return false;
};

export const canManageProjectMaterialTab = (
  user: ProjectPermissionUser,
  tabKey: ProjectMaterialTabKey,
  scopeInput: { projectId?: string; constructionSiteId?: string | null },
): boolean => {
  const moduleCode = PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY[tabKey];
  const scope = getProjectScope(scopeInput.projectId, scopeInput.constructionSiteId);
  if (getProjectManagePermissionCodes(moduleCode).some(code => hasProjectNavigationCapability(user, code, scope))) return true;
  return getProjectManagePermissionCodes(PROJECT_TAB_MODULE_CODE_BY_KEY.material)
    .some(code => hasProjectNavigationCapability(user, code, scope));
};

const projectActionCodesByAction = (actions: readonly string[]): readonly string[] =>
  getPermissionModules()
    .filter(module => module.code.startsWith('project.'))
    .flatMap(module => module.actions)
    .filter(action => actions.includes(action.action))
    .map(action => action.permissionCode);

export const projectPermissionCodeToLegacyProjectCode = (permissionCode: string): LegacyProjectPermissionCode | null => {
  if (permissionCode === 'project.material_request.view_available_stock') return 'view_available_stock';

  const action = getPermissionModules()
    .filter(module => module.code.startsWith('project.'))
    .flatMap(module => module.actions)
    .find(candidate => candidate.permissionCode === permissionCode);

  switch (action?.action) {
    case 'view':
      return 'view';
    case 'create':
    case 'edit':
    case 'edit_own':
    case 'edit_all':
      return 'edit';
    case 'delete':
    case 'delete_own':
    case 'delete_all':
      return 'delete';
    case 'submit':
      return 'submit';
    case 'verify':
    case 'return':
      return 'verify';
    case 'confirm':
    case 'confirm_fulfillment':
    case 'mark_paid':
      return 'confirm';
    case 'approve':
      return 'approve';
    default:
      return null;
  }
};

export const getLegacyProjectCodesDerivedFromPermissionCodes = (
  permissionCodes: readonly string[],
): readonly LegacyProjectPermissionCode[] =>
  [...new Set(permissionCodes.map(projectPermissionCodeToLegacyProjectCode).filter(Boolean))] as LegacyProjectPermissionCode[];

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
      return projectActionCodesByAction(['confirm', 'confirm_fulfillment']);
    case 'approve':
      return projectActionCodesByAction(['approve']);
    case 'view_available_stock':
      return ['project.material_request.view_available_stock'];
    default:
      return [];
  }
};
