import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_material_po_removal_delivery_cascade_fix.sql'));
const sql = migrationFile ? readFileSync(join(migrationDirectory, migrationFile), 'utf8') : '';

describe('Material PO removal delivery cascade fix migration', () => {
  it('deletes guarded delivery children while the parent PO still exists', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('create or replace function public.remove_purchase_order_v1(p_po_id text)');

    const deliveryBatchDelete = sql.indexOf('delete from public.purchase_order_delivery_batches');
    const deliveryGroupDelete = sql.indexOf('delete from public.purchase_order_delivery_groups');
    const purchaseOrderDelete = sql.indexOf('delete from public.purchase_orders');

    expect(deliveryBatchDelete).toBeGreaterThan(-1);
    expect(deliveryGroupDelete).toBeGreaterThan(-1);
    expect(purchaseOrderDelete).toBeGreaterThan(-1);
    expect(deliveryBatchDelete).toBeLessThan(purchaseOrderDelete);
    expect(deliveryGroupDelete).toBeLessThan(purchaseOrderDelete);
  });

  it('preserves the existing authorization and hard-delete safety gates', () => {
    expect(sql).toContain("'project.material_po.delete'");
    expect(sql).toContain('app_private.project_po_has_pending_work_v1(v_po.id::text)');
    expect(sql).toContain('app_private.project_po_has_stock_impact_v1(');
    expect(sql).toContain('app_private.project_po_can_archive_v1(');
  });

  it('does not replace or weaken delivery mutation guards', () => {
    expect(sql).not.toContain('create or replace function app_private.guard_purchase_order_delivery_delete');
    expect(sql).not.toContain('create or replace function app_private.purchase_order_delivery_can_mutate');
    expect(sql).not.toContain('disable trigger');
  });
});
