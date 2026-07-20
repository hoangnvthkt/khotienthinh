import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');

const candidates = () =>
  fs
    .readdirSync(migrationDir)
    .filter(name => name.endsWith('_hrm_employee_permission_guards.sql'));

const readMigration = () => {
  const files = candidates();
  expect(files).toHaveLength(1);
  return fs.readFileSync(path.join(migrationDir, files[0]), 'utf8');
};

const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('HRM employee backend permission guards', () => {
  it('documents concrete backend objects from the inventory', () => {
    const sql = readMigration();

    expect(sql).toContain('public.employees');
    expect(sql).toContain('department_id');
    expect(sql).toContain('user_id');
    expect(sql).toContain('employees_select');
    expect(sql).toContain('employees_write');
    expect(sql).toContain('employees_update');
  });

  it('creates operation-specific permission helper for HRM employee records', () => {
    const sql = normalized(readMigration());

    expect(sql).toMatch(/create or replace function app_private\.hrm_employee_has_action/i);
    expect(sql).toContain("'hrm.employee.view'");
    expect(sql).toContain("'hrm.employee.create'");
    expect(sql).toContain("'hrm.employee.edit'");
    expect(sql).toContain("'department'");
    expect(sql).toContain("'own'");
  });

  it('does not use broad FOR ALL policy or edit-as-delete mutation policy', () => {
    const sql = normalized(readMigration());

    expect(sql).not.toMatch(/for all to authenticated/i);
    expect(sql).toMatch(/for select/i);
    expect(sql).toMatch(/for insert/i);
    expect(sql).toMatch(/for update/i);
    expect(sql).not.toMatch(/create policy employees_delete/i);
    expect(sql).not.toMatch(/hrm\.employee\.delete/i);
  });

  it('replaces legacy employee write policies with action-specific checks', () => {
    const sql = normalized(readMigration());

    expect(sql).toContain('drop policy if exists employees_select on public.employees');
    expect(sql).toContain('drop policy if exists employees_write on public.employees');
    expect(sql).toContain('drop policy if exists employees_update on public.employees');
    expect(sql).toContain("app_private.hrm_employee_has_action('hrm.employee.view'");
    expect(sql).toContain("app_private.hrm_employee_has_action('hrm.employee.create'");
    expect(sql).toContain("app_private.hrm_employee_has_action('hrm.employee.edit'");
    expect(sql).not.toContain('can_manage_hrm_employees()');
  });

  it('promotes only HRM employee actions to enforced readiness', () => {
    const sql = readMigration();

    for (const code of ['hrm.employee.view', 'hrm.employee.create', 'hrm.employee.edit']) {
      expect(sql).toContain(`'${code}'`);
    }

    expect(sql).toContain("where permission_code in ('hrm.employee.view', 'hrm.employee.create', 'hrm.employee.edit')");
    expect(sql).not.toContain("'hrm.payroll.manage'");
    expect(sql).not.toContain("'hrm.attendance.edit'");
    expect(sql).not.toContain("'hrm.master_data.manage'");
  });
});
