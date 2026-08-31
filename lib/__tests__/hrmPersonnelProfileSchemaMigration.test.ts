import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260828091547_hrm_personnel_profile_schema.sql',
), 'utf8');

describe('HRM personnel profile schema', () => {
  it.each([
    'hrm_employee_private_profiles',
    'hrm_employee_addresses',
    'hrm_employee_emergency_contacts',
    'hrm_employee_identity_documents',
    'hrm_employee_tax_profiles',
    'hrm_employee_bank_accounts',
    'hrm_employee_insurance_profiles',
    'hrm_employee_dependents',
    'hrm_employee_employment_events',
    'hrm_employee_qualifications',
    'hrm_employee_certifications',
  ])('creates normalized table %s', table => {
    expect(sql).toContain(`public.${table}`);
  });

  it('guards the empty legacy contract/salary normalization', () => {
    expect(sql).toContain('HRM_EMPTY_TABLE_PRECONDITION_FAILED');
    expect(sql).toContain('alter table public.hrm_labor_contracts rename column');
    expect(sql).toContain('alter table public.hrm_salary_history rename column');
  });

  it('keeps new C2-C4 tables inaccessible to frontend roles', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('from public, anon, authenticated');
  });
});
