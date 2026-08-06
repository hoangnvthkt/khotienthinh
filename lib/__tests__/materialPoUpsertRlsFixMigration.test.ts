import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_material_po_upsert_rls_fix.sql'));
const sql = migrationFile ? readFileSync(join(migrationDirectory, migrationFile), 'utf8') : '';

describe('Material PO UPSERT RLS fix migration', () => {
  it('authorizes purchase_orders SELECT from candidate row columns', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('drop policy if exists purchase_orders_select');
    expect(sql).toContain("source_mode = 'company_consolidated'");
    expect(sql).toContain('app_private.current_actor_has_effective_room_action(');
    expect(sql).toContain("'material_po', 'view'");
    expect(sql).toContain('app_private.current_user_is_global_wms_keeper()');
    expect(sql).toContain('app_private.current_user_is_wms_keeper_for(target_warehouse_id)');
    expect(sql).not.toContain('using (app_private.purchase_order_can_view(id))');
  });
});
