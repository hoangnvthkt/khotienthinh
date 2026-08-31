import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260828090401_hrm_manager_scope_readiness.sql',
), 'utf8');

describe('HRM manager scope readiness migration', () => {
  it('keeps direct-report authorization behind an explicit readiness gate', () => {
    expect(sql).toContain('HRM_MANAGER_SCOPE_NOT_READY');
    expect(sql).toContain('missingPrimaryCount');
    expect(sql).toContain('overlappingAssignmentCount');
    expect(sql).toContain('unitsWithoutManagerCount');
    expect(sql).toContain('selfManagedCount');
  });

  it('derives manager sources only from the strict slot resolver', () => {
    expect(sql).toContain('resolve_strict_direct_manager');
    expect(sql).toContain("'ORGANIZATION'::text");
    expect(sql).toContain("'direct_reports'::text");
    expect(sql).not.toContain('employee.manager_id');
  });
});
