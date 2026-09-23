import { describe, expect, it } from 'vitest';
import { getPermissionActionByCode, getPermissionModuleByCode } from '../permissions/permissionRegistry';
import { getProjectPermissionRoom } from '../permissions/projectPermissionRooms';

describe('Project V2 permission catalog', () => {
  it.each(['month', 'construction', 'material'] as const)('declares scoped %s planning actions', type => {
    const module = getPermissionModuleByCode(`project.v2_${type}_plan`);
    expect(module?.routes).toContain('/project-v2');
    for (const action of ['view', 'create', 'edit_own', 'edit_all', 'delete_own',
      'delete_all', 'submit', 'return', 'approve', 'manage']) {
      expect(getPermissionActionByCode(`project.v2_${type}_plan.${action}`)?.scopeTypes)
        .toEqual(['global', 'project', 'construction_site']);
    }
  });

  it.each(['v2_month_plan', 'v2_construction_plan', 'v2_material_plan'] as const)(
    'requires a dedicated %s room instead of reusing legacy material planning', code => {
      expect(getProjectPermissionRoom(code)?.actions).toEqual(expect.arrayContaining([
        'view', 'edit', 'submit', 'return', 'approve',
      ]));
    },
  );
});
