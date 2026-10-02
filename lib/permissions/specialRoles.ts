import type { UserSpecialRole } from './businessRoleAdminService';

/**
 * Special roles: permissions that are not given box by box but as a whole role,
 * because they open sensitive data (HR) or control data (audit).
 * HR and HR Manage go through the HR role commands (one of the two at a time);
 * Auditor goes through the business-role commands.
 * System Admin and Permission Admin are only held by Admin accounts and cannot be
 * given anew (their permissions are not enforced yet), so they are shown, not offered.
 */
export type SpecialRoleCode = 'HR' | 'HR_MANAGE' | 'AUDITOR' | 'SYSTEM_ADMIN' | 'PERMISSION_ADMIN';

export interface SpecialRoleInfo {
  code: SpecialRoleCode;
  label: string;
  forWho: string;
  meaning: string;
  channel: 'hr' | 'business' | 'admin_account';
}

export const SPECIAL_ROLES: readonly SpecialRoleInfo[] = [
  {
    code: 'HR',
    label: 'Nhân sự',
    forWho: 'Chuyên viên nhân sự',
    meaning: 'Xem và sửa hồ sơ đầy đủ (kể cả phần hạn chế), hợp đồng lao động, tài liệu; sửa và duyệt chấm công, duyệt nghỉ phép của toàn công ty; xem lương và đãi ngộ.',
    channel: 'hr',
  },
  {
    code: 'HR_MANAGE',
    label: 'Trưởng phòng nhân sự',
    forWho: 'Trưởng phòng nhân sự',
    meaning: 'Mọi quyền của Nhân sự, thêm: sửa lương và đãi ngộ, sơ đồ tổ chức, định biên, danh mục nhân sự; xuất hồ sơ và bảng lương.',
    channel: 'hr',
  },
  {
    code: 'AUDITOR',
    label: 'Kiểm toán',
    forWho: 'Kiểm soát nội bộ',
    meaning: 'Xem bảng phân quyền và nhật ký thay đổi quyền của mọi người. Không sửa, không duyệt được gì.',
    channel: 'business',
  },
  {
    code: 'SYSTEM_ADMIN',
    label: 'Quản trị hệ thống',
    forWho: 'Tài khoản Quản trị viên',
    meaning: 'Sửa cài đặt hệ thống. Đã nằm trong loại tài khoản Quản trị viên.',
    channel: 'admin_account',
  },
  {
    code: 'PERMISSION_ADMIN',
    label: 'Quản trị phân quyền',
    forWho: 'Tài khoản Quản trị viên',
    meaning: 'Cấp và thu hồi quyền của người khác. Đã nằm trong loại tài khoản Quản trị viên.',
    channel: 'admin_account',
  },
];

export const specialRoleInfo = (code: string): SpecialRoleInfo | undefined =>
  SPECIAL_ROLES.find(role => role.code === code);

export type SpecialRoleChange =
  | { kind: 'assign'; role: SpecialRoleCode }
  | { kind: 'switch'; role: SpecialRoleCode; from: SpecialRoleCode }
  | { kind: 'revoke'; role: SpecialRoleCode; assignmentId: string };

/** What pressing the button on a role row does, given what the person holds now. */
export const specialRoleChangeFor = (
  held: readonly UserSpecialRole[],
  role: SpecialRoleCode,
): SpecialRoleChange | null => {
  const info = specialRoleInfo(role);
  if (!info || info.channel === 'admin_account') return null;
  const current = held.find(item => item.roleCode === role);
  if (current) return { kind: 'revoke', role, assignmentId: current.assignmentId };
  if (info.channel === 'hr') {
    const otherHr = held.find(item => item.roleCode !== role && specialRoleInfo(item.roleCode)?.channel === 'hr');
    if (otherHr) return { kind: 'switch', role, from: otherHr.roleCode as SpecialRoleCode };
  }
  return { kind: 'assign', role };
};

/** Roles shown as rows: the ones that can be given, plus any other role the person already holds. */
export const visibleSpecialRoles = (held: readonly UserSpecialRole[]): SpecialRoleInfo[] =>
  SPECIAL_ROLES.filter(role => role.channel !== 'admin_account' || held.some(item => item.roleCode === role.code));

/** Roles the person holds that this screen does not know (kept visible so nothing is hidden). */
export const unknownHeldRoles = (held: readonly UserSpecialRole[]): UserSpecialRole[] =>
  held.filter(item => !specialRoleInfo(item.roleCode));

/** "YYYY-MM-DD" from a date input → end of that day in local time, as ISO; empty → null. */
export const endOfDayIso = (date: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59).toISOString();
};

export const specialRoleChangeLabel = (change: SpecialRoleChange): string => {
  const label = specialRoleInfo(change.role)?.label || change.role;
  if (change.kind === 'revoke') return `Thu hồi vai trò ${label}`;
  if (change.kind === 'switch') return `Đổi từ ${specialRoleInfo(change.from)?.label || change.from} sang ${label}`;
  return `Gán vai trò ${label}`;
};
