import { ROUTE_TO_MODULE } from '../../constants/routes';
import {
  PermissionActionDefinition,
  PermissionApplicationDefinition,
  PermissionModuleDefinition,
} from './permissionTypes';
import { ERP_PERMISSION_APPLICATIONS } from './erpPermissionRegistry';
import { PROJECT_PERMISSION_MODULES } from './projectPermissionRegistry';
import { resolvePermissionRiskMetadata } from './permissionRisk';

const moduleLabels: Record<string, string> = {
  WMS: 'Kho vật tư',
  HRM: 'Nhân sự',
  WF: 'Quy trình',
  DA: 'Dự án',
  PROCUREMENT: 'Mua hàng',
  TS: 'Tài sản',
  RQ: 'Yêu cầu',
  EX: 'Ngân sách',
  EP: 'Hồ sơ nhân sự',
  HD: 'Hợp đồng',
  TENDER_AI: 'Tender AI',
  CHAT: 'Tin nhắn',
  SETTINGS: 'Cài đặt',
  STORAGE: 'Lưu trữ',
  KB: 'Kho tri thức',
  AI: 'AI',
  AUDIT_TRAIL: 'Nhật ký hệ thống',
  ANALYTICS: 'Phân tích',
  CUSTOM_DASHBOARD: 'Dashboard tùy chỉnh',
};

const moduleSortOrder = [
  'WMS',
  'HRM',
  'WF',
  'DA',
  'PROCUREMENT',
  'TS',
  'RQ',
  'EX',
  'EP',
  'HD',
  'TENDER_AI',
  'CHAT',
  'SETTINGS',
  'STORAGE',
  'KB',
  'AI',
  'AUDIT_TRAIL',
  'ANALYTICS',
  'CUSTOM_DASHBOARD',
];

const toSnakeCode = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '_');

const routesByLegacyModule = Object.entries(ROUTE_TO_MODULE).reduce<Record<string, string[]>>((acc, [route, moduleKey]) => {
  acc[moduleKey] = [...(acc[moduleKey] || []), route];
  return acc;
}, {});

const baseActions = (legacyModuleKey: string): readonly PermissionActionDefinition[] => {
  const code = toSnakeCode(legacyModuleKey);
  const moduleCode = `system.${code}`;
  return [
    {
      action: 'view',
      label: 'Xem',
      permissionCode: `${moduleCode}.view`,
      ...resolvePermissionRiskMetadata(moduleCode, 'view'),
      legacyModuleKey,
      scopeTypes: ['global'],
      sortOrder: 10,
    },
    {
      action: 'manage',
      label: 'Quản trị',
      permissionCode: `${moduleCode}.manage`,
      ...resolvePermissionRiskMetadata(moduleCode, 'manage'),
      legacyModuleKey,
      legacyAdminOnly: true,
      scopeTypes: ['global'],
      sortOrder: 20,
    },
  ];
};

const routeSystemModules: readonly PermissionModuleDefinition[] = moduleSortOrder
  .filter(moduleKey => Boolean(routesByLegacyModule[moduleKey]))
  .map((moduleKey, index) => ({
    code: `system.${toSnakeCode(moduleKey)}`,
    label: moduleLabels[moduleKey] || moduleKey,
    routes: routesByLegacyModule[moduleKey],
    legacyModuleKey: moduleKey,
    sortOrder: (index + 1) * 10,
    actions: baseActions(moduleKey),
  }));

const governanceAction = (
  action: string,
  label: string,
  sortOrder: number,
): PermissionActionDefinition => ({
  action,
  label,
  permissionCode: `system.authorization.${action}`,
  ...resolvePermissionRiskMetadata('system.authorization', action),
  legacyModuleKey: 'SETTINGS',
  legacyRoute: '/settings',
  legacyAdminOnly: true,
  scopeTypes: ['global'],
  sortOrder,
});

const authorizationModule: PermissionModuleDefinition = {
  code: 'system.authorization',
  label: 'Quản trị phân quyền',
  description: 'Business Role, direct grant, SoD và audit phân quyền',
  routes: ['/settings'],
  legacyModuleKey: 'SETTINGS',
  sortOrder: 135,
  actions: [
    governanceAction('view', 'Xem quản trị phân quyền', 10),
    governanceAction('manage_roles', 'Quản lý Business Role', 20),
    governanceAction('manage_grants', 'Quản lý quyền trực tiếp', 30),
    governanceAction('manage_scopes', 'Quản lý phân công theo scope', 40),
    governanceAction('audit', 'Xem audit phân quyền', 50),
    governanceAction('override', 'Ghi nhận override được phép', 60),
  ],
};

const systemModules: readonly PermissionModuleDefinition[] = [
  ...routeSystemModules,
  authorizationModule,
];

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(child => {
      if (child && typeof child === 'object') deepFreeze(child);
    });
  }
  return value;
};

export const permissionRegistry = deepFreeze([
  {
    code: 'system',
    label: 'Hệ thống ERP',
    sortOrder: 10,
    modules: systemModules,
  },
  {
    code: 'project',
    label: 'Dự án',
    sortOrder: 20,
    modules: PROJECT_PERMISSION_MODULES,
  },
  ...ERP_PERMISSION_APPLICATIONS,
] satisfies readonly PermissionApplicationDefinition[]);

export const getPermissionApplications = (): readonly PermissionApplicationDefinition[] => permissionRegistry;

export const getPermissionModules = (): readonly PermissionModuleDefinition[] =>
  permissionRegistry.flatMap(application => application.modules);

export const getAllPermissionActions = (): readonly PermissionActionDefinition[] =>
  getPermissionModules().flatMap(module => module.actions);

export const getPermissionRoutes = (): readonly string[] => [
  ...new Set(getPermissionModules().flatMap(module => module.routes || [])),
];

export const getPermissionActionByCode = (permissionCode: string): PermissionActionDefinition | undefined =>
  getAllPermissionActions().find(action => action.permissionCode === permissionCode);

export const getPermissionModuleByCode = (moduleCode: string): PermissionModuleDefinition | undefined =>
  getPermissionModules().find(module => module.code === moduleCode);

export const getPermissionModulesByLegacyKey = (legacyModuleKey: string): readonly PermissionModuleDefinition[] =>
  getPermissionModules().filter(module => module.legacyModuleKey === legacyModuleKey);

export const getPrimaryViewPermissionForModule = (moduleCodeOrLegacyKey: string): PermissionActionDefinition | undefined => {
  const directModule = getPermissionModuleByCode(moduleCodeOrLegacyKey);
  const legacyModule = getPermissionModulesByLegacyKey(moduleCodeOrLegacyKey)[0];
  const module = directModule || legacyModule;
  return module?.actions.find(action => action.action === 'view');
};
