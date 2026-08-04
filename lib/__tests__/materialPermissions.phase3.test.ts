import { describe, expect, it } from 'vitest';

import {
  PROJECT_MATERIAL_ACTION_CODES,
  getProjectMaterialActionCodesForRoomAction,
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
      'project.material_po.delete',
      'project.material_po.manage',
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
    expect(caps.canConfirmPo).toBe(false);
    expect(caps.canDeletePo).toBe(false);
    expect(caps.canManagePo).toBe(false);
  });

  it('keeps PO manage as an exception without implying any PO action', () => {
    const caps = capabilitiesFor(['project.material_po.manage']);

    expect(caps.canViewPo).toBe(false);
    expect(caps.canEditPo).toBe(false);
    expect(caps.canSubmitPo).toBe(false);
    expect(caps.canApprovePo).toBe(false);
    expect(caps.canConfirmPo).toBe(false);
    expect(caps.canDeletePo).toBe(false);
    expect(caps.canManagePo).toBe(true);
  });

  it('does not let PO manage cover the direct-purchase lifecycle', () => {
    const caps = capabilitiesFor(['project.material_po.manage']);

    expect(caps.canViewDirectPurchase).toBe(false);
    expect(caps.canCreateDirectPurchase).toBe(false);
    expect(caps.canEditDirectPurchase).toBe(false);
    expect(caps.canDeleteDirectPurchase).toBe(false);
    expect(caps.canRecordDirectPurchaseAp).toBe(false);
  });

  it('maps PO Room actions to the same PO capabilities used by the UI', () => {
    expect(getProjectMaterialActionCodesForRoomAction('material_po', 'submit')).toContain('project.material_po.create');
    expect(getProjectMaterialActionCodesForRoomAction('material_po', 'edit')).toContain('project.material_po.create');
    expect(getProjectMaterialActionCodesForRoomAction('material_po', 'approve')).toContain('project.material_po.approve');
    expect(getProjectMaterialActionCodesForRoomAction('material_po', 'confirm')).toContain('project.material_po.receive');
    expect(getProjectMaterialActionCodesForRoomAction('material_po', 'delete')).toContain('project.material_po.delete');
  });

  it('maps the material-planning Room to the dedicated BOQ capabilities', () => {
    expect(getProjectMaterialActionCodesForRoomAction('material_planning', 'view'))
      .toEqual(['project.material_boq.view']);
    expect(getProjectMaterialActionCodesForRoomAction('material_planning', 'edit'))
      .toEqual(['project.material_boq.edit']);
    expect(getProjectMaterialActionCodesForRoomAction('material_planning', 'delete'))
      .toEqual(['project.material_boq.delete']);
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
