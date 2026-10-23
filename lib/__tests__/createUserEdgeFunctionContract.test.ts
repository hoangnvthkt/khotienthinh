import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'create-user', 'index.ts'),
  'utf8',
);
const normalized = source.replace(/\s+/g, ' ').trim();

describe('create-user Edge Function contract', () => {
  it('writes the profile through the trusted RPC: the service role cannot write users directly', () => {
    expect(source).not.toMatch(/from\('users'\)\.upsert/);
    expect(normalized).toMatch(/admin\.rpc\('complete_user_account_creation_v1', \{ p_actor_user_id: caller\.appUser\.id, p_auth_id: data\.user\.id,/);
    expect(normalized).toMatch(/const profileId = String\(completed\?\.profileId \|\| data\.user\.id\)/);
  });

  it('lets only an Admin pick the account type and checks an existing profile before creating the login', () => {
    expect(normalized).toContain('role: resolveCreatedAccountRole(profile.role, caller.isAdmin)');
    expect(normalized).toContain('assignedWarehouseId: caller.isAdmin ? profile.assignedWarehouseId || null : null');
    expect(source).not.toMatch(/role: profile\.role/);
    const precheck = source.indexOf('if (!caller.isAdmin) await assertAccountManager(admin, caller, { email });');
    expect(precheck).toBeGreaterThan(0);
    expect(precheck).toBeLessThan(source.indexOf('admin.auth.admin.createUser'));
  });

  it('cleans up only the trigger-created profile row when the profile write fails', () => {
    expect(normalized).toMatch(/from\('users'\)\.delete\(\)\.eq\('id', data\.user\.id\)\.eq\('auth_id', data\.user\.id\)/);
    const profileCleanupIndex = normalized.indexOf(".from('users').delete()");
    const authCleanupAfterProfileIndex = normalized.indexOf(
      'admin.auth.admin.deleteUser(data.user.id)',
      profileCleanupIndex,
    );

    expect(profileCleanupIndex).toBeGreaterThanOrEqual(0);
    expect(authCleanupAfterProfileIndex).toBeGreaterThan(profileCleanupIndex);
  });

  it('keeps the friendly duplicate-email answer of the deployed version', () => {
    expect(source).toContain("errorCode === 'email_exists'");
    expect(source).toContain('Email này đã có tài khoản.');
  });

  it('does not store app permission grants in editable auth user metadata', () => {
    const createUserCall = source.slice(
      source.indexOf('admin.auth.admin.createUser'),
      source.indexOf('});', source.indexOf('admin.auth.admin.createUser')),
    );

    expect(createUserCall).not.toMatch(/allowedModules|adminModules|allowedSubModules|adminSubModules|role/);
  });
});
