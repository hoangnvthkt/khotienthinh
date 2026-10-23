import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HRM_VIEWER_PERMISSIONS } from '../permissions/permissionService';

describe('vai trò Xem nhân sự & lương HR_VIEWER (20261029110000)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261029110000_hrm_viewer_role.sql'),
    'utf8',
  );
  const body = (name: string) => {
    const start = sql.search(new RegExp(`create or replace function ${name.replace('.', '\\.')}\\(`, 'i'));
    expect(start, name).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf('$function$;', start));
  };
  const redefines = (name: string) =>
    new RegExp(`create or replace function ${name.replace('.', '\\.')}\\(`, 'i').test(sql);

  it('lists exactly the twelve view permissions, the same list the client mirrors', () => {
    const list = body('app_private.is_hrm_viewer_permission').match(/'hrm\.[a-z_.]+'/g)!.map(code => code.slice(1, -1));
    expect(new Set(list)).toEqual(HRM_VIEWER_PERMISSIONS);
    expect(list).toHaveLength(12);
    for (const code of list) expect(code).toMatch(/\.view(_directory|_profile|_sensitive)?$/);
    expect(list).not.toContain('hrm.payroll.export');
  });

  it('keeps the HR operator check and every write command untouched', () => {
    // has_hrm_template_permission also gates writes (leave decisions, leave balance, devices, direct manager…).
    for (const name of [
      'app_private.has_hrm_template_permission',
      'app_private.current_user_has_hrm_template_permission',
      'app_private.has_governed_hrm_permission',
      'app_private.can_edit_hrm_c2',
      'app_private.can_manage_hrm_payroll_3p',
      'public.decide_leave_request',
      'public.adjust_hrm_leave_balance',
      'public.set_hrm_designated_manager',
      'public.upsert_hrm_payroll',
      'public.delete_hrm_payroll',
      'public.upsert_hrm_employee_contract',
      'public.update_hrm_employee_core_profile',
      'public.upsert_hrm_document_metadata',
      'public.decide_hrm_profile_change',
      'public.decide_hrm_attendance_device',
    ]) {
      expect(redefines(name), name).toBe(false);
    }
  });

  it('accepts HR_VIEWER only for view permissions, HR and HR Manage for everything as before', () => {
    const view = body('app_private.has_hrm_view_permission');
    expect(view).toContain("source_row.source_code in ('HR', 'HR_MANAGE')");
    expect(view).toContain("source_row.source_code = 'HR_VIEWER'");
    expect(view).toContain('app_private.is_hrm_viewer_permission(p_permission_code)');
    expect(sql).toMatch(/grant execute on function app_private\.current_user_has_hrm_view_permission\(text\) to authenticated;/);
    expect(sql).not.toMatch(/grant execute on function app_private\.has_hrm_view_permission\(uuid, text\) to authenticated;/);
  });

  it('switches only read commands and read policies to the view check', () => {
    for (const name of [
      'public.list_hrm_payrolls', 'public.list_hrm_labor_contracts', 'public.list_hrm_salary_history',
      'public.list_hrm_compensation_assignments', 'public.list_hrm_manual_allowances',
      'public.list_hrm_payroll_components', 'public.list_hrm_documents', 'app_private.can_view_hrm_payroll_3p',
    ]) {
      const fn = body(name);
      expect(fn, name).toContain('app_private.has_hrm_view_permission(');
      expect(fn, name).not.toContain('has_hrm_template_permission(');
      expect(fn, name).not.toMatch(/\b(insert|update|delete)\s/i);
    }
    const policies = [...sql.matchAll(/alter policy (\w+) on ([\w.]+)\s+using \(([^;]+)\);/g)];
    expect(policies).toHaveLength(14);
    for (const [, name, , using] of policies) {
      // Only the SELECT policies (checked on Cloud: cmd = SELECT); write policies keep the HR check.
      expect(name).toMatch(/_(select|view|read)(_|$)/);
      expect(name).not.toMatch(/_(write|manage|insert|update|delete)(_|$)/);
      expect(using).toMatch(/current_user_has_hrm_view_permission\('hrm\.[a-z_]+\.view'\)/);
    }
    expect(sql).not.toMatch(/alter policy \w+ on [\w.]+\s+with check/i);
  });

  it('gives the personnel profile a read-all, edit-none level', () => {
    const level = body('app_private.hrm_employee_profile_access_level');
    expect(level.indexOf("return 'SELF'")).toBeLessThan(level.indexOf("return 'HR_VIEWER'"));
    expect(level.indexOf("return 'HR_VIEWER'")).toBeLessThan(level.indexOf("then return 'MANAGER'"));
    const overview = body('app_private.get_hrm_employee_overview');
    expect(overview).toContain("when v_level in ('HR','HR_MANAGE','HR_VIEWER') then array[");
    expect(overview).toContain(`when v_level = 'HR_MANAGE' then '["personal_contact"`);
    expect(overview).not.toMatch(/when v_level = 'HR_VIEWER' then '\[".*"\]'::jsonb/);
    expect(body('app_private.get_hrm_employee_compensation_tax_bank'))
      .toContain("array['HR','HR_MANAGE','HR_VIEWER']");
  });

  it('shows the view permissions in the client snapshot and lets Admin give the role as the third HR role', () => {
    expect(body('app_private.resolve_authorization_snapshot')).toContain(
      "and source_row.source_code = 'HR_VIEWER'\n          and app_private.is_hrm_viewer_permission(source_row.permission_code)",
    );
    const preview = body('app_private.preview_user_hr_business_role_impl');
    expect(preview).toContain("v_target_role_code not in ('NONE', 'HR', 'HR_MANAGE', 'HR_VIEWER')");
    expect(preview).toContain("'allowsC4Mutation', v_target_role_code = 'HR_MANAGE'");
    expect(body('app_private.set_user_hr_business_role_impl')).toContain("template.code in ('HR', 'HR_MANAGE', 'HR_VIEWER')");
  });

  it('blocks adding a non-view permission to the role and assigns it to the four people the owner named', () => {
    expect(body('app_private.guard_hrm_viewer_template_item')).toContain('not app_private.is_hrm_viewer_permission(new.permission_code)');
    expect(sql).toContain('create trigger trg_guard_hrm_viewer_template_item');
    expect(sql).toContain(
      "values ('thinhdx@tienthinhjsc.vn'), ('mont@tienthinhjsc.vn'), ('chuanhd@tienthinhjsc.vn'), ('huongnt@tienthinhjsc.vn')",
    );
    expect(sql).toContain("'Đợt 2a-3 audit mẫu quyền 23/10/2026'");
  });
});
