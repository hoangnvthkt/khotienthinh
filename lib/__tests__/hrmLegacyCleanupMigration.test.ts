import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(), 'supabase/migrations/20260828103000_hrm_legacy_permission_cleanup.sql',
), 'utf8');

describe('HRM legacy permission cleanup migration', () => {
  it('maps complete legacy employee grant sets to the HR template before revoking them', () => {
    expect(migration).toContain("template.code = 'HR'");
    expect(migration).toContain("hrm.employee.view");
    expect(migration).toContain("hrm.employee.create");
    expect(migration).toContain("hrm.employee.edit");
    expect(migration).toContain("status = 'ACTIVE'");
    expect(migration).toContain('is_active = false');
  });

  it('retires legacy actions and removes the HRM department scope adapter', () => {
    expect(migration).toContain("permission_code in ('hrm.employee.view','hrm.employee.create','hrm.employee.edit')");
    expect(migration).toContain("array_remove(scope_modes, 'department')");
  });

  it('replaces implicit admin and HRM module-admin checks with governed permissions', () => {
    expect(migration).toContain('app_private.has_governed_hrm_permission');
    expect(migration).toContain('app_private.has_hrm_template_permission');
    expect(migration).toContain('drop function if exists public.assign_hrm_employee_to_slot');
  });

  it('publishes a precise Permission Health scanner instead of hiding findings', () => {
    expect(migration).toContain('get_permission_health_summary_impl_v2');
    expect(migration).toContain("procedure.proname ~* '(hrm|employee|attendance|payroll)'");
    expect(migration).toContain("pg_get_functiondef(procedure.oid) ~* '(public\\.)?is_(module_)?admin");
  });
});
