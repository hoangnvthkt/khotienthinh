import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import {
  canManageProjectTab,
  canPerformProjectAction,
  canViewProjectTab,
  getProjectScope,
  legacyProjectCodeToPermissionCodes,
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

  it('allows ADMIN to perform project actions regardless of scope', () => {
    expect(canPerformProjectAction(user({ role: Role.ADMIN }), 'project.daily_log.approve', { projectId: 'project-1' })).toBe(true);
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

  it('uses scoped grants and legacy route fallback for Project tab visibility', () => {
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
    const legacyUser = user({
      allowedModules: ['DA'],
      allowedSubModules: { DA: ['/da/tabs/dailylog'] },
      adminSubModules: { DA: ['/da/tabs/org'] },
    });

    expect(canViewProjectTab(scopedUser, 'quality', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectTab(scopedUser, 'quality', { projectId: 'project-2' })).toBe(false);
    expect(canViewProjectTab(legacyUser, 'dailylog', { projectId: 'project-1' })).toBe(true);
    expect(canManageProjectTab(legacyUser, 'org', { projectId: 'project-1' })).toBe(true);
  });
});
