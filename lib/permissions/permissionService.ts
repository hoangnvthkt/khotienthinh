import { matchPath } from 'react-router-dom';
import {
  User,
  UserPermissionGrant,
  type AuthorizationSnapshot,
  type EffectivePermissionSource,
} from '../../types';
import {
  getPermissionActionByCode,
  getPermissionModuleByCode,
  getPermissionModules,
  getPermissionModulesByLegacyKey,
} from './permissionRegistry';
import { PermissionScope } from './permissionTypes';
import { evaluateCapability } from './authorizationEvaluator';

const DEFAULT_SCOPE: Required<PermissionScope> = { scopeType: 'global', scopeId: '*' };

const HRM_TEMPLATE_ONLY_PERMISSIONS = new Set([
  'hrm.organization.manage',
  'hrm.staffing.manage',
  'hrm.staffing.assign',
  'hrm.staffing.set_manager',
  'hrm.employee.view_sensitive',
  'hrm.employee.edit_sensitive',
  'hrm.employee.import',
  'hrm.employee.export',
  'hrm.contract.view',
  'hrm.contract.manage',
  'hrm.document.view',
  'hrm.document.manage',
  'hrm.compensation.view',
  'hrm.compensation.manage',
  'hrm.payroll.manage',
  'hrm.payroll.export',
  'hrm.master_data.manage',
]);

export const isDirectPermissionGrantAllowed = (permissionCode: string): boolean =>
  !HRM_TEMPLATE_ONLY_PERMISSIONS.has(permissionCode);

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

const hasAnyActiveProjectGrant = (user: PermissionUser): boolean => {
  const snapshot = getUserAuthorizationSnapshot(user);
  if (!snapshot) return false;

  const hasCanonicalProjectSource = snapshot.sources.some(source =>
    source.permissionCode.startsWith('project.')
    && evaluateCapability(snapshot, source.permissionCode, {
      scopeType: source.scopeType,
      scopeId: source.scopeId,
    }).allowed
  );

  return hasCanonicalProjectSource || snapshot.roomActions.some(action => action.actionCode === 'view');
};

const isVehicleBookingModule = (moduleCodeOrLegacyKey: string): boolean =>
  moduleCodeOrLegacyKey === 'VEHICLE_BOOKING' || moduleCodeOrLegacyKey === 'resource_booking.vehicle';

const isVehicleBookingRoute = (route: string): boolean =>
  route === '/booking/vehicle' || route.startsWith('/booking/vehicle/');

type PermissionUser = Pick<
  User,
  | 'role'
  | 'permissionGrants'
  | 'effectivePermissionSources'
  | 'authorizationSnapshot'
> | null | undefined;

const grantToSource = (grant: UserPermissionGrant): EffectivePermissionSource => ({
  permissionCode: grant.permissionCode,
  sourceType: 'DIRECT',
  sourceId: grant.id,
  scopeType: grant.scopeType,
  scopeId: grant.scopeId,
  startsAt: grant.grantedAt,
  expiresAt: grant.expiresAt,
  isBusinessApproval: false,
  metadata: { compatibilityProjection: true, isActive: grant.isActive !== false },
});

export const getUserAuthorizationSnapshot = (
  user: PermissionUser,
): AuthorizationSnapshot | null => {
  if (!user) return null;
  if (user.authorizationSnapshot) return user.authorizationSnapshot;

  const sources = user.effectivePermissionSources !== undefined
    ? user.effectivePermissionSources
    : (user.permissionGrants || []).filter(grant => grant.isActive !== false).map(grantToSource);

  return {
    generatedAt: new Date(0).toISOString(),
    flags: { legacy_fallback_disabled: true },
    sources,
    roomActions: [],
  };
};

export const userHasPermissionGrant = (
  user: PermissionUser,
  permissionCode: string,
  scope?: PermissionScope,
): boolean => evaluateCapability(
  getUserAuthorizationSnapshot(user),
  permissionCode,
  scope,
).allowed;

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
  user: PermissionUser,
  permissionCode: string,
  scope?: PermissionScope,
): boolean => evaluateCapability(
  getUserAuthorizationSnapshot(user),
  permissionCode,
  scope,
).allowed;

/** The creation wizard can start for a global or source-scoped Workspace grant. */
export const canStartWorkWorkspace = (user: PermissionUser): boolean => {
  if (canPerform(user, 'work.workspace.create', DEFAULT_SCOPE)) return true;
  const now = Date.now();
  return Boolean(getUserAuthorizationSnapshot(user)?.sources.some(source =>
    source.permissionCode === 'work.workspace.create' &&
    ['global', 'department', 'project'].includes(source.scopeType) &&
    (!source.startsAt || Date.parse(source.startsAt) <= now) &&
    (!source.expiresAt || Date.parse(source.expiresAt) > now)
  ));
};

export const canViewModule = (
  user: PermissionUser,
  moduleCodeOrLegacyKey: string,
  scope?: PermissionScope,
): boolean => {
  if (isVehicleBookingModule(moduleCodeOrLegacyKey)) return Boolean(user);
  if (moduleCodeOrLegacyKey === 'DA' && hasAnyActiveProjectGrant(user)) return true;

  const modules = getPermissionModuleByCode(moduleCodeOrLegacyKey)
    ? [getPermissionModuleByCode(moduleCodeOrLegacyKey)!]
    : getPermissionModulesByLegacyKey(moduleCodeOrLegacyKey);
  const viewPermissionCodes = modules.flatMap(module => module.actions
    .filter(action => action.action === 'view' || action.action === 'access' || action.action.startsWith('view_'))
    .map(action => action.permissionCode));

  if (scope) return viewPermissionCodes.some(permissionCode => canPerform(user, permissionCode, scope));

  const snapshot = getUserAuthorizationSnapshot(user);
  return Boolean(snapshot?.sources.some(source =>
    viewPermissionCodes.includes(source.permissionCode)
    && evaluateCapability(snapshot, source.permissionCode, {
      scopeType: source.scopeType,
      scopeId: source.scopeId,
    }).allowed
  ));
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
  if (isVehicleBookingRoute(route)) return true;
  if (route === '/da' && hasAnyActiveProjectGrant(user)) return true;

  const routeModules = getPermissionModules().filter(module =>
    (module.routes || []).some(moduleRoute => routeMatches(moduleRoute, route))
  );
  const isHrmRoute = routeModules.some(module => module.code.startsWith('hrm.'));
  const domainModules = routeModules.filter(module => !module.code.startsWith('system.'));
  const eligibleModules = isHrmRoute
    ? routeModules.filter(module => module.code.startsWith('hrm.'))
    : domainModules.length > 0 ? domainModules : routeModules;
  if (eligibleModules.length === 0) return false;
  return eligibleModules.some(module => module.actions.some(action =>
    (action.action.startsWith('view') || action.action === 'access') &&
    canPerform(user, action.permissionCode, scope)
  ));
};

export const canManageRoute = (
  user: Parameters<typeof canPerform>[0],
  route: string,
  scope?: PermissionScope,
): boolean => {
  if (!user) return false;

  const routeModules = getPermissionModules().filter(module =>
    (module.routes || []).some(moduleRoute => routeMatches(moduleRoute, route))
  );
  const isHrmRoute = routeModules.some(module => module.code.startsWith('hrm.'));
  const domainModules = routeModules.filter(module => !module.code.startsWith('system.'));
  const eligibleModules = isHrmRoute
    ? routeModules.filter(module => module.code.startsWith('hrm.'))
    : domainModules.length > 0 ? domainModules : routeModules;
  return eligibleModules.some(module => module.actions.some(action =>
    action.action === 'manage' &&
    canPerform(user, action.permissionCode, scope)
  ));
};

export const getManagePermissionCodeForRoute = (route: string): string | undefined => {
  const module = getPermissionModules().find(candidate =>
    (candidate.routes || []).some(moduleRoute => routeMatches(moduleRoute, route))
  );
  return module?.actions.find(action => action.action === 'manage')?.permissionCode;
};

export const getInheritedPermissionCodes = (
  user: PermissionUser,
): readonly string[] => {
  const snapshot = getUserAuthorizationSnapshot(user);
  return snapshot
    ? [...new Set(snapshot.sources.map(source => source.permissionCode))]
    : [];
};

export const getModuleViewPermissionCodes = (moduleCodeOrLegacyKey: string): readonly string[] => {
  const modules = getPermissionModuleByCode(moduleCodeOrLegacyKey)
    ? [getPermissionModuleByCode(moduleCodeOrLegacyKey)!]
    : getPermissionModulesByLegacyKey(moduleCodeOrLegacyKey);
  return modules.flatMap(module => module.actions.filter(action => action.action === 'view').map(action => action.permissionCode));
};
