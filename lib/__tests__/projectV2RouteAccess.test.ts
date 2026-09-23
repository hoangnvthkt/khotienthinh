import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import { canAccessNavigationModule, canAccessRoute, getAuthorizedModuleRoute,
  getRouteModuleKey } from '../routeAccess';
import { canPerform } from '../permissions/permissionService';

const actor = (codes: string[]): User => ({
  id: 'project-v2-viewer', name: 'Viewer', email: 'viewer@example.invalid', role: Role.EMPLOYEE,
  permissionGrants: codes.map(permissionCode => ({ userId: 'project-v2-viewer',
    permissionCode, scopeType: 'global', scopeId: '*', isActive: true })),
});

describe('parallel V2 route access', () => {
  it('maps both V2 list and detail routes to the existing module foundations', () => {
    expect(getRouteModuleKey('/project-v2')).toBe('DA');
    expect(getRouteModuleKey('/project-v2/plans/plan-1')).toBe('DA');
    expect(getRouteModuleKey('/procurement-v2')).toBe('PROCUREMENT');
    expect(getRouteModuleKey('/procurement-v2/demands/demand-1')).toBe('PROCUREMENT');
  });

  it('does not let legacy project access open V2 without V2 view permission', () => {
    expect(canAccessRoute(actor(['project.overview.view']), '/project-v2')).toBe(false);
    expect(canAccessRoute(actor(['project.v2_month_plan.view']), '/project-v2')).toBe(true);
    expect(canAccessRoute(actor(['project.v2_month_plan.view']), '/project-v2/plans/plan-1')).toBe(true);
    expect(canAccessNavigationModule(actor(['project.overview.view']), 'DA', '/project-v2',
      { requirePreferredRoute: true })).toBe(false);
    expect(getAuthorizedModuleRoute(actor(['project.overview.view']), 'DA', '/project-v2',
      { requirePreferredRoute: true })).toBeNull();
  });

  it('does not infer V2 mutation permission from a legacy project grant', () => {
    expect(canPerform(actor(['project.overview.view']), 'project.v2_material_plan.approve',
      { scopeType: 'project', scopeId: 'project-1' })).toBe(false);
  });

  it('keeps procurement viewing separate from PO creation', () => {
    const viewer = actor(['system.procurement.view']);
    expect(canAccessRoute(viewer, '/procurement-v2')).toBe(true);
    expect(canPerform(viewer, 'project.material_po.create', { scopeType: 'project', scopeId: 'project-1' })).toBe(false);
  });
});
