import { describe, expect, it } from 'vitest';
import { UserPermissionGrant } from '../../types';
import {
  getApplicationGrantState,
  ModuleGrantSelectionError,
  removeApplicationDirectGrants,
  selectApplicationDefaultViews,
  togglePermissionAction,
} from '../permissions/moduleGrantSelection';
import { PermissionAdminCatalog, PermissionCatalogAction } from '../permissions/permissionTypes';

const action = (
  permissionCode: string,
  overrides: Partial<PermissionCatalogAction> = {},
): PermissionCatalogAction => ({
  action: permissionCode.split('.').at(-1) || 'view',
  label: permissionCode.endsWith('.view') ? 'Xem' : 'Duyệt',
  permissionCode,
  scopeTypes: ['global'],
  sortOrder: 10,
  riskLevel: 'normal',
  grantReadiness: 'enforced',
  directGrantAllowed: true,
  directGrantRequiresExpiry: false,
  isDefaultView: permissionCode.endsWith('.view'),
  defaultScopeType: permissionCode.endsWith('.view') ? 'global' : undefined,
  ...overrides,
});

const assetActions = [
  action('asset.catalog.view'),
  action('asset.assignment.view'),
  action('asset.assignment.approve', {
    riskLevel: 'sensitive',
    directGrantRequiresExpiry: true,
    isDefaultView: false,
    defaultScopeType: undefined,
  }),
  action('asset.maintenance.view'),
  action('asset.audit.view'),
];

const catalog: PermissionAdminCatalog = {
  generatedAt: '2026-09-11T07:45:16.000Z',
  applications: [{
    code: 'asset',
    label: 'Tài sản',
    sortOrder: 80,
    hasDefaultViewBundle: true,
    modules: [
      { code: 'asset.catalog', label: 'Danh mục', sortOrder: 10, actions: [assetActions[0]] },
      { code: 'asset.assignment', label: 'Cấp phát', sortOrder: 20, actions: assetActions.slice(1, 3) },
      { code: 'asset.maintenance', label: 'Bảo trì', sortOrder: 30, actions: [assetActions[3]] },
      { code: 'asset.audit', label: 'Kiểm kê', sortOrder: 40, actions: [assetActions[4]] },
    ],
  }],
};

const grant = (
  permissionCode: string,
  overrides: Partial<UserPermissionGrant> = {},
): UserPermissionGrant => ({
  id: `grant-${permissionCode}`,
  userId: 'user-1',
  permissionCode,
  scopeType: 'global',
  scopeId: '*',
  isActive: true,
  ...overrides,
});

describe('module grant selection', () => {
  it('selects exactly the four Asset views and deduplicates an existing view', () => {
    const result = selectApplicationDefaultViews({
      catalog,
      applicationCode: 'asset',
      grants: [grant('asset.catalog.view')],
      targetUserId: 'user-1',
    });

    expect(result.map(item => item.permissionCode)).toEqual([
      'asset.catalog.view',
      'asset.assignment.view',
      'asset.maintenance.view',
      'asset.audit.view',
    ]);
    expect(result.some(item => item.permissionCode.endsWith('.approve'))).toBe(false);
  });

  it('reports checked, partial inherited, and unchecked states independently', () => {
    const allViews = assetActions
      .filter(item => item.isDefaultView)
      .map(item => grant(item.permissionCode));

    expect(getApplicationGrantState({
      catalog, applicationCode: 'asset', grants: allViews, inheritedPermissionCodes: [],
    })).toBe('checked');
    expect(getApplicationGrantState({
      catalog,
      applicationCode: 'asset',
      grants: [allViews[0]],
      inheritedPermissionCodes: [],
    })).toBe('indeterminate');
    expect(getApplicationGrantState({
      catalog,
      applicationCode: 'asset',
      grants: [],
      inheritedPermissionCodes: ['asset.catalog.view'],
    })).toBe('indeterminate');
    expect(getApplicationGrantState({
      catalog, applicationCode: 'asset', grants: [], inheritedPermissionCodes: [],
    })).toBe('unchecked');
  });

  it('does not count expired grants as selected', () => {
    expect(getApplicationGrantState({
      catalog,
      applicationCode: 'asset',
      grants: [grant('asset.catalog.view', { expiresAt: '2026-09-10T00:00:00.000Z' })],
      inheritedPermissionCodes: [],
      now: new Date('2026-09-11T00:00:00.000Z'),
    })).toBe('unchecked');
  });

  it('marks removal for confirmation when the Module has advanced direct grants', () => {
    const result = removeApplicationDirectGrants({
      catalog,
      applicationCode: 'asset',
      grants: [grant('asset.catalog.view'), grant('asset.assignment.approve', {
        expiresAt: '2026-12-01T00:00:00.000Z',
      })],
    });

    expect(result.grants).toEqual([]);
    expect(result.removed).toHaveLength(2);
    expect(result.needsConfirmation).toBe(true);
  });

  it('requires a concrete ID for entity-scoped default views', () => {
    const warehouseCatalog: PermissionAdminCatalog = {
      ...catalog,
      applications: [{
        ...catalog.applications[0],
        modules: [{
          ...catalog.applications[0].modules[0],
          actions: [action('asset.catalog.view', {
            scopeTypes: ['warehouse'],
            defaultScopeType: 'warehouse',
          })],
        }],
      }],
    };

    expect(() => selectApplicationDefaultViews({
      catalog: warehouseCatalog,
      applicationCode: 'asset',
      grants: [],
      targetUserId: 'user-1',
    })).toThrowError(ModuleGrantSelectionError);
  });

  it('rejects direct template grants and expiry-required actions without a future expiry', () => {
    expect(() => togglePermissionAction({
      catalog,
      grants: [],
      targetUserId: 'user-1',
      permissionCode: 'asset.assignment.approve',
      checked: true,
      scopeType: 'global',
      scopeId: '*',
      now: new Date('2026-09-11T00:00:00.000Z'),
    })).toThrowError('Quyền yêu cầu ngày hết hạn trong tương lai');

    const blockedCatalog: PermissionAdminCatalog = {
      ...catalog,
      applications: [{
        ...catalog.applications[0],
        modules: [{
          ...catalog.applications[0].modules[0],
          actions: [action('asset.catalog.view', { directGrantAllowed: false })],
        }],
      }],
    };
    expect(() => selectApplicationDefaultViews({
      catalog: blockedCatalog,
      applicationCode: 'asset',
      grants: [],
      targetUserId: 'user-1',
    })).toThrowError('Không thể cấp trực tiếp quyền');
  });
});
