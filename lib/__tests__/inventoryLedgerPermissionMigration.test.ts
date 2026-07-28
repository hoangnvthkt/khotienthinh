import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_inventory_ledger_wms_permission_scope.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('inventory ledger WMS permission scope migration', () => {
  it('lets ledger reports use explicit WMS transaction view grants instead of only assigned warehouse', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('create or replace function app_private.can_read_inventory_scope');
    expect(normalized).toMatch(/app_private\.wms_has_action\s*\(\s*'wms\.transaction\.view'/);
    expect(normalized).toContain('p_warehouse_id');
  });
});
