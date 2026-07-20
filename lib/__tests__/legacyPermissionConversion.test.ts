import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import type { LegacyPermissionState } from '../permissions/permissionTypes';
import {
  applyLegacyConversionDraft,
  buildLegacyConversionCandidates,
} from '../permissions/unifiedPermissionViewModel';

const emptyLegacy: LegacyPermissionState = {
  allowedModules: [],
  allowedSubModules: {},
  adminModules: [],
  adminSubModules: {},
};

describe('legacy permission conversion', () => {
  it('maps legacy module access to view permissions only', () => {
    const candidates = buildLegacyConversionCandidates({
      legacyState: {
        ...emptyLegacy,
        allowedModules: ['TS'],
      },
      scope: { scopeType: 'global', scopeId: '*' },
    });

    const asset = candidates.find(candidate => candidate.legacyModuleKey === 'TS');
    expect(asset?.permissionCodes).toEqual(expect.arrayContaining([
      'asset.catalog.view',
      'asset.assignment.view',
      'asset.maintenance.view',
      'asset.audit.view',
    ]));
    expect(asset?.permissionCodes.some(code => code !== 'asset.catalog.view' && code.endsWith('.create'))).toBe(false);
  });

  it('does not convert legacy admin manage permissions until they have direct-grantable modern equivalents', () => {
    const candidates = buildLegacyConversionCandidates({
      legacyState: {
        ...emptyLegacy,
        adminModules: ['TS'],
      },
      scope: { scopeType: 'global', scopeId: '*' },
    });

    expect(candidates.find(candidate => candidate.legacyModuleKey === 'TS')).toBeUndefined();
  });

  it('creates direct grants and removes converted legacy module key', () => {
    const grants: UserPermissionGrant[] = [];
    const result = applyLegacyConversionDraft({
      targetUserId: 'user-1',
      grants,
      legacyState: {
        ...emptyLegacy,
        allowedModules: ['TS'],
      },
      conversion: {
        legacyModuleKey: 'TS',
        label: 'Tài sản',
        sourceKind: 'allowedModule',
        scopeType: 'global',
        scopeId: '*',
        permissionCodes: ['asset.catalog.view', 'asset.assignment.view'],
      },
    });

    expect(result.grants).toEqual([
      { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*' },
      { userId: 'user-1', permissionCode: 'asset.assignment.view', scopeType: 'global', scopeId: '*' },
    ]);
    expect(result.legacyState.allowedModules).toEqual([]);
  });
});
