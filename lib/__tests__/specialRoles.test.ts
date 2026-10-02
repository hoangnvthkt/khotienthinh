import { describe, expect, it } from 'vitest';
import {
  endOfDayIso,
  specialRoleChangeFor,
  specialRoleChangeLabel,
  unknownHeldRoles,
  visibleSpecialRoles,
} from '../permissions/specialRoles';
import type { UserSpecialRole } from '../permissions/businessRoleAdminService';

const held = (roleCode: string, assignmentId = `a-${roleCode}`): UserSpecialRole => ({
  assignmentId, roleCode, roleName: roleCode, scopeType: 'global', scopeId: '*', startsAt: '2026-10-01T00:00:00Z',
});

describe('special roles in the user editor', () => {
  it('offers HR, HR Manage and Auditor, and shows admin-only roles only when held', () => {
    expect(visibleSpecialRoles([]).map(role => role.code)).toEqual(['HR', 'HR_MANAGE', 'AUDITOR']);
    expect(visibleSpecialRoles([held('SYSTEM_ADMIN')]).map(role => role.code)).toContain('SYSTEM_ADMIN');
  });

  it('assigns, revokes, and switches between the two HR roles', () => {
    expect(specialRoleChangeFor([], 'AUDITOR')).toEqual({ kind: 'assign', role: 'AUDITOR' });
    expect(specialRoleChangeFor([held('AUDITOR', 'x')], 'AUDITOR')).toEqual({ kind: 'revoke', role: 'AUDITOR', assignmentId: 'x' });
    expect(specialRoleChangeFor([held('HR')], 'HR_MANAGE')).toEqual({ kind: 'switch', role: 'HR_MANAGE', from: 'HR' });
    // Auditor is not exclusive with HR.
    expect(specialRoleChangeFor([held('HR')], 'AUDITOR')).toEqual({ kind: 'assign', role: 'AUDITOR' });
  });

  it('never offers a change for roles that come with the Admin account', () => {
    expect(specialRoleChangeFor([held('SYSTEM_ADMIN')], 'SYSTEM_ADMIN')).toBeNull();
    expect(specialRoleChangeFor([], 'PERMISSION_ADMIN')).toBeNull();
  });

  it('keeps unknown roles visible', () => {
    expect(unknownHeldRoles([held('HR'), held('LEGACY_X')]).map(role => role.roleCode)).toEqual(['LEGACY_X']);
  });

  it('turns a date into the end of that day, and empty into no expiry', () => {
    const iso = endOfDayIso('2026-12-31');
    expect(iso).not.toBeNull();
    const local = new Date(iso!);
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()]).toEqual([2026, 11, 31, 23, 59]);
    expect(endOfDayIso('')).toBeNull();
  });

  it('labels each change in plain words', () => {
    expect(specialRoleChangeLabel({ kind: 'switch', role: 'HR_MANAGE', from: 'HR' })).toBe('Đổi từ Nhân sự sang Trưởng phòng nhân sự');
    expect(specialRoleChangeLabel({ kind: 'revoke', role: 'AUDITOR', assignmentId: 'x' })).toBe('Thu hồi vai trò Kiểm toán');
  });
});
