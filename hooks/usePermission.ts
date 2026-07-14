import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { canManageRoute } from '../lib/permissions/permissionService';


/**
 * Hook phân quyền CRUD theo sub-module.
 * 
 * canManage(route) — dùng cho MASTER DATA:
 *   - Admin hệ thống → luôn true
 *   - Employee → true chỉ khi route nằm trong user.adminSubModules[moduleKey]
 * 
 * Không dùng cho "công việc phát sinh" (phiếu, yêu cầu...) — giữ logic riêng từng trang.
 */
export function usePermission() {
  const { user } = useApp();
  const isAdmin = user.role === Role.ADMIN;

  const canManage = (route: string): boolean => {
    return canManageRoute(user, route);
  };

  return { canManage, isAdmin };
}
