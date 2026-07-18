import type { UserPermissionGrant } from '../../types';
import type {
  EffectivePermissionSource,
  EffectivePermissionSourceType,
} from './authorizationGovernanceTypes';
import { buildPermissionSourceBadges } from './authorizationGovernanceViewModel';
import { canAddDirectGrant, canRemoveDirectGrant, resolvePermissionActionReadiness } from './permissionReadiness';
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
