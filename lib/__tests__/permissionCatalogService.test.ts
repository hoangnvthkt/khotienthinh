import { describe, expect, it, vi } from 'vitest';
import { listPermissionAdminCatalog } from '../permissions/permissionCatalogService';

const catalogFixture = {
  generatedAt: '2026-09-11T07:45:16.000Z',
  applications: [{
    code: 'asset',
    label: 'Tài sản',
    description: null,
    sortOrder: 80,
    hasDefaultViewBundle: true,
    modules: [
      ['asset.catalog', 'Danh mục tài sản', 'asset.catalog.view', 10],
      ['asset.assignment', 'Cấp phát tài sản', 'asset.assignment.view', 20],
      ['asset.maintenance', 'Bảo trì tài sản', 'asset.maintenance.view', 30],
      ['asset.audit', 'Kiểm kê tài sản', 'asset.audit.view', 40],
    ].map(([code, label, permissionCode, sortOrder]) => ({
      code,
      label,
      description: null,
      sortOrder,
      actions: [{
        action: 'view',
        label: 'Xem',
        permissionCode,
        description: null,
        scopeTypes: ['global'],
        sortOrder: 10,
        riskLevel: 'normal',
        grantReadiness: 'enforced',
        directGrantAllowed: true,
        directGrantRequiresExpiry: false,
        isDefaultView: true,
        defaultScopeType: 'global',
      }],
    })),
  }],
};

describe('permission admin catalog service', () => {
  it('preserves the authoritative four-view Asset bundle', async () => {
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ data: catalogFixture, error: null }),
    };

    const result = await listPermissionAdminCatalog(gateway);

    expect(result.applications.find(app => app.code === 'asset')?.modules
      .flatMap(module => module.actions)
      .filter(action => action.isDefaultView)
      .map(action => action.permissionCode)).toEqual([
        'asset.catalog.view',
        'asset.assignment.view',
        'asset.maintenance.view',
        'asset.audit.view',
      ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.applications[0].modules[0].actions[0])).toBe(true);
  });

  it.each([
    { applications: null },
    { generatedAt: '', applications: [] },
    {
      ...catalogFixture,
      applications: [catalogFixture.applications[0], catalogFixture.applications[0]],
    },
    {
      ...catalogFixture,
      applications: [{
        ...catalogFixture.applications[0],
        modules: [{
          ...catalogFixture.applications[0].modules[0],
          actions: [{
            ...catalogFixture.applications[0].modules[0].actions[0],
            defaultScopeType: 'warehouse',
          }],
        }],
      }],
    },
  ])('fails closed for malformed or inconsistent payload %#', async data => {
    const gateway = { rpc: vi.fn().mockResolvedValue({ data, error: null }) };

    await expect(listPermissionAdminCatalog(gateway))
      .rejects.toThrow('Catalog phân quyền không hợp lệ');
  });

  it('surfaces the Cloud RPC error without returning a static fallback', async () => {
    const gateway = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Authorization administration permission required' },
      }),
    };

    await expect(listPermissionAdminCatalog(gateway))
      .rejects.toThrow('Không tải được catalog phân quyền: Authorization administration permission required');
  });
});
