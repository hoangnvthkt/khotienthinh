export const PROJECT_MATERIAL_ACTION_CODES = Object.freeze([
  'project.material.view',
  'project.material_boq.view',
  'project.material_boq.edit',
  'project.material_boq.delete',
  'project.material_plan.view',
  'project.material_plan.edit',
  'project.material_request.view',
  'project.material_request.create',
  'project.material_request.edit_own',
  'project.material_request.edit_all',
  'project.material_request.submit',
  'project.material_request.return',
  'project.material_request.approve',
  'project.material_request.confirm_fulfillment',
  'project.material_request.view_available_stock',
  'project.custom_material.view',
  'project.custom_material.create',
  'project.custom_material.approve',
  'project.material_po.view',
  'project.material_po.create',
  'project.material_po.approve',
  'project.material_po.receive',
  'project.material_waste.view',
  'project.material_waste.record',
  'project.material_waste.approve',
] as const);

export type ProjectMaterialActionCode = (typeof PROJECT_MATERIAL_ACTION_CODES)[number];

export type ProjectMaterialCapability = {
  canViewMaterialSummary: boolean;
  canViewBoq: boolean;
  canEditBoq: boolean;
  canDeleteBoq: boolean;
  canViewPlanning: boolean;
  canEditPlanning: boolean;
  canViewMaterialRequest: boolean;
  canCreateMaterialRequest: boolean;
  canEditOwnMaterialRequest: boolean;
  canEditAllMaterialRequest: boolean;
  canSubmitMaterialRequest: boolean;
  canReturnMaterialRequest: boolean;
  canApproveMaterialRequest: boolean;
  canConfirmFulfillment: boolean;
  canViewAvailableStock: boolean;
  canViewCustomMaterial: boolean;
  canCreateCustomMaterial: boolean;
  canApproveCustomMaterial: boolean;
  canViewPo: boolean;
  canCreatePo: boolean;
  canApprovePo: boolean;
  canReceivePo: boolean;
  canViewWaste: boolean;
  canRecordWaste: boolean;
  canApproveWaste: boolean;
};

type PermissionLookup =
  | ReadonlySet<string>
  | readonly string[]
  | ((permissionCode: ProjectMaterialActionCode) => boolean);

const hasPermission = (lookup: PermissionLookup, code: ProjectMaterialActionCode) => {
  if (typeof lookup === 'function') return lookup(code);
  if (typeof (lookup as ReadonlySet<string>).has === 'function') return (lookup as ReadonlySet<string>).has(code);
  return (lookup as readonly string[]).includes(code);
};

export const getProjectMaterialCapabilities = (
  grantedPermissions: PermissionLookup,
  options: { isAdmin?: boolean } = {},
): ProjectMaterialCapability => {
  const can = (code: ProjectMaterialActionCode) =>
    Boolean(options.isAdmin) || hasPermission(grantedPermissions, code);

  return {
    canViewMaterialSummary: can('project.material.view'),
    canViewBoq: can('project.material_boq.view'),
    canEditBoq: can('project.material_boq.edit'),
    canDeleteBoq: can('project.material_boq.delete'),
    canViewPlanning: can('project.material_plan.view'),
    canEditPlanning: can('project.material_plan.edit'),
    canViewMaterialRequest: can('project.material_request.view'),
    canCreateMaterialRequest: can('project.material_request.create'),
    canEditOwnMaterialRequest: can('project.material_request.edit_own'),
    canEditAllMaterialRequest: can('project.material_request.edit_all'),
    canSubmitMaterialRequest: can('project.material_request.submit'),
    canReturnMaterialRequest: can('project.material_request.return'),
    canApproveMaterialRequest: can('project.material_request.approve'),
    canConfirmFulfillment: can('project.material_request.confirm_fulfillment'),
    canViewAvailableStock: can('project.material_request.view_available_stock'),
    canViewCustomMaterial: can('project.custom_material.view'),
    canCreateCustomMaterial: can('project.custom_material.create'),
    canApproveCustomMaterial: can('project.custom_material.approve'),
    canViewPo: can('project.material_po.view'),
    canCreatePo: can('project.material_po.create'),
    canApprovePo: can('project.material_po.approve'),
    canReceivePo: can('project.material_po.receive'),
    canViewWaste: can('project.material_waste.view'),
    canRecordWaste: can('project.material_waste.record'),
    canApproveWaste: can('project.material_waste.approve'),
  };
};
