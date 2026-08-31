import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(), 'supabase/migrations/20260828101200_hrm_sensitive_projection_cutover.sql',
), 'utf8');

describe('HRM sensitive projection cutover migration', () => {
  it.each([
    'list_hrm_employee_directory', 'lookup_hrm_employee_directory',
    'list_hrm_labor_contracts', 'list_hrm_salary_history', 'list_hrm_payrolls',
    'list_hrm_documents', 'list_hrm_compensation_assignments',
    'list_hrm_manual_allowances', 'list_hrm_payroll_components',
  ])('provides explicit governed projection %s', rpc => {
    expect(migration).toContain(`public.${rpc}`);
  });

  it('removes authenticated raw access from all sensitive HR tables', () => {
    [
      'hrm_documents', 'hrm_employee_compensation_assignments',
      'hrm_employee_manual_allowances', 'hrm_labor_contracts',
      'hrm_payroll_components', 'hrm_payrolls', 'hrm_salary_history',
    ].forEach(table => expect(migration).toContain(`revoke all on public.${table} from authenticated`));
  });

  it('makes the document bucket private and protects objects with HR templates', () => {
    expect(migration).toContain("where id = 'hr-documents'");
    expect(migration).toContain("'hrm.document.view'");
    expect(migration).toContain("'hrm.document.manage'");
    expect(migration).toContain('upsert_hrm_document_metadata');
    expect(migration).toContain('delete_hrm_document_metadata');
  });

  it('moves employee and payroll mutations to domain commands', () => {
    expect(migration).toContain('create_hrm_employee_core');
    expect(migration).toContain('archive_hrm_employee');
    expect(migration).toContain('upsert_hrm_payroll');
    expect(migration).toContain('delete_hrm_payroll');
  });
});
