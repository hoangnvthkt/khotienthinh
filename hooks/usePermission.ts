import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { ROUTE_TO_MODULE } from '../constants/routes';


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
    if (isAdmin) return true;

    const moduleKey = ROUTE_TO_MODULE[route];
    if (!moduleKey) return false;

    // Check old adminModules for backward compat
    const oldAdminModules = user.adminModules || [];
    if (oldAdminModules.includes(moduleKey)) return true;

    // Check new adminSubModules
    const adminSubs = user.adminSubModules?.[moduleKey];
    if (adminSubs && adminSubs.length > 0 && adminSubs.includes(route)) return true;

    return false;
  };

  return { canManage, isAdmin };
}
