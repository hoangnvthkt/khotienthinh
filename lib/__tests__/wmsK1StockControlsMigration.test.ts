import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from '../apiError';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261002090000_wms_k1_stock_controls.sql'), 'utf8').toLowerCase();

describe('Kho K1 migration', () => {
  it('blocks stock issues that would make the warehouse total negative', () => {
    expect(sql).toContain("if p_direction = 'out' and coalesce(current_setting('app.inventory_allow_negative', true), '') <> 'on' then");
    expect(sql).toContain('where b.material_id = p_material_id and b.warehouse_id = p_warehouse_id');
    expect(sql).toContain('inventory_negative_stock');
  });

  it('lists stale warehouse documents to keepers, requesters and warehouse approvers', () => {
    expect(sql).toContain("where t.status::text in ('pending', 'approved')");
    expect(sql).toContain('app_private.wms_warehouse_keepers(d.warehouse_id)');
  });

  it('sends one reminder a day per person', () => {
    expect(sql).toContain("select cron.schedule('wms-stale-documents-daily', '30 0 * * *'");
    expect(sql).toContain("continue when exists (select 1 from public.notifications x where x.user_id = r.user_id");
  });
});

describe('negative stock error message', () => {
  it('shows the readable part only', () => {
    const message = getApiErrorMessage({ message: 'INVENTORY_NEGATIVE_STOCK: Không đủ tồn "Xi măng" tại kho "Kho A": còn 5 Tấn, cần xuất 8.', code: 'P0001' });
    expect(message).toBe('Không đủ tồn "Xi măng" tại kho "Kho A": còn 5 Tấn, cần xuất 8.');
  });
});
