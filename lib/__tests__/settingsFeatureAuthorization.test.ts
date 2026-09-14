import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import { getPermissionModuleByCode } from '../permissions/permissionRegistry';
import {
  canAccessSettingsFeature,
  canManageSettingsFeature,
  getSettingsFeaturePermission,
} from '../settingsPermissions';

const userWith = (...permissionCodes: string[]): User => ({
  id: 'settings-fixture',
  name: 'Settings fixture',
  email: 'settings-fixture@invalid.local',
  role: Role.EMPLOYEE,
  permissionGrants: permissionCodes.map(permissionCode => ({
    userId: 'settings-fixture', permissionCode, scopeType: 'global', scopeId: '*', isActive: true,
  })),
});

describe('settings feature authorization', () => {
  it('opens only the Settings feature granted to the user', () => {
    const user = userWith('settings.warehouses.view');
    expect(canAccessSettingsFeature(user, 'warehouses')).toBe(true);
    expect(canAccessSettingsFeature(user, 'general')).toBe(false);
    expect(canManageSettingsFeature(user, 'warehouses')).toBe(false);
  });

  it('lets feature manage imply feature view without opening another feature', () => {
    const user = userWith('settings.warehouses.manage');
    expect(canAccessSettingsFeature(user, 'warehouses')).toBe(true);
    expect(canManageSettingsFeature(user, 'warehouses')).toBe(true);
    expect(canAccessSettingsFeature(user, 'loss-norms')).toBe(false);
  });

  it('keeps global settings administration as an inherited all-feature source', () => {
    const user = userWith('system.settings.manage');
    expect(canAccessSettingsFeature(user, 'ai-learning')).toBe(true);
    expect(canManageSettingsFeature(user, 'maintenance')).toBe(true);
  });

  it('reuses HR capabilities for HR-owned Settings surfaces', () => {
    expect(getSettingsFeaturePermission('org-chart')).toEqual({
      view: 'hrm.organization.view', manage: 'hrm.organization.manage',
    });
    expect(getSettingsFeaturePermission('hrm-master-data')).toEqual({
      view: 'hrm.master_data.view', manage: 'hrm.master_data.manage',
    });
  });

  it('registers granular Settings modules and actions for the editor', () => {
    const warehouses = getPermissionModuleByCode('settings.warehouses');
    expect(warehouses?.actions.map(action => action.permissionCode)).toEqual([
      'settings.warehouses.view', 'settings.warehouses.manage',
    ]);
    expect(getPermissionModuleByCode('settings.maintenance')?.actions.map(action => action.permissionCode)).toEqual([
      'settings.maintenance.view', 'settings.maintenance.manage',
    ]);
  });
});
