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

  it('adds only verified/enforced grants but permits existing Direct revocation', () => {
    expect(canAddDirectGrant(action('project.daily_log.edit_own'))).toBe(true);
    expect(canAddDirectGrant(action('project.daily_log.confirm'))).toBe(false);
    expect(canRemoveDirectGrant(true)).toBe(true);
    expect(canRemoveDirectGrant(false)).toBe(false);
  });
});
