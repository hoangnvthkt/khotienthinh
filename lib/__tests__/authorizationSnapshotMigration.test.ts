import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_authorization_v2_phase2_snapshot_rpc.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();

describe('Authorization V2 source-aware snapshot migration', () => {
  it('exposes a self-only public wrapper backed by a private resolver', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(normalized).toContain('create or replace function app_private.resolve_authorization_snapshot');
    expect(normalized).toContain('create or replace function public.get_my_authorization_snapshot()');
    expect(normalized).toContain('public.current_app_user_id()');
    expect(normalized).not.toContain('user_metadata');
    expect(normalized).not.toMatch(/get_my_authorization_snapshot\s*\(\s*p_/);
  });

  it('preserves source metadata, flags, and project room actions', () => {
    expect(normalized).toContain('resolve_effective_permission_sources');
    expect(normalized).toContain('resolve_manager_derived_permission_sources');
    expect(normalized).toContain("'generatedat'");
    expect(normalized).toContain("'flags'");
    expect(normalized).toContain("'sources'");
    expect(normalized).toContain("'roomactions'");
    for (const key of [
      'permissioncode', 'sourcetype', 'sourceid', 'sourcecode',
      'scopetype', 'scopeid', 'risklevel', 'metadata',
      'projectid', 'constructionsiteid', 'roomcode', 'actioncode',
      'source', 'enforcement', 'fallback',
    ]) {
      expect(normalized).toContain(`'${key}'`);
    }
  });

  it('denies anonymous execution and exposes only the wrapper to signed-in users', () => {
    expect(normalized).toMatch(/revoke all on function app_private\.resolve_authorization_snapshot\(uuid\) from public/);
    expect(normalized).toMatch(/revoke all on function public\.get_my_authorization_snapshot\(\) from public/);
    expect(normalized).toMatch(/revoke all on function public\.get_my_authorization_snapshot\(\) from anon/);
    expect(normalized).toMatch(/grant execute on function public\.get_my_authorization_snapshot\(\) to authenticated/);
  });
});
