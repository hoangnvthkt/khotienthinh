import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_allow_auth_profile_sync_guard_bypass.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('user privilege guard internal auth sync migration', () => {
  it('replaces the users privilege guard without wrapping an external transaction', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
    expect(normalized).toMatch(/create or replace function app_private\.prevent_users_privilege_self_update\(\)/i);
    expect(normalized).toMatch(/returns trigger/i);
    expect(normalized).toMatch(/security definer/i);
  });

  it('lets trusted Supabase internals sync auth profiles through the guard', () => {
    expect(normalized).toMatch(/session_user = 'supabase_auth_admin'/i);
    expect(normalized).toMatch(/auth\.role\(\) = 'service_role'/i);
    expect(normalized).toMatch(/session_user = 'supabase_auth_admin'.*public\.is_admin\(\)/i);
  });

  it('preserves user-facing privilege containment for normal self profile updates', () => {
    expect(normalized).toMatch(/Only admins can update other user rows/i);
    expect(normalized).toMatch(/Self profile updates cannot change protected permission fields/i);
    expect(normalized).toMatch(/old\.role is distinct from new\.role/i);
    expect(normalized).toMatch(/old\.allowed_modules is distinct from new\.allowed_modules/i);
    expect(normalized).toMatch(/old\.admin_sub_modules is distinct from new\.admin_sub_modules/i);
  });
});
