import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_hrm_workforce_planning_cutover.sql'));
const sql = migrationFile
  ? readFileSync(join(migrationDirectory, migrationFile), 'utf8')
  : '';

describe('HRM workforce planning phase-one cutover migration', () => {
  it('archives backfill slots only after proving they are unoccupied', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain("source = 'employee_backfill'");
    expect(sql).toContain("status = 'ARCHIVED'");
    expect(sql).toContain('HRM_CUTOVER_ACTIVE_BACKFILL_ASSIGNMENTS');
    expect(sql).toContain('manager_slot_id = null');
  });

  it('preserves employee, assignment, workforce-plan and P3 data', () => {
    expect(sql).not.toContain('delete from public.hrm_org_position_slots');
    expect(sql).not.toContain('delete from public.hrm_employee_slot_assignments');
    expect(sql).not.toContain('update public.employees');
    expect(sql).not.toContain("source = 'workforce_plan'");
    expect(sql).not.toContain('hrm_3p');
  });

  it('runs atomically and writes one aggregate audit event', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql).toContain("'HRM_WORKFORCE_CUTOVER'");
    expect(sql).toContain("'archived_count'");
  });
});
