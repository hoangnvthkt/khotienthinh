import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260722180000_align_direct_purchase_po_room_permissions.sql',
);

describe('direct-purchase permission alignment', () => {
  it('aligns the PO Room actions with direct-purchase checks in the database', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain("'project.material_direct_purchase.create'");
    expect(migration).toContain("'material_po', 'submit'");
    expect(migration).toContain("'project.material_direct_purchase.record_ap'");
    expect(migration).toContain("'material_po', 'confirm'");
    expect(migration).toContain("'project.material_po.manage'");
  });

  it('adds the line audit column required by the save RPC', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('alter table public.site_direct_purchase_lines');
    expect(migration).toContain('add column if not exists updated_at timestamptz not null default now()');
  });
});
