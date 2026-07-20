import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_auth_profile_safe_metadata_sync.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('auth profile safe metadata sync migration', () => {
  it('adds exactly one forward migration without an external transaction', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
    expect(normalized).toMatch(
      /create or replace function public\.sync_auth_user_profile\(\)/i,
    );
  });

  it('reads only display-safe user metadata', () => {
    for (const key of [
      'role',
      'username',
      'assignedWarehouseId',
      'allowedModules',
      'adminModules',
      'allowedSubModules',
      'adminSubModules',
      'isActive',
      'accountStatus',
    ]) {
      expect(normalized).not.toContain(`raw_user_meta_data ->> '${key}'`);
      expect(normalized).not.toContain(`raw_user_meta_data -> '${key}'`);
      expect(normalized).not.toContain(`raw_user_meta_data ? '${key}'`);
    }

    expect(normalized).toContain("new.raw_user_meta_data ->> 'name'");
    expect(normalized).toContain("new.raw_user_meta_data ->> 'phone'");
    expect(normalized).toContain("new.raw_user_meta_data ->> 'avatar'");
  });

  it('creates new profiles as active zero-right employees', () => {
    expect(normalized).toMatch(/'EMPLOYEE'::public\.user_role/i);
    expect(normalized).toMatch(/'\{\}'::text\[\]/i);
    expect(normalized).toMatch(/'\{\}'::jsonb/i);
    expect(normalized).toContain("'ACTIVE'");
  });

  it('does not add a privileged command or broaden the write guard', () => {
    expect(normalized).not.toContain('apply_created_user_profile_command');
    expect(normalized).not.toContain('prevent_users_privilege_self_update');
    expect(normalized).not.toContain('app.account_lifecycle_command');
  });
});
