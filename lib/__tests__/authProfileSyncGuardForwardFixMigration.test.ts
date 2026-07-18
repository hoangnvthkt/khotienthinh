import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_auth_profile_sync_guard_forward_fix.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('auth profile sync guard forward-fix migration', () => {
  it('adds exactly one forward migration without an external transaction', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
    expect(normalized).toMatch(
      /create or replace function app_private\.prevent_users_privilege_self_update\(\)/i,
    );
    expect(normalized).toMatch(/returns trigger/i);
    expect(normalized).toMatch(/security definer set search_path = ''/i);
  });

  it('keeps the Auth and lifecycle bypasses separate and narrow', () => {
    expect(normalized).toMatch(
      /if session_user = 'supabase_auth_admin' then return new; end if; if auth\.role\(\) = 'service_role' and coalesce\(current_setting\('app\.account_lifecycle_command', true\), ''\) = 'on' then return new; end if;/i,
    );
    expect(normalized).not.toMatch(
      /session_user = 'supabase_auth_admin'\s+or\s+auth\.role\(\) = 'service_role'/i,
    );
  });

  it('preserves normal actor and protected-field containment', () => {
    expect(normalized).toMatch(/if public\.is_admin\(\) then return new; end if;/i);
    expect(normalized).toMatch(/current_user_id := public\.current_app_user_id\(\)/i);
    expect(normalized).toContain('Only admins can update other user rows');
    expect(normalized).toContain('Self profile updates cannot change protected permission fields');
    for (const field of [
      'role',
      'auth_id',
      'email',
      'username',
      'assigned_warehouse_id',
      'allowed_modules',
      'admin_modules',
      'allowed_sub_modules',
      'admin_sub_modules',
      'is_active',
    ]) {
      expect(normalized).toMatch(
        new RegExp(`old\\.${field} is distinct from new\\.${field}`, 'i'),
      );
    }
  });

  it('retains least-privilege execute ACLs', () => {
    expect(normalized).toMatch(
      /revoke all on function app_private\.prevent_users_privilege_self_update\(\) from public, anon, authenticated/i,
    );
  });
});
