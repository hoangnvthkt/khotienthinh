import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import { getHrmSharedCatalogCapabilities } from '../hrmSharedCatalogCapabilities';
import { canViewRoute } from '../permissions/permissionService';

const userWith = (...permissionCodes: string[]): User => ({
  id: 'user-1',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  permissionGrants: permissionCodes.map(permissionCode => ({
    userId: 'user-1',
    permissionCode,
    scopeType: 'global' as const,
    scopeId: '',
  })),
});

describe('getHrmSharedCatalogCapabilities', () => {
  it('keeps organization, staffing and master-data mutations independent', () => {
    const capabilities = getHrmSharedCatalogCapabilities(userWith(
      'hrm.organization.view',
      'hrm.staffing.view',
      'hrm.staffing.assign',
    ));

    expect(capabilities).toEqual({
      canViewOrganization: true,
      canManageOrganization: false,
      canViewStaffing: true,
      canAdjustStaffing: false,
      canAssignEmployee: true,
      canSetManager: false,
      canViewMasterData: false,
      canManageMasterData: false,
    });
  });

  it('does not give a technical Admin implicit HRM catalog capabilities', () => {
    const capabilities = getHrmSharedCatalogCapabilities({
      ...userWith(),
      role: Role.ADMIN,
    });

    expect(Object.values(capabilities).every(value => value === false)).toBe(true);
    expect(canViewRoute({ ...userWith(), role: Role.ADMIN }, '/settings/hrm-shared-catalog')).toBe(false);
  });

  it('opens the dedicated settings route from an effective HRM view action', () => {
    expect(canViewRoute(
      userWith('hrm.organization.view'),
      '/settings/hrm-shared-catalog',
    )).toBe(true);
  });
});
