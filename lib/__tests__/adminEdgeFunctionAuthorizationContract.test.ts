import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const shared = readFileSync(
  join(process.cwd(), 'supabase', 'functions', '_shared', 'adminAuthorization.ts'),
  'utf8',
);
const createUser = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'create-user', 'index.ts'),
  'utf8',
);
const resetPassword = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'reset-password', 'index.ts'),
  'utf8',
);

describe('shared Edge Function admin authorization', () => {
  it('requires an active app profile and never trusts user_metadata', () => {
    expect(shared).toContain(".select('id, role, email, auth_id, is_active, account_status')");
    expect(shared).toMatch(/appUser\?\.is_active !== true/);
    expect(shared).toMatch(/appUser\?\.account_status === 'DISABLED'/);
    expect(shared).not.toMatch(/user_metadata.*role|role.*user_metadata/);
    expect(shared).toContain(".eq('auth_id', authData.user.id)");
    expect(shared).toContain(".is('auth_id', null)");
    expect(shared).not.toMatch(/\.or\(filters\.join/);
  });

  it('is used by create-user and reset-password', () => {
    expect(createUser).toContain("../_shared/adminAuthorization.ts");
    expect(createUser).toContain('requireAccountManager(req, admin)');
    expect(resetPassword).toContain("../_shared/adminAuthorization.ts");
    expect(resetPassword).toContain('requireActiveCaller');
    expect(createUser).not.toMatch(/is_active:\s*profile\.isActive/);
  });

  it('decides "Quản lý tài khoản" on the server, never from the browser (Đợt 2a-2)', () => {
    expect(shared).not.toContain('requireActiveAdmin');
    expect(shared).toContain("admin.rpc('account_manager_access_v1'");
    expect(shared).toContain('p_actor_user_id: caller.appUser.id');
    expect(shared).toContain('accountManagerDenial(parseAccountManagerAccess(data)');
  });

  it('lets an account manager set someone else\'s password, but not an Admin\'s or a login email', () => {
    expect(resetPassword).toContain("await assertAccountManager(admin, caller, { userId: target?.id });");
    expect(resetPassword).toMatch(/if \(newEmail && !caller\.isAdmin\)[\s\S]*?403/);
    expect(resetPassword.indexOf('assertAccountManager(admin, caller')).toBeLessThan(
      resetPassword.indexOf('admin.auth.admin.updateUserById'),
    );
    expect(resetPassword).not.toContain('Chỉ Admin được đặt mật khẩu cho người khác.');
  });
});
