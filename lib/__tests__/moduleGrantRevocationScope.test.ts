import { describe, expect, it } from 'vitest';
import { removeApplicationDirectGrants } from '../permissions/moduleGrantSelection';
import type { PermissionAdminCatalog, PermissionScope } from '../permissions/permissionTypes';
import type { UserPermissionGrant } from '../../types';

const catalog: PermissionAdminCatalog = {
  generatedAt: '2026-09-14T00:00:00Z',
  applications: [{ code: 'asset', label: 'Tài sản', sortOrder: 1, hasDefaultViewBundle: true,
    modules: [{ code: 'asset.catalog', label: 'Danh mục', sortOrder: 1,
      actions: ['view', 'edit'].map(action => ({ action, label: action,
        permissionCode: `asset.catalog.${action}`, scopeTypes: ['global', 'warehouse'],
        sortOrder: 1, riskLevel: 'normal', grantReadiness: 'enforced',
        directGrantAllowed: true, directGrantRequiresExpiry: false,
        isDefaultView: action === 'view', defaultScopeType: action === 'view' ? 'global' : undefined,
      })),
    }],
  }],
};
const grant = (id: string, scopeType: UserPermissionGrant['scopeType'], scopeId: string,
  permissionCode = 'asset.catalog.view'): UserPermissionGrant => ({
  id, userId: 'fixture', permissionCode, scopeType, scopeId, isActive: true,
});
const grants = [grant('a-view', 'warehouse', 'A'), grant('a-edit', 'warehouse', 'A', 'asset.catalog.edit'),
  grant('b-view', 'warehouse', 'B'), grant('global-view', 'global', '*'),
  grant('shell', 'global', '*', 'system.ts.view')];

// Removing the scope filter must fail these tests: no cross-warehouse revocation.
describe('module direct revocation scope', () => {
  const remove = (scope?: PermissionScope) => removeApplicationDirectGrants({
    catalog, applicationCode: 'asset', grants, scope,
  });
  it('removes view and edit only in warehouse A, preserving global, B and hidden sources', () => {
    const result = remove({ scopeType: 'warehouse', scopeId: 'A' });
    expect(result.removed.map(g => g.id)).toEqual(['a-view', 'a-edit']);
    expect(result.grants.map(g => g.id)).toEqual(['b-view', 'global-view', 'shell']);
    expect(result.needsConfirmation).toBe(true);
  });
  it('requires explicit scope when the module has grants in several scopes', () => {
    expect(() => remove()).toThrow(/phạm vi/i);
  });
  it('treats global as an exact stored grant, not permission to delete all scopes', () => {
    expect(remove({ scopeType: 'global', scopeId: '*' }).removed.map(g => g.id)).toEqual(['global-view']);
  });
  it('does not infer wildcard for an omitted warehouse ID', () => {
    expect(() => remove({ scopeType: 'warehouse' })).toThrow(/phạm vi/i);
  });
  it('keeps all grants when the selected scope has no direct grant', () => {
    expect(remove({ scopeType: 'warehouse', scopeId: 'C' }).grants).toEqual(grants);
  });
  it('preserves the single-scope module checkbox behavior', () => {
    const result = removeApplicationDirectGrants({ catalog, applicationCode: 'asset',
      grants: [grant('single', 'global', '*'), grant('shell', 'global', '*', 'system.ts.view')] });
    expect(result.removed.map(g => g.id)).toEqual(['single']);
    expect(result.grants.map(g => g.id)).toEqual(['shell']);
  });
});
