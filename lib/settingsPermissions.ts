import { Role, User } from '../types';

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
  { id: 'hrm-master-data', label: 'Dữ liệu gốc HRM' },
  { id: 'users', label: 'Người dùng' },
  { id: 'alerts', label: 'Cảnh báo' },
  { id: 'chibi-bot', label: 'Trợ lý ảo' },
  { id: 'ai-learning', label: 'AI Learning' },
  { id: 'maintenance', label: 'Bảo trì' },
] as const;

export type SettingsFeatureId = typeof SETTINGS_FEATURES[number]['id'] | 'account';

export const getSettingsFeatureToken = (featureId: Exclude<SettingsFeatureId, 'account'>): string =>
  `/settings/${featureId}`;

const hasExplicitSettingsModule = (user: Pick<User, 'allowedModules' | 'adminModules'>): boolean =>
  Boolean(user.allowedModules?.includes(SETTINGS_MODULE_KEY) || user.adminModules?.includes(SETTINGS_MODULE_KEY));

export const canAccessSettingsFeature = (
  user: Pick<User, 'role' | 'allowedModules' | 'allowedSubModules' | 'adminModules' | 'adminSubModules'>,
  featureId: SettingsFeatureId,
): boolean => {
  if (featureId === 'account') return true;
  if (user.role === Role.ADMIN) return true;

  const token = getSettingsFeatureToken(featureId);
  const allowedSettings = user.allowedSubModules?.[SETTINGS_MODULE_KEY];
  const adminSettings = user.adminSubModules?.[SETTINGS_MODULE_KEY];

  if (user.adminModules?.includes(SETTINGS_MODULE_KEY)) return true;
  if (adminSettings?.includes(token)) return true;
  if (!user.allowedModules?.includes(SETTINGS_MODULE_KEY)) return false;
  if (!Object.prototype.hasOwnProperty.call(user.allowedSubModules || {}, SETTINGS_MODULE_KEY)) return true;

  return Boolean(allowedSettings?.includes(token));
};

export const hasAnySettingsManagementFeature = (
  user: Pick<User, 'role' | 'allowedModules' | 'allowedSubModules' | 'adminModules' | 'adminSubModules'>,
): boolean => {
  if (user.role === Role.ADMIN || hasExplicitSettingsModule(user)) return true;
  return SETTINGS_FEATURES.some(feature => canAccessSettingsFeature(user, feature.id));
};
