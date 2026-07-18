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
]);

const ENFORCED_PERMISSION_CODES = new Set<string>();

export const resolvePermissionActionReadiness = (
  action: PermissionActionDefinition,
): PermissionActionReadiness => {
  if (VERIFIED_PERMISSION_CODES.has(action.permissionCode)) return 'verified';
  if (ENFORCED_PERMISSION_CODES.has(action.permissionCode)) return 'enforced';
  if (action.action === 'manage') return 'legacy';
  return 'declared';
};

export const canAddDirectGrant = (action: PermissionActionDefinition): boolean =>
  ['enforced', 'verified'].includes(resolvePermissionActionReadiness(action));

export const canRemoveDirectGrant = (hasDirectGrant: boolean): boolean => hasDirectGrant;
