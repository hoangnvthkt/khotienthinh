import { describe, expect, it } from 'vitest';
import { inheritedLockHint, notDirectGrantReason } from '../permissions/permissionLockReason';

describe('why a permission box is locked', () => {
  it('points sensitive HR codes to the special roles section and project codes to Rooms', () => {
    expect(notDirectGrantReason({ permissionCode: 'hrm.payroll.view' }).hint).toContain('② Vai trò đặc biệt');
    expect(notDirectGrantReason({ permissionCode: 'project.daily_log.view' }).badge).toBe('Phân quyền trong Room dự án');
    expect(notDirectGrantReason({ permissionCode: 'settings.users.manage' }).badge).toBe('Chỉ vai trò quản trị');
  });

  it('says where to remove an inherited permission', () => {
    expect(inheritedLockHint({ sourceType: 'ROLE', sourceCode: 'HR_MANAGE' })).toContain('vai trò Trưởng phòng nhân sự');
    expect(inheritedLockHint({ sourceType: 'ROLE', sourceCode: 'AUDITOR' })).toContain('② Vai trò đặc biệt');
    expect(inheritedLockHint({ sourceType: 'INHERITED' })).toContain('Loại tài khoản');
  });
});
