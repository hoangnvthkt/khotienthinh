import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import {
  buildApplicationAccessOverview,
  buildCurrentPermissionOverview,
  getDirectGrantRevokeDraft,
} from '../permissions/unifiedPermissionViewModel';

const directSource = (
  permissionCode: string,
  scopeType: EffectivePermissionSource['scopeType'] = 'global',
  scopeId = '*',
): EffectivePermissionSource => ({
  permissionCode,
  scopeType,
  scopeId,
  sourceType: 'DIRECT',
  sourceId: `direct:${permissionCode}`,
  sourceCode: permissionCode,
  sourceLabel: 'Direct grant',
  riskLevel: 'normal',
  isBusinessApproval: false,
  metadata: {},
});

describe('application permission overview', () => {
  it('derives app access from effective view permissions', () => {
    const rows = buildApplicationAccessOverview({
      effectiveSources: [
        directSource('asset.catalog.view'),
        directSource('asset.assignment.assign'),
        directSource('hrm.employee.view', 'department', 'dept-1'),
      ],
    });

    expect(rows.find(row => row.applicationCode === 'asset')).toMatchObject({
      applicationLabel: 'Tài sản',
      hasAccess: true,
      viewPermissionCount: 1,
      actionPermissionCount: 1,
    });
    expect(rows.find(row => row.applicationCode === 'hrm')).toMatchObject({
      hasAccess: true,
      viewPermissionCount: 1,
    });
    expect(rows.find(row => row.applicationCode === 'workflow')?.hasAccess).toBe(false);
  });

  it('summarizes source labels and revocation availability by permission row', () => {
    const rows = buildCurrentPermissionOverview({
      directGrants: [{
        userId: 'user-1',
        permissionCode: 'asset.catalog.view',
        scopeType: 'global',
        scopeId: '*',
      }],
      effectiveSources: [
        directSource('asset.catalog.view'),
        {
          ...directSource('asset.catalog.create'),
          sourceType: 'ROLE',
          sourceId: 'role-1',
          sourceCode: 'ASSET_OPERATOR',
          sourceLabel: 'Asset Operator',
        },
      ],
    });

    expect(rows.map(row => row.permissionCode)).toEqual([
      'asset.catalog.view',
      'asset.catalog.create',
    ]);
    expect(rows[0]).toMatchObject({
      sourceTypes: ['DIRECT'],
      canRevokeDirect: true,
    });
    expect(rows[1]).toMatchObject({
      sourceTypes: ['ROLE'],
      canRevokeDirect: false,
    });
  });

  it('removes only the selected direct grant scope when revoking inline', () => {
    const grants: UserPermissionGrant[] = [
      { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*' },
      { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'warehouse', scopeId: 'wh-1' },
      { userId: 'user-1', permissionCode: 'asset.catalog.create', scopeType: 'global', scopeId: '*' },
    ];

    expect(getDirectGrantRevokeDraft({
      grants,
      targetUserId: 'user-1',
      permissionCode: 'asset.catalog.view',
      scopeType: 'global',
      scopeId: '*',
    })).toEqual([
      { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'warehouse', scopeId: 'wh-1' },
      { userId: 'user-1', permissionCode: 'asset.catalog.create', scopeType: 'global', scopeId: '*' },
    ]);
  });
});
