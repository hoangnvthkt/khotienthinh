import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_work_r1a_permission_registry.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();

describe('Work R1A permission registry migration', () => {
  it('registers the canonical application, modules, and exact action surface', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(normalized).toContain("'work.module.access'");
    for (const permissionCode of [
      'work.task.create',
      'work.task.view_related',
      'work.task.assign_user',
      'work.task.assign_group',
      'work.task.view_scope',
      'work.task.view_restricted',
      'work.task.manage_scope',
      'work.task.review',
      'work.task.audit_view',
      'work.task.configure',
    ]) {
      expect(normalized).toContain(`'${permissionCode}'`);
    }
    expect(normalized).not.toContain("'work'::text[]");
  });

  it('keeps Work outside legacy and technical-admin compatibility paths', () => {
    expect(normalized).toContain('legacy_module_key = null');
    expect(normalized).toContain("permission_code not like 'work.%'");
    expect(normalized).toContain("source_row.permission_code like 'work.%'");
    expect(normalized).toContain("upper(source_row.source_type) = 'legacy'");
  });
});
