import { describe, expect, it } from 'vitest';
import { getPermissionActionByCode } from '../permissions/permissionRegistry';
import {
  canAddDirectGrant,
  canRemoveDirectGrant,
  resolvePermissionActionReadiness,
} from '../permissions/permissionReadiness';

const action = (code: string) => {
  const found = getPermissionActionByCode(code);
  if (!found) throw new Error('Missing fixture ' + code);
  return found;
};

describe('permission readiness', () => {
  it('marks only the bounded Daily Log evidence set as verified', () => {
    expect(resolvePermissionActionReadiness(action('project.daily_log.view'))).toBe('verified');
    expect(resolvePermissionActionReadiness(action('project.daily_log.edit_own'))).toBe('verified');
    expect(resolvePermissionActionReadiness(action('project.daily_log.submit'))).toBe('verified');
    expect(resolvePermissionActionReadiness(action('project.daily_log.verify'))).toBe('verified');
    expect(resolvePermissionActionReadiness(action('project.daily_log.approve'))).toBe('verified');
  });

  it('does not promote unproven or umbrella actions from their names', () => {
    expect(resolvePermissionActionReadiness(action('project.daily_log.confirm'))).toBe('declared');
    expect(resolvePermissionActionReadiness(action('project.daily_log.manage'))).toBe('legacy');
    expect(resolvePermissionActionReadiness(action('system.wms.manage'))).toBe('legacy');
  });

  it('marks only the Cloud-verified Payment/Quantity and Material approval tranche as verified', () => {
    const verifiedCodes = [
      'project.payment.verify',
      'project.payment.approve',
      'project.payment.confirm',
      'project.quantity_acceptance.verify',
      'project.quantity_acceptance.approve',
      'project.material_request.approve',
      'project.material_po.approve',
      'project.custom_material.approve',
    ];

    for (const permissionCode of verifiedCodes) {
      expect(resolvePermissionActionReadiness(action(permissionCode))).toBe('verified');
    }

    for (const permissionCode of [
      'project.payment.mark_paid',
      'project.material_request.confirm',
      'project.material_request.verify',
    ]) {
      expect(resolvePermissionActionReadiness(action(permissionCode))).toBe('declared');
    }
  });

  it('adds declared action grants but keeps legacy-only manage actions blocked', () => {
    expect(canAddDirectGrant(action('project.daily_log.edit_own'))).toBe(true);
    expect(canAddDirectGrant(action('project.daily_log.confirm'))).toBe(true);
    expect(canAddDirectGrant(action('hrm.employee.create'))).toBe(true);
    expect(canAddDirectGrant(action('project.daily_log.manage'))).toBe(false);
    expect(canRemoveDirectGrant(true)).toBe(true);
    expect(canRemoveDirectGrant(false)).toBe(false);
  });
});
