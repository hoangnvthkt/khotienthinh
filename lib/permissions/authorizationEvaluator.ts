import type {
  AuthorizationSnapshot,
  EffectivePermissionSource,
} from '../../types';
import { getPermissionActionByCode } from './permissionRegistry';
import type { PermissionScope } from './permissionTypes';

export type AuthorizationDecisionReason =
  | 'granted'
  | 'inactive'
  | 'unknown_permission'
  | 'scope_mismatch'
  | 'legacy_disabled'
  | 'not_granted';

export interface AuthorizationEvaluationScope extends PermissionScope {
  projectId?: string;
  constructionSiteId?: string | null;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: AuthorizationDecisionReason;
  sourceType?: string;
  sourceId?: string;
  sourceMetadata?: Record<string, unknown>;
}

const sourceIsActive = (source: EffectivePermissionSource, now: Date): boolean => {
  if (source.startsAt && new Date(source.startsAt).getTime() > now.getTime()) return false;
  if (source.expiresAt && new Date(source.expiresAt).getTime() <= now.getTime()) return false;
  return true;
};

const sourceCoversScope = (
  source: EffectivePermissionSource,
  scope: AuthorizationEvaluationScope,
): boolean => {
  const requestedType = scope.scopeType || 'global';
  const requestedId = scope.scopeId || '*';

  if (source.scopeType === 'global') return true;
  if (source.scopeType === requestedType) {
    return source.scopeId === '*' || source.scopeId === requestedId;
  }
  return Boolean(
    source.scopeType === 'project'
    && requestedType === 'construction_site'
    && scope.projectId
    && source.scopeId === scope.projectId
  );
};

const sourceCanAuthorize = (
  snapshot: AuthorizationSnapshot,
  source: EffectivePermissionSource,
): boolean => source.sourceType.toUpperCase() !== 'LEGACY'
  || !(
    snapshot.flags.legacy_fallback_disabled === true
    || source.permissionCode.startsWith('work.')
  );

export const evaluateCapability = (
  snapshot: AuthorizationSnapshot | null | undefined,
  permissionCode: string,
  scope: AuthorizationEvaluationScope = { scopeType: 'global', scopeId: '*' },
  now = new Date(),
): AuthorizationDecision => {
  if (!snapshot) return { allowed: false, reason: 'inactive' };

  const action = getPermissionActionByCode(permissionCode);
  if (!action) return { allowed: false, reason: 'unknown_permission' };

  const requestedScopeType = scope.scopeType || 'global';
  const allowedScopeTypes = action.scopeTypes?.length ? action.scopeTypes : ['global'];
  if (!allowedScopeTypes.includes(requestedScopeType)) {
    return { allowed: false, reason: 'scope_mismatch' };
  }

  const matching = snapshot.sources.filter(source => source.permissionCode === permissionCode);
  const active = matching.filter(source => sourceIsActive(source, now));
  const enabled = active.filter(source => sourceCanAuthorize(snapshot, source));
  const granted = enabled.find(source => sourceCoversScope(source, scope));

  if (granted) {
    return {
      allowed: true,
      reason: 'granted',
      sourceType: granted.sourceType,
      sourceId: granted.sourceId,
      sourceMetadata: granted.metadata,
    };
  }
  if (active.length > 0 && enabled.length === 0) {
    return { allowed: false, reason: 'legacy_disabled' };
  }
  if (enabled.length > 0) return { allowed: false, reason: 'scope_mismatch' };
  return { allowed: false, reason: 'not_granted' };
};

export const hasRoomAction = (
  snapshot: AuthorizationSnapshot | null | undefined,
  projectId: string,
  constructionSiteId: string | null | undefined,
  roomCode: string,
  actionCode: string,
): boolean => Boolean(snapshot?.roomActions.some(action =>
  action.projectId === projectId
  && action.roomCode === roomCode
  && action.actionCode === actionCode
  && (
    action.constructionSiteId == null
    || action.constructionSiteId === (constructionSiteId || null)
  )
));
