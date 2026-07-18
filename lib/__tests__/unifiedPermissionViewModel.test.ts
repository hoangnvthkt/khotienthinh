import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import { getPermissionModuleByCode } from '../permissions/permissionRegistry';
import {
  buildUnifiedPermissionDraftKey,
  buildUnifiedPermissionRows,
  toggleUnifiedDirectGrant,
} from '../permissions/unifiedPermissionViewModel';

const dailyLog = getPermissionModuleByCode('project.daily_log');
if (!dailyLog) throw new Error('Missing daily log fixture');

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

  it('clearing View removes only same-module same-scope Direct actions', () => {
    const next = toggleUnifiedDirectGrant({
      module: dailyLog,
      grants: [
        grant('project.daily_log.view'),
        grant('project.daily_log.edit_own'),
        grant('project.daily_log.edit_own', 'project-2'),
        grant('project.material_request.view'),
      ],
      targetUserId: 'user-1',
      permissionCode: 'project.daily_log.view',
      checked: false,
      scope,
    });

    expect(next.map(item => item.permissionCode + ':' + item.scopeId).sort()).toEqual([
      'project.daily_log.edit_own:project-2',
      'project.material_request.view:project-1',
    ]);
  });

  it('refuses a new Declared action but permits removing an existing one', () => {
    const existing = grant('project.daily_log.confirm');
    expect(toggleUnifiedDirectGrant({
      module: dailyLog,
      grants: [],
      targetUserId: 'user-1',
      permissionCode: existing.permissionCode,
      checked: true,
      scope,
    })).toEqual([]);
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
});
