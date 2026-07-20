import { describe, expect, it } from 'vitest';
import {
  getAllPermissionActions,
  getPermissionApplications,
  getPermissionModules,
} from '../permissions/permissionRegistry';

describe('application permission registry contract', () => {
  it('has one view gateway action for every module', () => {
    for (const module of getPermissionModules()) {
      const viewActions = module.actions.filter(action => action.action === 'view');
      expect(viewActions, module.code).toHaveLength(1);
      expect(viewActions[0].permissionCode).toMatch(/\.view$/);
      expect(viewActions[0].permissionGroup).toBe('access');
    }
  });

  it('labels non-view ordinary actions as action group', () => {
    const ordinaryActions = getAllPermissionActions()
      .filter(action => action.action !== 'view' && action.action !== 'manage' && !action.permissionCode.includes('.settings.'));

    expect(ordinaryActions.length).toBeGreaterThan(20);
    for (const action of ordinaryActions) {
      expect(action.permissionGroup, action.permissionCode).toBe('action');
    }
  });

  it('labels app administration permissions explicitly', () => {
    const adminActions = getAllPermissionActions()
      .filter(action => action.action !== 'view' && (
        action.action === 'manage' || action.permissionCode.includes('.settings.')
      ));

    expect(adminActions.map(action => action.permissionCode)).toEqual(expect.arrayContaining([
      'hrm.master_data.manage',
      'asset.catalog.manage',
      'asset.maintenance.manage',
    ]));

    for (const action of adminActions) {
      expect(action.permissionGroup, action.permissionCode).toBe('admin');
    }
  });

  it('keeps application list stable and complete for the workbench', () => {
    expect(getPermissionApplications().map(app => app.code)).toEqual(expect.arrayContaining([
      'wms',
      'hrm',
      'workflow',
      'request',
      'asset',
      'contract',
      'ai',
      'storage',
      'kb',
      'analytics',
    ]));
  });
});
