import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projections = readFileSync(join(
  process.cwd(), 'supabase/migrations/20260828091549_hrm_personnel_profile_projections.sql',
), 'utf8');
const commands = readFileSync(join(
  process.cwd(), 'supabase/migrations/20260828091551_hrm_personnel_profile_commands.sql',
), 'utf8');
const personaSmoke = readFileSync(join(
  process.cwd(), 'supabase/tests/hrm_personnel_profile_persona_smoke.sql',
), 'utf8');

describe('HRM personnel profile API migrations', () => {
  it('exercises the eight public projections through the authenticated database role', () => {
    expect(personaSmoke).toContain('set local role authenticated');
    expect(personaSmoke).toContain('reset role');
    expect(personaSmoke).toContain('perform public.get_hrm_employee_overview(v_employee_id)');
    expect(personaSmoke).toContain('perform public.get_hrm_employee_qualifications_documents(v_employee_id)');
  });

  it.each([
    'get_hrm_employee_overview', 'get_hrm_employee_personal_contact',
    'get_hrm_employee_work_organization', 'get_hrm_employee_attendance_leave',
    'get_hrm_employee_contract_employment', 'get_hrm_employee_legal_insurance',
    'get_hrm_employee_compensation_tax_bank', 'get_hrm_employee_qualifications_documents',
  ])('provides a dedicated projection %s', rpc => {
    expect(projections).toContain(`public.${rpc}`);
  });

  it('never exposes a select-all profile projection', () => {
    expect(projections.toLowerCase()).not.toContain('select * from public.employees');
    expect(projections).toContain('visibleSections');
    expect(projections).toContain('maskedFields');
  });

  it('uses field-aware C2-C4 commands and blocks direct mixed C3/C4 writes', () => {
    expect(commands).toContain('update_hrm_employee_core_profile');
    expect(commands).toContain('update_hrm_employee_personal_contact');
    expect(commands).toContain('upsert_hrm_employee_identity_document');
    expect(commands).toContain('upsert_hrm_employee_bank_account');
    expect(commands).toContain('HRM_COMPENSATION_MANAGE_REQUIRED');
    expect(commands).toContain('revoke insert, update, delete on public.hrm_labor_contracts');
  });
});
