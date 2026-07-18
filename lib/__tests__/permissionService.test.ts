import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import {
  canPerform,
  canViewModule,
  canViewRoute,
  getInheritedPermissionCodes,
  getLegacyModuleAssignmentCount,
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

  it('does not expose workflow template routes from a legacy workflow list grant', () => {
    const workflowUser = user({ allowedSubModules: { WF: ['/wf'] } });

    expect(canViewRoute(workflowUser, '/wf/templates')).toBe(false);
    expect(canViewRoute(workflowUser, '/wf/builder/template-1')).toBe(false);
  });

  it('falls back to adminSubModules/adminModules for legacy manage access', () => {
    expect(canPerform(user({ adminSubModules: { HRM: ['/hrm/employees'] } }), 'system.hrm.manage')).toBe(true);
    expect(canPerform(user({ adminModules: ['HRM'] }), 'system.hrm.manage')).toBe(true);
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
});
