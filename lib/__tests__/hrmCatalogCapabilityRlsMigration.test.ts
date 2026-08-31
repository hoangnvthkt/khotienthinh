import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260828091008_hrm_catalog_capability_rls.sql',
), 'utf8');

describe('HRM shared catalog capability RLS', () => {
  it.each([
    'hrm.organization.manage',
    'hrm.master_data.manage',
    'hrm.staffing.view',
    'hrm.staffing.manage',
    'hrm.staffing.assign',
  ])('uses the scoped template permission %s', permissionCode => {
    expect(sql).toContain(permissionCode);
  });

  it('removes active-actor write gates and anonymous mutations', () => {
    expect(sql).toContain("policyname like '%active_actor_gate'");
    expect(sql).toContain('revoke insert, update, delete on table');
  });
});
