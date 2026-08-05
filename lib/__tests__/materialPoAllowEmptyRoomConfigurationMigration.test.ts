import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_material_po_allow_empty_room_configuration.sql'));
const sql = migrationFile ? readFileSync(join(migrationDirectory, migrationFile), 'utf8') : '';

describe('Material PO empty Room configuration migration', () => {
  it('removes only the PO setup-time recipient requirement', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain("where code = 'material_po'");
    expect(sql).toContain("required_actions = '{}'::text[]");
    expect(sql).not.toContain("where code = 'daily_log'");
  });

  it('verifies the resulting PO metadata in the migration transaction', () => {
    expect(sql).toContain('material_po must allow an empty Room configuration');
  });
});
