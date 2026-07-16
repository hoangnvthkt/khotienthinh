import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_revoke_legacy_login_lookup.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const executableSql = migration
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const runbookPath = join(process.cwd(), 'docs', 'security', 'permission-audit.md');
const runbook = readFileSync(runbookPath, 'utf8');
const normalizedRunbook = runbook.replace(/\s+/g, ' ');

describe('delayed legacy-login revoke rollout contract', () => {
  it('contains exactly one CLI-created, externally transaction-safe migration', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
  });

  it('only revokes the obsolete exact login-lookup signature from untrusted callers', () => {
    expect(executableSql).toBe(
      'revoke execute on function public.lookup_login_email(text) from public, anon, authenticated;',
    );
    expect(migration).not.toMatch(/grant\s+execute/i);
    expect(migration).not.toMatch(/create\s+(?:or\s+replace\s+)?function/i);
    expect(migration).not.toMatch(/drop\s+function/i);
  });

  it('marks the migration as delayed until the email-only frontend is clean for 24 hours', () => {
    expect(migration).toMatch(/delayed rollout/i);
    expect(migration).toMatch(/do not apply/i);
    expect(migration).toMatch(/email-only frontend/i);
    expect(migration).toMatch(/24\s+hours/i);
  });

  it('documents identity preflight, archive reconciliation, and the external rollback drill', () => {
    expect(normalizedRunbook).toMatch(/auth\.users\.id[\s\S]*public\.users\.auth_id/i);
    expect(normalizedRunbook).toMatch(/active[\s\S]*exactly one active profile/i);
    expect(runbook.match(/app_user\.is_active is true/gi) ?? []).toHaveLength(2);
    expect(runbook).not.toMatch(/coalesce\(app_user\.is_active, true\)/i);
    expect(normalizedRunbook).toMatch(/repair_batch_id[\s\S]*app_private\.xp_repair_archive/i);
    expect(normalizedRunbook).toMatch(/BEGIN;[\s\S]*SET LOCAL lock_timeout = '5s';[\s\S]*ROLLBACK;/i);
    expect(normalizedRunbook).toMatch(/separate real transaction/i);
    expect(normalizedRunbook).toMatch(/migration repair <new_timestamp> --status applied/i);
    expect(normalizedRunbook).toContain('order by function_row.oid::regprocedure::text');
    expect(normalizedRunbook).not.toContain('order by function_signature::text');
  });

  it('documents the two-wave gates, delayed revoke, monitoring, and safe rollback rules', () => {
    for (const requiredText of [
      '42501 permission denied for table user_sessions',
      '22P02 invalid input syntax for type uuid: "u1"',
      '42703 column ws.workflow_template_id does not exist',
      '23505 user_xp_user_id_key',
      'Vercel Preview',
      'PWA update',
      '30 clean minutes',
      '24 clean hours',
      'r.workflow_template_id',
      'disable award',
      'fix-forward',
    ]) {
      expect(runbook).toContain(requiredText);
    }

    expect(normalizedRunbook).toMatch(/do not use `?supabase db push`?/i);
    expect(normalizedRunbook).toMatch(/do not mass-repair/i);
    expect(normalizedRunbook).toMatch(/never grant `?anon`?/i);
  });

  it('checks the PUBLIC pseudo-role through function ACL catalog entries', () => {
    expect(runbook).not.toMatch(/has_function_privilege\('PUBLIC'/i);
    expect(normalizedRunbook).toContain('pg_catalog.aclexplode');
    expect(normalizedRunbook).toMatch(/grantee = 0[\s\S]*privilege_type = 'EXECUTE'/i);
    expect(normalizedRunbook).toContain(
      "function_row.oid = 'public.lookup_login_email(text)'::regprocedure",
    );
    expect(runbook).not.toMatch(/pg_get_function_identity_arguments\(function_row\.oid\) =/i);
  });
});
