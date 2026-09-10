import { Role, User } from '../types';
import { canPerform, canViewModule, canViewRoute } from './permissions/permissionService';

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
  const token = getSettingsFeatureToken(featureId);
  return canPerform(user, 'system.settings.manage') || canViewRoute(user, token);
};

export const hasAnySettingsManagementFeature = (
  user: User,
): boolean => {
  if (canPerform(user, 'system.settings.manage')) return true;
  return SETTINGS_FEATURES.some(feature => canAccessSettingsFeature(user, feature.id));
};
