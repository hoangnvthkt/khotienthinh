import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PROJECT_PERMISSION_ROOMS } from '../permissions/projectPermissionRooms';
import { PROJECT_PERMISSION_MODULES } from '../permissions/projectPermissionRegistry';
import {
  PROJECT_MATERIAL_ACTION_CODES,
  getProjectMaterialCapabilities,
} from '../permissions/projectMaterialPermissions';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const RETIRED_ROOMS = ['material_waste', 'custom_material', 'boq_reconciliation', 'subcontract'];

describe('Authorization V2 retired view-only Rooms', () => {
  it('removes all four retired modules from the Room registry', () => {
    expect(PROJECT_PERMISSION_ROOMS.map(room => room.code))
      .not.toEqual(expect.arrayContaining(RETIRED_ROOMS));
  });

  it('publishes only view capabilities for the retired canonical modules', () => {
    const actions = new Map(PROJECT_PERMISSION_MODULES.map(module => [
      module.code,
      module.actions.map(action => action.permissionCode),
    ]));

    expect(actions.get('project.material_waste')).toEqual(['project.material_waste.view']);
    expect(actions.get('project.custom_material')).toEqual(['project.custom_material.view']);
    expect(actions.get('project.subcontract')).toEqual(['project.subcontract.view']);
    expect(PROJECT_MATERIAL_ACTION_CODES).not.toEqual(expect.arrayContaining([
      'project.material_waste.record',
      'project.material_waste.approve',
      'project.custom_material.create',
      'project.custom_material.approve',
    ]));
  });

  it('never turns obsolete direct grants into mutation capability for ordinary users', () => {
    const ordinary = getProjectMaterialCapabilities(new Set([
      'project.material_waste.record',
      'project.material_waste.approve',
      'project.custom_material.create',
      'project.custom_material.approve',
    ]));
    const admin = getProjectMaterialCapabilities(new Set(), { isAdmin: true });

    expect(ordinary.canRecordWaste).toBe(false);
    expect(ordinary.canApproveWaste).toBe(false);
    expect(ordinary.canCreateCustomMaterial).toBe(false);
    expect(ordinary.canApproveCustomMaterial).toBe(false);
    expect(admin.canRecordWaste).toBe(true);
    expect(admin.canApproveWaste).toBe(true);
    expect(admin.canCreateCustomMaterial).toBe(true);
    expect(admin.canApproveCustomMaterial).toBe(true);
  });

  it('gates every retired-module mutation surface on System Admin', () => {
    const material = read('pages/project/MaterialTab.tsx');
    const boq = read('components/project/BoqReconciliationPanel.tsx');
    const subcontract = read('pages/project/SubcontractTab.tsx');
    const dashboard = read('pages/ProjectDashboard.tsx');

    expect(material).toContain('canCreate={isAdmin}');
    expect(material).toContain('canApprove={isAdmin}');
    expect(boq).toContain('const canMutate = isAdminUser;');
    expect(subcontract).toContain('isAdmin = false');
    expect(subcontract).toContain('const canMutate = isAdmin;');
    expect(dashboard).toContain('isAdmin={isAdmin}');
  });
});
