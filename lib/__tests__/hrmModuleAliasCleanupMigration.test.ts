import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260828105100_hrm_module_alias_cleanup.sql',
), 'utf8');

describe('HRM legacy module alias cleanup', () => {
  it('retires system.hrm actions and any surviving direct grants', () => {
    expect(migration).toContain("'system.hrm.view', 'system.hrm.manage'");
    expect(migration).toContain('update public.user_permission_grants');
    expect(migration).toContain('update public.permission_actions');
    expect(migration).toContain("grant_readiness = 'legacy'");
    expect(migration).toContain('HRM_MODULE_ALIAS_DEACTIVATION_FAILED');
  });
});
