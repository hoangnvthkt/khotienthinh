import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(), 'supabase/migrations/20260828104700_hrm_legacy_resolver_cutover.sql',
), 'utf8');

describe('HRM legacy resolver cutover', () => {
  it('rejects legacy sources for every HRM persona, not only admins', () => {
    expect(migration).toContain("source_row.permission_code like 'hrm.%'");
    expect(migration).toContain("source_row.source_type = 'LEGACY'");
    expect(migration).not.toContain("actor.role = 'ADMIN'");
    expect(migration).toContain("'source_row.permission_code like ''hrm.%''");
  });
});
