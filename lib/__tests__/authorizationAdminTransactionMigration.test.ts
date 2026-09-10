import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_authorization_v2_phase3_admin_transaction.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();

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
