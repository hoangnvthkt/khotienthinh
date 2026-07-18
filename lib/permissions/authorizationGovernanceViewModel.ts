import type { UserPermissionGrant } from '../../types';
import type {
  AuthorizationDecision,
  EffectivePermissionSource,
  EffectivePermissionSourceType,
  SodWarningAcceptanceInput,
} from './authorizationGovernanceTypes';
import { isPermissionActionScopeAllowed } from './permissionService';
import type { PermissionRiskLevel } from './permissionTypes';

export const sourceKey = (source: EffectivePermissionSource): string =>
  `${source.permissionCode}::${source.scopeType}::${source.scopeId}::${source.sourceType}::${source.sourceId}`;

const SOURCE_BADGE_ORDER: Record<EffectivePermissionSourceType, number> = {
  ROLE: 0,
  DIRECT: 1,
  LEGACY: 2,
};

export const buildPermissionSourceBadges = (sources: readonly EffectivePermissionSource[]) =>
  [...sources]
    .sort((left, right) =>
      SOURCE_BADGE_ORDER[left.sourceType] - SOURCE_BADGE_ORDER[right.sourceType]
      || `${left.sourceCode}:${left.sourceId}`.localeCompare(`${right.sourceCode}:${right.sourceId}`)
    )
    .map(source => ({
      key: sourceKey(source),
      kind: source.sourceType,
      label: source.sourceType === 'ROLE'
        ? `Business Role · ${source.sourceLabel}`
        : source.sourceType === 'DIRECT'
          ? 'Direct'
          : `Legacy · ${source.sourceCode}`,
    }));

export const buildEffectivePermissionRows = (
  directGrants: readonly UserPermissionGrant[],
  effectiveSources: readonly EffectivePermissionSource[],
) => {
  const codes = new Set([
    ...directGrants.map(grant => grant.permissionCode),
    ...effectiveSources.map(source => source.permissionCode),
  ]);
  return [...codes].sort().map(permissionCode => ({
    permissionCode,
    hasDirectGrant: directGrants.some(grant =>
      grant.permissionCode === permissionCode && grant.isActive !== false
    ),
    isEffective: effectiveSources.some(source => source.permissionCode === permissionCode),
    sources: effectiveSources.filter(source => source.permissionCode === permissionCode),
  }));
};

const activeGrantKey = (grant: UserPermissionGrant): string => [
  grant.permissionCode,
  grant.scopeType || 'global',
  grant.scopeId || '*',
  grant.expiresAt || '',
].join('::');

const canonicalActiveGrants = (grants: readonly UserPermissionGrant[]): string =>
  grants
    .filter(grant => grant.isActive !== false)
    .map(activeGrantKey)
    .sort()
    .join('|');

export const buildDirectGrantDraftKey = (
  targetUserId: string,
  grants: readonly UserPermissionGrant[],
): string => `${targetUserId}::${canonicalActiveGrants(grants)}`;

export const validateDirectGrantDrafts = (
  before: readonly UserPermissionGrant[],
  after: readonly UserPermissionGrant[],
  riskByPermissionCode: ReadonlyMap<string, PermissionRiskLevel>,
  now: Date,
  reason: string,
): string[] => {
  const errors: string[] = [];
  const changed = canonicalActiveGrants(before) !== canonicalActiveGrants(after);
  if (changed && reason.trim().length < 10) {
    errors.push('Lý do thay đổi phân quyền phải có ít nhất 10 ký tự.');
  }

  after.filter(grant => grant.isActive !== false).forEach(grant => {
    if (!isPermissionActionScopeAllowed(grant.permissionCode, {
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
    })) {
      errors.push(`${grant.permissionCode} không hỗ trợ scope ${grant.scopeType}/${grant.scopeId}.`);
    }

    if (riskByPermissionCode.get(grant.permissionCode) !== 'sensitive') return;
    const expiry = grant.expiresAt ? new Date(grant.expiresAt).getTime() : Number.NaN;
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
      errors.push(`${grant.permissionCode} cần ngày hết hạn trong tương lai.`);
    }
  });

  return [...new Set(errors)];
};

export const sodWarningKey = (
  value: Pick<SodWarningAcceptanceInput, 'ruleCode' | 'scopeType' | 'scopeId'>,
): string => `${value.ruleCode}::${value.scopeType}::${value.scopeId}`;

export const validateSodWarningAcceptances = (
  decision: AuthorizationDecision,
  acceptances: readonly SodWarningAcceptanceInput[],
  now: Date,
): string[] => {
  const errors: string[] = [];
  const warningsByKey = new Map(decision.warnings.map(warning => [sodWarningKey(warning), warning]));
  const acceptancesByKey = new Map<string, SodWarningAcceptanceInput[]>();
  acceptances.forEach(acceptance => {
    const key = sodWarningKey(acceptance);
    acceptancesByKey.set(key, [...(acceptancesByKey.get(key) || []), acceptance]);
  });

  warningsByKey.forEach((warning, key) => {
    const matches = acceptancesByKey.get(key) || [];
    if (matches.length === 0) {
      errors.push(`Thiếu xác nhận SoD cho ${warning.ruleCode} tại ${warning.scopeType}/${warning.scopeId}.`);
      return;
    }
    if (matches.length > 1) {
      errors.push(`Chỉ được có một xác nhận SoD cho ${warning.ruleCode} tại ${warning.scopeType}/${warning.scopeId}.`);
      return;
    }

    const acceptance = matches[0];
    if (acceptance.reason.trim().length < 10) {
      errors.push(`Lý do xác nhận SoD cho ${warning.ruleCode} phải có ít nhất 10 ký tự.`);
    }
    if (acceptance.compensatingControls.trim().length < 10) {
      errors.push(`Biện pháp kiểm soát cho ${warning.ruleCode} phải có ít nhất 10 ký tự.`);
    }
    if (!acceptance.controlOwnerUserId.trim()) {
      errors.push(`Chưa chọn người kiểm soát cho ${warning.ruleCode}.`);
    }
    const expiresAt = acceptance.expiresAt ? new Date(acceptance.expiresAt).getTime() : Number.NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      errors.push(`Xác nhận SoD cho ${warning.ruleCode} cần ngày hết hạn trong tương lai.`);
    }
  });

  acceptancesByKey.forEach((matches, key) => {
    if (!warningsByKey.has(key)) {
      matches.forEach(acceptance => {
        errors.push(`Xác nhận SoD ${acceptance.ruleCode} không thuộc kết quả preview hiện tại.`);
      });
    }
  });

  return errors;
};
