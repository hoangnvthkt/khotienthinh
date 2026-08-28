import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import {
  canPerform,
  canViewModule,
  canViewRoute,
  getInheritedPermissionCodes,
  getLegacyModuleAssignmentCount,
  isDirectPermissionGrantAllowed,
  isPermissionActionScopeAllowed,
  userHasPermissionGrant,
} from '../permissions/permissionService';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  permissionGrants: [],
  ...overrides,
});

describe('permissionService', () => {
  it('allows admins to perform every registered permission', () => {
    expect(canPerform(user({ role: Role.ADMIN }), 'project.daily_log.approve')).toBe(true);
  });

  it('does not give a technical admin implicit HRM access', () => {
    const technicalAdmin = user({
      role: Role.ADMIN,
      adminModules: ['HRM'],
    });

    expect(canPerform(technicalAdmin, 'hrm.employee.view_sensitive')).toBe(false);
    expect(canPerform(technicalAdmin, 'hrm.compensation.view')).toBe(false);
    expect(canPerform(technicalAdmin, 'system.hrm.manage')).toBe(false);
  });

  it('allows a technical admin to use HRM permissions from an effective source', () => {
    const hrAdmin = user({
      role: Role.ADMIN,
      permissionGrants: [{
        id: 'hr-role-source',
        userId: 'user-1',
        permissionCode: 'hrm.employee.view_sensitive',
        scopeType: 'global',
        scopeId: '*',
        isActive: true,
      }],
    });

    expect(canPerform(hrAdmin, 'hrm.employee.view_sensitive')).toBe(true);
  });

  it('does not let a technical admin open an HRM route without an effective HR permission', () => {
    expect(canViewRoute(user({ role: Role.ADMIN }), '/hrm/payroll')).toBe(false);
    expect(canViewRoute(user({
      role: Role.ADMIN,
      permissionGrants: [{
        userId: 'user-1',
        permissionCode: 'hrm.payroll.view',
        scopeType: 'global',
        scopeId: '*',
        isActive: true,
      }],
    }), '/hrm/payroll')).toBe(true);
  });

  it('uses active scoped grants before legacy fallback', () => {
    const grantedUser = user({
      permissionGrants: [{
        id: 'grant-1',
        userId: 'user-1',
        permissionCode: 'project.daily_log.approve',
        scopeType: 'project',
        scopeId: 'project-1',
        isActive: true,
      }],
    });

    expect(canPerform(grantedUser, 'project.daily_log.approve', { scopeType: 'project', scopeId: 'project-1' })).toBe(true);
    expect(canPerform(grantedUser, 'project.daily_log.approve', { scopeType: 'project', scopeId: 'project-2' })).toBe(false);
  });

  it('ignores inactive and expired grants', () => {
    const grantedUser = user({
      permissionGrants: [
        {
          id: 'inactive',
          userId: 'user-1',
          permissionCode: 'system.wms.view',
          scopeType: 'global',
          scopeId: '*',
          isActive: false,
        },
        {
          id: 'expired',
          userId: 'user-1',
          permissionCode: 'system.hrm.view',
          scopeType: 'global',
          scopeId: '*',
          isActive: true,
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(userHasPermissionGrant(grantedUser, 'system.wms.view')).toBe(false);
    expect(userHasPermissionGrant(grantedUser, 'system.hrm.view')).toBe(false);
  });

  it('falls back to allowedModules for legacy module view access', () => {
    expect(canViewModule(user({ allowedModules: ['WMS'] }), 'WMS')).toBe(true);
    expect(canPerform(user({ allowedModules: ['WMS'] }), 'system.wms.view')).toBe(true);
    expect(canPerform(user({ allowedModules: ['WMS'] }), 'system.wms.manage')).toBe(false);
  });

  it('opens workflow instance details from a legacy allowed submodule grant', () => {
    expect(canViewRoute(user({
      allowedSubModules: { WF: ['/wf'] },
    }), '/wf/instances/instance-1')).toBe(true);
  });

  it('opens workflow instance details from a legacy admin submodule grant', () => {
    expect(canViewRoute(user({
      allowedSubModules: { WF: [] },
      adminSubModules: { WF: ['/wf'] },
    }), '/wf/instances/instance-1')).toBe(true);
  });

  it('opens request details from a legacy request list grant', () => {
    expect(canViewRoute(user({
      allowedSubModules: { RQ: ['/rq'] },
    }), '/rq/request-1')).toBe(true);
  });

  it('does not expose workflow template routes from a legacy workflow list grant', () => {
    const workflowUser = user({ allowedSubModules: { WF: ['/wf'] } });

    expect(canViewRoute(workflowUser, '/wf/templates')).toBe(false);
    expect(canViewRoute(workflowUser, '/wf/builder/template-1')).toBe(false);
  });

  it('does not fall back to HRM module-admin aliases', () => {
    expect(canPerform(user({ adminSubModules: { HRM: ['/hrm/employees'] } }), 'system.hrm.manage')).toBe(false);
    expect(canPerform(user({ adminModules: ['HRM'] }), 'system.hrm.manage')).toBe(false);
    expect(getInheritedPermissionCodes(user({ adminModules: ['HRM'] }))).not.toContain('system.hrm.manage');
  });

  it('reports inherited legacy permission codes for read-only UI badges', () => {
    expect(getInheritedPermissionCodes(user({ allowedModules: ['DA'], adminSubModules: { DA: ['/da/tabs/dailylog'] } }))).toEqual(
      expect.arrayContaining(['system.da.view', 'project.daily_log.manage'])
    );
  });

  it('counts legacy module assignments behind the permission boundary', () => {
    expect(getLegacyModuleAssignmentCount(user({
      allowedModules: ['WMS', 'DA'],
      adminModules: ['HRM'],
    }))).toBe(3);
  });

  it('checks whether a permission action can be granted for a selected scope', () => {
    expect(isPermissionActionScopeAllowed('wms.inventory.view', { scopeType: 'warehouse', scopeId: 'wh-1' })).toBe(true);
    expect(isPermissionActionScopeAllowed('wms.inventory.view', { scopeType: 'department', scopeId: 'dep-1' })).toBe(false);
    expect(isPermissionActionScopeAllowed('analytics.export', { scopeType: 'global', scopeId: '*' })).toBe(true);
    expect(isPermissionActionScopeAllowed('analytics.export', { scopeType: 'warehouse', scopeId: 'wh-1' })).toBe(false);
    expect(isPermissionActionScopeAllowed('unknown.permission', { scopeType: 'global', scopeId: '*' })).toBe(false);
  });

  it('supports direct-report and organization-unit scopes for HRM', () => {
    expect(isPermissionActionScopeAllowed('hrm.employee.view_profile', {
      scopeType: 'direct_reports',
      scopeId: '*',
    })).toBe(true);
    expect(isPermissionActionScopeAllowed('hrm.organization.view', {
      scopeType: 'org_unit',
      scopeId: 'unit-1',
    })).toBe(true);
  });

  it('requires governed HR templates for sensitive and HR Manage-only actions', () => {
    expect(isDirectPermissionGrantAllowed('hrm.employee.view_sensitive')).toBe(false);
    expect(isDirectPermissionGrantAllowed('hrm.compensation.manage')).toBe(false);
    expect(isDirectPermissionGrantAllowed('hrm.staffing.manage')).toBe(false);
    expect(isDirectPermissionGrantAllowed('hrm.employee.view_profile')).toBe(true);
    expect(isDirectPermissionGrantAllowed('project.daily_log.approve')).toBe(true);
  });
});
