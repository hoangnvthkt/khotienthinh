import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260911034226_authorization_v2_task12_2_hrm_self_service_isolation.sql',
), 'utf8').toLowerCase();
const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const payrollSourceMigrationName = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_authorization_v2_task12_2_payroll_template_source.sql'));
const payrollSourceMigration = payrollSourceMigrationName
  ? readFileSync(join(migrationDirectory, payrollSourceMigrationName), 'utf8').toLowerCase()
  : '';
const aclHardeningMigrationName = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_authorization_v2_task12_2_harden_self_service_rpc_acl.sql'));
const aclHardeningMigration = aclHardeningMigrationName
  ? readFileSync(join(migrationDirectory, aclHardeningMigrationName), 'utf8').toLowerCase()
  : '';
const finalAclMigrationName = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_authorization_v2_task12_2_finalize_self_service_rpc_acl.sql'));
const finalAclMigration = finalAclMigrationName
  ? readFileSync(join(migrationDirectory, finalAclMigrationName), 'utf8').toLowerCase()
  : '';

describe('authorization Task 12.2 migration', () => {
  it('exposes parameterless self projections backed by private security-definer functions', () => {
    expect(migration).toContain('function app_private.get_my_checkin_context()');
    expect(migration).toContain('function public.get_my_checkin_context()');
    expect(migration).toContain('function app_private.list_my_payrolls()');
    expect(migration).toContain('function public.list_my_payrolls()');
    expect(migration).not.toMatch(/list_my_payrolls\s*\(\s*p_employee_id/);
    expect(migration).not.toMatch(/get_my_checkin_context\s*\(\s*p_employee_id/);
  });

  it('keeps payroll drafts out of employee self-service and filters by the JWT-linked employee', () => {
    expect(migration).toContain("payroll.status in ('confirmed', 'paid')");
    expect(migration).toMatch(/payroll\."employeeid"\s*=\s*v_employee_id/);
    expect(migration).toMatch(/employee\.user_id\s*=\s*v_actor_user_id/);
  });

  it('revokes anonymous execution and leaves the raw payroll RLS policy unchanged', () => {
    expect(migration).toContain('revoke all on function public.get_my_checkin_context() from public, anon, authenticated');
    expect(migration).toContain('revoke all on function public.list_my_payrolls() from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.get_my_checkin_context() to authenticated');
    expect(migration).toContain('grant execute on function public.list_my_payrolls() to authenticated');
    expect(migration).not.toMatch(/create\s+policy[\s\S]*hrm_payrolls/);
    expect(migration).not.toMatch(/alter\s+table\s+public\.hrm_payrolls\s+disable\s+row\s+level\s+security/);
  });
});

describe('authorization Task 12.2 payroll template-source reconciliation', () => {
  it('classifies payroll view as HR-template-only and preserves role-source enforcement', () => {
    expect(payrollSourceMigration).toContain("'hrm.payroll.view'");
    expect(payrollSourceMigration).toContain('create or replace function app_private.is_hrm_template_only_permission');
    expect(payrollSourceMigration).toContain("source_row.source_type = 'role'");
    expect(payrollSourceMigration).toContain("source_row.source_code in ('hr', 'hr_manage')");
  });
});

describe('authorization Task 12.2 self-service RPC ACL hardening', () => {
  it('keeps private functions client-inaccessible behind public security-definer wrappers', () => {
    expect(aclHardeningMigration).toMatch(/function public\.get_my_checkin_context\(\)[\s\S]*security definer/);
    expect(aclHardeningMigration).toMatch(/function public\.list_my_payrolls\(\)[\s\S]*security definer/);
    expect(aclHardeningMigration).toMatch(
      /revoke all on function app_private\.get_my_checkin_context\(\)\s+from public, anon, authenticated/,
    );
    expect(aclHardeningMigration).toMatch(
      /revoke all on function app_private\.list_my_payrolls\(\)\s+from public, anon, authenticated/,
    );
    expect(aclHardeningMigration).not.toMatch(
      /grant execute on function app_private\.(?:get_my_checkin_context|list_my_payrolls)\(\)\s+to authenticated/,
    );
  });
});

describe('authorization Task 12.2 final self-service RPC boundary', () => {
  it('uses public invoker wrappers over private current-actor implementations', () => {
    expect(finalAclMigration).toMatch(/function public\.get_my_checkin_context\(\)[\s\S]*security invoker/);
    expect(finalAclMigration).toMatch(/function public\.list_my_payrolls\(\)[\s\S]*security invoker/);
    expect(finalAclMigration).toMatch(
      /grant execute on function app_private\.get_my_checkin_context\(\)\s+to authenticated, service_role/,
    );
    expect(finalAclMigration).toMatch(
      /grant execute on function app_private\.list_my_payrolls\(\)\s+to authenticated, service_role/,
    );
    expect(finalAclMigration).not.toMatch(/grant usage on schema app_private to authenticated/);
  });
});
