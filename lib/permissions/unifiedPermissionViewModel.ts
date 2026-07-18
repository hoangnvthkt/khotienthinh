import type { UserPermissionGrant } from '../../types';
import { ROUTE_TO_MODULE } from '../../constants/routes';
import {
  PROJECT_MATERIAL_TAB_PERMISSIONS,
  PROJECT_TAB_PERMISSIONS,
} from '../projectTabPermissions';
import {
  getSettingsFeatureToken,
  SETTINGS_FEATURES,
} from '../settingsPermissions';
import type {
  EffectivePermissionSource,
  EffectivePermissionSourceType,
} from './authorizationGovernanceTypes';
import { buildPermissionSourceBadges } from './authorizationGovernanceViewModel';
import { canAddDirectGrant, canRemoveDirectGrant, resolvePermissionActionReadiness } from './permissionReadiness';
import { getPermissionModules } from './permissionRegistry';
import type {
  LegacyPermissionState,
  PermissionActionReadiness,
  PermissionModuleDefinition,
  PermissionRiskLevel,
  PermissionScope,
  PermissionScopeType,
} from './permissionTypes';

export interface UnifiedPermissionActionRow {
  permissionCode: string;
  action: string;
  label: string;
  readiness: PermissionActionReadiness;
  hasDirectGrant: boolean;
  isEffective: boolean;
  sourceKinds: EffectivePermissionSourceType[];
  sourceBadges: ReturnType<typeof buildPermissionSourceBadges>;
  canAdd: boolean;
  canRemove: boolean;
  riskLevel: PermissionRiskLevel;
}

export interface LegacyPermissionCatalogRoute {
  route: string;
  label: string;
}

export interface LegacyPermissionCatalogEntry {
  legacyModuleKey: string;
  label: string;
  routes: LegacyPermissionCatalogRoute[];
}

const normalizeScope = (scope: PermissionScope): Required<PermissionScope> => ({
  scopeType: scope.scopeType || 'global',
  scopeId: scope.scopeId || '*',
});

const grantMatchesScope = (
  grant: UserPermissionGrant,
  scope: Required<PermissionScope>,
): boolean => grant.scopeType === scope.scopeType && grant.scopeId === scope.scopeId;

const sourceCoversScope = (
  source: EffectivePermissionSource,
  scope: Required<PermissionScope>,
): boolean => source.scopeType === 'global'
  || (source.scopeType === scope.scopeType && source.scopeId === scope.scopeId);

export const buildUnifiedPermissionRows = (input: {
  module: PermissionModuleDefinition;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  scope: PermissionScope;
}): UnifiedPermissionActionRow[] => {
  const scope = normalizeScope(input.scope);
  return [...input.module.actions]
    .sort((left, right) => (
      (left.action === 'view' ? -1 : 0) - (right.action === 'view' ? -1 : 0)
      || (left.sortOrder || 0) - (right.sortOrder || 0)
      || left.permissionCode.localeCompare(right.permissionCode)
    ))
    .map(action => {
      const hasDirectGrant = input.grants.some(grant =>
        grant.isActive !== false
        && grant.permissionCode === action.permissionCode
        && grantMatchesScope(grant, scope)
      );
      const sources = input.effectiveSources.filter(source =>
        source.permissionCode === action.permissionCode && sourceCoversScope(source, scope)
      );
      const sourceBadges = buildPermissionSourceBadges(sources);

      return {
        permissionCode: action.permissionCode,
        action: action.action,
        label: action.label,
        readiness: resolvePermissionActionReadiness(action),
        hasDirectGrant,
        isEffective: sources.length > 0,
        sourceKinds: sourceBadges.map(badge => badge.kind),
        sourceBadges,
        canAdd: !hasDirectGrant && canAddDirectGrant(action),
        canRemove: canRemoveDirectGrant(hasDirectGrant),
        riskLevel: action.riskLevel || 'normal',
      };
    });
};

export const toggleUnifiedDirectGrant = (input: {
  module: PermissionModuleDefinition;
  grants: readonly UserPermissionGrant[];
  targetUserId: string;
  permissionCode: string;
  checked: boolean;
  scope: PermissionScope;
}): UserPermissionGrant[] => {
  const action = input.module.actions.find(candidate => candidate.permissionCode === input.permissionCode);
  if (!action) return [...input.grants];

  const scope = normalizeScope(input.scope);
  const moduleCodes = new Set(input.module.actions.map(candidate => candidate.permissionCode));
  const sameDraftKey = (grant: UserPermissionGrant, permissionCode = input.permissionCode): boolean =>
    grant.userId === input.targetUserId
    && grant.permissionCode === permissionCode
    && grantMatchesScope(grant, scope);

  if (!input.checked) {
    if (action.action === 'view') {
      return input.grants.filter(grant => !(
        grant.userId === input.targetUserId
        && moduleCodes.has(grant.permissionCode)
        && grantMatchesScope(grant, scope)
      ));
    }
    return input.grants.filter(grant => !sameDraftKey(grant));
  }

  if (!canAddDirectGrant(action)) return [...input.grants];

  const next = [...input.grants];
  const append = (permissionCode: string) => {
    if (next.some(grant => sameDraftKey(grant, permissionCode) && grant.isActive !== false)) return;
    next.push({
      userId: input.targetUserId,
      permissionCode,
      scopeType: scope.scopeType as PermissionScopeType,
      scopeId: scope.scopeId,
    });
  };

  append(action.permissionCode);
  if (action.action !== 'view') {
    const viewAction = input.module.actions.find(candidate => candidate.action === 'view');
    if (viewAction && canAddDirectGrant(viewAction)) append(viewAction.permissionCode);
  }

  return next;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

const canonicalGrant = (grant: UserPermissionGrant) => ({
  permissionCode: grant.permissionCode,
  scopeType: grant.scopeType || 'global',
  scopeId: grant.scopeId || '*',
  expiresAt: grant.expiresAt || null,
  isActive: grant.isActive !== false,
});

export const buildUnifiedPermissionDraftKey = (
  targetUserId: string,
  legacyState: LegacyPermissionState,
  grants: readonly UserPermissionGrant[],
): string => JSON.stringify(canonicalize({
  targetUserId,
  legacyState,
  grants: grants
    .map(canonicalGrant)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
}));

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();

const withoutMapKey = (
  map: Record<string, string[]>,
  key: string,
): Record<string, string[]> => Object.fromEntries(
  Object.entries(map).filter(([candidate]) => candidate !== key),
);

const normalizeLegacyState = (state: LegacyPermissionState): LegacyPermissionState => ({
  allowedModules: sortedUnique(state.allowedModules),
  allowedSubModules: Object.fromEntries(
    Object.entries(state.allowedSubModules)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, routes]) => [key, sortedUnique(routes)]),
  ),
  adminModules: sortedUnique(state.adminModules),
  adminSubModules: Object.fromEntries(
    Object.entries(state.adminSubModules)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, routes]) => [key, sortedUnique(routes)]),
  ),
});

export const isLegacyRouteVisible = (
  state: LegacyPermissionState,
  legacyModuleKey: string,
  route: string,
): boolean => {
  if (!state.allowedModules.includes(legacyModuleKey)) return false;
  if (!Object.prototype.hasOwnProperty.call(state.allowedSubModules, legacyModuleKey)) return true;
  return state.allowedSubModules[legacyModuleKey].includes(route);
};

export const toggleLegacyModuleView = (
  state: LegacyPermissionState,
  legacyModuleKey: string,
  checked: boolean,
): LegacyPermissionState => {
  if (checked) {
    return normalizeLegacyState({
      ...state,
      allowedModules: [...state.allowedModules, legacyModuleKey],
    });
  }

  return normalizeLegacyState({
    allowedModules: state.allowedModules.filter(key => key !== legacyModuleKey),
    allowedSubModules: withoutMapKey(state.allowedSubModules, legacyModuleKey),
    adminModules: state.adminModules.filter(key => key !== legacyModuleKey),
    adminSubModules: withoutMapKey(state.adminSubModules, legacyModuleKey),
  });
};

export const toggleLegacyRouteView = (
  state: LegacyPermissionState,
  legacyModuleKey: string,
  route: string,
  checked: boolean,
  knownRoutes: readonly string[],
): LegacyPermissionState => {
  const normalizedKnownRoutes = sortedUnique(knownRoutes);
  const hasExplicitRoutes = Object.prototype.hasOwnProperty.call(state.allowedSubModules, legacyModuleKey);
  const currentRoutes = hasExplicitRoutes
    ? sortedUnique(state.allowedSubModules[legacyModuleKey])
    : normalizedKnownRoutes;
  const nextRoutes = sortedUnique(
    checked
      ? [...currentRoutes, route]
      : currentRoutes.filter(candidate => candidate !== route),
  );
  const hasEveryKnownRoute = normalizedKnownRoutes.length > 0
    && normalizedKnownRoutes.every(candidate => nextRoutes.includes(candidate));
  const allowedSubModules = hasEveryKnownRoute
    ? withoutMapKey(state.allowedSubModules, legacyModuleKey)
    : { ...state.allowedSubModules, [legacyModuleKey]: nextRoutes };

  return normalizeLegacyState({
    ...state,
    allowedModules: checked
      ? [...state.allowedModules, legacyModuleKey]
      : state.allowedModules,
    allowedSubModules,
  });
};

export const revokeLegacyUmbrella = (
  state: LegacyPermissionState,
  legacyModuleKey: string,
): LegacyPermissionState => normalizeLegacyState({
  ...state,
  adminModules: state.adminModules.filter(key => key !== legacyModuleKey),
  adminSubModules: withoutMapKey(state.adminSubModules, legacyModuleKey),
});

const PROJECT_ROUTE_LABELS = new Map<string, string>([
  ...PROJECT_TAB_PERMISSIONS.map(tab => [tab.route, tab.label] as const),
  ...PROJECT_MATERIAL_TAB_PERMISSIONS.map(tab => [tab.route, tab.label] as const),
]);

const SETTINGS_ROUTE_LABELS = new Map<string, string>(
  SETTINGS_FEATURES.map(feature => [getSettingsFeatureToken(feature.id), feature.label]),
);

const routeLabel = (route: string, fallback: string): string =>
  PROJECT_ROUTE_LABELS.get(route)
  || SETTINGS_ROUTE_LABELS.get(route)
  || fallback;

export const buildLegacyPermissionCatalog = (): LegacyPermissionCatalogEntry[] => {
  const catalog = new Map<string, {
    label: string;
    routes: Map<string, string>;
  }>();
  const ensure = (legacyModuleKey: string, label: string) => {
    const current = catalog.get(legacyModuleKey);
    if (current) return current;
    const created = { label, routes: new Map<string, string>() };
    catalog.set(legacyModuleKey, created);
    return created;
  };

  for (const module of getPermissionModules()) {
    if (!module.legacyModuleKey) continue;
    const entry = ensure(module.legacyModuleKey, module.label);
    for (const route of module.routes || []) {
      entry.routes.set(route, routeLabel(route, module.label));
    }
    for (const action of module.actions) {
      if (!action.legacyRoute) continue;
      entry.routes.set(action.legacyRoute, routeLabel(action.legacyRoute, action.label));
    }
  }

  for (const [route, legacyModuleKey] of Object.entries(ROUTE_TO_MODULE)) {
    const entry = ensure(legacyModuleKey, legacyModuleKey);
    if (!entry.routes.has(route)) entry.routes.set(route, routeLabel(route, route));
  }

  for (const [route, label] of SETTINGS_ROUTE_LABELS) {
    ensure('SETTINGS', 'Cài đặt').routes.set(route, label);
  }

  return [...catalog.entries()]
    .map(([legacyModuleKey, entry]) => ({
      legacyModuleKey,
      label: entry.label,
      routes: [...entry.routes.entries()]
        .map(([route, label]) => ({ route, label }))
        .sort((left, right) => left.label.localeCompare(right.label) || left.route.localeCompare(right.route)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.legacyModuleKey.localeCompare(right.legacyModuleKey));
};
