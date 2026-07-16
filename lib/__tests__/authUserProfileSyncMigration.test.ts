import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_harden_auth_user_profile_sync.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('auth user profile sync hardening migration', () => {
  it('replaces the auth profile trigger function without wrapping an external transaction', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
    expect(normalized).toMatch(/create or replace function public\.sync_auth_user_profile\(\)/i);
    expect(normalized).toMatch(/returns trigger/i);
    expect(normalized).toMatch(/security definer/i);
  });

  it('links pre-existing app profiles by auth id or email before inserting a new row', () => {
    expect(normalized).toMatch(/v_existing_profile_id uuid/i);
    expect(normalized).toMatch(/u\.auth_id = new\.id/i);
    expect(normalized).toMatch(/lower\(u\.email\) = lower\(new\.email\)/i);
    expect(normalized).toMatch(/for update/i);
    expect(normalized).toMatch(/if v_existing_profile_id is not null then update public\.users/i);
    expect(normalized).toMatch(/where id = v_existing_profile_id/i);
  });

  it('prevents username uniqueness collisions from aborting auth.users insertion', () => {
    expect(normalized).toMatch(/v_requested_username text/i);
    expect(normalized).toMatch(/v_safe_username text/i);
    expect(normalized).toMatch(/left\(new\.id::text, 8\)/i);
    expect(normalized).toMatch(/lower\(username\) = lower\(v_safe_username\)/i);
    expect(normalized).toMatch(/is distinct from new\.email/i);
  });

  it('validates enum role labels before casting metadata to public.user_role', () => {
    expect(normalized).toMatch(/pg_catalog\.pg_enum/i);
    expect(normalized).toMatch(/typname = 'user_role'/i);
    expect(normalized).toMatch(/v_role := 'EMPLOYEE'/i);
    expect(normalized).toMatch(/v_role::public\.user_role/i);
  });
});
