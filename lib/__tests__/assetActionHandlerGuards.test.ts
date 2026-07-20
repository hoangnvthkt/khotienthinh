import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import {
  buildAssetAssignmentActionPolicy,
  buildAssetAuditActionPolicy,
  buildAssetCatalogActionPolicy,
  buildAssetMaintenanceActionPolicy,
} from '../permissions/assetActionUiPolicy';
import type { AssetPermissionTarget } from '../permissions/assetPermissionScope';
import type { PermissionScopeType } from '../permissions/permissionTypes';

const source = (
  permissionCode: string,
  scopeType: PermissionScopeType = 'warehouse',
  scopeId = 'wh-1',
): EffectivePermissionSource => ({
  permissionCode,
  sourceType: 'DIRECT',
  sourceId: `${permissionCode}:${scopeType}:${scopeId}`,
  sourceCode: 'DIRECT',
  sourceLabel: 'Direct grant',
  scopeType,
  scopeId,
  riskLevel: 'normal',
  isBusinessApproval: false,
  metadata: {},
});

const userWith = (
  codes: readonly string[],
  scopeType: PermissionScopeType = 'warehouse',
  scopeId = 'wh-1',
): User => ({
  id: 'user-1',
  name: 'Asset Tester',
  email: 'asset@test.local',
  role: Role.EMPLOYEE,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  effectivePermissions: codes.map(code => source(code, scopeType, scopeId)),
});

const target: AssetPermissionTarget = { warehouseId: 'wh-1' };
const otherTarget: AssetPermissionTarget = { warehouseId: 'wh-2' };

describe('asset action UI policies', () => {
  it.each([
    ['asset.catalog.create', 'create'],
    ['asset.catalog.edit', 'edit'],
    ['asset.catalog.delete', 'delete'],
    ['asset.catalog.dispose', 'dispose'],
    ['asset.catalog.import', 'import'],
  ] as const)('blocks catalog %s without permission and allows it with scoped permission', (permissionCode, operation) => {
    expect(buildAssetCatalogActionPolicy(userWith(['asset.catalog.view']), operation, target).allowed).toBe(false);
    expect(buildAssetCatalogActionPolicy(userWith(['asset.catalog.view', permissionCode]), operation, target).allowed).toBe(true);
    expect(buildAssetCatalogActionPolicy(userWith(['asset.catalog.view', permissionCode]), operation, otherTarget).allowed).toBe(false);
  });

  it('requires transfer permission for both source and destination', () => {
    const actor = userWith(['asset.catalog.view', 'asset.catalog.transfer_stock']);

    expect(buildAssetCatalogActionPolicy(actor, 'transfer_stock', {
      source: target,
      destination: target,
    }).allowed).toBe(true);
    expect(buildAssetCatalogActionPolicy(actor, 'transfer_stock', {
      source: target,
      destination: otherTarget,
    }).allowed).toBe(false);
  });

  it.each([
    ['asset.assignment.assign', 'assign'],
    ['asset.assignment.return', 'return'],
    ['asset.assignment.transfer', 'transfer'],
  ] as const)('blocks assignment %s without permission and allows it with scoped permission', (permissionCode, operation) => {
    expect(buildAssetAssignmentActionPolicy(userWith(['asset.assignment.view']), operation, target).allowed).toBe(false);
    expect(buildAssetAssignmentActionPolicy(userWith(['asset.assignment.view', permissionCode]), operation, target).allowed).toBe(true);
  });

  it.each([
    ['asset.maintenance.create', 'create'],
    ['asset.maintenance.complete', 'complete'],
    ['asset.maintenance.import', 'import'],
  ] as const)('blocks maintenance %s without permission and allows it with scoped permission', (permissionCode, operation) => {
    expect(buildAssetMaintenanceActionPolicy(userWith(['asset.maintenance.view']), operation, target).allowed).toBe(false);
    expect(buildAssetMaintenanceActionPolicy(userWith(['asset.maintenance.view', permissionCode]), operation, target).allowed).toBe(true);
  });

  it.each([
    ['asset.audit.perform', 'perform'],
    ['asset.audit.export', 'export'],
  ] as const)('blocks audit %s without permission and allows it with scoped permission', (permissionCode, operation) => {
    expect(buildAssetAuditActionPolicy(userWith(['asset.audit.view']), operation, target).allowed).toBe(false);
    expect(buildAssetAuditActionPolicy(userWith(['asset.audit.view', permissionCode]), operation, target).allowed).toBe(true);
  });
});
