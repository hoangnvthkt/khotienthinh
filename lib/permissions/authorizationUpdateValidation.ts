import { UserPermissionGrant } from '../../types';
import {
  PermissionAdminCatalog,
  PermissionCatalogAction,
  PermissionScopeType,
} from './permissionTypes';

export interface AuthorizationValidationIssue {
  code:
    | 'reason_required'
    | 'reason_too_short'
    | 'duplicate_grant'
    | 'unknown_permission'
    | 'direct_grant_denied'
    | 'scope_denied'
    | 'scope_required'
    | 'expiry_invalid'
    | 'expiry_required';
  message: string;
  field: 'reason' | 'permissionCode' | 'scopeType' | 'scopeId' | 'expiresAt';
  permissionCode?: string;
}

export class AuthorizationCommandError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly permissionCode?: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'AuthorizationCommandError';
  }
}

interface ValidationInput {
  changed: boolean;
  reason: string;
  grants: readonly UserPermissionGrant[];
  originalGrants?: readonly UserPermissionGrant[];
  catalog: PermissionAdminCatalog;
  now?: Date;
}

interface RpcErrorLike {
  code?: string;
  message?: string;
  details?: unknown;
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

const catalogActions = (catalog: PermissionAdminCatalog): Map<string, PermissionCatalogAction> =>
  new Map(catalog.applications.flatMap(application =>
    application.modules.flatMap(module => module.actions)
  ).map(action => [action.permissionCode, action]));

const grantKey = (grant: UserPermissionGrant): string => [
  grant.permissionCode,
  grant.scopeType || 'global',
  grant.scopeId || '*',
].join('::');

const retainedGrantFingerprint = (grant: UserPermissionGrant): string => {
  const parsedExpiry = grant.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN;
  const normalizedExpiry = grant.expiresAt && !Number.isNaN(parsedExpiry)
    ? new Date(parsedExpiry).toISOString()
    : grant.expiresAt || '';
  return `${grantKey(grant)}::${normalizedExpiry}`;
};

export const getRetainedHiddenGrants = ({
  grants,
  originalGrants,
  catalog,
}: {
  grants: readonly UserPermissionGrant[];
  originalGrants: readonly UserPermissionGrant[];
  catalog: PermissionAdminCatalog;
}): UserPermissionGrant[] => {
  const visiblePermissionCodes = new Set(catalogActions(catalog).keys());
  const originalFingerprints = new Set(originalGrants
    .filter(grant => grant.isActive !== false)
    .map(retainedGrantFingerprint));
  return grants.filter(grant =>
    grant.isActive !== false
    && !visiblePermissionCodes.has(grant.permissionCode)
    && originalFingerprints.has(retainedGrantFingerprint(grant))
  );
};

export const getCatalogEditableGrants = ({
  grants,
  catalog,
}: {
  grants: readonly UserPermissionGrant[];
  catalog: PermissionAdminCatalog;
}): UserPermissionGrant[] => {
  const visiblePermissionCodes = new Set(catalogActions(catalog).keys());
  return grants.filter(grant =>
    grant.isActive !== false && visiblePermissionCodes.has(grant.permissionCode)
  );
};

export const validateAuthorizationUpdate = ({
  changed,
  reason,
  grants,
  originalGrants = [],
  catalog,
  now = new Date(),
}: ValidationInput): AuthorizationValidationIssue[] => {
  if (!changed) return [];

  const issues: AuthorizationValidationIssue[] = [];
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    issues.push({
      code: 'reason_required',
      field: 'reason',
      message: 'Vui lòng nhập lý do thay đổi.',
    });
  } else if (normalizedReason.length < 10) {
    issues.push({
      code: 'reason_too_short',
      field: 'reason',
      message: 'Lý do thay đổi phải có ít nhất 10 ký tự.',
    });
  }

  const actions = catalogActions(catalog);
  const retainedOriginalFingerprints = new Set(originalGrants
    .filter(grant => grant.isActive !== false)
    .map(retainedGrantFingerprint));
  const seen = new Set<string>();
  grants.filter(grant => grant.isActive !== false).forEach(grant => {
    const key = grantKey(grant);
    if (seen.has(key)) {
      issues.push({
        code: 'duplicate_grant',
        field: 'permissionCode',
        permissionCode: grant.permissionCode,
        message: `Quyền ${grant.permissionCode} bị trùng cùng phạm vi.`,
      });
      return;
    }
    seen.add(key);

    const action = actions.get(grant.permissionCode);
    if (!action) {
      if (retainedOriginalFingerprints.has(retainedGrantFingerprint(grant))) return;
      issues.push({
        code: 'unknown_permission',
        field: 'permissionCode',
        permissionCode: grant.permissionCode,
        message: `Quyền ${grant.permissionCode} không còn trong danh mục hiện hành.`,
      });
      return;
    }
    if (!action.directGrantAllowed) {
      issues.push({
        code: 'direct_grant_denied',
        field: 'permissionCode',
        permissionCode: grant.permissionCode,
        message: `Quyền ${action.label} chỉ được cấp qua template nghiệp vụ.`,
      });
    }

    const scopeType = grant.scopeType || 'global';
    const scopeId = grant.scopeId || '*';
    if (!action.scopeTypes.includes(scopeType)) {
      issues.push({
        code: 'scope_denied',
        field: 'scopeType',
        permissionCode: grant.permissionCode,
        message: `Quyền ${action.label} không hỗ trợ phạm vi đã chọn.`,
      });
    } else if (ENTITY_SCOPE_TYPES.has(scopeType) && (!scopeId.trim() || scopeId === '*')) {
      issues.push({
        code: 'scope_required',
        field: 'scopeId',
        permissionCode: grant.permissionCode,
        message: `Quyền ${action.label} cần một phạm vi cụ thể.`,
      });
    } else if (!ENTITY_SCOPE_TYPES.has(scopeType) && scopeId !== '*') {
      issues.push({
        code: 'scope_denied',
        field: 'scopeId',
        permissionCode: grant.permissionCode,
        message: `Phạm vi ${scopeType} phải dùng mã mặc định *.`,
      });
    }

    const expiry = grant.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN;
    if (grant.expiresAt && (Number.isNaN(expiry) || expiry <= now.getTime())) {
      issues.push({
        code: 'expiry_invalid',
        field: 'expiresAt',
        permissionCode: grant.permissionCode,
        message: `Ngày hết hạn của quyền ${action.label} phải ở tương lai.`,
      });
    } else if (action.directGrantRequiresExpiry && !grant.expiresAt) {
      issues.push({
        code: 'expiry_required',
        field: 'expiresAt',
        permissionCode: grant.permissionCode,
        message: `Quyền ${action.label} cần ngày hết hạn trong tương lai.`,
      });
    }
  });

  return issues;
};

const parseDetails = (details: unknown): Record<string, unknown> | null => {
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return details as Record<string, unknown>;
  }
  if (typeof details !== 'string' || !details.trim()) return null;
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

export const mapAuthorizationRpcError = (error: RpcErrorLike): AuthorizationCommandError => {
  const details = parseDetails(error.details);
  if (details && typeof details.code === 'string') {
    return new AuthorizationCommandError(
      typeof details.message === 'string'
        ? details.message
        : 'Dữ liệu phân quyền không hợp lệ.',
      details.code,
      typeof details.permissionCode === 'string' ? details.permissionCode : undefined,
      typeof details.field === 'string' ? details.field : undefined,
    );
  }

  if (error.code === '40001' || /changed after it was loaded|stale/i.test(error.message || '')) {
    return new AuthorizationCommandError(
      'Thông tin người dùng đã thay đổi. Vui lòng tải lại và đối chiếu trước khi lưu.',
      'stale_version',
      undefined,
      'version',
    );
  }
  if (/reason/i.test(error.message || '')) {
    return new AuthorizationCommandError(
      'Lý do thay đổi phải có ít nhất 10 ký tự.',
      'reason_too_short',
      undefined,
      'reason',
    );
  }
  if (/duplicate direct permission grant/i.test(error.message || '')) {
    return new AuthorizationCommandError(
      'Danh sách quyền có mục bị trùng cùng phạm vi.',
      'duplicate_grant',
      undefined,
      'permissionCode',
    );
  }
  return new AuthorizationCommandError(
    'Không thể lưu phân quyền. Vui lòng kiểm tra lại các quyền và phạm vi đã chọn.',
    error.code || 'authorization_update_failed',
  );
};
