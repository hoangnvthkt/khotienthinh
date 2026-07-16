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
    expect(createUser).toContain('requireActiveAdmin');
    expect(resetPassword).toContain("../_shared/adminAuthorization.ts");
    expect(resetPassword).toContain('requireActiveCaller');
    expect(createUser).not.toMatch(/is_active:\s*profile\.isActive/);
  });
});
