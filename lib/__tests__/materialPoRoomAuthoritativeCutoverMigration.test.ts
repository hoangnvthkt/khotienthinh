import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_material_po_room_authoritative_cutover.sql'));
const sql = migrationFile ? readFileSync(join(migrationDirectory, migrationFile), 'utf8') : '';

describe('Material PO authoritative Room cutover migration', () => {
  it('turns off only the per-action PO fallback while keeping the global flag', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('pbac_fallback_enabled boolean not null default true');
    expect(sql).toContain("where room_code = 'material_po'");
    expect(sql).toContain('binding.pbac_fallback_enabled');
    expect(sql).toContain("permission_hardening_flag('project_room_pbac_fallback_enabled')");
  });

  it('records Room provenance and preserves unchanged backfill sources', () => {
    expect(sql).toContain("grant_source in ('manual_room', 'pbac_backfill')");
    expect(sql).toContain("event.metadata ->> 'room_code' = 'material_po'");
    expect(sql).toContain('then public.project_permission_room_member_actions.grant_source');
  });

  it('requires PO view for workflow grants in the Drawer backend', () => {
    expect(sql).toContain("p_room_code = 'material_po'");
    expect(sql).toContain("and not (item.action_codes ? 'view')");
    expect(sql).toContain('Quyền nghiệp vụ PO phải đi cùng quyền Xem trong Room');
  });

  it('preserves old PO PBAC for audit and rejects new PO PBAC', () => {
    expect(sql).toContain("grant_row.permission_code like 'project.material_po.%'");
    expect(sql).toContain('v_preserved_po_grants');
    expect(sql).toContain('không thể cấp mới');
  });

  it('uses parent PO view for PO and dependent records', () => {
    expect(sql).toContain('app_private.purchase_order_can_view');
    expect(sql).toContain('using (app_private.purchase_order_can_view(id))');
    expect(sql).toContain('purchase_order_delivery_can_view');
    expect(sql).toContain('purchase_order_supplemental_can_view');
    expect(sql).not.toMatch(/purchase_order_delivery_can_view[\s\S]*?public\.is_module_admin\('WMS'\)/);
  });
});
