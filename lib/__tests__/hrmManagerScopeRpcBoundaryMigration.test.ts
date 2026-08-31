import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260828105200_hrm_manager_scope_rpc_boundary_fix.sql',
), 'utf8');
const smoke = readFileSync(join(
  process.cwd(),
  'supabase/tests/hrm_manager_scope_readiness_smoke.sql',
), 'utf8');

describe('HRM manager-scope RPC boundary', () => {
  it('crosses the private worker boundary only through guarded public definer RPCs', () => {
    expect(migration).toContain('alter function public.get_hrm_manager_scope_readiness()');
    expect(migration).toContain('alter function public.set_hrm_manager_scope_enabled(boolean, text)');
    expect(migration.match(/security definer/g)).toHaveLength(2);
    expect(migration).toContain(
      'revoke all on function app_private.get_hrm_manager_scope_readiness()',
    );
    expect(smoke).toContain('set local role authenticated');
    expect(smoke).toContain('reset role');
  });
});
