import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('user account lifecycle UI contract', () => {
  it('uses lifecycle copy and has no ordinary permanent-delete action', () => {
    const modal = read('components/UserAccountStatusModal.tsx');
    const management = read('pages/UserManagement.tsx');
    const settingsPage = read('pages/Settings.tsx');
    const settings = read('pages/settings/SettingsUsers.tsx');
    const combined = `${modal}\n${management}\n${settingsPage}\n${settings}`;
    const accountUi = `${modal}\n${management}\n${settings}`;

    expect(combined).toContain('Vô hiệu hóa tài khoản');
    expect(combined).toContain('Khôi phục tài khoản');
    expect(combined).toContain('Quyền cũ sẽ không được khôi phục');
    expect(combined).toContain('Cần thử lại đồng bộ đăng nhập');
    expect(modal).toContain('getUserAccountLifecyclePreview');
    expect(modal).toContain('Trách nhiệm cần phân công lại');
    expect(combined).toContain('AUTH_RETRY');
    expect(accountUi).not.toContain('Xoá vĩnh viễn');
    expect(accountUi).not.toContain('Xóa vĩnh viễn');
    expect(management).toContain('disableUserAccount');
    expect(management).toContain('reactivateUserAccount');
    expect(management).toContain('const lifecycleAction =');
    expect(settingsPage).toContain('disableUserAccount');
    expect(settingsPage).toContain('reactivateUserAccount');
    expect(settings).toContain('accountFilter');
    expect(settings).toContain('const lifecycleAction =');
    expect(combined).not.toContain('DeleteUserModal');
  });
});
