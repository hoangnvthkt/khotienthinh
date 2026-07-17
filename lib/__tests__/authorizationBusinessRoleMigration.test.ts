import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter(file => file.endsWith('_authorization_business_role_foundation.sql'))
  .sort();
const sql = files.length === 1 ? readFileSync(join(dir, files[0]), 'utf8') : '';
const normalized = sql.replace(/\s+/g, ' ').trim();

describe('authorization Business Role foundation migration', () => {
  it('has one forward migration with risk metadata', () => {
    expect(files).toHaveLength(1);
    expect(normalized).toMatch(/add column if not exists risk_level text/i);
    expect(normalized).toMatch(/add column if not exists is_business_action boolean/i);
    expect(normalized).toMatch(/add column if not exists is_business_approval boolean/i);
    expect(normalized).toMatch(/add column if not exists direct_grant_requires_expiry boolean/i);
  });

  it('creates temporal scoped role assignments without a polymorphic foreign key', () => {
    expect(normalized).toMatch(/create table public\.principal_role_assignments/i);
    expect(normalized).toMatch(/principal_type text not null/i);
    expect(normalized).toMatch(/principal_id uuid not null/i);
    expect(normalized).toMatch(/role_template_id uuid not null references public\.role_permission_templates/i);
    expect(normalized).toMatch(/status text not null default 'ACTIVE'/i);
    expect(normalized).toMatch(/assigned_reason text not null/i);
    expect(normalized).toMatch(/revoked_reason text/i);
    expect(normalized).not.toMatch(/principal_id uuid[^,]*references/i);
  });

  it('uses RLS, least privilege and no authenticated direct mutation', () => {
    expect(normalized).toMatch(/alter table public\.principal_role_assignments enable row level security/i);
    expect(normalized).toMatch(/revoke all privileges on table public\.principal_role_assignments from public, anon, authenticated/i);
    expect(normalized).toMatch(/grant select on table public\.principal_role_assignments to authenticated/i);
    expect(normalized).toMatch(/drop policy if exists permission_audit_events_insert/i);
    expect(normalized).toMatch(/drop policy if exists user_permission_grants_(insert|update|delete)/i);
    expect(normalized).not.toMatch(/grant (insert|update|delete).*principal_role_assignments.*authenticated/i);
  });

  it('seeds separated governance roles and permissions', () => {
    for (const code of ['SYSTEM_ADMIN', 'PERMISSION_ADMIN', 'BUSINESS_SCOPE_ADMIN', 'BUSINESS_USER', 'AUDITOR']) {
      expect(sql).toContain(`'${code}'`);
    }
    for (const code of [
      'system.authorization.view',
      'system.authorization.manage_roles',
      'system.authorization.manage_grants',
      'system.authorization.manage_scopes',
      'system.authorization.audit',
      'system.authorization.override',
    ]) {
      expect(sql).toContain(`'${code}'`);
    }
  });
});
