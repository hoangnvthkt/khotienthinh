import { UserPermissionGrant } from '../../types';
import {
  PermissionAdminCatalog,
  PermissionCatalogAction,
  PermissionCatalogApplication,
  PermissionScopeType,
} from './permissionTypes';

export type ApplicationGrantState = 'unchecked' | 'checked' | 'indeterminate';

export class ModuleGrantSelectionError extends Error {
  constructor(
    message: string,
    readonly code: 'application_not_found' | 'direct_grant_denied' | 'scope_required' | 'scope_denied' | 'expiry_required',
    readonly permissionCode?: string,
  ) {
    super(message);
    this.name = 'ModuleGrantSelectionError';
  }
}

interface ApplicationInput {
  catalog: PermissionAdminCatalog;
  applicationCode: string;
}

interface GrantStateInput extends ApplicationInput {
  grants: readonly UserPermissionGrant[];
  inheritedPermissionCodes: readonly string[];
  scopeIds?: Partial<Record<PermissionScopeType, string>>;
  now?: Date;
}

interface SelectApplicationInput extends ApplicationInput {
  grants: readonly UserPermissionGrant[];
  targetUserId: string;
  scopeIds?: Partial<Record<PermissionScopeType, string>>;
  now?: Date;
}

interface RemoveApplicationInput extends ApplicationInput {
  grants: readonly UserPermissionGrant[];
}

interface TogglePermissionInput {
  catalog: PermissionAdminCatalog;
  grants: readonly UserPermissionGrant[];
  targetUserId: string;
  permissionCode: string;
  checked: boolean;
  scopeType: PermissionScopeType;
  scopeId?: string;
  expiresAt?: string;
  now?: Date;
}

const ENTITY_SCOPE_TYPES = new Set<PermissionScopeType>([
  'project',
  'construction_site',
  'warehouse',
  'department',
  'direct_reports',
  'org_unit',
  'work_workspace',
]);

const grantKey = (
  permissionCode: string,
  scopeType: PermissionScopeType,
  scopeId: string,
): string => `${permissionCode}::${scopeType}::${scopeId}`;

const activeGrant = (grant: UserPermissionGrant, now: Date): boolean =>
  grant.isActive !== false
  && (!grant.expiresAt || Date.parse(grant.expiresAt) > now.getTime());

const getApplication = (
  catalog: PermissionAdminCatalog,
  applicationCode: string,
): PermissionCatalogApplication => {
  const application = catalog.applications.find(item => item.code === applicationCode);
  if (!application) {
    throw new ModuleGrantSelectionError(
      `Không tìm thấy Module ${applicationCode}.`,
      'application_not_found',
    );
  }
  return application;
};

const getApplicationActions = (application: PermissionCatalogApplication): PermissionCatalogAction[] =>
  application.modules.flatMap(module => module.actions);

const getAction = (
  catalog: PermissionAdminCatalog,
  permissionCode: string,
): PermissionCatalogAction => {
  for (const application of catalog.applications) {
    const action = getApplicationActions(application)
      .find(item => item.permissionCode === permissionCode);
    if (action) return action;
  }
  throw new ModuleGrantSelectionError(
    `Không tìm thấy quyền ${permissionCode}.`,
    'application_not_found',
    permissionCode,
  );
};

const normalizedScopeId = (
  scopeType: PermissionScopeType,
  scopeId: string | undefined,
  permissionCode: string,
): string => {
  if (!ENTITY_SCOPE_TYPES.has(scopeType)) return '*';
  const normalized = scopeId?.trim();
  if (!normalized || normalized === '*') {
    throw new ModuleGrantSelectionError(
      'Quyền yêu cầu chọn phạm vi cụ thể.',
      'scope_required',
      permissionCode,
    );
  }
  return normalized;
};

const validateDirectAction = (
  action: PermissionCatalogAction,
  scopeType: PermissionScopeType,
  scopeId: string | undefined,
  expiresAt: string | undefined,
  now: Date,
): string => {
  if (!action.directGrantAllowed) {
    throw new ModuleGrantSelectionError(
      `Không thể cấp trực tiếp quyền ${action.permissionCode}.`,
      'direct_grant_denied',
      action.permissionCode,
    );
  }
  if (!action.scopeTypes.includes(scopeType)) {
    throw new ModuleGrantSelectionError(
      `Quyền ${action.permissionCode} không hỗ trợ phạm vi đã chọn.`,
      'scope_denied',
      action.permissionCode,
    );
  }
  if (action.directGrantRequiresExpiry && (
    !expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()
  )) {
    throw new ModuleGrantSelectionError(
      'Quyền yêu cầu ngày hết hạn trong tương lai.',
      'expiry_required',
      action.permissionCode,
    );
  }
  return normalizedScopeId(scopeType, scopeId, action.permissionCode);
};

const defaultGrantIdentity = (
  action: PermissionCatalogAction,
  scopeIds: Partial<Record<PermissionScopeType, string>>,
  now: Date,
): { scopeType: PermissionScopeType; scopeId: string } => {
  if (!action.defaultScopeType) {
    throw new ModuleGrantSelectionError(
      `Quyền ${action.permissionCode} thiếu phạm vi mặc định.`,
      'scope_required',
      action.permissionCode,
    );
  }
  const scopeId = validateDirectAction(
    action,
    action.defaultScopeType,
    scopeIds[action.defaultScopeType],
    undefined,
    now,
  );
  return { scopeType: action.defaultScopeType, scopeId };
};

export const getApplicationGrantState = ({
  catalog,
  applicationCode,
  grants,
  inheritedPermissionCodes,
  scopeIds = {},
  now = new Date(),
}: GrantStateInput): ApplicationGrantState => {
  const application = getApplication(catalog, applicationCode);
  const actions = getApplicationActions(application);
  const defaultActions = actions.filter(action => action.isDefaultView);
  const applicationCodes = new Set(actions.map(action => action.permissionCode));
  const activeGrants = grants.filter(grant => activeGrant(grant, now));
  const hasApplicationGrant = activeGrants.some(grant => applicationCodes.has(grant.permissionCode));
  const hasInherited = inheritedPermissionCodes.some(code => applicationCodes.has(code));

  if (defaultActions.length === 0) {
    return hasApplicationGrant || hasInherited ? 'indeterminate' : 'unchecked';
  }

  let selectedDefaultCount = 0;
  for (const action of defaultActions) {
    try {
      const identity = defaultGrantIdentity(action, scopeIds, now);
      const key = grantKey(action.permissionCode, identity.scopeType, identity.scopeId);
      if (activeGrants.some(grant => grantKey(
        grant.permissionCode,
        grant.scopeType || 'global',
        grant.scopeId || '*',
      ) === key)) selectedDefaultCount += 1;
    } catch (error) {
      if (!(error instanceof ModuleGrantSelectionError) || error.code !== 'scope_required') throw error;
      if (activeGrants.some(grant => grant.permissionCode === action.permissionCode)) {
        selectedDefaultCount += 1;
      }
    }
  }

  if (selectedDefaultCount === defaultActions.length) return 'checked';
  if (selectedDefaultCount > 0 || hasApplicationGrant || hasInherited) return 'indeterminate';
  return 'unchecked';
};

export const selectApplicationDefaultViews = ({
  catalog,
  applicationCode,
  grants,
  targetUserId,
  scopeIds = {},
  now = new Date(),
}: SelectApplicationInput): UserPermissionGrant[] => {
  const application = getApplication(catalog, applicationCode);
  const defaultActions = getApplicationActions(application).filter(action => action.isDefaultView);
  const next = [...grants];

  defaultActions.forEach(action => {
    const identity = defaultGrantIdentity(action, scopeIds, now);
    const key = grantKey(action.permissionCode, identity.scopeType, identity.scopeId);
    const activeExisting = next.some(grant => activeGrant(grant, now) && grantKey(
      grant.permissionCode,
      grant.scopeType || 'global',
      grant.scopeId || '*',
    ) === key);
    if (activeExisting) return;

    for (let index = next.length - 1; index >= 0; index -= 1) {
      const existing = next[index];
      if (grantKey(
        existing.permissionCode,
        existing.scopeType || 'global',
        existing.scopeId || '*',
      ) === key) next.splice(index, 1);
    }
    next.push({
      id: `local-${action.permissionCode}-${identity.scopeType}-${identity.scopeId}`,
      userId: targetUserId,
      permissionCode: action.permissionCode,
      scopeType: identity.scopeType,
      scopeId: identity.scopeId,
      isActive: true,
    });
  });

  return next;
};

export const removeApplicationDirectGrants = ({
  catalog,
  applicationCode,
  grants,
}: RemoveApplicationInput): {
  grants: UserPermissionGrant[];
  removed: UserPermissionGrant[];
  needsConfirmation: boolean;
} => {
  const application = getApplication(catalog, applicationCode);
  const actions = getApplicationActions(application);
  const applicationCodes = new Set(actions.map(action => action.permissionCode));
  const defaultCodes = new Set(actions.filter(action => action.isDefaultView).map(action => action.permissionCode));
  const removed = grants.filter(grant => applicationCodes.has(grant.permissionCode));
  return {
    grants: grants.filter(grant => !applicationCodes.has(grant.permissionCode)),
    removed,
    needsConfirmation: removed.some(grant => !defaultCodes.has(grant.permissionCode)),
  };
};

export const togglePermissionAction = ({
  catalog,
  grants,
  targetUserId,
  permissionCode,
  checked,
  scopeType,
  scopeId,
  expiresAt,
  now = new Date(),
}: TogglePermissionInput): UserPermissionGrant[] => {
  const action = getAction(catalog, permissionCode);
  const normalizedId = validateDirectAction(action, scopeType, scopeId, expiresAt, now);
  const key = grantKey(permissionCode, scopeType, normalizedId);
  const withoutTarget = grants.filter(grant => grantKey(
    grant.permissionCode,
    grant.scopeType || 'global',
    grant.scopeId || '*',
  ) !== key);
  if (!checked) return withoutTarget;
  return [
    ...withoutTarget,
    {
      id: `local-${permissionCode}-${scopeType}-${normalizedId}`,
      userId: targetUserId,
      permissionCode,
      scopeType,
      scopeId: normalizedId,
      expiresAt,
      isActive: true,
    },
  ];
};
