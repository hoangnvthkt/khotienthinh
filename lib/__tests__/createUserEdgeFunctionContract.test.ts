import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'create-user', 'index.ts'),
  'utf8',
);
const normalized = source.replace(/\s+/g, ' ').trim();

describe('create-user Edge Function contract', () => {
  it('uses the app profile linked by the auth trigger instead of assuming auth id is the profile id', () => {
    expect(normalized).toMatch(/from\('users'\)\.select\('id'\)\.eq\('auth_id', data\.user\.id\)\.maybeSingle\(\)/);
    expect(normalized).toMatch(/const profileId = linkedProfile\?\.id \|\| profile\.id \|\| data\.user\.id/);
    expect(normalized).toMatch(/id: profileId/);
  });

  it('cleans up only the trigger-created profile row when profile upsert fails', () => {
    expect(normalized).toMatch(/from\('users'\)\.delete\(\)\.eq\('id', data\.user\.id\)\.eq\('auth_id', data\.user\.id\)/);
    const profileCleanupIndex = normalized.indexOf(".from('users').delete()");
    const authCleanupAfterProfileIndex = normalized.indexOf(
      'admin.auth.admin.deleteUser(data.user.id)',
      profileCleanupIndex,
    );

    expect(profileCleanupIndex).toBeGreaterThanOrEqual(0);
    expect(authCleanupAfterProfileIndex).toBeGreaterThan(profileCleanupIndex);
  });

  it('does not store app permission grants in editable auth user metadata', () => {
    const createUserCall = source.slice(
      source.indexOf('admin.auth.admin.createUser'),
      source.indexOf('});', source.indexOf('admin.auth.admin.createUser')),
    );

    expect(createUserCall).not.toMatch(/allowedModules|adminModules|allowedSubModules|adminSubModules/);
  });
});
