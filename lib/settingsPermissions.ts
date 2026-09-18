import { Role, User } from '../types';
import { canPerform, canViewModule } from './permissions/permissionService';

export const SETTINGS_MODULE_KEY = 'SETTINGS';

export const SETTINGS_FEATURES = [
  { id: 'general', label: 'Chung' },
  { id: 'warehouses', label: 'Kho bãi' },
  { id: 'master-data', label: 'Dữ liệu gốc' },
  { id: 'g8-cost-norms', label: 'Định mức G8' },
  { id: 'project-master-data', label: 'Danh mục DA' },
  { id: 'inspection-templates', label: 'Mẫu nghiệm thu' },
  { id: 'work-groups', label: 'Nhóm làm việc' },
  { id: 'org-chart', label: 'Sơ đồ tổ chức' },
  { id: 'loss-norms', label: 'Định mức hao hụt' },
  { id: 'hrm-master-data', label: 'Danh mục dùng chung HRM' },
  { id: 'users', label: 'Người dùng' },
  { id: 'alerts', label: 'Cảnh báo' },
  { id: 'permission-health', label: 'Permission health' },
  { id: 'chibi-bot', label: 'Trợ lý ảo' },
  { id: 'ai-learning', label: 'AI Learning' },
  { id: 'maintenance', label: 'Bảo trì' },
] as const;

export type SettingsFeatureId = typeof SETTINGS_FEATURES[number]['id'] | 'account';

export interface SettingsFeaturePermission {
  view: string;
  manage: string;
}

const SETTINGS_FEATURE_PERMISSIONS: Record<Exclude<SettingsFeatureId, 'account'>, SettingsFeaturePermission> = {
  general: { view: 'settings.general.view', manage: 'settings.general.manage' },
  warehouses: { view: 'settings.warehouses.view', manage: 'settings.warehouses.manage' },
  'master-data': { view: 'settings.master_data.view', manage: 'settings.master_data.manage' },
  'g8-cost-norms': { view: 'settings.g8_cost_norms.view', manage: 'settings.g8_cost_norms.manage' },
  'project-master-data': { view: 'settings.project_master_data.view', manage: 'settings.project_master_data.manage' },
  'inspection-templates': { view: 'settings.inspection_templates.view', manage: 'settings.inspection_templates.manage' },
  'work-groups': { view: 'settings.work_groups.view', manage: 'settings.work_groups.manage' },
  'org-chart': { view: 'hrm.organization.view', manage: 'hrm.organization.manage' },
  'loss-norms': { view: 'settings.loss_norms.view', manage: 'settings.loss_norms.manage' },
  'hrm-master-data': { view: 'hrm.master_data.view', manage: 'hrm.master_data.manage' },
  users: { view: 'settings.users.view', manage: 'settings.users.manage' },
  alerts: { view: 'settings.alerts.view', manage: 'settings.alerts.manage' },
  'permission-health': { view: 'settings.permission_health.view', manage: 'settings.permission_health.manage' },
  'chibi-bot': { view: 'settings.chibi_bot.view', manage: 'settings.chibi_bot.manage' },
  'ai-learning': { view: 'settings.ai_learning.view', manage: 'settings.ai_learning.manage' },
  maintenance: { view: 'settings.maintenance.view', manage: 'settings.maintenance.manage' },
};

export const getSettingsFeaturePermission = (
  featureId: Exclude<SettingsFeatureId, 'account'>,
): SettingsFeaturePermission => SETTINGS_FEATURE_PERMISSIONS[featureId];

export const getSettingsFeatureToken = (featureId: Exclude<SettingsFeatureId, 'account'>): string =>
  `/settings/${featureId}`;

export const isSettingsUserAdmin = (user: User): boolean =>
  user.role === Role.ADMIN || canPerform(user, 'system.settings.manage');

export const getSettingsUserModuleKeys = (
  user: User,
  moduleKeys: string[],
): string[] => {
  if (isSettingsUserAdmin(user)) return [...moduleKeys];
  return moduleKeys.filter(moduleKey => canViewModule(user, moduleKey));
};

export const canAccessSettingsFeature = (
  user: User,
  featureId: SettingsFeatureId,
): boolean => {
  if (featureId === 'account') return true;
  const permission = getSettingsFeaturePermission(featureId);
  return canPerform(user, 'system.settings.manage')
    || canPerform(user, permission.view)
    || canPerform(user, permission.manage);
};

export const canManageSettingsFeature = (
  user: User,
  featureId: Exclude<SettingsFeatureId, 'account'>,
): boolean => canPerform(user, 'system.settings.manage')
  || canPerform(user, getSettingsFeaturePermission(featureId).manage);

export const hasAnySettingsManagementFeature = (
  user: User,
): boolean => {
  if (canPerform(user, 'system.settings.manage')) return true;
  return SETTINGS_FEATURES.some(feature => canAccessSettingsFeature(user, feature.id));
};
