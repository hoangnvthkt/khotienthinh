import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'manage-user-account', 'index.ts'),
  'utf8',
);

describe('manage-user-account Edge Function contract', () => {
  it('authorizes the caller and never accepts actor identity from the body', () => {
    expect(source).toContain('requireActiveAdmin');
    expect(source).toContain('caller.appUser.id');
    expect(source).not.toMatch(/body\.(actor|actorUserId|requestedBy)/);
  });

  it('prepares DB first for disable and completes DB last for reactivate', () => {
    const prepare = source.indexOf("admin.rpc('prepare_user_account_lifecycle'");
    const authUpdate = source.indexOf('admin.auth.admin.updateUserById');
    const complete = source.indexOf("admin.rpc('complete_user_account_lifecycle'");
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(authUpdate).toBeGreaterThan(prepare);
    expect(complete).toBeGreaterThan(authUpdate);
  });

  it('rotates the password while banning and requires a new password when reactivating', () => {
    expect(source).toContain("ban_duration: '876000h'");
    expect(source).toContain("ban_duration: 'none'");
    expect(source).toContain('buildRevocationPassword');
    expect(source).toMatch(/REACTIVATE.*newPassword/s);
  });

  it('records retryable Auth failures without re-enabling the app profile', () => {
    expect(source).toContain("admin.rpc('fail_user_account_lifecycle'");
    expect(source).toMatch(/status:.*'AUTH_RETRY'/s);
    expect(source).toContain('Không thể đồng bộ trạng thái đăng nhập');
    expect(source).not.toMatch(/from\('users'\).*update/s);
  });
});
