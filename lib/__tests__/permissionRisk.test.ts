import { describe, expect, it } from 'vitest';
import {
  classifyPermissionAction,
  isIdentityBoundPermission,
  resolvePermissionRiskMetadata,
} from '../permissions/permissionRisk';

describe('permission risk classification', () => {
  it.each([
    ['project.daily_log', 'view', 'normal', true, false, false],
    ['project.daily_log', 'edit_all', 'important', true, false, false],
    ['project.daily_log', 'approve', 'sensitive', true, true, true],
    ['project.payment', 'mark_paid', 'sensitive', true, true, true],
    ['system.authorization', 'manage_grants', 'sensitive', false, false, true],
    ['system.settings', 'manage', 'important', false, false, false],
  ] as const)(
    '%s.%s has stable metadata',
    (
      moduleCode,
      action,
      riskLevel,
      isBusinessAction,
      isBusinessApproval,
      directGrantRequiresExpiry,
    ) => {
      expect(classifyPermissionAction(moduleCode, action)).toEqual({
        riskLevel,
        isBusinessAction,
        isBusinessApproval,
        directGrantRequiresExpiry,
      });
    },
  );

  it('keeps System Admin identity permission out of custom role/direct editors', () => {
    expect(isIdentityBoundPermission('system.settings.manage')).toBe(true);
    expect(isIdentityBoundPermission('system.authorization.manage_roles')).toBe(false);
  });

  it('allows a complete module-owned metadata override to win', () => {
    expect(resolvePermissionRiskMetadata('project.daily_log', 'approve', {
      riskLevel: 'normal',
      isBusinessAction: true,
      isBusinessApproval: false,
      directGrantRequiresExpiry: false,
    })).toEqual({
      riskLevel: 'normal',
      isBusinessAction: true,
      isBusinessApproval: false,
      directGrantRequiresExpiry: false,
    });
  });
});
