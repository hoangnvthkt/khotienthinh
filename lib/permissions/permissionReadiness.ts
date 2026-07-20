import type {
  PermissionActionDefinition,
  PermissionActionReadiness,
} from './permissionTypes';

const VERIFIED_PERMISSION_CODES = new Set([
  'project.daily_log.view',
  'project.daily_log.create',
  'project.daily_log.edit_own',
  'project.daily_log.edit_all',
  'project.daily_log.delete_own',
  'project.daily_log.delete_all',
  'project.daily_log.submit',
  'project.daily_log.return',
  'project.daily_log.verify',
  'project.daily_log.approve',
  'project.daily_log.summarize',
  'project.payment.verify',
  'project.payment.approve',
  'project.payment.confirm',
  'project.quantity_acceptance.verify',
  'project.quantity_acceptance.approve',
  'project.material_request.approve',
  'project.material_po.approve',
  'project.custom_material.approve',
]);

const ENFORCED_PERMISSION_CODES = new Set<string>();
[
  'asset.catalog.view',
  'asset.catalog.create',
  'asset.catalog.edit',
  'asset.catalog.delete',
  'asset.catalog.dispose',
  'asset.catalog.import',
  'asset.catalog.transfer_stock',
  'asset.assignment.view',
  'asset.assignment.assign',
  'asset.assignment.return',
  'asset.assignment.transfer',
  'asset.maintenance.view',
  'asset.maintenance.create',
  'asset.maintenance.complete',
  'asset.maintenance.import',
  'asset.audit.view',
  'hrm.employee.view',
  'hrm.employee.create',
  'hrm.employee.edit',
].forEach(code => ENFORCED_PERMISSION_CODES.add(code));

export const resolvePermissionActionReadiness = (
  action: PermissionActionDefinition,
): PermissionActionReadiness => {
  if (VERIFIED_PERMISSION_CODES.has(action.permissionCode)) return 'verified';
  if (ENFORCED_PERMISSION_CODES.has(action.permissionCode)) return 'enforced';
  if (action.action === 'manage') return 'legacy';
  return 'declared';
};

export const canAddDirectGrant = (action: PermissionActionDefinition): boolean =>
  resolvePermissionActionReadiness(action) !== 'legacy';

export const canRemoveDirectGrant = (hasDirectGrant: boolean): boolean => hasDirectGrant;
