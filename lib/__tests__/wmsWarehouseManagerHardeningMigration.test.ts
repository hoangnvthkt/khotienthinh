import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260916161634_authorization_v2_task12_4_2_warehouse_manager_hardening.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('E31 warehouse manager hardening migration', () => {
  it('exposes only the guarded stock adjustment wrapper to authenticated users', () => {
    expect(migration).toContain('create or replace function app_private.adjust_inventory_stock_impl');
    expect(migration).toContain('create or replace function public.adjust_inventory_stock');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('revoke all on function app_private.adjust_inventory_stock_impl');
    expect(migration).toContain('grant execute on function public.adjust_inventory_stock');
  });

  it('removes direct authenticated access to the raw stock primitive', () => {
    expect(migration).toContain('revoke execute on function public.apply_stock_change(text, text, integer) from public, anon, authenticated');
    expect(migration).toContain('revoke execute on function public.apply_stock_change(text, text, numeric) from public, anon, authenticated');
  });

  it('evaluates warehouse visibility and mutation against each row id', () => {
    expect(migration).toContain("app_private.wms_has_action('wms.inventory.view', id)");
    expect(migration).toContain("using (app_private.wms_has_action('wms.master_data.manage', id))");
    expect(migration).toContain("with check (app_private.wms_has_action('wms.master_data.manage', id))");
  });

  it('promotes only the two reviewed manager blockers', () => {
    expect(migration).toContain("where permission_code in (\n  'wms.inventory.edit',\n  'wms.master_data.manage'\n)");
    expect(migration).toContain("set grant_readiness = 'enforced'");
    expect(migration).toContain("scope_modes = array['global', 'warehouse']::text[]");
  });
});
