import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import {
  getAssetAssignmentCapabilities,
  getAssetAuditCapabilities,
  getAssetCatalogRecordCapabilities,
  getAssetCatalogRouteCapabilities,
  getAssetMaintenanceCapabilities,
  getAssetTransferCapabilities,
} from '../permissions/assetPermissionCapabilities';
import { hasAnyAssetActionSource } from '../permissions/assetPermissionScope';
import { resolvePermissionActionReadiness } from '../permissions/permissionReadiness';
import { getPermissionActionByCode } from '../permissions/permissionRegistry';
import type { PermissionScopeType } from '../permissions/permissionTypes';

const source = (
  permissionCode: string,
  scopeType: PermissionScopeType = 'global',
  scopeId = '*',
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
  scopeType: PermissionScopeType = 'global',
  scopeId = '*',
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

describe('asset permission capabilities', () => {
  it('requires View separately from Create for route access', () => {
    const actor = userWith(['asset.catalog.create'], 'warehouse', 'wh-1');

    expect(getAssetCatalogRouteCapabilities(actor)).toEqual({
      canViewCatalog: false,
      canViewDashboard: false,
    });
    expect(getAssetCatalogRecordCapabilities(actor, { warehouseId: 'wh-1' }).canCreate).toBe(true);
  });

  it('detects any scoped action source for opening target-selecting UI', () => {
    const actor = userWith(['asset.catalog.create'], 'warehouse', 'wh-1');

    expect(hasAnyAssetActionSource(actor, 'asset.catalog.create')).toBe(true);
    expect(hasAnyAssetActionSource(actor, 'asset.catalog.edit')).toBe(false);
  });

  it('opens catalog route only from a matching View grant', () => {
    const actor = userWith(['asset.catalog.view'], 'warehouse', 'wh-1');

    expect(getAssetCatalogRouteCapabilities(actor).canViewCatalog).toBe(true);
    expect(getAssetCatalogRouteCapabilities(actor).canViewDashboard).toBe(true);
  });

  it('allows scoped edit only for matching asset scope', () => {
    const actor = userWith(['asset.catalog.view', 'asset.catalog.edit'], 'warehouse', 'wh-1');

    expect(getAssetCatalogRecordCapabilities(actor, { warehouseId: 'wh-1' }).canEdit).toBe(true);
    expect(getAssetCatalogRecordCapabilities(actor, { warehouseId: 'wh-2' }).canEdit).toBe(false);
  });

  it('checks assigned-user scope independently from warehouse scope', () => {
    const actor = userWith(['asset.assignment.return'], 'assigned', 'user-2');

    expect(getAssetAssignmentCapabilities(actor, { assignedUserId: 'user-2' }).canReturn).toBe(true);
    expect(getAssetAssignmentCapabilities(actor, { assignedUserId: 'user-3' }).canReturn).toBe(false);
  });

  it('checks transfer stock against both source and destination scopes', () => {
    const actor = userWith(['asset.catalog.transfer_stock'], 'warehouse', 'wh-1');

    expect(getAssetTransferCapabilities(actor, {
      source: { warehouseId: 'wh-1' },
      destination: { warehouseId: 'wh-1' },
    }).canTransferStock).toBe(true);

    expect(getAssetTransferCapabilities(actor, {
      source: { warehouseId: 'wh-1' },
      destination: { warehouseId: 'wh-2' },
    }).canTransferStock).toBe(false);
  });

  it('maps maintenance and audit actions by target scope', () => {
    const maintenanceActor = userWith(['asset.maintenance.create'], 'department', 'dept-1');
    const auditActor = userWith(['asset.audit.perform', 'asset.audit.export'], 'warehouse', 'wh-1');

    expect(getAssetMaintenanceCapabilities(maintenanceActor, { departmentId: 'dept-1' }).canCreate).toBe(true);
    expect(getAssetMaintenanceCapabilities(maintenanceActor, { departmentId: 'dept-2' }).canCreate).toBe(false);
    expect(getAssetAuditCapabilities(auditActor, { warehouseId: 'wh-1' })).toMatchObject({
      canPerformAudit: true,
      canExportAudit: true,
    });
    expect(getAssetAuditCapabilities(auditActor, { warehouseId: 'wh-2' })).toMatchObject({
      canPerformAudit: false,
      canExportAudit: false,
    });
  });

  it('marks backend-enforced Asset action grants as enforced while leaving audit persistence declared', () => {
    const enforcedCodes = [
      'asset.catalog.view',
      'asset.catalog.create',
      'asset.catalog.edit',
      'asset.catalog.delete',
      'asset.catalog.dispose',
      'asset.catalog.import',
      'asset.catalog.transfer_stock',
      'asset.assignment.view',
      'asset.assignment.assign',
      'asset.assignment.return',
      'asset.assignment.transfer',
      'asset.maintenance.view',
      'asset.maintenance.create',
      'asset.maintenance.complete',
      'asset.maintenance.import',
      'asset.audit.view',
    ];

    for (const code of enforcedCodes) {
      const action = getPermissionActionByCode(code);
      expect(action, code).toBeDefined();
      expect(resolvePermissionActionReadiness(action!), code).toBe('enforced');
    }

    expect(resolvePermissionActionReadiness(getPermissionActionByCode('asset.audit.perform')!)).toBe('declared');
    expect(resolvePermissionActionReadiness(getPermissionActionByCode('asset.audit.export')!)).toBe('declared');
  });
});
