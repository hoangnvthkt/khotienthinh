import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260910025910_authorization_v2_phase4_retire_view_only_rooms.sql',
), 'utf8');

describe('Authorization V2 Phase 4 retired Room migration', () => {
  it('retires exactly four Room registries and preserves audit evidence', () => {
    expect(migration).toContain('authorization_room_retirement_dispositions');
    expect(migration).toContain("'material_waste', 'custom_material', 'boq_reconciliation', 'subcontract'");
    expect(migration).toContain('set is_active = false');
    expect(migration).not.toMatch(/delete\s+from\s+public\.project_permission_room/i);
  });

  it('keeps non-view mutations behind the System Admin predicate', () => {
    expect(migration).toContain('authorization_v2_assert_retired_module_admin_write');
    expect(migration).toContain('if not public.is_admin()');
    expect(migration).toContain('select public.is_admin();');
    expect(migration).not.toContain("public.is_module_admin('DA')");
  });
});
