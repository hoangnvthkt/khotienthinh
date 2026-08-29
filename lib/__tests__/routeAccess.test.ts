import { describe, expect, it } from 'vitest';
import { Role, User, UserPermissionGrant } from '../../types';
import { canAccessRoute, getRouteModuleKey, isAuthenticatedOpenRoute } from '../routeAccess';

const user = (allowedModules?: string[]): User => ({
  id: 'user-1',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  allowedModules,
});

const persona = (
  role: Role,
  grants: Array<[UserPermissionGrant['permissionCode'], UserPermissionGrant['scopeType']]>,
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

const businessUser = persona(Role.EMPLOYEE, [
  ['hrm.employee.view_directory', 'global'],
  ['hrm.employee.view_profile', 'own'],
  ['hrm.employee.edit_profile', 'own'],
  ['hrm.attendance.view', 'own'],
  ['hrm.leave.view', 'own'],
]);

describe('chat route access', () => {
  it('maps the chat route to the CHAT module', () => {
    expect(getRouteModuleKey('/chat')).toBe('CHAT');
  });

  it('allows users explicitly granted CHAT', () => {
    expect(canAccessRoute(user(['HRM', 'CHAT']), '/chat')).toBe(true);
  });

  it('blocks users without CHAT', () => {
    expect(canAccessRoute(user(['HRM']), '/chat')).toBe(false);
  });

  it('keeps legacy profiles without an allowedModules list working', () => {
    expect(canAccessRoute(user(undefined), '/chat')).toBe(true);
  });

  it('always allows administrators', () => {
    expect(canAccessRoute({ ...user([]), role: Role.ADMIN }, '/chat')).toBe(true);
  });
});

describe('phase 0 route containment', () => {
  it('maps the document trace route to AUDIT_TRAIL', () => {
    expect(getRouteModuleKey('/trace')).toBe('AUDIT_TRAIL');
  });

  it('maps the contract shell route to HD', () => {
    expect(getRouteModuleKey('/hd')).toBe('HD');
  });

  it('blocks unknown protected routes for non-admin users', () => {
    expect(canAccessRoute(user(['HRM']), '/not-declared-yet')).toBe(false);
  });

  it('keeps authenticated-open profile routes available', () => {
    expect(canAccessRoute(user([]), '/my-profile')).toBe(true);
  });

  it('keeps the authenticated home route available', () => {
    expect(canAccessRoute(user([]), '/')).toBe(true);
  });

  it('keeps legacy profiles without an allowedModules list working for mapped routes', () => {
    expect(canAccessRoute(user(undefined), '/hd')).toBe(true);
  });

  it('treats a QR route as authenticated navigation, not a public capability grant', () => {
    const safetyCardRoute = '/safety-card/forwarded-token';
    expect(isAuthenticatedOpenRoute(safetyCardRoute)).toBe(true);
    expect(canAccessRoute(null, safetyCardRoute)).toBe(false);
  });
});

describe('request detail route access', () => {
  it('maps request detail deep links to the RQ module', () => {
    expect(getRouteModuleKey('/rq/f2995dba-4718-4e70-b1a8-19cc4a659e2a')).toBe('RQ');
  });

  it('allows an RQ user to open an assigned request detail', () => {
    expect(canAccessRoute({
      ...user(['RQ']),
      allowedSubModules: { RQ: ['/rq'] },
      adminSubModules: {},
      adminModules: [],
      permissionGrants: [],
    }, '/rq/f2995dba-4718-4e70-b1a8-19cc4a659e2a')).toBe(true);
  });
});

describe('HRM employee self-service route access', () => {
  it('opens employee self-service routes from own-scoped grants', () => {
    expect(canAccessRoute(businessUser, '/employee-dashboard')).toBe(true);
    expect(canAccessRoute(businessUser, '/my-profile')).toBe(true);
    expect(canAccessRoute(businessUser, '/hrm/employees')).toBe(true);
    expect(canAccessRoute(businessUser, '/hrm/checkin')).toBe(true);
    expect(canAccessRoute(businessUser, '/hrm/attendance')).toBe(true);
    expect(canAccessRoute(businessUser, '/hrm/leave')).toBe(true);
  });

  it('keeps HR-wide and sensitive routes closed to a business user', () => {
    for (const route of [
      '/hrm/dashboard',
      '/hrm/shifts',
      '/hrm/payroll',
      '/hrm/contracts',
      '/hrm/documents',
      '/hrm/reports',
      '/hrm/ranking',
      '/settings/hrm-shared-catalog',
    ]) {
      expect(canAccessRoute(businessUser, route), route).toBe(false);
    }
  });

  it('opens the HR dashboard only from an effective governed HR permission', () => {
    const hr = persona(Role.EMPLOYEE, [
      ['hrm.employee.view_sensitive', 'global'],
    ]);
    const hrManage = persona(Role.EMPLOYEE, [
      ['hrm.employee.view_sensitive', 'global'],
      ['hrm.compensation.manage', 'global'],
    ]);
    const technicalAdmin = persona(Role.ADMIN, []);

    expect(canAccessRoute(hr, '/hrm/dashboard')).toBe(true);
    expect(canAccessRoute(hrManage, '/hrm/dashboard')).toBe(true);
    expect(canAccessRoute(technicalAdmin, '/hrm/dashboard')).toBe(false);
    expect(canAccessRoute(technicalAdmin, '/settings/hrm-shared-catalog')).toBe(false);
  });

  it('allows global HR grants to satisfy own routes without widening own grants to global', () => {
    const globalAttendance = persona(Role.EMPLOYEE, [
      ['hrm.attendance.view', 'global'],
    ]);
    const ownSensitive = persona(Role.EMPLOYEE, [
      ['hrm.employee.view_sensitive', 'own'],
    ]);

    expect(canAccessRoute(globalAttendance, '/hrm/attendance')).toBe(true);
    expect(canAccessRoute(ownSensitive, '/hrm/dashboard')).toBe(false);
  });
});
