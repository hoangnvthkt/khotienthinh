import { describe, expect, it } from 'vitest';
import {
  buildBusinessRolePermissionGroups,
  resolveBusinessRoleItemScope,
} from '../permissions/businessRolePermissionCatalogViewModel';
import { getAllPermissionActions } from '../permissions/permissionRegistry';

describe('business role permission catalog view model', () => {
  it('groups editable actions by application and module with selected counts', () => {
    const groups = buildBusinessRolePermissionGroups({
      actions: getAllPermissionActions(),
      selectedItems: [
        { permissionCode: 'project.daily_log.view', scopeType: 'project', scopeId: 'project-1', sortOrder: 10 },
        { permissionCode: 'project.daily_log.create', scopeType: 'project', scopeId: 'project-1', sortOrder: 20 },
      ],
      query: '',
      selectedOnly: false,
    });

    const project = groups.find(group => group.applicationCode === 'project');
    const dailyLog = project?.modules.find(module => module.moduleCode === 'project.daily_log');

    expect(project?.selectedCount).toBeGreaterThanOrEqual(2);
    expect(dailyLog?.selectedCount).toBe(2);
    expect(dailyLog?.actions.map(action => action.permissionCode)).toEqual(expect.arrayContaining([
      'project.daily_log.view',
      'project.daily_log.create',
    ]));
  });

  it('filters by search query and selected-only mode', () => {
    const selectedItems = [
      { permissionCode: 'project.daily_log.view', scopeType: 'project' as const, scopeId: 'project-1', sortOrder: 10 },
    ];

    const searched = buildBusinessRolePermissionGroups({
      actions: getAllPermissionActions(),
      selectedItems,
      query: 'nhật ký',
      selectedOnly: false,
    });
    expect(searched.flatMap(group => group.modules).some(module => module.moduleCode === 'project.daily_log')).toBe(true);

    const selectedOnly = buildBusinessRolePermissionGroups({
      actions: getAllPermissionActions(),
      selectedItems,
      query: '',
      selectedOnly: true,
    });
    expect(selectedOnly.flatMap(group => group.modules)).toHaveLength(1);
    expect(selectedOnly[0].modules[0].moduleCode).toBe('project.daily_log');
  });

  it('uses requested scope only when the action supports it', () => {
    const actions = getAllPermissionActions();
    const projectAction = actions.find(action => action.permissionCode === 'project.daily_log.view');
    const systemAction = actions.find(action => action.permissionCode === 'system.wms.view');
    if (!projectAction || !systemAction) throw new Error('Missing fixture actions');

    expect(resolveBusinessRoleItemScope(projectAction, { scopeType: 'project', scopeId: 'project-1' })).toEqual({
      scopeType: 'project',
      scopeId: 'project-1',
    });
    expect(resolveBusinessRoleItemScope(systemAction, { scopeType: 'project', scopeId: 'project-1' })).toEqual({
      scopeType: 'global',
      scopeId: '*',
    });
  });
});
