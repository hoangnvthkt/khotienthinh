import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_authorization_v2_phase3_admin_transaction.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();
const structuredMigrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_authorization_v2_structured_grant_errors.sql'));
const structuredMigrationPath = structuredMigrationFile ? join(migrationsDir, structuredMigrationFile) : '';
const structuredMigration = existsSync(structuredMigrationPath)
  ? readFileSync(structuredMigrationPath, 'utf8').replace(/\s+/g, ' ').trim().toLowerCase()
  : '';

describe('Authorization V2 admin transaction migration', () => {
  it('exposes one authenticated wrapper backed by a hardened private command', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(normalized).toContain('create or replace function app_private.update_user_authorization_v2_impl');
    expect(normalized).toContain('create or replace function public.update_user_authorization_v2');
    expect(normalized).toContain("set search_path to ''");
    expect(normalized).toContain("assert_authorization_permission( 'system.authorization.manage_grants'");
    expect(normalized).toMatch(/revoke all on function public\.update_user_authorization_v2[^;]+from public/);
    expect(normalized).toMatch(/revoke all on function public\.update_user_authorization_v2[^;]+from anon/);
    expect(normalized).toMatch(/grant execute on function public\.update_user_authorization_v2[^;]+to authenticated/);
  });

  it('uses an optimistic lock and permits only the approved profile fields', () => {
    expect(normalized).toContain('for update');
    expect(normalized).toContain('p_expected_updated_at');
    expect(normalized).toContain("errcode = '40001'");
    for (const field of ['name', 'phone', 'avatar', 'manager_id', 'assigned_warehouse_id']) {
      expect(normalized).toContain(`'${field}'`);
    }
    expect(normalized).toContain('unsupported user profile fields');
  });

  it('reuses V2 grant validation and returns the command receipt', () => {
    expect(normalized).toContain('app_private.replace_user_permission_grants_v2_impl');
    expect(normalized).toContain("'userid'");
    expect(normalized).toContain("'updatedat'");
    expect(normalized).toContain("'activegrantcount'");
    expect(normalized).toContain("'auditeventid'");
    expect(normalized).toContain("'user_authorization_v2_updated'");
  });
});

describe('Authorization V2 structured grant errors migration', () => {
  it('enforces catalog direct-grant metadata and emits machine-readable details', () => {
    expect(existsSync(structuredMigrationPath)).toBe(true);
    expect(structuredMigration).toContain('direct_grant_allowed');
    expect(structuredMigration).toContain('direct_grant_requires_expiry');
    expect(structuredMigration).toContain("'permissioncode'");
    expect(structuredMigration).toContain("'field'");
    expect(structuredMigration).toContain("'expiry_required'");
    expect(structuredMigration).toContain("'direct_grant_denied'");
  });

  it('requires a ten-character reason on the public atomic command', () => {
    expect(structuredMigration).toContain('char_length(btrim(coalesce(p_reason');
    expect(structuredMigration).toContain("'reason_too_short'");
    expect(structuredMigration).toMatch(/revoke all on function public\.update_user_authorization_v2[^;]+from anon/);
  });
});
