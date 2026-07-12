import { describe, expect, it } from 'vitest';
import {
  getAllPermissionActions,
  getPermissionApplications,
  getPermissionModuleByCode,
  getPermissionModules,
  getPermissionRoutes,
  permissionRegistry,
} from '../permissions/permissionRegistry';
import {
  PROJECT_MATERIAL_TAB_PERMISSIONS,
  PROJECT_TAB_PERMISSIONS,
} from '../projectTabPermissions';

describe('permissionRegistry', () => {
  it('defines unique permission codes and module codes', () => {
    const actions = getAllPermissionActions();
    const actionCodes = actions.map(action => action.permissionCode);
    const moduleCodes = getPermissionModules().map(module => module.code);

    expect(new Set(actionCodes).size).toBe(actionCodes.length);
    expect(new Set(moduleCodes).size).toBe(moduleCodes.length);
  });

  it('seeds the common ERP applications and project detail permissions', () => {
    const applicationCodes = getPermissionApplications().map(app => app.code);
    const actionCodes = getAllPermissionActions().map(action => action.permissionCode);

    expect(applicationCodes).toEqual(expect.arrayContaining(['system', 'project']));
    expect(actionCodes).toEqual(expect.arrayContaining([
      'system.wms.view',
      'system.settings.manage',
      'project.daily_log.view',
      'project.daily_log.approve',
      'project.material_request.view_available_stock',
      'project.quality.manage',
    ]));
  });

  it('seeds the full Project PBAC v2 module tree', () => {
    const moduleCodes = getPermissionModules().map(module => module.code);
    const actionCodes = getAllPermissionActions().map(action => action.permissionCode);

    expect(moduleCodes).toEqual(expect.arrayContaining([
      'project.overview',
      'project.org',
      'project.executive',
      'project.daily_log',
      'project.material_request',
      'project.material_plan',
      'project.material_boq',
      'project.material_po',
      'project.custom_material',
      'project.gantt',
      'project.weekly_progress',
      'project.contract',
      'project.subcontract',
      'project.payment',
      'project.quantity_acceptance',
      'project.cashflow',
      'project.budget',
      'project.quality',
      'project.safety',
      'project.documents',
      'project.report',
    ]));

    expect(actionCodes).toEqual(expect.arrayContaining([
      'project.org.grant_permissions',
      'project.daily_log.verify',
      'project.daily_log.delete_own',
      'project.daily_log.delete_all',
      'project.material_request.confirm',
      'project.material_po.receive',
      'project.payment.mark_paid',
      'project.documents.upload',
      'project.report.export',
    ]));
  });

  it('maps every Project tab route to a project view permission', () => {
    const projectRoutes = [
      ...PROJECT_TAB_PERMISSIONS.map(tab => tab.route),
      ...PROJECT_MATERIAL_TAB_PERMISSIONS.map(tab => tab.route),
    ];

    for (const route of projectRoutes) {
      const matchingModules = getPermissionModules().filter(module =>
        (module.routes || []).includes(route)
      );

      expect(matchingModules.length, route).toBeGreaterThan(0);
      expect(
        matchingModules.some(module =>
          module.code.startsWith('project.') &&
          module.actions.some(action => action.action === 'view' && action.permissionCode.startsWith('project.'))
        ),
        route,
      ).toBe(true);
    }
  });

  it('keeps Project modules scoped to project or construction site grants', () => {
    const projectModules = getPermissionModules().filter(module => module.code.startsWith('project.'));

    for (const module of projectModules) {
      expect(getPermissionModuleByCode(module.code)).toBe(module);
      for (const action of module.actions) {
        expect(action.scopeTypes).toEqual(expect.arrayContaining(['project', 'construction_site']));
      }
    }
  });

  it('keeps registry routes unique', () => {
    const routes = getPermissionRoutes();

    expect(routes.length).toBeGreaterThan(20);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('exports immutable application definitions', () => {
    expect(() => {
      (permissionRegistry[0].modules as any).push({ code: 'bad' });
    }).toThrow();
  });
});
