import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260828090400_hrm_workforce_scoped_authorization.sql',
), 'utf8');

describe('HRM workforce scoped authorization migration', () => {
  it.each([
    'hrm.staffing.manage',
    'hrm.staffing.assign',
    'hrm.staffing.set_manager',
  ])('requires the exact template action %s', permissionCode => {
    expect(sql).toContain(permissionCode);
  });

  it('requires reason/source context and disables context-free public mutations', () => {
    expect(sql).toContain('HRM_MUTATION_REASON_TOO_SHORT');
    expect(sql).toContain('HRM_MUTATION_SOURCE_REFERENCE_REQUIRED');
    expect(sql).toContain('HRM_MUTATION_CONTEXT_REQUIRED');
    expect(sql).toContain("'source_reference'");
  });

  it('uses invoker public wrappers and private definer workers', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain('security invoker');
    expect(sql).toContain("revoke all on function public.adjust_hrm_staffing");
  });
});
