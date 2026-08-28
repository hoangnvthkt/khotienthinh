import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(), 'supabase/migrations/20260828094800_hrm_personnel_import_export.sql',
), 'utf8');

describe('HRM personnel import/export migration', () => {
  it('keeps source files and typed staging private with a 30-day lifecycle', () => {
    expect(migration).toContain("'hrm-private-imports'");
    expect(migration).toContain('public.hrm_import_batches');
    expect(migration).toContain('public.hrm_import_staging_rows');
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain('enable row level security');
  });

  it('provides manifest, dry-run, transactional apply and governed export APIs', () => {
    expect(migration).toContain('public.create_hrm_import_batch');
    expect(migration).toContain('public.stage_hrm_import_rows');
    expect(migration).toContain('public.preview_hrm_import_batch');
    expect(migration).toContain('public.apply_hrm_import_batch');
    expect(migration).toContain('public.export_hrm_employee_profiles');
    expect(migration).toContain('HRM_IMPORT_VALIDATION_REQUIRED');
    expect(migration).toContain('hrm.employee.export');
  });

  it('records only safe error coordinates and explicit error codes', () => {
    expect(migration).toContain("'sheetCode'");
    expect(migration).toContain("'rowNumber'");
    expect(migration).toContain("'column'");
    expect(migration).toContain("'errorCode'");
    expect(migration).not.toContain("'documentNumber', row_payload");
    expect(migration).not.toContain("'accountNumber', row_payload");
  });

  it('blocks unsupported projections and C4 apply outside HR Manage', () => {
    expect(migration).toContain('UNSUPPORTED_PROJECTION_FIELD');
    expect(migration).toContain('UNSUPPORTED_DEPOSIT_FIELD');
    expect(migration).toContain('HRM_IMPORT_C4_MANAGE_REQUIRED');
    expect(migration).toContain('DUPLICATE_RECORD_CODE');
  });
});
