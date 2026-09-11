import type { Employee, EffectivePermissionSource, User } from '../types';
import { evaluateCapability } from './permissions/authorizationEvaluator';
import { getUserAuthorizationSnapshot } from './permissions/permissionService';

type AttendanceUser = Pick<
  User,
  'role' | 'permissionGrants' | 'effectivePermissionSources' | 'authorizationSnapshot'
> | null | undefined;

const LEGACY_HR_ROLE_PREFIX = 'LEGACY_HR_';
const ATTENDANCE_OPERATOR_PERMISSIONS = new Set([
  'hrm.attendance.edit',
  'hrm.attendance.approve',
]);

const sourceIsActive = (source: EffectivePermissionSource, now: Date): boolean => {
  if (source.startsAt && Date.parse(source.startsAt) > now.getTime()) return false;
  if (source.expiresAt && Date.parse(source.expiresAt) <= now.getTime()) return false;
  return true;
};

const isSameRoleAssignment = (
  left: EffectivePermissionSource,
  right: EffectivePermissionSource,
): boolean => {
  if (left.sourceId && right.sourceId) return left.sourceId === right.sourceId;
  return Boolean(left.sourceCode && left.sourceCode === right.sourceCode);
};

const isMigratedLegacyHrmRole = (source: EffectivePermissionSource): boolean => {
  const sourceType = source.sourceType.toUpperCase();
  return (sourceType === 'ROLE' || sourceType === 'BUSINESS_ROLE')
    && (source.sourceCode || '').toUpperCase().startsWith(LEGACY_HR_ROLE_PREFIX);
};

/**
 * Legacy HR module-view profiles were migrated as global permission templates.
 * They may see only their own attendance unless the same migrated role also
 * carries an attendance operator capability. Canonical HR roles and explicit
 * global grants keep their configured scope.
 */
export const canViewCompanyAttendance = (
  user: AttendanceUser,
  now = new Date(),
): boolean => {
  const snapshot = getUserAuthorizationSnapshot(user);
  if (!snapshot) return false;

  const sources = snapshot.sources.filter(source => {
    if (source.permissionCode !== 'hrm.attendance.view') return true;
    if (!isMigratedLegacyHrmRole(source)) return true;
    if (!sourceIsActive(source, now)) return true;

    return snapshot.sources.some(candidate =>
      ATTENDANCE_OPERATOR_PERMISSIONS.has(candidate.permissionCode)
      && sourceIsActive(candidate, now)
      && isSameRoleAssignment(source, candidate)
    );
  });

  return evaluateCapability(
    { ...snapshot, sources },
    'hrm.attendance.view',
    { scopeType: 'global', scopeId: '*' },
    now,
  ).allowed;
};

export const selectAttendanceEmployees = (
  employees: Employee[],
  userId: string,
  canViewCompany: boolean,
): Employee[] => employees.filter(employee =>
  employee.status === 'Đang làm việc'
  && (canViewCompany || employee.userId === userId)
);
