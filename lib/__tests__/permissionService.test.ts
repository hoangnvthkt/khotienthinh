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
  it('keeps offline admins on registered technical actions without business approval bypass', () => {
    const admin = user({ role: Role.ADMIN });
    expect(canPerform(admin, 'system.settings.manage')).toBe(true);
    expect(canPerform(admin, 'project.daily_log.approve')).toBe(false);
    expect(canPerform(admin, 'unknown.permission')).toBe(false);
  });

  it('denies System Admin automatic business approval when effective sources are authoritative', () => {
    expect(canPerform(user({
      role: Role.ADMIN,
      allowedModules: ['DA'],
      effectivePermissions: [],
    }), 'project.daily_log.approve', {
      scopeType: 'project', scopeId: 'project-1',
    })).toBe(false);
  });

  it('allows a scoped Business Role source and denies the adjacent scope', () => {
    const roleUser = user({
      effectivePermissions: [{
        permissionCode: 'project.daily_log.approve',
        sourceType: 'ROLE', sourceId: 'assignment-1',
        sourceCode: 'PROJECT_APPROVER', sourceLabel: 'Project Approver',
        scopeType: 'project', scopeId: 'project-1',
        riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
      }],
    });

    expect(canPerform(roleUser, 'project.daily_log.approve', {
      scopeType: 'project', scopeId: 'project-1',
    })).toBe(true);
    expect(canPerform(roleUser, 'project.daily_log.approve', {
      scopeType: 'project', scopeId: 'project-2',
    })).toBe(false);
  });

  it('uses a direct view source without requiring legacy module arrays', () => {
    expect(canViewModule(user({
      allowedModules: [],
      effectivePermissions: [{
        permissionCode: 'wms.inventory.view',
        sourceType: 'DIRECT', sourceId: 'grant-1',
        sourceCode: 'DIRECT', sourceLabel: 'Direct grant',
        scopeType: 'warehouse', scopeId: 'warehouse-1',
        riskLevel: 'normal', isBusinessApproval: false, metadata: {},
      }],
    }), 'wms.inventory', {
      scopeType: 'warehouse', scopeId: 'warehouse-1',
    })).toBe(true);
  });

  it('fails closed for a malformed effective-source time', () => {
    expect(canPerform(user({
      effectivePermissions: [{
        permissionCode: 'project.daily_log.approve',
        sourceType: 'ROLE', sourceId: 'bad-time',
        sourceCode: 'APPROVER', sourceLabel: 'Approver',
        scopeType: 'project', scopeId: 'project-1',
        startsAt: 'not-a-time', expiresAt: null,
        riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
      }],
    }), 'project.daily_log.approve', {
      scopeType: 'project', scopeId: 'project-1',
    })).toBe(false);
  });

  it('does not open the registered module route from a non-view action source alone', () => {
    const approver = user({
      allowedModules: [], allowedSubModules: {},
      effectivePermissions: [{
        permissionCode: 'project.daily_log.approve',
        sourceType: 'DIRECT', sourceId: 'grant-approve',
        sourceCode: 'DIRECT', sourceLabel: 'Direct grant',
        scopeType: 'project', scopeId: 'project-1',
        riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
      }],
    });

    expect(canViewRoute(approver, '/da/tabs/dailylog')).toBe(false);
    expect(canPerform(approver, 'project.daily_log.verify', {
      scopeType: 'project', scopeId: 'project-1',
    })).toBe(false);
  });

  it('opens the registered module route only when a view source exists', () => {
    const dailyLogUser = user({
      allowedModules: [], allowedSubModules: {},
      effectivePermissions: [
        {
          permissionCode: 'project.daily_log.view',
          sourceType: 'DIRECT', sourceId: 'grant-view',
          sourceCode: 'DIRECT', sourceLabel: 'Direct grant',
          scopeType: 'project', scopeId: 'project-1',
          riskLevel: 'normal', isBusinessApproval: false, metadata: {},
        },
        {
          permissionCode: 'project.daily_log.approve',
          sourceType: 'DIRECT', sourceId: 'grant-approve',
          sourceCode: 'DIRECT', sourceLabel: 'Direct grant',
          scopeType: 'project', scopeId: 'project-1',
          riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
        },
      ],
    });

    expect(canViewRoute(dailyLogUser, '/da/tabs/dailylog')).toBe(true);
    expect(canPerform(dailyLogUser, 'project.daily_log.approve', {
      scopeType: 'project', scopeId: 'project-1',
    })).toBe(true);
    expect(canPerform(dailyLogUser, 'project.daily_log.verify', {
      scopeType: 'project', scopeId: 'project-1',
    })).toBe(false);
  });

  it('does not open asset routes from a non-view effective action alone', () => {
    const actor = user({
      effectivePermissions: [{
        permissionCode: 'asset.catalog.create',
        sourceType: 'DIRECT',
        sourceId: 'grant-create',
        sourceCode: 'DIRECT',
        sourceLabel: 'Direct grant',
        scopeType: 'warehouse',
        scopeId: 'wh-1',
        riskLevel: 'normal',
        isBusinessApproval: false,
        metadata: {},
      }],
    });

    expect(canViewModule(actor, 'TS')).toBe(false);
    expect(canViewRoute(actor, '/ts/catalog')).toBe(false);
  });

  it('opens only the asset route whose matching view source exists', () => {
    const actor = user({
      effectivePermissions: [{
        permissionCode: 'asset.catalog.view',
        sourceType: 'DIRECT',
        sourceId: 'grant-view',
        sourceCode: 'DIRECT',
        sourceLabel: 'Direct grant',
        scopeType: 'warehouse',
        scopeId: 'wh-1',
        riskLevel: 'normal',
        isBusinessApproval: false,
        metadata: {},
      }],
    });

    expect(canViewModule(actor, 'TS')).toBe(true);
    expect(canViewRoute(actor, '/ts/catalog')).toBe(true);
    expect(canViewRoute(actor, '/ts/assignment')).toBe(false);
  });

  it('does not reveal a sibling route from another permission module', () => {
    const poApprover = user({
      effectivePermissions: [
        {
          permissionCode: 'project.material_po.view',
          sourceType: 'ROLE', sourceId: 'assignment-po-view',
          sourceCode: 'PO_APPROVER', sourceLabel: 'PO Approver',
          scopeType: 'project', scopeId: 'project-1',
          riskLevel: 'normal', isBusinessApproval: false, metadata: {},
        },
        {
          permissionCode: 'project.material_po.approve',
          sourceType: 'ROLE', sourceId: 'assignment-po',
          sourceCode: 'PO_APPROVER', sourceLabel: 'PO Approver',
          scopeType: 'project', scopeId: 'project-1',
          riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
        },
      ],
    });

    expect(canViewRoute(poApprover, '/da/tabs/material/po')).toBe(true);
    expect(canViewRoute(poApprover, '/da/tabs/material/planning')).toBe(false);
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
