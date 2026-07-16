import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'context', 'AppContext.tsx'), 'utf8');

describe('AppContext account lifecycle contract', () => {
  it('exposes disable/reactivate commands and removes hard-delete user behavior', () => {
    expect(source).toContain('disableUserAccount:');
    expect(source).toContain('reactivateUserAccount:');
    expect(source).toContain('executeUserAccountLifecycle');
    expect(source).not.toContain('removeUser: (userId: string)');
    expect(source).not.toMatch(/from\('users'\)\.delete\(\)\.eq\('id', id\)/);
  });
});
