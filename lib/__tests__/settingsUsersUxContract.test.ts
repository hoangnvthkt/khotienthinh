import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const settingsUsers = read('pages/settings/SettingsUsers.tsx');
const userModal = read('components/UserModal.tsx');
const editor = read('components/permissions/AuthorizationEditor.tsx');
const moduleCard = read('components/permissions/PermissionModuleCard.tsx');
const diff = read('components/permissions/PermissionDiffPreview.tsx');

describe('Settings → Users (audit P2)', () => {
  it('shows no invented data: online comes from real sessions, no fake login history', () => {
    expect(settingsUsers).not.toContain('isOnline !== false');
    expect(settingsUsers).not.toContain('14.232.210.18');
    expect(settingsUsers).not.toContain('showLoginLogsModal');
    expect(settingsUsers).toContain("userActivityService.listSessions({ status: 'active'");
    expect(settingsUsers).toContain("navigate('/admin/activity')");
  });

  it('has no dead-end drawer tabs and never shows an unassigned warehouse as "all warehouses"', () => {
    expect(settingsUsers).not.toContain("['password', 'Mật khẩu'");
    expect(settingsUsers).not.toContain("['edit', 'Chỉnh sửa'");
    expect(settingsUsers).not.toContain('Phòng vật tư - toàn bộ kho');
    expect(settingsUsers).toContain('Chưa gán kho');
  });

  it('picks scopes by name instead of typing ids', () => {
    expect(moduleCard).not.toContain('Mã phạm vi cụ thể');
    expect(moduleCard).toContain('hasScopeEntityPicker(scopeType)');
    expect(moduleCard).toContain('getScopeEntityLabel');
    expect(diff).toContain('getScopeEntityLabel');
  });

  it('drops technical wording from the edit screen', () => {
    for (const text of [editor, userModal, moduleCard, diff]) {
      expect(text).not.toMatch(/direct grants|grants \+ scope|Grant mới|PBAC|Room-authoritative|>Template</);
    }
  });

  it('loads the edited person\'s permissions, not the signed-in admin\'s', () => {
    expect(userModal).toContain('loadUserAuthorizationSnapshot(userToEdit.id)');
    expect(editor).toContain('snapshotState');
  });

  it('lets an Admin set a new password for someone else, audited on the server', () => {
    const form = read('components/AdminSetPasswordForm.tsx');
    const fn = read('supabase/functions/reset-password/index.ts');
    expect(settingsUsers).toContain('<AdminSetPasswordForm targetUser={drawerUser} />');
    expect(settingsUsers).toContain('drawerUser.id !== currentUser.id');
    expect(form).toContain('setUserPasswordByAdmin');
    expect(fn).toContain("from('audit_trail').insert");
    expect(fn).toContain('MIN_PASSWORD_LENGTH = 8');
    expect(fn).toContain("target.account_status === 'DISABLED'");
    expect(fn).toContain('Chỉ Admin được đặt mật khẩu cho người khác.');
  });
});
