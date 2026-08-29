import { User } from '../types';
import { canPerform } from './permissions/permissionService';
import { canAccessRoute } from './routeAccess';

type HrmNavigationUser = Pick<
  User,
  'role' | 'allowedModules' | 'allowedSubModules' | 'adminModules' | 'adminSubModules' | 'permissionGrants'
>;

export interface HrmNavigationItem {
  to: string;
  label: string;
}

const GLOBAL_SCOPE = { scopeType: 'global' as const, scopeId: '*' };

const HRM_NAVIGATION_ITEMS = [
  { to: '/employee-dashboard', employeeLabel: 'Tổng quan của tôi', hrLabel: 'Tổng quan của tôi' },
  { to: '/my-profile', employeeLabel: 'Hồ sơ của tôi', hrLabel: 'Hồ sơ của tôi' },
  { to: '/hrm/dashboard', employeeLabel: 'Dashboard nhân sự', hrLabel: 'Dashboard nhân sự' },
  { to: '/hrm/employees', employeeLabel: 'Danh bạ nhân sự', hrLabel: 'Hồ sơ nhân sự' },
  { to: '/hrm/checkin', employeeLabel: 'Check-in / Check-out', hrLabel: 'Check-in / Check-out' },
  { to: '/hrm/attendance', employeeLabel: 'Chấm công của tôi', hrLabel: 'Chấm công' },
  { to: '/hrm/shifts', employeeLabel: 'Ca làm việc', hrLabel: 'Ca làm việc' },
  { to: '/hrm/leave', employeeLabel: 'Nghỉ phép của tôi', hrLabel: 'Nghỉ phép' },
  { to: '/hrm/payroll', employeeLabel: 'Bảng lương', hrLabel: 'Bảng lương' },
  { to: '/hrm/contracts', employeeLabel: 'Hợp đồng LĐ', hrLabel: 'Hợp đồng LĐ' },
  { to: '/hrm/documents', employeeLabel: 'Hồ sơ & Công văn', hrLabel: 'Hồ sơ & Công văn' },
  { to: '/hrm/reports', employeeLabel: 'Báo cáo NS', hrLabel: 'Báo cáo NS' },
  { to: '/hrm/ranking', employeeLabel: 'Xếp hạng NV', hrLabel: 'Xếp hạng NV' },
] as const;

export const getHrmNavigationItems = (user: HrmNavigationUser): HrmNavigationItem[] => {
  const isHrPersona = canPerform(user, 'hrm.employee.view_sensitive', GLOBAL_SCOPE);
  return HRM_NAVIGATION_ITEMS
    .filter(item => canAccessRoute(user, item.to))
    .map(item => ({
      to: item.to,
      label: isHrPersona ? item.hrLabel : item.employeeLabel,
    }));
};
