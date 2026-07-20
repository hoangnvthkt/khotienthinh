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
import { getPermissionApplications, getPermissionModules } from './permissionRegistry';
import type {
  LegacyPermissionState,
  PermissionActionReadiness,
  PermissionApplicationDefinition,
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

export interface CurrentPermissionOverviewRow {
  key: string;
  permissionCode: string;
  actionLabel: string;
  applicationCode: string;
  applicationLabel: string;
  moduleCode: string;
  moduleLabel: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  sourceTypes: EffectivePermissionSourceType[];
  sourceLabels: string[];
  canRevokeDirect: boolean;
}

export interface ApplicationAccessOverviewRow {
  applicationCode: string;
  applicationLabel: string;
  hasAccess: boolean;
  viewPermissionCount: number;
  actionPermissionCount: number;
  adminPermissionCount: number;
  sourceTypes: EffectivePermissionSourceType[];
}

const BUSINESS_PERMISSION_WORKBENCH_APPS: readonly {
  code: string;
  label: string;
  legacyModuleKey: string;
  sourceApplicationCode?: string;
}[] = [
  { code: 'wms', label: 'Vật tư', legacyModuleKey: 'WMS', sourceApplicationCode: 'wms' },
  { code: 'hrm', label: 'Nhân sự', legacyModuleKey: 'HRM', sourceApplicationCode: 'hrm' },
  { code: 'workflow', label: 'Quy trình', legacyModuleKey: 'WF', sourceApplicationCode: 'workflow' },
  { code: 'project', label: 'Dự án', legacyModuleKey: 'DA', sourceApplicationCode: 'project' },
  { code: 'procurement', label: 'Mua hàng', legacyModuleKey: 'PROCUREMENT' },
  { code: 'asset', label: 'Tài sản', legacyModuleKey: 'TS', sourceApplicationCode: 'asset' },
  { code: 'request', label: 'Yêu cầu', legacyModuleKey: 'RQ', sourceApplicationCode: 'request' },
  { code: 'expense', label: 'Chi phí', legacyModuleKey: 'EX', sourceApplicationCode: 'expense' },
  { code: 'storage', label: 'Kho dữ liệu', legacyModuleKey: 'STORAGE', sourceApplicationCode: 'storage' },
  { code: 'kb', label: 'Kho Kiến Thức', legacyModuleKey: 'KB', sourceApplicationCode: 'kb' },
  { code: 'ai', label: 'Trợ lý AI', legacyModuleKey: 'AI', sourceApplicationCode: 'ai' },
  { code: 'ep', label: 'Hồ sơ NV', legacyModuleKey: 'EP' },
  { code: 'contract', label: 'Hợp đồng', legacyModuleKey: 'HD', sourceApplicationCode: 'contract' },
  { code: 'tender_ai', label: 'Tender AI', legacyModuleKey: 'TENDER_AI' },
];

const SOURCE_TYPE_ORDER: Record<EffectivePermissionSourceType, number> = {
  ROLE: 0,
  DIRECT: 1,
  LEGACY: 2,
};

const uniqueSourceTypes = (sources: readonly EffectivePermissionSource[]): EffectivePermissionSourceType[] =>
  [...new Set(sources.map(source => source.sourceType))]
    .sort((left, right) => SOURCE_TYPE_ORDER[left] - SOURCE_TYPE_ORDER[right]);

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
      const hasSiblingActionGrant = input.grants.some(grant =>
        grant.userId === input.targetUserId
        && moduleCodes.has(grant.permissionCode)
        && grant.permissionCode !== action.permissionCode
        && grantMatchesScope(grant, scope)
        && grant.isActive !== false
      );
      if (hasSiblingActionGrant) return [...input.grants];
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

export const revokeUnifiedModuleDirectGrants = (input: {
  module: PermissionModuleDefinition;
  grants: readonly UserPermissionGrant[];
  targetUserId: string;
  scope: PermissionScope;
}): UserPermissionGrant[] => {
  const scope = normalizeScope(input.scope);
  const moduleCodes = new Set(input.module.actions.map(candidate => candidate.permissionCode));
  return input.grants.filter(grant => !(
    grant.userId === input.targetUserId
    && moduleCodes.has(grant.permissionCode)
    && grantMatchesScope(grant, scope)
  ));
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
  if (state.allowedModules.includes(legacyModuleKey) || state.adminModules.includes(legacyModuleKey)) {
    return true;
  }
  return (state.allowedSubModules[legacyModuleKey] || []).includes(route)
    || (state.adminSubModules[legacyModuleKey] || []).includes(route);
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
      allowedSubModules: withoutMapKey(state.allowedSubModules, legacyModuleKey),
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
  const hasFullModuleView = state.allowedModules.includes(legacyModuleKey);
  const currentRoutes = hasFullModuleView
    ? normalizedKnownRoutes
    : sortedUnique(state.allowedSubModules[legacyModuleKey] || []);
  const nextRoutes = sortedUnique(
    checked
      ? [...currentRoutes, route]
      : currentRoutes.filter(candidate => candidate !== route),
  );
  const hasEveryKnownRoute = normalizedKnownRoutes.length > 0
    && normalizedKnownRoutes.every(candidate => nextRoutes.includes(candidate));
  const allowedModules = hasEveryKnownRoute
    ? [...state.allowedModules, legacyModuleKey]
    : state.allowedModules.filter(key => key !== legacyModuleKey);
  const allowedSubModules = hasEveryKnownRoute || nextRoutes.length === 0
    ? withoutMapKey(state.allowedSubModules, legacyModuleKey)
    : { ...state.allowedSubModules, [legacyModuleKey]: nextRoutes };

  return normalizeLegacyState({
    ...state,
    allowedModules,
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

const LEGACY_ROUTE_LABELS = new Map<string, string>([
  ['/dashboard', 'Dashboard kho'],
  ['/requests', 'Đề xuất vật tư'],
  ['/material-code-requests', 'Đề xuất cấp mã'],
  ['/inventory', 'Kho & Vật tư'],
  ['/operations', 'Nhập / Xuất'],
  ['/audit', 'Kiểm kê'],
  ['/reports', 'Báo cáo WMS'],
  ['/misa-export', 'Đồng bộ MISA'],
  ['/hrm/dashboard', 'Dashboard NS'],
  ['/hrm/checkin', 'Check-in'],
  ['/hrm/employees', 'Hồ sơ nhân sự'],
  ['/hrm/attendance', 'Chấm công'],
  ['/hrm/shifts', 'Ca làm việc'],
  ['/hrm/leave', 'Nghỉ phép'],
  ['/hrm/payroll', 'Bảng lương'],
  ['/hrm/contracts', 'Hợp đồng LĐ'],
  ['/hrm/documents', 'Hồ sơ & Công văn'],
  ['/hrm/reports', 'Báo cáo NS'],
  ['/hrm/ranking', 'Xếp hạng NV'],
  ['/wf/dashboard', 'Dashboard QT'],
  ['/wf', 'Quy trình'],
  ['/wf/instances/:id', 'Chi tiết quy trình'],
  ['/wf/templates', 'Mẫu quy trình'],
  ['/wf/builder/:id', 'Thiết kế quy trình'],
  ['/da', 'Tổng quan DA'],
  ['/da/portfolio', 'Đa dự án'],
  ['/procurement', 'Mua hàng công ty'],
  ['/ts/dashboard', 'Dashboard TS'],
  ['/ts/catalog', 'Danh mục tài sản'],
  ['/ts/assignment', 'Cấp phát / Thu hồi'],
  ['/ts/maintenance', 'Bảo trì / Sửa chữa'],
  ['/ts/audit', 'Kiểm kê TS'],
  ['/ts/reports', 'Báo cáo TS'],
  ['/ts/asset/:id', 'Hồ sơ tài sản'],
  ['/rq/dashboard', 'Dashboard RQ'],
  ['/rq', 'Phiếu yêu cầu'],
  ['/rq/categories', 'Danh mục yêu cầu'],
  ['/expense', 'Kế hoạch chi phí'],
  ['/ep', 'Tra cứu nhân viên'],
  ['/ep/:employeeId', 'Hồ sơ nhân viên'],
  ['/hd', 'Hợp đồng'],
  ['/hd/overview', 'Tổng quan HĐ'],
  ['/hd/partners', 'Đối tác'],
  ['/hd/contract-types', 'Loại HĐ & Mẫu'],
  ['/hd/catalogs', 'Danh mục hợp đồng'],
  ['/hd/cost-library', 'Thư viện đơn giá'],
  ['/hd/supplier', 'HĐ Nhà cung cấp'],
  ['/hd/customer', 'HĐ Nhận thầu'],
  ['/hd/customer/:id', 'Chi tiết HĐ nhận thầu'],
  ['/hd/subcontractor', 'HĐ Thầu phụ'],
  ['/hd/subcontractor/:id', 'Chi tiết HĐ thầu phụ'],
  ['/tender-ai', 'Tender AI'],
  ['/tender-ai/boq', 'AI BOQ CĐT'],
  ['/tender-ai/cost-library', 'Dự toán nội bộ'],
  ['/storage', 'Kho dữ liệu'],
  ['/knowledge-base', 'Kho Kiến Thức'],
  ['/ai', 'Trợ lý AI'],
  ['/ai/executive', 'Ban Giám Đốc'],
  ['/ai/reports', 'Báo cáo AI'],
  ['/org-map', 'Sơ đồ tổ chức'],
]);

const routeLabel = (route: string, fallback: string): string =>
  PROJECT_ROUTE_LABELS.get(route)
  || SETTINGS_ROUTE_LABELS.get(route)
  || LEGACY_ROUTE_LABELS.get(route)
  || fallback;

export const buildPermissionWorkbenchApplications = (): PermissionApplicationDefinition[] => {
  const applications = getPermissionApplications();
  const modules = getPermissionModules();

  return BUSINESS_PERMISSION_WORKBENCH_APPS
    .map(spec => {
      const sourceApplication = spec.sourceApplicationCode
        ? applications.find(application => application.code === spec.sourceApplicationCode)
        : undefined;
      const sourceModules = sourceApplication
        ? [...sourceApplication.modules]
        : modules.filter(module => module.legacyModuleKey === spec.legacyModuleKey);

      return {
        code: spec.code,
        label: spec.label,
        sortOrder: sourceApplication?.sortOrder,
        modules: sourceModules
          .map(module => ({ ...module }))
          .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.label.localeCompare(right.label)),
      };
    })
    .filter(application => application.modules.length > 0);
};

const findWorkbenchLocation = (
  permissionCode: string,
  applications: readonly PermissionApplicationDefinition[],
) => {
  for (const application of applications) {
    for (const module of application.modules) {
      const action = module.actions.find(candidate => candidate.permissionCode === permissionCode);
      if (!action) continue;
      return { application, module, action };
    }
  }
  return null;
};

export const buildApplicationAccessOverview = (input: {
  effectiveSources: readonly EffectivePermissionSource[];
  applications?: readonly PermissionApplicationDefinition[];
}): ApplicationAccessOverviewRow[] => {
  const applications = input.applications || buildPermissionWorkbenchApplications();

  return applications
    .map(application => {
      const actionCodes = new Set(application.modules.flatMap(module => module.actions.map(action => action.permissionCode)));
      const actionsByCode = new Map(application.modules.flatMap(module =>
        module.actions.map(action => [action.permissionCode, action] as const)
      ));
      const sources = input.effectiveSources.filter(source => actionCodes.has(source.permissionCode));
      const viewSources = sources.filter(source => actionsByCode.get(source.permissionCode)?.action === 'view');
      const adminSources = sources.filter(source => actionsByCode.get(source.permissionCode)?.permissionGroup === 'admin');
      const actionSources = sources.filter(source => {
        const action = actionsByCode.get(source.permissionCode);
        return Boolean(action && action.action !== 'view' && action.permissionGroup !== 'admin');
      });

      return {
        applicationCode: application.code,
        applicationLabel: application.label,
        hasAccess: viewSources.length > 0,
        viewPermissionCount: viewSources.length,
        actionPermissionCount: actionSources.length,
        adminPermissionCount: adminSources.length,
        sourceTypes: uniqueSourceTypes(sources),
      };
    })
    .sort((left, right) => left.applicationLabel.localeCompare(right.applicationLabel) || left.applicationCode.localeCompare(right.applicationCode));
};

export const buildCurrentPermissionOverview = (input: {
  directGrants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  applications?: readonly PermissionApplicationDefinition[];
}): CurrentPermissionOverviewRow[] => {
  const applications = input.applications || buildPermissionWorkbenchApplications();
  const rows = new Map<string, {
    row: CurrentPermissionOverviewRow;
    sourceSet: Set<EffectivePermissionSourceType>;
    sourceLabels: Set<string>;
  }>();

  const ensure = (
    permissionCode: string,
    scopeType: PermissionScopeType,
    scopeId: string,
  ) => {
    const location = findWorkbenchLocation(permissionCode, applications);
    if (!location) return null;
    const key = `${permissionCode}::${scopeType}::${scopeId}`;
    const current = rows.get(key);
    if (current) return current;

    const created = {
      row: {
        key,
        permissionCode,
        actionLabel: location.action.label,
        applicationCode: location.application.code,
        applicationLabel: location.application.label,
        moduleCode: location.module.code,
        moduleLabel: location.module.label,
        scopeType,
        scopeId,
        sourceTypes: [],
        sourceLabels: [],
        canRevokeDirect: false,
      },
      sourceSet: new Set<EffectivePermissionSourceType>(),
      sourceLabels: new Set<string>(),
    };
    rows.set(key, created);
    return created;
  };

  input.effectiveSources.forEach(source => {
    const row = ensure(source.permissionCode, source.scopeType, source.scopeId);
    if (!row) return;
    row.sourceSet.add(source.sourceType);
    buildPermissionSourceBadges([source]).forEach(badge => row.sourceLabels.add(badge.label));
  });

  input.directGrants
    .filter(grant => grant.isActive !== false)
    .forEach(grant => {
      const row = ensure(grant.permissionCode, grant.scopeType || 'global', grant.scopeId || '*');
      if (!row) return;
      row.sourceSet.add('DIRECT');
      row.sourceLabels.add('Direct');
      row.row.canRevokeDirect = true;
    });

  const applicationOrder = new Map(applications.map((application, index) => [application.code, index]));
  const moduleOrder = new Map<string, number>();
  const actionOrder = new Map<string, number>();
  applications.forEach(application => {
    application.modules.forEach(module => {
      moduleOrder.set(module.code, module.sortOrder || 0);
      module.actions.forEach(action => actionOrder.set(action.permissionCode, action.sortOrder || 0));
    });
  });

  return [...rows.values()]
    .map(value => ({
      ...value.row,
      sourceTypes: [...value.sourceSet].sort((left, right) => SOURCE_TYPE_ORDER[left] - SOURCE_TYPE_ORDER[right]),
      sourceLabels: [...value.sourceLabels].sort(),
    }))
    .sort((left, right) =>
      (applicationOrder.get(left.applicationCode) || 0) - (applicationOrder.get(right.applicationCode) || 0)
      || (moduleOrder.get(left.moduleCode) || 0) - (moduleOrder.get(right.moduleCode) || 0)
      || (actionOrder.get(left.permissionCode) || 0) - (actionOrder.get(right.permissionCode) || 0)
      || left.permissionCode.localeCompare(right.permissionCode)
      || left.scopeType.localeCompare(right.scopeType)
      || left.scopeId.localeCompare(right.scopeId)
    );
};

export const getDirectGrantRevokeDraft = (input: {
  grants: readonly UserPermissionGrant[];
  targetUserId: string;
  permissionCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
}): UserPermissionGrant[] => input.grants.filter(grant => !(
  grant.userId === input.targetUserId
  && grant.permissionCode === input.permissionCode
  && grant.scopeType === input.scopeType
  && grant.scopeId === input.scopeId
));

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
