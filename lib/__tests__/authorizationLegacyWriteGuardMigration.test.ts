import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_authorization_v2_phase1_legacy_write_guard.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();

describe('Authorization V2 legacy write guard migration', () => {
  it('registers the disabled-by-default rollout flag and private audit table', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(normalized).toContain("'legacy_permission_writes_disabled', 'false'::jsonb");
    expect(normalized).toContain('create table if not exists app_private.authorization_legacy_write_audit');
    expect(normalized).toContain('actor_user_id uuid');
    expect(normalized).toContain('target_user_id uuid not null');
    expect(normalized).toContain('changed_columns text[] not null');
    expect(normalized).toContain('reason text not null');
    expect(normalized).toContain('occurred_at timestamp with time zone');
  });

  it('guards every legacy permission column and supports only transaction-local migration bypass', () => {
    expect(normalized).toContain('guard_and_audit_legacy_permission_write');
    for (const column of [
      'allowed_modules',
      'allowed_sub_modules',
      'admin_modules',
      'admin_sub_modules',
    ]) {
      expect(normalized).toContain(`old.${column} is distinct from new.${column}`);
    }
    expect(normalized).toContain("current_setting('app.authorization_legacy_migration', true)");
    expect(normalized).toContain("permission_hardening_flag('legacy_permission_writes_disabled')");
    expect(normalized).toContain('legacy permission writes are disabled');
    expect(normalized).toContain('before update of allowed_modules, allowed_sub_modules, admin_modules, admin_sub_modules on public.users');
  });

  it('keeps audit data outside the Data API boundary', () => {
    expect(normalized).toMatch(/revoke all on table app_private\.authorization_legacy_write_audit from public/);
    expect(normalized).toMatch(/revoke all on table app_private\.authorization_legacy_write_audit from anon/);
    expect(normalized).toMatch(/revoke all on table app_private\.authorization_legacy_write_audit from authenticated/);
    expect(normalized).toMatch(/revoke all on function app_private\.guard_and_audit_legacy_permission_write\(\) from public/);
  });
});
