import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readMigration = () => {
  const migrationDir = join(process.cwd(), 'supabase/migrations');
  const file = readdirSync(migrationDir)
    .filter(name => name.endsWith('_permission_quick_templates.sql'))
    .sort()
    .at(-1);
  if (!file) throw new Error('Missing permission_quick_templates migration');
  return readFileSync(join(migrationDir, file), 'utf8');
};

describe('permission quick templates migration', () => {
  it('creates isolated quick-template tables and RPCs', () => {
    const sql = readMigration();

    expect(sql).toContain('create table public.permission_quick_templates');
    expect(sql).toContain('create table public.permission_quick_template_items');
    expect(sql).toContain('alter table public.permission_quick_templates enable row level security');
    expect(sql).toContain('alter table public.permission_quick_template_items enable row level security');
    expect(sql).toContain('create or replace function public.list_permission_quick_templates()');
    expect(sql).toContain('create or replace function public.save_permission_quick_template(');
    expect(sql).toContain('create or replace function public.deactivate_permission_quick_template(');
  });

  it('keeps templates out of Business Role assignments and resolver sources', () => {
    const sql = readMigration();

    expect(sql).not.toContain('principal_role_assignments');
    expect(sql).not.toContain('role_permission_templates');
    expect(sql).not.toContain('get_effective_permission_sources');
    expect(sql).not.toContain('replace_user_permission_grants');
    expect(sql).not.toContain('user_permission_grants');
  });

  it('uses governed authorization, readiness gating, and audit', () => {
    const sql = readMigration();

    expect(sql).toContain("app_private.assert_authorization_permission('system.authorization.view')");
    expect(sql).toContain("app_private.assert_authorization_permission('system.authorization.manage_grants')");
    expect(sql).toContain("grant_readiness in ('enforced', 'verified')");
    expect(sql).toContain('permission_quick_template_saved');
    expect(sql).toContain('permission_quick_template_deactivated');
    expect(sql).toContain("set search_path = ''");
  });

  it('adds a rollback-only smoke script for manual Cloud checkpoint', () => {
    const smokePath = join(process.cwd(), 'supabase/tests/permission_quick_templates_smoke.sql');
    expect(existsSync(smokePath)).toBe(true);
    const smoke = readFileSync(smokePath, 'utf8');
    expect(smoke).toContain('begin;');
    expect(smoke).toContain('rollback;');
    expect(smoke).toContain('list_permission_quick_templates');
  });
});
