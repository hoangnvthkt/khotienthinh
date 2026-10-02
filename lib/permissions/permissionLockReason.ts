import type { EffectivePermissionSource } from '../../types';
import type { PermissionCatalogAction } from './permissionTypes';

// Why a permission box in the user editor cannot be ticked, and where to
// change it, in words an Admin can act on.

const ROLE_LABELS: Record<string, string> = { HR: 'Nhân sự', HR_MANAGE: 'Trưởng phòng nhân sự', AUDITOR: 'Kiểm toán' };

export interface PermissionLockReason {
  badge: string;
  hint: string;
}

/** Badge and hint for a permission that cannot be granted to one person here. */
export const notDirectGrantReason = (action: Pick<PermissionCatalogAction, 'permissionCode'>): PermissionLockReason => {
  if (action.permissionCode.startsWith('project.')) {
    return { badge: 'Phân quyền trong Room dự án', hint: 'Cấp trong tab Phân quyền của từng dự án.' };
  }
  if (action.permissionCode.startsWith('hrm.')) {
    return {
      badge: 'Qua vai trò nhân sự',
      hint: 'Dữ liệu nhân sự nhạy cảm: gán vai trò Nhân sự hoặc Trưởng phòng nhân sự ở mục ② Vai trò đặc biệt bên dưới.',
    };
  }
  return {
    badge: 'Chỉ vai trò quản trị',
    hint: 'Quyền quản trị hệ thống, không cấp riêng. Người có vai trò quản trị (hoặc Quản trị viên) mới dùng được.',
  };
};

/** Hint for a box locked because the person already gets it from elsewhere. */
export const inheritedLockHint = (source: Pick<EffectivePermissionSource, 'sourceType' | 'sourceCode'>): string => {
  const type = String(source.sourceType).toUpperCase();
  const code = source.sourceCode || '';
  if ((type === 'ROLE' || type === 'BUSINESS_ROLE') && ROLE_LABELS[code]) {
    return `Đã có qua vai trò ${ROLE_LABELS[code]}. Muốn bỏ: thu hồi ở mục ② Vai trò đặc biệt bên dưới.`;
  }
  if (type === 'ROLE' || type === 'BUSINESS_ROLE') {
    return `Đã có qua vai trò ${code || 'quản trị'}. Muốn bỏ: thu hồi vai trò ở Cài đặt → Vai trò đặc biệt.`;
  }
  if (type === 'INHERITED' || type === 'ADMIN') {
    return 'Đã có theo loại tài khoản. Muốn bỏ: đổi Loại tài khoản ở phía trên.';
  }
  if (type === 'LEGACY') {
    return 'Đã có từ cấu hình quyền cũ của tài khoản (danh sách module được phép), chưa bỏ riêng được ở đây.';
  }
  return 'Đã có từ nguồn khác nên không cần tick.';
};
