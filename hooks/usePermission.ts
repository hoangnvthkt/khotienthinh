import { useApp } from '../context/AppContext';
import { Role } from '../types';

// Route → Module key mapping (shared with App.tsx)
const ROUTE_TO_MODULE: Record<string, string> = {
  '/dashboard': 'WMS', '/requests': 'WMS', '/inventory': 'WMS', '/operations': 'WMS',
  '/audit': 'WMS', '/reports': 'WMS', '/misa-export': 'WMS',
  '/hrm/dashboard': 'HRM', '/hrm/checkin': 'HRM', '/hrm/employees': 'HRM',
  '/hrm/attendance': 'HRM', '/hrm/shifts': 'HRM', '/hrm/leave': 'HRM',
  '/hrm/payroll': 'HRM', '/hrm/contracts': 'HRM', '/hrm/documents': 'HRM', '/hrm/reports': 'HRM',
  '/wf/dashboard': 'WF', '/wf': 'WF', '/wf/templates': 'WF',
  '/da': 'DA', '/da/portfolio': 'DA',
  '/ts/dashboard': 'TS', '/ts/catalog': 'TS', '/ts/assignment': 'TS',
  '/ts/maintenance': 'TS', '/ts/audit': 'TS', '/ts/reports': 'TS',
  '/rq/dashboard': 'RQ', '/rq': 'RQ', '/rq/categories': 'RQ',
  '/expense': 'EX',
};

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
