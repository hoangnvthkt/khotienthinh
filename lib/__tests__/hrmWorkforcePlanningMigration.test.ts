import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_hrm_workforce_planning_foundation.sql'));
const sql = migrationFile
  ? readFileSync(join(migrationDirectory, migrationFile), 'utf8')
  : '';

describe('HRM workforce planning foundation migration', () => {
  it('defines the four atomic workforce planning operations', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('app_private.adjust_hrm_staffing');
    expect(sql).toContain('public.adjust_hrm_staffing');
    expect(sql).toContain('app_private.assign_hrm_employee_to_staffing');
    expect(sql).toContain('public.assign_hrm_employee_to_staffing');
    expect(sql).toContain('app_private.unassign_hrm_employee_from_organization');
    expect(sql).toContain('public.unassign_hrm_employee_from_organization');
    expect(sql).toContain('app_private.set_hrm_unit_manager_staffing');
    expect(sql).toContain('public.set_hrm_unit_manager_staffing');
  });

  it('uses short concurrency-safe claims and official workforce-plan slots', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain("'workforce_plan'");
    expect(sql).toContain('hrm_workforce_plan_vacancy_idx');
    expect(sql).toContain('linked_construction_site_id');
  });

  it('keeps privileged workers private and public wrappers invoker-only', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('security invoker');
    expect(sql).toContain("public.is_module_admin('HRM')");
    expect(sql).toContain('revoke all on function public.adjust_hrm_staffing');
    expect(sql).toContain('grant execute on function public.adjust_hrm_staffing');
  });

  it('does not change P3 or trust a caller-supplied actor', () => {
    expect(sql).not.toContain('update public.hrm_3p_bands');
    expect(sql).not.toContain('delete from public.hrm_3p_bands');
    expect(sql).not.toContain('p_actor_id');
    expect(sql).toContain('public.current_app_user_id()');
  });
});
