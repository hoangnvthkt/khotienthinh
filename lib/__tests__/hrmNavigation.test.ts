import { describe, expect, it } from 'vitest';
import { Role, User, UserPermissionGrant } from '../../types';
import { getHrmNavigationItems } from '../hrmNavigation';

const persona = (
  grants: Array<[UserPermissionGrant['permissionCode'], UserPermissionGrant['scopeType']]>,
  role: Role = Role.EMPLOYEE,
): User => ({
  id: 'persona-1',
  name: 'Persona',
  email: 'persona@example.com',
  role,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  permissionGrants: grants.map(([permissionCode, scopeType]) => ({
    userId: 'persona-1',
    permissionCode,
    scopeType,
    scopeId: '*',
    isActive: true,
  })),
});

const businessUser = persona([
  ['hrm.employee.view_directory', 'global'],
  ['hrm.employee.view_profile', 'own'],
  ['hrm.employee.edit_profile', 'own'],
  ['hrm.attendance.view', 'own'],
  ['hrm.leave.view', 'own'],
]);

const hrUser = persona([
  ['hrm.employee.view_directory', 'global'],
  ['hrm.employee.view_sensitive', 'global'],
  ['hrm.attendance.view', 'global'],
  ['hrm.leave.view', 'global'],
  ['hrm.contract.view', 'global'],
  ['hrm.document.view', 'global'],
  ['hrm.payroll.view', 'global'],
  ['hrm.master_data.view', 'global'],
]);

const hrManageUser = persona([
  ...(hrUser.permissionGrants || []).map(grant => [
    grant.permissionCode,
    grant.scopeType,
  ] as [UserPermissionGrant['permissionCode'], UserPermissionGrant['scopeType']]),
  ['hrm.compensation.manage', 'global'],
  ['hrm.master_data.manage', 'global'],
]);

describe('HRM navigation', () => {
  it('returns the approved Employee self-service menu in order', () => {
    expect(getHrmNavigationItems(businessUser)).toEqual([
      { to: '/employee-dashboard', label: 'Tổng quan của tôi' },
      { to: '/my-profile', label: 'Hồ sơ của tôi' },
      { to: '/hrm/employees', label: 'Danh bạ nhân sự' },
      { to: '/hrm/checkin', label: 'Check-in / Check-out' },
      { to: '/hrm/attendance', label: 'Chấm công của tôi' },
      { to: '/hrm/leave', label: 'Nghỉ phép của tôi' },
    ]);
  });

  it('adds company-wide pages from HR view permissions', () => {
    const routes = getHrmNavigationItems(hrUser).map(item => item.to);

    expect(routes).toEqual(expect.arrayContaining([
      '/employee-dashboard',
      '/my-profile',
      '/hrm/dashboard',
      '/hrm/employees',
      '/hrm/checkin',
      '/hrm/attendance',
      '/hrm/shifts',
      '/hrm/leave',
      '/hrm/payroll',
      '/hrm/contracts',
      '/hrm/documents',
      '/hrm/reports',
      '/hrm/ranking',
    ]));
  });

  it('keeps the governed HR route set available to HR Manage', () => {
    const routes = getHrmNavigationItems(hrManageUser).map(item => item.to);

    expect(routes).toEqual(expect.arrayContaining([
      '/hrm/dashboard',
      '/hrm/contracts',
      '/hrm/documents',
      '/hrm/shifts',
      '/hrm/payroll',
    ]));
  });

  it('does not give a technical Admin an implicit HRM menu', () => {
    expect(getHrmNavigationItems(persona([], Role.ADMIN))).toEqual([
      { to: '/employee-dashboard', label: 'Tổng quan của tôi' },
      { to: '/my-profile', label: 'Hồ sơ của tôi' },
    ]);
  });
});
