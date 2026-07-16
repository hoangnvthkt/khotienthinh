import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_user_account_lifecycle_operations.sql'))
  .sort();
const migration = files.length === 1
  ? readFileSync(join(migrationsDir, files[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('user account lifecycle operations migration', () => {
  it('has one migration and a private idempotent operation ledger', () => {
    expect(files).toHaveLength(1);
    expect(normalized).toMatch(/create table if not exists app_private\.user_account_operations/i);
    expect(normalized).toMatch(/idempotency_key uuid not null unique/i);
    expect(normalized).toMatch(/action text not null check \(action in \('DISABLE', 'REACTIVATE'\)\)/i);
    expect(normalized).toMatch(/account_operation_status text not null default 'IDLE'/i);
    expect(normalized).toMatch(/account_operation_action text/i);
  });

  it('allows only one unfinished lifecycle operation per target', () => {
    expect(normalized).toMatch(/on app_private\.user_account_operations \(target_user_id\) where status <> 'COMPLETED'/i);
    expect(normalized).toMatch(/where target_user_id = p_target_user_id and status <> 'COMPLETED'/i);
    expect(normalized).toMatch(/Target account has an unfinished lifecycle operation/i);
  });

  it('revokes every current permission source without deleting history', () => {
    expect(normalized).toMatch(/update public\.user_permission_grants set is_active = false/i);
    expect(normalized).toMatch(/update public\.project_staff_permissions/i);
    expect(normalized).toMatch(/update public\.app_responsibility_slots/i);
    expect(normalized).toMatch(/update public\.app_assignments/i);
    expect(normalized).not.toMatch(/delete from public\.user_permission_grants/i);
    expect(normalized).toMatch(/revoke_user_access_sources/i);
  });

  it('rejects new active rights or assignments for inactive principals', () => {
    expect(normalized).toMatch(/assert_active_principal/i);
    expect(normalized).toMatch(/trg_user_permission_grants_active_principal/i);
    expect(normalized).toMatch(/trg_app_responsibility_slots_active_principal/i);
    expect(normalized).toMatch(/trg_app_assignments_active_principal/i);
    expect(normalized).toMatch(/trg_project_staff_active_principal/i);
  });

  it('lets only the trusted lifecycle command pass the existing users privilege guard', () => {
    expect(normalized).toMatch(/create or replace function app_private\.prevent_users_privilege_self_update\(\)/i);
    expect(normalized).toMatch(/auth\.role\(\) = 'service_role'.*app\.account_lifecycle_command/is);
  });

  it('enforces self-disable and last-admin guards', () => {
    expect(normalized).toMatch(/pg_advisory_xact_lock.*user_account_lifecycle_active_admin/i);
    expect(normalized).toMatch(/Cannot disable the current account/i);
    expect(normalized).toMatch(/Cannot disable the last active System Admin/i);
  });

  it('keeps lifecycle commands service-role only', () => {
    expect(normalized).toMatch(/revoke all on function public\.prepare_user_account_lifecycle\(uuid, uuid, text, text, uuid\) from public, anon, authenticated/i);
    expect(normalized).toMatch(/grant execute on function public\.prepare_user_account_lifecycle\(uuid, uuid, text, text, uuid\) to service_role/i);
  });

  it('reactivates the profile without restoring old rights', () => {
    expect(normalized).toMatch(/account_status = 'ACTIVE'/i);
    expect(normalized).toMatch(/role = 'EMPLOYEE'/i);
    expect(normalized).toMatch(/allowed_modules = '\{\}'::text\[\]/i);
    expect(normalized.match(/revoke_user_access_sources/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('supports persistent Auth retry status and an admin preview', () => {
    expect(normalized).toMatch(/create or replace function public\.get_user_account_lifecycle_preview\(p_target_user_id uuid\)/i);
    expect(normalized).toMatch(/account_operation_status = 'AUTH_RETRY'/i);
    expect(normalized).toMatch(/status <> 'COMPLETED'/i);
    expect(normalized).toMatch(/old\.account_operation_status is distinct from new\.account_operation_status/i);
  });
});
