import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_material_po_room_permission_pilot.sql'));
const sql = migrationFile ? readFileSync(join(migrationDirectory, migrationFile), 'utf8') : '';

describe('Material PO Room permission pilot migration', () => {
  it('promotes exactly the six approved PO actions and keeps manage unmapped', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain("where room_code = 'material_po'");
    for (const action of ['view', 'edit', 'delete', 'submit', 'approve', 'confirm']) {
      expect(sql).toContain(`when '${action}'`);
    }
    expect(sql).toContain('project.material_po.manage');
    expect(sql).not.toMatch(/when 'manage' then array\[/);
  });

  it('backfills by safe union and never deactivates legacy grants', () => {
    expect(sql).toContain('material_po_room_backfill_candidates');
    expect(sql).toContain('project_room_pbac_backfill');
    expect(sql).toContain('matching_staff_count = 1');
    expect(sql).not.toMatch(/update\s+public\.user_permission_grants[\s\S]*is_active\s*=\s*false/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.user_permission_grants/i);
  });

  it('enforces owner, assignee, workflow and logistics boundaries in the database', () => {
    expect(sql).toContain('guard_project_purchase_order_room_write');
    expect(sql).toContain("old.status = 'sent'");
    expect(sql).toContain("new.status in ('confirmed', 'returned')");
    expect(sql).toContain('submitted_to_user_id');
    expect(sql).toContain("'material_po', 'delete'");
    expect(sql).toContain('không thay thế quyền ghi nhận tồn kho WMS');
    expect(sql).toContain('guard_purchase_order_supplemental_assignment');
  });

  it('supports audit_only rollback through mapped PBAC but not Room membership', () => {
    expect(sql).toContain("binding.enforcement_status in ('pilot', 'enforced')");
    expect(sql).toContain("project_room_pbac_fallback_enabled");
    expect(sql).toContain('unnest(binding.legacy_permission_codes)');
  });

  it('revokes direct access to private logistics implementations', () => {
    expect(sql).toMatch(/revoke execute on function app_private\.create_delivery_batch_with_wms_qr_v2[\s\S]*from authenticated/);
    expect(sql).toMatch(/revoke execute on function app_private\.close_purchase_package_short_v2[\s\S]*from authenticated/);
  });
});
