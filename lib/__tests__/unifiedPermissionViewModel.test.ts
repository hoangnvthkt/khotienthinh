import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import { getPermissionModuleByCode } from '../permissions/permissionRegistry';
import {
  buildCurrentPermissionOverview,
  buildLegacyPermissionCatalog,
  buildPermissionWorkbenchApplications,
  buildUnifiedPermissionDraftKey,
  buildUnifiedPermissionRows,
  isLegacyRouteVisible,
  revokeLegacyUmbrella,
  revokeUnifiedModuleDirectGrants,
  toggleLegacyModuleView,
  toggleLegacyRouteView,
  toggleUnifiedDirectGrant,
} from '../permissions/unifiedPermissionViewModel';

const dailyLog = getPermissionModuleByCode('project.daily_log');
if (!dailyLog) throw new Error('Missing daily log fixture');
const hrmEmployee = getPermissionModuleByCode('hrm.employee');
if (!hrmEmployee) throw new Error('Missing HRM employee fixture');
const assetCatalog = getPermissionModuleByCode('asset.catalog');
if (!assetCatalog) throw new Error('Missing Asset catalog fixture');

const scope = { scopeType: 'project' as const, scopeId: 'project-1' };

const grant = (
  permissionCode: string,
  scopeId = 'project-1',
  overrides: Partial<UserPermissionGrant> = {},
): UserPermissionGrant => ({
  userId: 'user-1',
  permissionCode,
  scopeType: 'project',
  scopeId,
  ...overrides,
});

const source = (
  permissionCode: string,
  sourceType: EffectivePermissionSource['sourceType'],
  scopeType: EffectivePermissionSource['scopeType'] = 'project',
  scopeId = 'project-1',
): EffectivePermissionSource => ({
  permissionCode,
  sourceType,
  sourceId: sourceType.toLowerCase() + '-1',
  sourceCode: sourceType.toLowerCase(),
  sourceLabel: sourceType === 'ROLE' ? 'Nhật ký công trường' : sourceType,
  scopeType,
  scopeId,
  riskLevel: 'normal',
  isBusinessApproval: false,
  metadata: {},
});

describe('unified permission view model', () => {
  it('adds View in the same scope when Edit is granted', () => {
    const next = toggleUnifiedDirectGrant({
      module: dailyLog,
      grants: [],
      targetUserId: 'user-1',
      permissionCode: 'project.daily_log.edit_own',
      checked: true,
      scope,
    });

    expect(next.map(item => item.permissionCode).sort()).toEqual([
      'project.daily_log.edit_own',
      'project.daily_log.view',
    ]);
    expect(next.every(item => item.scopeType === 'project' && item.scopeId === 'project-1')).toBe(true);
  });

  it('keeps View when same-module same-scope Direct actions still exist', () => {
    const existing = [
      grant('project.daily_log.view'),
      grant('project.daily_log.edit_own'),
      grant('project.daily_log.edit_own', 'project-2'),
      grant('project.material_request.view'),
    ];
    const next = toggleUnifiedDirectGrant({
      module: dailyLog,
      grants: existing,
      targetUserId: 'user-1',
      permissionCode: 'project.daily_log.view',
      checked: false,
      scope,
    });

    expect(next).toEqual(existing);
  });

  it('explicitly revokes same-module same-scope Direct grants when bulk module revoke is requested', () => {
    const next = revokeUnifiedModuleDirectGrants({
      module: dailyLog,
      grants: [
        grant('project.daily_log.view'),
        grant('project.daily_log.edit_own'),
        grant('project.daily_log.edit_own', 'project-2'),
        grant('project.material_request.view'),
      ],
      targetUserId: 'user-1',
      scope,
    });

    expect(next.map(item => item.permissionCode + ':' + item.scopeId).sort()).toEqual([
      'project.daily_log.edit_own:project-2',
      'project.material_request.view:project-1',
    ]);
  });

  it('auto-adds Asset catalog View in the same scope when Create is granted', () => {
    const next = toggleUnifiedDirectGrant({
      module: assetCatalog,
      grants: [],
      targetUserId: 'user-1',
      permissionCode: 'asset.catalog.create',
      checked: true,
      scope: { scopeType: 'warehouse', scopeId: 'wh-1' },
    });

    expect(next.map(item => `${item.permissionCode}:${item.scopeType}:${item.scopeId}`).sort()).toEqual([
      'asset.catalog.create:warehouse:wh-1',
      'asset.catalog.view:warehouse:wh-1',
    ]);
  });

  it('adds a new Declared app action with View but still blocks legacy-only manage grants', () => {
    expect(toggleUnifiedDirectGrant({
      module: hrmEmployee,
      grants: [],
      targetUserId: 'user-1',
      permissionCode: 'hrm.employee.create',
      checked: true,
      scope: { scopeType: 'global', scopeId: '*' },
    }).map(item => item.permissionCode).sort()).toEqual([
      'hrm.employee.create',
      'hrm.employee.view',
    ]);

    expect(toggleUnifiedDirectGrant({
      module: dailyLog,
      grants: [],
      targetUserId: 'user-1',
      permissionCode: 'project.daily_log.manage',
      checked: true,
      scope,
    })).toEqual([]);

    const existing = grant('project.daily_log.manage');
    expect(toggleUnifiedDirectGrant({
      module: dailyLog,
      grants: [existing],
      targetUserId: 'user-1',
      permissionCode: existing.permissionCode,
      checked: false,
      scope,
    })).toEqual([]);
  });

  it('shows inherited sources as effective without checking Direct', () => {
    const rows = buildUnifiedPermissionRows({
      module: dailyLog,
      grants: [],
      effectiveSources: [
        source('project.daily_log.view', 'ROLE'),
        source('project.daily_log.view', 'LEGACY'),
      ],
      scope,
    });
    const view = rows.find(row => row.permissionCode === 'project.daily_log.view');

    expect(view).toMatchObject({
      hasDirectGrant: false,
      isEffective: true,
      sourceKinds: ['ROLE', 'LEGACY'],
    });
  });

  it('lets a global source cover a project navigation scope', () => {
    const rows = buildUnifiedPermissionRows({
      module: dailyLog,
      grants: [],
      effectiveSources: [source('project.daily_log.view', 'ROLE', 'global', '*')],
      scope,
    });

    expect(rows.find(row => row.permissionCode === 'project.daily_log.view')?.isEffective).toBe(true);
  });

  it('changes the preview key for principal, nested Legacy routes, grant scope, and expiry', () => {
    const legacy = {
      allowedModules: ['DA'],
      allowedSubModules: { DA: ['/da/daily-log'] },
      adminModules: [],
      adminSubModules: {},
    };
    const baseGrant = grant('project.daily_log.view');
    const baseline = buildUnifiedPermissionDraftKey('user-1', legacy, [baseGrant]);

    expect(buildUnifiedPermissionDraftKey('user-2', legacy, [baseGrant])).not.toBe(baseline);
    expect(buildUnifiedPermissionDraftKey('user-1', {
      ...legacy,
      allowedSubModules: { DA: ['/da/overview'] },
    }, [baseGrant])).not.toBe(baseline);
    expect(buildUnifiedPermissionDraftKey('user-1', legacy, [
      { ...baseGrant, scopeId: 'project-2' },
    ])).not.toBe(baseline);
    expect(buildUnifiedPermissionDraftKey('user-1', legacy, [
      { ...baseGrant, expiresAt: '2026-10-01T00:00:00.000Z' },
    ])).not.toBe(baseline);

    expect(buildUnifiedPermissionDraftKey('user-1', {
      adminSubModules: {},
      adminModules: [],
      allowedSubModules: { DA: ['/da/daily-log'] },
      allowedModules: ['DA'],
    }, [baseGrant])).toBe(baseline);
  });

  it('treats a missing allowedSubModules key as all known routes', () => {
    const state = { allowedModules: ['WMS'], allowedSubModules: {}, adminModules: [], adminSubModules: {} };
    expect(isLegacyRouteVisible(state, 'WMS', '/requests')).toBe(true);
  });

  it('shows route-level Legacy grants even when the parent module is not fully granted', () => {
    const state = {
      allowedModules: [],
      allowedSubModules: { WMS: ['/requests'] },
      adminModules: [],
      adminSubModules: {},
    };

    expect(isLegacyRouteVisible(state, 'WMS', '/requests')).toBe(true);
    expect(isLegacyRouteVisible(state, 'WMS', '/inventory')).toBe(false);
  });

  it('removes one route by materializing the remaining known routes', () => {
    const state = { allowedModules: ['WMS'], allowedSubModules: {}, adminModules: [], adminSubModules: {} };
    expect(toggleLegacyRouteView(state, 'WMS', '/requests', false, ['/requests', '/inventory'])).toEqual({
      ...state,
      allowedModules: [],
      allowedSubModules: { WMS: ['/inventory'] },
    });
  });

  it('removes the route map when no route remains visible', () => {
    const state = {
      allowedModules: [],
      allowedSubModules: { WMS: ['/requests'] },
      adminModules: [],
      adminSubModules: {},
    };
    expect(toggleLegacyRouteView(state, 'WMS', '/requests', false, ['/requests'])).toEqual({
      allowedModules: [],
      allowedSubModules: {},
      adminModules: [],
      adminSubModules: {},
    });
  });

  it('deletes the route restriction when every known route is selected', () => {
    const state = {
      allowedModules: [],
      allowedSubModules: { WMS: ['/inventory'] },
      adminModules: [],
      adminSubModules: {},
    };
    expect(toggleLegacyRouteView(state, 'WMS', '/requests', true, ['/requests', '/inventory'])).toEqual({
      ...state,
      allowedModules: ['WMS'],
      allowedSubModules: {},
    });
  });

  it('keeps a partial route grant route-level until all known routes are selected', () => {
    const state = {
      allowedModules: [],
      allowedSubModules: {},
      adminModules: [],
      adminSubModules: {},
    };

    expect(toggleLegacyRouteView(state, 'WMS', '/requests', true, ['/requests', '/inventory'])).toEqual({
      ...state,
      allowedSubModules: { WMS: ['/requests'] },
    });
  });

  it('clears explicit route grants when the full Legacy module is selected', () => {
    const state = {
      allowedModules: [],
      allowedSubModules: { WMS: ['/requests'] },
      adminModules: [],
      adminSubModules: {},
    };

    expect(toggleLegacyModuleView(state, 'WMS', true)).toEqual({
      ...state,
      allowedModules: ['WMS'],
      allowedSubModules: {},
    });
  });

  it('clearing module View also revokes its Legacy administration umbrella', () => {
    const state = {
      allowedModules: ['WMS'],
      allowedSubModules: {},
      adminModules: ['WMS'],
      adminSubModules: { WMS: ['/requests'] },
    };
    expect(toggleLegacyModuleView(state, 'WMS', false)).toEqual({
      allowedModules: [],
      allowedSubModules: {},
      adminModules: [],
      adminSubModules: {},
    });
  });

  it('only revokes an existing Legacy umbrella', () => {
    const state = {
      allowedModules: ['WMS'],
      allowedSubModules: {},
      adminModules: ['WMS'],
      adminSubModules: { WMS: ['/requests'] },
    };
    expect(revokeLegacyUmbrella(state, 'WMS')).toEqual({
      ...state,
      adminModules: [],
      adminSubModules: {},
    });
  });

  it('builds deterministic Project and Settings Legacy route labels', () => {
    const catalog = buildLegacyPermissionCatalog();
    const project = catalog.find(entry => entry.legacyModuleKey === 'DA');
    const settings = catalog.find(entry => entry.legacyModuleKey === 'SETTINGS');

    expect(project?.routes).toContainEqual({ route: '/da/tabs/dailylog', label: 'Nhật ký' });
    expect(settings?.routes).toContainEqual({ route: '/settings/users', label: 'Người dùng' });
    expect(new Set(catalog.flatMap(entry => entry.routes.map(item => `${entry.legacyModuleKey}:${item.route}`))).size)
      .toBe(catalog.reduce((count, entry) => count + entry.routes.length, 0));
  });

  it('builds the permission workbench around the 14 business apps instead of the system bucket', () => {
    const applications = buildPermissionWorkbenchApplications();

    expect(applications.map(application => application.label)).toEqual([
      'Vật tư',
      'Nhân sự',
      'Quy trình',
      'Dự án',
      'Mua hàng',
      'Tài sản',
      'Yêu cầu',
      'Chi phí',
      'Kho dữ liệu',
      'Kho Kiến Thức',
      'Trợ lý AI',
      'Hồ sơ NV',
      'Hợp đồng',
      'Tender AI',
    ]);
    expect(applications.map(application => application.code)).not.toContain('system');
    expect(applications.find(application => application.code === 'hrm')?.modules.map(module => module.label))
      .toContain('Nhân viên');
    expect(applications.find(application => application.code === 'procurement')?.modules[0]).toMatchObject({
      legacyModuleKey: 'PROCUREMENT',
      label: 'Mua hàng',
    });
  });

  it('labels HRM legacy routes by their real submodule names for revocation', () => {
    const hrm = buildLegacyPermissionCatalog().find(entry => entry.legacyModuleKey === 'HRM');

    expect(hrm?.routes).toEqual(expect.arrayContaining([
      { route: '/hrm/shifts', label: 'Ca làm việc' },
      { route: '/hrm/contracts', label: 'Hợp đồng LĐ' },
      { route: '/hrm/documents', label: 'Hồ sơ & Công văn' },
      { route: '/hrm/reports', label: 'Báo cáo NS' },
      { route: '/hrm/ranking', label: 'Xếp hạng NV' },
    ]));
    expect(hrm?.routes.filter(route => route.label === 'Danh mục nhân sự')).toEqual([]);
  });

  it('maps current effective permissions back to the app and submodule that can revoke them', () => {
    const overview = buildCurrentPermissionOverview({
      directGrants: [{ ...grant('hrm.employee.edit'), scopeType: 'global', scopeId: '*' }],
      effectiveSources: [
        source('hrm.employee.view', 'LEGACY', 'global', '*'),
        source('hrm.employee.edit', 'DIRECT', 'global', '*'),
      ],
    });

    expect(overview.find(row => row.permissionCode === 'hrm.employee.view')).toMatchObject({
      applicationCode: 'hrm',
      applicationLabel: 'Nhân sự',
      moduleCode: 'hrm.employee',
      moduleLabel: 'Nhân viên',
      actionLabel: 'Xem',
      sourceTypes: ['LEGACY'],
      canRevokeDirect: false,
    });
    expect(overview.find(row => row.permissionCode === 'hrm.employee.edit')).toMatchObject({
      applicationCode: 'hrm',
      moduleCode: 'hrm.employee',
      sourceTypes: ['DIRECT'],
      canRevokeDirect: true,
    });
  });
});
