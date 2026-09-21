import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260921120000_g6_wms_custody_transfer_inventory_count.sql', import.meta.url),
  'utf8',
);

describe('G6 WMS migration', () => {
  it('stores physical receipt count and custody separately from documented and accepted quantities', () => {
    expect(sql).toMatch(/physical_counted_qty/);
    expect(sql).toMatch(/custody_qty/);
    expect(sql).toMatch(/accepted_purchase_qty\s*>\s*v_counted_purchase_qty/);
    expect(sql).not.toMatch(/set physical_counted_qty\s*=\s*greatest/i);
    expect(sql).toMatch(/physical_counted_stock_qty is null then null/i);
  });

  it('defines two-leg transfer progress and idempotent commands', () => {
    expect(sql).toMatch(/create table public\.wms_transfer_lines/);
    expect(sql).toMatch(/dispatch_wms_transfer_v1/);
    expect(sql).toMatch(/receive_wms_transfer_v1/);
    expect(sql).toMatch(/returned_qty\s*\+\s*received_qty\s*\+\s*lost_qty/i);
    expect(sql).toMatch(/G6_INJECTED_FAILURE_AFTER_TRANSFER_STOCK/);
    expect(sql).toMatch(/before insert or update on public\.transactions[\s\S]+guard_wms_transfer_status_v1/i);
  });

  it('defines scoped reconciliation, custody and count read models', () => {
    expect(sql).toMatch(/get_wms_inventory_workspace_v1/);
    expect(sql).toMatch(/get_material_custody_v1/);
    expect(sql).toMatch(/create table public\.wms_inventory_counts/);
    expect(sql).toMatch(/post_wms_inventory_count_v1/);
  });

  it('keeps privileged owners private and public wrappers invoker-scoped', () => {
    expect(sql).toMatch(/security definer\s+set search_path = ''/i);
    expect(sql).toMatch(/security invoker\s+set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function app_private\.[\s\S]+from public, anon, authenticated/i);
  });
});
