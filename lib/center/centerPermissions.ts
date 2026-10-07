import type { PermissionApplicationDefinition } from '../permissions/permissionTypes';

export const CENTER_ROUTE = '/center';

// Khớp migration 20261008138000_center_dot0_foundation. Vào được Center cần quyền này
// và còn trong thời hạn bật theo người (máy chủ kiểm, get_center_access_v1).
export const CENTER_PERMISSION_APPLICATION: PermissionApplicationDefinition = {
  code: 'center',
  label: 'Trung tâm điều hành',
  description: 'Màn làm việc chung: việc của tôi, hôm nay, mở hồ sơ các module',
  sortOrder: 5,
  modules: [
    {
      code: 'center.module',
      label: 'Trung tâm điều hành',
      routes: [CENTER_ROUTE],
      sortOrder: 10,
      actions: [{ action: 'access', label: 'Truy cập Trung tâm điều hành', permissionCode: 'center.module.access', scopeTypes: ['global'], sortOrder: 1 }],
    },
    {
      code: 'center.layout',
      label: 'Bố cục của tôi',
      routes: [],
      sortOrder: 20,
      actions: [{ action: 'manage', label: 'Tùy chỉnh bố cục của tôi', permissionCode: 'center.layout.manage', scopeTypes: ['own'], sortOrder: 10 }],
    },
  ],
};
