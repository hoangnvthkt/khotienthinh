import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(join(
  process.cwd(), 'supabase/migrations/20260904081841_allow_generated_hrm_employee_code.sql',
), 'utf8');

describe('HRM employee code generation migration', () => {
  it('allows an omitted employee code and delegates generation to the employee trigger', () => {
    expect(migrationSql).toMatch(/create or replace function public\.create_hrm_employee_core/i);
    expect(migrationSql).toContain("if length(trim(coalesce(p_full_name, ''))) = 0 then");
    expect(migrationSql).toContain("nullif(trim(p_employee_code), '')");
    expect(migrationSql).not.toContain("length(trim(coalesce(p_employee_code, ''))) = 0 or");
  });
});
