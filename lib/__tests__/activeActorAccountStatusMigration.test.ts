import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_active_actor_account_status.sql'))
  .sort();
const migration = files.length === 1
  ? readFileSync(join(migrationsDir, files[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();
const surfaceSnapshot = readFileSync(
  join(process.cwd(), 'supabase', 'tests', 'active_actor_surface_snapshot.sql'),
  'utf8',
);

describe('active actor account status migration', () => {
  it('has exactly one generated migration and no external transaction wrapper', () => {
    expect(files).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
  });

  it('adds explicit account lifecycle metadata while retaining is_active', () => {
    expect(normalized).toMatch(/add column if not exists account_status text/i);
    expect(normalized).toMatch(/add column if not exists disabled_at timestamptz/i);
    expect(normalized).toMatch(/add column if not exists disabled_by uuid/i);
    expect(normalized).toMatch(/add column if not exists disabled_reason text/i);
    expect(normalized).toMatch(/add column if not exists reactivated_at timestamptz/i);
    expect(normalized).toMatch(/add column if not exists reactivated_by uuid/i);
    expect(normalized).toMatch(/disable trigger trg_users_prevent_privilege_self_update.*update public\.users.*enable trigger trg_users_prevent_privilege_self_update/is);
  });

  it('makes current_app_user_id active-only and preserves disabled profiles during Auth sync', () => {
    expect(normalized).toMatch(/create or replace function public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/u\.is_active\s+and\s+u\.account_status = 'ACTIVE'/i);
    expect(normalized).toMatch(/session_user = 'supabase_auth_admin'/i);
    expect(normalized).toMatch(/new\.account_status := old\.account_status/i);
    expect(normalized).toMatch(/new\.role := old\.role/i);
    expect(normalized).toMatch(/new\.allowed_modules := old\.allowed_modules/i);
    expect(normalized).toMatch(/new\.admin_sub_modules := old\.admin_sub_modules/i);
    expect(normalized).toMatch(/guard_user_account_lifecycle_metadata/i);
    expect(normalized).toMatch(/auth\.role\(\) = 'service_role'.*app\.account_lifecycle_command/is);
  });

  it('does not reopen the retired anonymous username lookup', () => {
    expect(normalized).not.toMatch(/create or replace function public\.lookup_login_email/i);
    expect(normalized).not.toMatch(/grant execute on function public\.lookup_login_email/i);
  });

  it('gates PostgREST and all RLS-protected authenticated table access', () => {
    expect(normalized).toMatch(/create or replace function public\.enforce_active_app_actor\(\)/i);
    expect(normalized).toMatch(/alter role authenticator set pgrst\.db_pre_request = 'public\.enforce_active_app_actor'/i);
    expect(normalized).toMatch(/as restrictive for all to authenticated/i);
    expect(normalized).toMatch(/n\.nspname = 'public'/i);
    expect(normalized).toMatch(/storage.*objects/i);
  });

  it('keeps the Cloud surface snapshot regex valid for PostgreSQL strings', () => {
    expect(surfaceSnapshot).toContain('is_admin\\(');
    expect(surfaceSnapshot).toContain('is_module_admin\\(');
    expect(surfaceSnapshot).not.toContain('is_admin\\\\(');
    expect(surfaceSnapshot).not.toContain('is_module_admin\\\\(');
  });

  it('removes ordinary authenticated hard-delete access to public.users', () => {
    expect(normalized).toMatch(/drop policy if exists users_delete on public\.users/i);
    expect(normalized).toMatch(/revoke delete on public\.users from authenticated/i);
  });
});
