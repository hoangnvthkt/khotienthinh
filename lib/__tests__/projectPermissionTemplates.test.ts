import { describe, expect, it } from 'vitest';
import { getAllPermissionActions } from '../permissions/permissionRegistry';
import {
  getProjectPermissionTemplateCodes,
  PROJECT_PERMISSION_TEMPLATES,
} from '../permissions/projectPermissionTemplates';

describe('projectPermissionTemplates', () => {
  const registeredCodes = new Set(getAllPermissionActions().map(action => action.permissionCode));
  const deprecatedCodes = new Set([
    'project.quality.create',
    'project.quality.edit_all',
    'project.safety.create',
    'project.safety.edit_all',
    'project.safety.verify',
    'project.safety.approve',
  ]);

  it('contains only registered namespaced project permission codes', () => {
    for (const template of PROJECT_PERMISSION_TEMPLATES) {
      const codes = getProjectPermissionTemplateCodes(template.key);

      expect(codes.length, template.key).toBeGreaterThan(0);
      expect(new Set(codes).size, template.key).toBe(codes.length);
      for (const code of codes) {
        expect(code, template.key).toMatch(/^project\./);
        expect(registeredCodes.has(code), `${template.key}: ${code}`).toBe(true);
      }
    }
  });

  it('uses Phase 3 quality and safety actions instead of deprecated broad actions', () => {
    for (const template of PROJECT_PERMISSION_TEMPLATES) {
      const codes = getProjectPermissionTemplateCodes(template.key);

      for (const code of codes) {
        expect(deprecatedCodes.has(code), `${template.key}: ${code}`).toBe(false);
      }
    }
  });

  it('keeps project manager separate from access administration privileges', () => {
    const projectManagerCodes = getProjectPermissionTemplateCodes('project_manager');
    const accessAdminCodes = getProjectPermissionTemplateCodes('access_admin');

    expect(projectManagerCodes).not.toContain('project.org.grant_permissions');
    expect(projectManagerCodes).not.toContain('project.master.hide');
    expect(projectManagerCodes).not.toContain('project.master.restore');
    expect(projectManagerCodes).not.toContain('project.master.manage_categories');
    expect(projectManagerCodes.some(code => code.endsWith('.manage'))).toBe(false);

    expect(accessAdminCodes).toEqual(expect.arrayContaining([
      'project.org.view',
      'project.org.assign_staff',
      'project.org.grant_permissions',
    ]));
  });
});
