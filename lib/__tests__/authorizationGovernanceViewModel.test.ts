import { describe, expect, it } from 'vitest';
import {
  buildEffectivePermissionRows,
  buildPermissionSourceBadges,
  validateDirectGrantDrafts,
  validateSodWarningAcceptances,
} from '../permissions/authorizationGovernanceViewModel';

const roleSource = {
  permissionCode: 'project.daily_log.approve',
  sourceType: 'ROLE' as const,
  sourceId: 'assignment-1',
  sourceCode: 'PROJECT_APPROVER',
  sourceLabel: 'Project Approver',
  scopeType: 'project' as const,
  scopeId: 'project-1',
  riskLevel: 'sensitive' as const,
  isBusinessApproval: true,
  metadata: {},
};

describe('authorization governance view model', () => {
  it('keeps multiple effective sources visible for one permission', () => {
    expect(buildPermissionSourceBadges([
      roleSource,
      { ...roleSource, sourceType: 'LEGACY', sourceId: 'DA', sourceCode: 'DA', sourceLabel: 'Legacy permission' },
    ])).toEqual([
      { key: 'project.daily_log.approve::project::project-1::ROLE::assignment-1', kind: 'ROLE', label: 'Business Role · Project Approver' },
      { key: 'project.daily_log.approve::project::project-1::LEGACY::DA', kind: 'LEGACY', label: 'Legacy · DA' },
    ]);
  });

  it('does not turn an inherited source into a direct checkbox', () => {
    expect(buildEffectivePermissionRows([], [roleSource])[0]).toMatchObject({
      permissionCode: 'project.daily_log.approve',
      hasDirectGrant: false,
      isEffective: true,
    });
  });

  it('requires future expiry for a sensitive direct grant', () => {
    expect(validateDirectGrantDrafts([], [{
      userId: 'user-1', permissionCode: 'project.daily_log.approve',
      scopeType: 'project', scopeId: 'project-1', isActive: true,
    }], new Map([['project.daily_log.approve', 'sensitive']]), new Date('2026-07-17T00:00:00Z'), 'Cấp quyền duyệt có thời hạn'))
      .toContain('project.daily_log.approve cần ngày hết hạn trong tương lai.');
  });

  it('requires exactly one complete acceptance per warning scope key', () => {
    const decision = {
      hardDenies: [],
      warnings: [{
        ruleCode: 'PO_CREATE_APPROVE', effect: 'WARN' as const,
        message: 'Cần kiểm soát', permissionCodes: ['a', 'b'],
        scopeType: 'project' as const, scopeId: 'project-1',
      }],
    };
    expect(validateSodWarningAcceptances(decision, [], new Date('2026-07-17T00:00:00Z')))
      .toContain('Thiếu xác nhận SoD cho PO_CREATE_APPROVE tại project/project-1.');
  });
});
