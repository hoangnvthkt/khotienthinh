import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(), 'supabase/migrations/20260828104500_hrm_broad_policy_hardening.sql',
), 'utf8');

describe('HRM broad policy hardening migration', () => {
  it('uses subject-aware own, direct-report and global authorization', () => {
    expect(migration).toContain('app_private.hrm_can_access_employee_subject');
    expect(migration).toContain("'direct_reports'");
    expect(migration).toContain('app_private.resolve_strict_direct_manager');
  });

  it('replaces broad attendance and leave policies', () => {
    expect(migration).toContain('hrm_attendance_subject_select');
    expect(migration).toContain('hrm_leave_requests_subject_select');
    expect(migration).toContain('hrm_leave_balances_subject_select');
    expect(migration).toContain('hrm_attendance_proposals_scoped_select');
  });

  it('replaces public write policies on HR dictionaries and shifts', () => {
    expect(migration).toContain('hrm_doc_categories_manage_template');
    expect(migration).toContain('hrm_shift_types_manage_template');
    expect(migration).toContain('hrm_employee_shifts_scoped_select');
    expect(migration).toContain("'hrm.master_data.manage'");
  });

  it('removes permissive actor gates that would override scoped policies', () => {
    expect(migration).toContain("policyname like 'hrm\\_%\\_active\\_actor\\_gate'");
    expect(migration).toContain("execute format('drop policy %I on public.%I'");
  });
});
