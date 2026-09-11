import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import {
  canManageProjectTab,
  canPerformProjectAction,
  canViewProjectMaterialTab,
  canViewProjectTab,
  checkProjectAction,
  getLegacyProjectCodesDerivedFromPermissionCodes,
  getProjectScope,
  legacyProjectCodeToPermissionCodes,
  projectPermissionCodeToLegacyProjectCode,
  requireProjectAction,
} from '../permissions/projectPermissionService';

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

describe('projectPermissionService', () => {
  it('returns construction-site scope when a site id is available', () => {
    expect(getProjectScope('project-1', 'site-1')).toEqual({
      scopeType: 'construction_site',
      scopeId: 'site-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
    });
    expect(getProjectScope('project-1')).toEqual({
      scopeType: 'project',
      scopeId: 'project-1',
      projectId: 'project-1',
      constructionSiteId: undefined,
    });
  });

  it('checks explicit project and construction-site grants without legacy module-admin fallback', () => {
    const grantedUser = user({
      adminModules: ['DA'],
      permissionGrants: [
        {
          id: 'grant-project',
          userId: 'user-1',
          permissionCode: 'project.daily_log.view',
          scopeType: 'project',
          scopeId: 'project-1',
          isActive: true,
        },
        {
          id: 'grant-site',
          userId: 'user-1',
          permissionCode: 'project.material_request.submit',
          scopeType: 'construction_site',
          scopeId: 'site-1',
          isActive: true,
        },
      ],
    });

    expect(canPerformProjectAction(grantedUser, 'project.daily_log.view', { projectId: 'project-1' })).toBe(true);
    expect(canPerformProjectAction(grantedUser, 'project.daily_log.view', { projectId: 'project-2' })).toBe(false);
    expect(canPerformProjectAction(grantedUser, 'project.daily_log.view', { projectId: 'project-1', constructionSiteId: 'site-1' })).toBe(true);
    expect(canPerformProjectAction(grantedUser, 'project.material_request.submit', { projectId: 'project-1', constructionSiteId: 'site-1' })).toBe(true);
    expect(canPerformProjectAction(grantedUser, 'project.material_request.submit', { projectId: 'project-1', constructionSiteId: 'site-2' })).toBe(false);
    expect(canPerformProjectAction(grantedUser, 'project.daily_log.approve', { projectId: 'project-1' })).toBe(false);
  });

  it('requires canonical Project capability for ADMIN outside backend exceptions', () => {
    expect(canPerformProjectAction(user({ role: Role.ADMIN }), 'project.daily_log.approve', { projectId: 'project-1' })).toBe(false);
    expect(canPerformProjectAction(user({
      role: Role.ADMIN,
      permissionGrants: [{
        userId: 'user-1', permissionCode: 'project.daily_log.approve',
        scopeType: 'global', scopeId: '*', isActive: true,
      }],
    }), 'project.daily_log.approve', { projectId: 'project-1' })).toBe(true);
  });

  it('does not bypass an authoritative empty snapshot from legacy role or module fields', () => {
    expect(canPerformProjectAction(user({
      role: Role.ADMIN,
      adminModules: ['DA'],
      authorizationSnapshot: {
        generatedAt: '2026-09-05T00:00:00.000Z',
        flags: { legacy_fallback_disabled: false },
        sources: [],
        roomActions: [],
      },
    }), 'project.daily_log.approve', { projectId: 'project-1' })).toBe(false);
  });

  it('checks and requires explicit namespaced project actions without legacy fallback', () => {
    const grantedUser = user({
      adminModules: ['DA'],
      permissionGrants: [{
        id: 'grant-payment',
        userId: 'user-1',
        permissionCode: 'project.payment.mark_paid',
        scopeType: 'project',
        scopeId: 'project-1',
        isActive: true,
      }],
    });

    expect(checkProjectAction(grantedUser, 'project.payment.mark_paid', { projectId: 'project-1' })).toBe(true);
    expect(checkProjectAction(grantedUser, 'project.payment.mark_paid', { projectId: 'project-2' })).toBe(false);
    expect(checkProjectAction(grantedUser, 'project.payment.approve', { projectId: 'project-1' })).toBe(false);
    expect(() => requireProjectAction(grantedUser, 'project.payment.mark_paid', { projectId: 'project-1' }, 'đánh dấu đã thanh toán')).not.toThrow();
    expect(() => requireProjectAction(grantedUser, 'project.payment.approve', { projectId: 'project-1' }, 'duyệt thanh toán'))
      .toThrow('Bạn cần quyền "project.payment.approve" để duyệt thanh toán.');
  });

  it('maps legacy project staff permission codes into namespaced Project PBAC v2 permissions', () => {
    expect(legacyProjectCodeToPermissionCodes('view')).toEqual(expect.arrayContaining([
      'project.daily_log.view',
      'project.material_request.view',
      'project.payment.view',
    ]));
    expect(legacyProjectCodeToPermissionCodes('edit')).toEqual(expect.arrayContaining([
      'project.daily_log.create',
      'project.daily_log.edit_own',
      'project.daily_log.edit_all',
    ]));
    expect(legacyProjectCodeToPermissionCodes('verify')).toEqual(expect.arrayContaining([
      'project.daily_log.verify',
      'project.daily_log.return',
    ]));
    expect(legacyProjectCodeToPermissionCodes('view_available_stock')).toEqual([
      'project.material_request.view_available_stock',
    ]);
    expect(legacyProjectCodeToPermissionCodes('view')).not.toContain('project.daily_log.create');
  });

  it('detects legacy compatibility rows derived from Project PBAC v2 grants', () => {
    expect(projectPermissionCodeToLegacyProjectCode('project.material_request.confirm_fulfillment')).toBe('confirm');
    expect(projectPermissionCodeToLegacyProjectCode('project.material_request.view_available_stock')).toBe('view_available_stock');
    expect(projectPermissionCodeToLegacyProjectCode('project.daily_log.return')).toBe('verify');
    expect(projectPermissionCodeToLegacyProjectCode('project.org.grant_permissions')).toBeNull();

    expect(getLegacyProjectCodesDerivedFromPermissionCodes([
      'project.daily_log.view',
      'project.daily_log.create',
      'project.material_request.confirm_fulfillment',
      'project.material_request.view_available_stock',
      'project.org.grant_permissions',
    ])).toEqual(['view', 'edit', 'confirm', 'view_available_stock']);
  });

  it('uses only scoped canonical grants for Project tab visibility', () => {
    const scopedUser = user({
      permissionGrants: [{
        id: 'grant-tab',
        userId: 'user-1',
        permissionCode: 'project.quality.view',
        scopeType: 'project',
        scopeId: 'project-1',
        isActive: true,
      }],
    });
    const canonicalUser = user({
      permissionGrants: [
        {
          userId: 'user-1', permissionCode: 'project.daily_log.view',
          scopeType: 'project', scopeId: 'project-1', isActive: true,
        },
        {
          userId: 'user-1', permissionCode: 'project.org.manage',
          scopeType: 'project', scopeId: 'project-1', isActive: true,
        },
      ],
    });

    expect(canViewProjectTab(scopedUser, 'quality', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectTab(scopedUser, 'quality', { projectId: 'project-2' })).toBe(false);
    expect(canViewProjectTab(canonicalUser, 'dailylog', { projectId: 'project-1' })).toBe(true);
    expect(canManageProjectTab(canonicalUser, 'org', { projectId: 'project-1' })).toBe(true);
  });

  it('uses authoritative Room view actions for Project tab navigation with strict scope isolation', () => {
    const roomUser = user({
      role: Role.ADMIN,
      authorizationSnapshot: {
        generatedAt: '2026-09-11T00:00:00.000Z',
        flags: { legacy_fallback_disabled: true },
        sources: [],
        roomActions: [
          {
            projectId: 'project-1',
            constructionSiteId: null,
            roomCode: 'daily_log',
            actionCode: 'view',
            source: 'admin',
            enforcement: 'enforced',
            fallback: false,
          },
          {
            projectId: 'project-1',
            constructionSiteId: 'site-1',
            roomCode: 'quality',
            actionCode: 'view',
            source: 'room',
            enforcement: 'enforced',
            fallback: false,
          },
          {
            projectId: 'project-1',
            constructionSiteId: null,
            roomCode: 'payment',
            actionCode: 'view',
            source: 'room',
            enforcement: 'enforced',
            fallback: false,
          },
          {
            projectId: 'project-1', constructionSiteId: null,
            roomCode: 'gantt', actionCode: 'view', source: 'room', enforcement: 'enforced', fallback: false,
          },
          {
            projectId: 'project-1', constructionSiteId: null,
            roomCode: 'weekly_progress', actionCode: 'view', source: 'room', enforcement: 'enforced', fallback: false,
          },
          {
            projectId: 'project-1', constructionSiteId: null,
            roomCode: 'safety', actionCode: 'view', source: 'room', enforcement: 'enforced', fallback: false,
          },
        ],
      },
    });

    expect(canViewProjectTab(roomUser, 'dailylog', { projectId: 'project-1', constructionSiteId: 'site-2' })).toBe(true);
    expect(canViewProjectTab(roomUser, 'dailylog', { projectId: 'project-2', constructionSiteId: 'site-2' })).toBe(false);
    expect(canViewProjectTab(roomUser, 'quality', { projectId: 'project-1', constructionSiteId: 'site-1' })).toBe(true);
    expect(canViewProjectTab(roomUser, 'quality', { projectId: 'project-1', constructionSiteId: 'site-2' })).toBe(false);
    expect(canViewProjectTab(roomUser, 'finance', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectTab(roomUser, 'gantt', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectTab(roomUser, 'weekly_progress', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectTab(roomUser, 'safety', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectTab(user({ role: Role.ADMIN }), 'dailylog', { projectId: 'project-1' })).toBe(false);
  });

  it('maps only active material Rooms to their governed material tabs', () => {
    const roomUser = user({
      authorizationSnapshot: {
        generatedAt: '2026-09-11T00:00:00.000Z',
        flags: { legacy_fallback_disabled: true },
        sources: [],
        roomActions: [
          {
            projectId: 'project-1', constructionSiteId: null,
            roomCode: 'material_planning', actionCode: 'view', source: 'room', enforcement: 'enforced', fallback: false,
          },
          {
            projectId: 'project-1', constructionSiteId: null,
            roomCode: 'material_request', actionCode: 'view', source: 'room', enforcement: 'enforced', fallback: false,
          },
          {
            projectId: 'project-1', constructionSiteId: null,
            roomCode: 'material_po', actionCode: 'view', source: 'room', enforcement: 'enforced', fallback: false,
          },
        ],
      },
    });

    expect(canViewProjectTab(roomUser, 'material', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectMaterialTab(roomUser, 'boq', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectMaterialTab(roomUser, 'request', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectMaterialTab(roomUser, 'po', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectMaterialTab(roomUser, 'custom', { projectId: 'project-1' })).toBe(false);
    expect(canViewProjectMaterialTab(roomUser, 'waste', { projectId: 'project-1' })).toBe(false);
    expect(canViewProjectTab(roomUser, 'subcontract', { projectId: 'project-1' })).toBe(false);
  });
});
