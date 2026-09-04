import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import { getPermissionModuleByCode } from '../permissions/permissionRegistry';
import {
  canViewProjectMaterialTab,
  canViewProjectTab,
} from '../permissions/projectPermissionService';
import { getInheritedPermissionCodes } from '../permissions/permissionService';

describe('supplier delivery permission registry', () => {
  it('exposes every Gọi hàng HĐ NCC action in the admin permission matrix', () => {
    const module = getPermissionModuleByCode('project.material_supplier_delivery');

    expect(module?.label).toBe('Gọi hàng HĐ NCC');
    expect(module?.actions.map(action => action.permissionCode)).toEqual([
      'project.material_supplier_delivery.view',
      'project.material_supplier_delivery.create',
      'project.material_supplier_delivery.edit',
      'project.material_supplier_delivery.delete',
      'project.material_supplier_delivery.record',
      'project.material_supplier_delivery.unrecord',
      'project.material_supplier_delivery.reconcile',
    ]);
    expect(module?.actions.every(action => (
      action.scopeTypes?.includes('project')
      && action.scopeTypes?.includes('construction_site')
    ))).toBe(true);
  });

  it('opens the parent material and PO tabs from the scoped supplier-delivery view grant', () => {
    const user = {
      id: 'user-1',
      role: Role.EMPLOYEE,
      allowedModules: [],
      permissionGrants: [{
        id: 'grant-1',
        userId: 'user-1',
        permissionCode: 'project.material_supplier_delivery.view',
        scopeType: 'project',
        scopeId: 'project-1',
        isActive: true,
      }],
    } as User;

    expect(canViewProjectTab(user, 'material', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectMaterialTab(user, 'po', { projectId: 'project-1' })).toBe(true);
    expect(canViewProjectTab(user, 'material', { projectId: 'project-2' })).toBe(false);
  });

  it('does not present legacy DA routes as effective supplier-delivery grants', () => {
    const legacyUser = {
      id: 'user-1',
      name: 'Legacy user',
      email: 'legacy@example.com',
      role: Role.WAREHOUSE_KEEPER,
      allowedModules: ['DA'],
      allowedSubModules: { DA: ['/da/tabs/material', '/da/tabs/material/po'] },
      adminModules: [],
      adminSubModules: { DA: ['/da/tabs/material/po'] },
      permissionGrants: [],
    } as User;

    expect(getInheritedPermissionCodes(legacyUser)).not.toEqual(expect.arrayContaining([
      'project.material_supplier_delivery.view',
      'project.material_supplier_delivery.create',
      'project.material_supplier_delivery.edit',
      'project.material_supplier_delivery.delete',
      'project.material_supplier_delivery.record',
      'project.material_supplier_delivery.unrecord',
      'project.material_supplier_delivery.reconcile',
    ]));
  });
});
