import { describe, expect, it } from 'vitest';
import type { Employee, User } from '../../types';
import { Role } from '../../types';
import {
  canViewCompanyAttendance,
  selectAttendanceEmployees,
} from '../hrmAttendanceVisibility';

const employees = [
  { id: 'employee-1', userId: 'user-1', fullName: 'Một', status: 'Đang làm việc' },
  { id: 'employee-2', userId: 'user-2', email: 'one@example.com', fullName: 'Hai', status: 'Đang làm việc' },
  { id: 'employee-3', userId: 'user-3', fullName: 'Ba', status: 'Đã nghỉ việc' },
] as Employee[];

const makeUser = (sources: NonNullable<User['authorizationSnapshot']>['sources']): User => ({
  id: 'user-1',
  name: 'User 1',
  email: 'one@example.com',
  role: Role.EMPLOYEE,
  authorizationSnapshot: {
    generatedAt: '2026-09-11T00:00:00.000Z',
    flags: { legacy_fallback_disabled: true },
    sources,
    roomActions: [],
  },
});

const source = (permissionCode: string, sourceCode: string, scopeType = 'global' as const) => ({
  permissionCode,
  sourceType: 'ROLE',
  sourceId: `assignment-${sourceCode}`,
  sourceCode,
  scopeType,
  scopeId: '*',
  isBusinessApproval: false,
  metadata: {},
});

describe('HRM attendance visibility', () => {
  it('shows an ordinary user only the employee linked by user id', () => {
    const user = makeUser([
      source('hrm.attendance.view', 'LEGACY_HR_VIEWER'),
    ]);

    expect(canViewCompanyAttendance(user)).toBe(false);
    expect(selectAttendanceEmployees(employees, user.id, false).map(employee => employee.id))
      .toEqual(['employee-1']);
  });

  it('keeps company attendance for HR and explicit global grants', () => {
    const hr = makeUser([source('hrm.attendance.view', 'HR')]);
    const direct = makeUser([{
      ...source('hrm.attendance.view', 'DIRECT'),
      sourceType: 'DIRECT',
    }]);

    expect(canViewCompanyAttendance(hr)).toBe(true);
    expect(canViewCompanyAttendance(direct)).toBe(true);
    expect(selectAttendanceEmployees(employees, hr.id, true).map(employee => employee.id))
      .toEqual(['employee-1', 'employee-2']);
  });

  it('keeps a migrated HR operator global only when the same role can edit attendance', () => {
    const legacyOperator = makeUser([
      source('hrm.attendance.view', 'LEGACY_HR_OPERATOR'),
      source('hrm.attendance.edit', 'LEGACY_HR_OPERATOR'),
    ]);

    expect(canViewCompanyAttendance(legacyOperator)).toBe(true);
  });
});
