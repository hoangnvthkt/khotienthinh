import { describe, expect, it } from 'vitest';

import {
  PROJECT_MATERIAL_ACTION_CODES,
  getProjectMaterialCapabilities,
} from '../permissions/projectMaterialPermissions';

const capabilitiesFor = (codes: string[]) =>
  getProjectMaterialCapabilities(new Set(codes));

describe('Phase 3.3 Material permission capabilities', () => {
  it('keeps the Material action surface explicit and namespaced', () => {
    expect(PROJECT_MATERIAL_ACTION_CODES.length).toBeGreaterThan(15);
    expect(PROJECT_MATERIAL_ACTION_CODES.every(code => code.startsWith('project.'))).toBe(true);
    expect(PROJECT_MATERIAL_ACTION_CODES).toEqual(expect.arrayContaining([
      'project.material_boq.edit',
      'project.material_plan.edit',
      'project.material_request.create',
      'project.material_request.view_available_stock',
      'project.custom_material.approve',
      'project.material_po.receive',
      'project.material_waste.approve',
    ]));
  });

  it('does not let request view imply create, approval, fulfillment, or available stock', () => {
    const caps = capabilitiesFor(['project.material_request.view']);

    expect(caps.canViewMaterialRequest).toBe(true);
    expect(caps.canCreateMaterialRequest).toBe(false);
    expect(caps.canApproveMaterialRequest).toBe(false);
    expect(caps.canConfirmFulfillment).toBe(false);
    expect(caps.canViewAvailableStock).toBe(false);
  });

  it('does not let request create imply submit or approve', () => {
    const caps = capabilitiesFor(['project.material_request.create']);

    expect(caps.canCreateMaterialRequest).toBe(true);
    expect(caps.canSubmitMaterialRequest).toBe(false);
    expect(caps.canApproveMaterialRequest).toBe(false);
  });

  it('does not let request approval imply PO receiving', () => {
    const caps = capabilitiesFor(['project.material_request.approve', 'project.material_po.approve']);

    expect(caps.canApproveMaterialRequest).toBe(true);
    expect(caps.canApprovePo).toBe(true);
    expect(caps.canReceivePo).toBe(false);
  });

  it('requires the dedicated available-stock action for stock exposure', () => {
    const withoutStock = capabilitiesFor([
      'project.material_request.view',
      'project.material_request.create',
      'project.material_request.approve',
    ]);
    const withStock = capabilitiesFor(['project.material_request.view_available_stock']);

    expect(withoutStock.canViewAvailableStock).toBe(false);
    expect(withStock.canViewAvailableStock).toBe(true);
  });
});
