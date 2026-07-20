import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_permission_quick_template_private_impl_grants.sql'))
  .sort();

const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';

const normalized = migration.replace(/\s+/g, ' ').trim();

describe('permission quick-template private implementation grant forward-fix', () => {
  it('adds exactly one forward migration without external transaction wrapping', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
  });

  it('grants authenticated access to the private implementations used by public RPC wrappers', () => {
    expect(normalized).toMatch(/grant execute on function app_private\.list_permission_quick_templates_impl\(\) to authenticated/i);
    expect(normalized).toMatch(/grant execute on function app_private\.save_permission_quick_template_impl\(uuid,\s*text,\s*text,\s*text,\s*jsonb,\s*text\) to authenticated/i);
    expect(normalized).toMatch(/grant execute on function app_private\.deactivate_permission_quick_template_impl\(uuid,\s*text\) to authenticated/i);
  });

  it('does not broaden anon/public access or mutate grant data directly', () => {
    expect(normalized).not.toMatch(/to\s+(?:public|anon)\b/i);
    expect(normalized).not.toMatch(/user_permission_grants|principal_role_assignments|role_permission_templates/i);
    expect(normalized).not.toMatch(/insert\s+into|update\s+public\.|delete\s+from/i);
    expect(normalized).not.toMatch(/(?:grant|revoke)\s+.*\bon\s+(?:table\s+)?public\.permission_quick_templates/i);
    expect(normalized).not.toMatch(/(?:grant|revoke)\s+.*\bon\s+(?:table\s+)?public\.permission_quick_template_items/i);
  });
});
