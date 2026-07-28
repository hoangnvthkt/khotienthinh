import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_material_issue_wms_transaction_note.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('material issue WMS transaction note migration', () => {
  it('copies the material issue form note into the generated WMS export transaction note', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('create or replace function public.submit_material_issue_order');
    expect(normalized).toMatch(/coalesce\s*\(\s*nullif\s*\(\s*trim\s*\(\s*v_order\.note\s*\)/i);
    expect(normalized).toContain("'Xuất cấp thi công ' || v_order.issue_no");
  });
});
