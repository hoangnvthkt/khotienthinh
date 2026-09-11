import { isSupabaseConfigured, supabase } from '../supabase';
import {
  PermissionAdminCatalog,
  PermissionCatalogAction,
  PermissionCatalogApplication,
  PermissionCatalogModule,
  PermissionGrantReadiness,
  PermissionRiskLevel,
  PermissionScopeType,
} from './permissionTypes';

interface PermissionCatalogRpcError {
  message?: string;
}

export interface PermissionCatalogGateway {
  rpc: (functionName: string) => PromiseLike<{
    data: unknown;
    error: PermissionCatalogRpcError | null;
  }>;
}

const SCOPE_TYPES = new Set<PermissionScopeType>([
  'global',
  'own',
  'assigned',
  'project',
  'construction_site',
  'warehouse',
  'department',
  'direct_reports',
  'org_unit',
  'work_workspace',
]);
const RISK_LEVELS = new Set<PermissionRiskLevel>(['normal', 'important', 'sensitive']);
const GRANT_READINESS = new Set<PermissionGrantReadiness>([
  'legacy',
  'declared',
  'enforced',
  'verified',
]);

const invalidCatalog = (): never => {
  throw new Error('Catalog phân quyền không hợp lệ. Vui lòng tải lại.');
};

const assertCatalog: (condition: unknown) => asserts condition = (condition) => {
  if (!condition) invalidCatalog();
};

const objectValue = (value: unknown): Record<string, unknown> => {
  assertCatalog(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown): string => {
  assertCatalog(typeof value === 'string' && Boolean(value.trim()));
  return value;
};

const optionalString = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  return requiredString(value);
};

const numberValue = (value: unknown): number => {
  assertCatalog(typeof value === 'number' && Number.isFinite(value));
  return value;
};

const booleanValue = (value: unknown): boolean => {
  assertCatalog(typeof value === 'boolean');
  return value;
};

const parseAction = (value: unknown): PermissionCatalogAction => {
  const row = objectValue(value);
  assertCatalog(Array.isArray(row.scopeTypes) && row.scopeTypes.length > 0);
  const scopeTypes = row.scopeTypes.map(scope => {
    if (typeof scope !== 'string' || !SCOPE_TYPES.has(scope as PermissionScopeType)) invalidCatalog();
    return scope as PermissionScopeType;
  });
  const riskLevel = requiredString(row.riskLevel) as PermissionRiskLevel;
  const grantReadiness = requiredString(row.grantReadiness) as PermissionGrantReadiness;
  if (!RISK_LEVELS.has(riskLevel) || !GRANT_READINESS.has(grantReadiness)) invalidCatalog();

  const isDefaultView = booleanValue(row.isDefaultView);
  const defaultScopeType = optionalString(row.defaultScopeType) as PermissionScopeType | undefined;
  const directGrantAllowed = booleanValue(row.directGrantAllowed);
  const directGrantRequiresExpiry = booleanValue(row.directGrantRequiresExpiry);
  if (isDefaultView && (
    !defaultScopeType
    || !scopeTypes.includes(defaultScopeType)
    || !directGrantAllowed
    || directGrantRequiresExpiry
  )) invalidCatalog();

  return {
    action: requiredString(row.action),
    label: requiredString(row.label),
    permissionCode: requiredString(row.permissionCode),
    description: optionalString(row.description),
    scopeTypes,
    sortOrder: numberValue(row.sortOrder),
    riskLevel,
    grantReadiness,
    directGrantAllowed,
    directGrantRequiresExpiry,
    isDefaultView,
    defaultScopeType,
  };
};

const parseModule = (value: unknown, seenPermissionCodes: Set<string>): PermissionCatalogModule => {
  const row = objectValue(value);
  assertCatalog(Array.isArray(row.actions) && row.actions.length > 0);
  const actions = row.actions.map(parseAction);
  actions.forEach(action => {
    if (seenPermissionCodes.has(action.permissionCode)) invalidCatalog();
    seenPermissionCodes.add(action.permissionCode);
  });
  return {
    code: requiredString(row.code),
    label: requiredString(row.label),
    description: optionalString(row.description),
    sortOrder: numberValue(row.sortOrder),
    actions,
  };
};

const parseApplication = (
  value: unknown,
  seenPermissionCodes: Set<string>,
): PermissionCatalogApplication => {
  const row = objectValue(value);
  assertCatalog(Array.isArray(row.modules) && row.modules.length > 0);
  const seenModules = new Set<string>();
  const modules = row.modules.map(moduleValue => {
    const module = parseModule(moduleValue, seenPermissionCodes);
    if (seenModules.has(module.code)) invalidCatalog();
    seenModules.add(module.code);
    return module;
  });
  return {
    code: requiredString(row.code),
    label: requiredString(row.label),
    description: optionalString(row.description),
    sortOrder: numberValue(row.sortOrder),
    hasDefaultViewBundle: booleanValue(row.hasDefaultViewBundle),
    modules,
  };
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(child => {
      if (child && typeof child === 'object') deepFreeze(child);
    });
  }
  return value;
};

export const parsePermissionAdminCatalog = (value: unknown): PermissionAdminCatalog => {
  const row = objectValue(value);
  const generatedAt = requiredString(row.generatedAt);
  assertCatalog(!Number.isNaN(Date.parse(generatedAt)) && Array.isArray(row.applications));

  const seenApplications = new Set<string>();
  const seenPermissionCodes = new Set<string>();
  const applications = row.applications.map(applicationValue => {
    const application = parseApplication(applicationValue, seenPermissionCodes);
    if (seenApplications.has(application.code)) invalidCatalog();
    seenApplications.add(application.code);
    return application;
  });

  return deepFreeze({ generatedAt, applications });
};

export const listPermissionAdminCatalog = async (
  gateway: PermissionCatalogGateway = supabase as unknown as PermissionCatalogGateway,
): Promise<PermissionAdminCatalog> => {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase chưa được cấu hình.');
  }
  const { data, error } = await gateway.rpc('get_permission_admin_catalog');
  if (error) {
    throw new Error(`Không tải được catalog phân quyền: ${error.message || 'Lỗi không xác định'}`);
  }
  return parsePermissionAdminCatalog(data);
};

export const isCatalogActionDirectGrantAllowed = (
  action: PermissionCatalogAction,
): boolean => action.directGrantAllowed;
