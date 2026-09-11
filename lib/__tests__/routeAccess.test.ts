import { describe, expect, it } from 'vitest';
import { Role, User, UserPermissionGrant } from '../../types';
import { canAccessRoute, getRouteModuleKey, isAuthenticatedOpenRoute } from '../routeAccess';

const user = (permissionCodes: string[] = []): User => ({
  id: 'user-1',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  permissionGrants: permissionCodes.map(permissionCode => ({
    userId: 'user-1', permissionCode, scopeType: 'global', scopeId: '*', isActive: true,
  })),
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

const governedHrPersona = (
  permissionCode: string,
  sourceCode: 'HR' | 'HR_MANAGE' = 'HR',
): User => ({
  ...persona(Role.EMPLOYEE, []),
  authorizationSnapshot: {
    generatedAt: '2026-09-11T00:00:00.000Z',
    flags: { legacy_fallback_disabled: true },
    sources: [{
      permissionCode,
      sourceType: 'business_role',
      sourceCode,
      scopeType: 'global',
      scopeId: '*',
      isBusinessApproval: true,
      metadata: {},
    }],
    roomActions: [],
  },
});

describe('chat route access', () => {
  it('maps the chat route to the CHAT module', () => {
    expect(getRouteModuleKey('/chat')).toBe('CHAT');
  });

  it('allows users explicitly granted CHAT', () => {
    expect(canAccessRoute(user(['system.chat.view']), '/chat')).toBe(true);
  });

  it('blocks users without CHAT', () => {
    expect(canAccessRoute(user([]), '/chat')).toBe(false);
  });

  it('denies profiles without a canonical CHAT grant', () => {
    expect(canAccessRoute(user(), '/chat')).toBe(false);
  });

  it('always allows administrators', () => {
    expect(canAccessRoute({ ...user(['system.chat.view']), role: Role.ADMIN }, '/chat')).toBe(true);
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
    expect(canAccessRoute(user(), '/not-declared-yet')).toBe(false);
  });

  it('keeps authenticated-open profile routes available', () => {
    expect(canAccessRoute(user([]), '/my-profile')).toBe(true);
    expect(canAccessRoute(user([]), '/my-payroll')).toBe(true);
  });

  it('keeps the authenticated home route available', () => {
    expect(canAccessRoute(user([]), '/')).toBe(true);
  });

  it('opens mapped routes only with their canonical view grant', () => {
    expect(canAccessRoute(user(['contract.partner.view']), '/hd')).toBe(true);
  });

  it('treats a QR route as authenticated navigation, not a public capability grant', () => {
    const safetyCardRoute = '/safety-card/forwarded-token';
    expect(isAuthenticatedOpenRoute(safetyCardRoute)).toBe(true);
    expect(canAccessRoute(null, safetyCardRoute)).toBe(false);
  });
});

describe('request detail route access', () => {
  const templateRoutes = ['/rq/templates', '/rq/templates/new', '/rq/templates/template-1'];

  it('maps all request template routes to RQ and allows administrators', () => {
    for (const route of templateRoutes) {
      expect(getRouteModuleKey(route), route).toBe('RQ');
      expect(canAccessRoute({ ...user(['request.template.view']), role: Role.ADMIN }, route), route).toBe(true);
    }
  });

  it('opens template editors with an explicit template view grant', () => {
    const viewer = persona(Role.EMPLOYEE, [['request.template.view', 'global']]);
    for (const route of templateRoutes) {
      expect(canAccessRoute(viewer, route), route).toBe(true);
    }
  });

  it('keeps template editors closed to users without request access', () => {
    for (const route of templateRoutes) {
      expect(canAccessRoute(persona(Role.EMPLOYEE, []), route), route).toBe(false);
    }
  });

  it('maps request detail deep links to the RQ module', () => {
    expect(getRouteModuleKey('/rq/f2995dba-4718-4e70-b1a8-19cc4a659e2a')).toBe('RQ');
  });

  it('allows a canonical request viewer to open an assigned request detail', () => {
    expect(canAccessRoute(
      user(['request.instance.view_own']),
      '/rq/f2995dba-4718-4e70-b1a8-19cc4a659e2a',
    )).toBe(true);
  });
});

describe('HRM employee self-service route access', () => {
  it('does not widen HR master-data access to unrelated HR pages', () => {
    const masterDataOnly = persona(Role.EMPLOYEE, [['hrm.master_data.view', 'global']]);

    expect(canAccessRoute(masterDataOnly, '/hrm/shifts')).toBe(true);
    expect(canAccessRoute(masterDataOnly, '/hrm/contracts')).toBe(false);
    expect(canAccessRoute(masterDataOnly, '/hrm/documents')).toBe(false);
    expect(canAccessRoute(masterDataOnly, '/hrm/reports')).toBe(false);
    expect(canAccessRoute(masterDataOnly, '/hrm/ranking')).toBe(false);
  });

  it('opens contract and document pages only from their governed HR source', () => {
    const contractViewer = governedHrPersona('hrm.contract.view');
    const documentViewer = governedHrPersona('hrm.document.view', 'HR_MANAGE');

    expect(canAccessRoute(contractViewer, '/hrm/contracts')).toBe(true);
    expect(canAccessRoute(contractViewer, '/hrm/documents')).toBe(false);
    expect(canAccessRoute(documentViewer, '/hrm/documents')).toBe(true);
    expect(canAccessRoute(documentViewer, '/hrm/contracts')).toBe(false);
  });

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

  it('does not open payroll administration from a non-template payroll grant', () => {
    const directPayrollViewer = persona(Role.EMPLOYEE, [
      ['hrm.payroll.view', 'global'],
    ]);

    expect(canAccessRoute(directPayrollViewer, '/hrm/payroll')).toBe(false);
    expect(canAccessRoute(directPayrollViewer, '/my-payroll')).toBe(true);
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

  it('opens the shared HRM catalog only for governed HR personas', () => {
    const hr = persona(Role.EMPLOYEE, [
      ['hrm.organization.view', 'global'],
      ['hrm.master_data.view', 'global'],
    ]);
    const hrManage = persona(Role.EMPLOYEE, [
      ['hrm.organization.view', 'global'],
      ['hrm.organization.manage', 'global'],
      ['hrm.master_data.view', 'global'],
      ['hrm.master_data.manage', 'global'],
    ]);
    const technicalAdmin = persona(Role.ADMIN, []);

    expect(canAccessRoute(hr, '/settings/hrm-shared-catalog')).toBe(true);
    expect(canAccessRoute(hrManage, '/settings/hrm-shared-catalog')).toBe(true);
    expect(canAccessRoute(businessUser, '/settings/hrm-shared-catalog')).toBe(false);
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
