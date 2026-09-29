import { describe, expect, it } from 'vitest';
import { inheritedLockHint, notDirectGrantReason } from '../permissions/permissionLockReason';

describe('why a permission box is locked', () => {
  it('points sensitive HR codes to the HR role tab and project codes to Rooms', () => {
    expect(notDirectGrantReason({ permissionCode: 'hrm.payroll.view' }).hint).toContain('tab Vai trò nhân sự');
    expect(notDirectGrantReason({ permissionCode: 'project.daily_log.view' }).badge).toBe('Phân quyền trong Room dự án');
    expect(notDirectGrantReason({ permissionCode: 'settings.users.manage' }).badge).toBe('Chỉ vai trò quản trị');
  });

  it('says where to remove an inherited permission', () => {
    expect(inheritedLockHint({ sourceType: 'ROLE', sourceCode: 'HR_MANAGE' })).toContain('vai trò HR Manage');
    expect(inheritedLockHint({ sourceType: 'ROLE', sourceCode: 'AUDITOR' })).toContain('Cài đặt → Mẫu quyền');
    expect(inheritedLockHint({ sourceType: 'INHERITED' })).toContain('Loại tài khoản');
  });
});
