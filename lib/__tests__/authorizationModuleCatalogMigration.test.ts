import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_authorization_v2_module_first_catalog.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();

describe('Authorization V2 module-first catalog migration', () => {
  it('publishes the guarded catalog boundary from a private implementation', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(normalized).toContain('app_private.permission_application_default_view_grants');
    expect(normalized).toContain('direct_grant_allowed boolean not null default true');
    expect(normalized).toContain('create or replace function app_private.get_permission_admin_catalog_impl()');
    expect(normalized).toContain('create or replace function public.get_permission_admin_catalog()');
    expect(normalized).toContain("assert_authorization_permission( 'system.authorization.manage_grants'");
    expect(normalized).toMatch(/revoke all on function public\.get_permission_admin_catalog\(\) from public/);
    expect(normalized).toMatch(/revoke all on function public\.get_permission_admin_catalog\(\) from anon/);
    expect(normalized).toMatch(/grant execute on function public\.get_permission_admin_catalog\(\) to authenticated/);
  });

  it('defines an explicit four-view Asset bundle without approval grants', () => {
    for (const permissionCode of [
      'asset.catalog.view',
      'asset.assignment.view',
      'asset.maintenance.view',
      'asset.audit.view',
    ]) {
      expect(normalized).toContain(`'${permissionCode}'`);
    }
    expect(normalized).not.toMatch(/permission_application_default_view_grants[^;]*asset\.assignment\.approve/);
  });

  it('keeps the private bundle table outside direct Data API access', () => {
    expect(normalized).toMatch(
      /revoke all on table app_private\.permission_application_default_view_grants from public/,
    );
    expect(normalized).toMatch(
      /revoke all on table app_private\.permission_application_default_view_grants from anon/,
    );
    expect(normalized).toMatch(
      /revoke all on table app_private\.permission_application_default_view_grants from authenticated/,
    );
  });
});
