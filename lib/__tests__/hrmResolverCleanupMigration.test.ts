import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260828105000_hrm_resolver_cleanup.sql',
), 'utf8');

describe('HRM governed resolver cleanup', () => {
  it('keeps HRM legacy sources denied without the retired Admin variable', () => {
    expect(migration).toContain("source_row.permission_code like 'hrm.%'");
    expect(migration).toContain("source_row.source_type = 'LEGACY'");
    expect(migration).not.toContain('v_target_is_admin');
    expect(migration).toContain(
      'revoke all on function app_private.get_effective_permission_sources_authorized(uuid)',
    );
  });
});
