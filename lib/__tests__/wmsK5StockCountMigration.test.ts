import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261004090000_wms_k5_stock_count.sql'), 'utf8');

describe('K5 — kiểm kê có duyệt', () => {
  it('closes the G6 self-posting shortcut and direct line reads (blind count)', () => {
    expect(sql).toContain('revoke execute on function public.post_wms_inventory_count_v1(uuid, jsonb, bigint, text) from authenticated;');
    expect(sql).toContain('revoke select on public.wms_inventory_count_lines from authenticated;');
    expect(sql).toContain("v_show := not v_c.blind or v_c.status <> 'counting' or v_approver;");
  });

  it('separates counter and approver, requires reasons in the right direction', () => {
    expect(sql).toContain("message = 'STOCK_COUNT_SAME_PERSON'");
    expect(sql).toContain("message = 'STOCK_COUNT_REASON_REQUIRED'");
    expect(sql).toContain("message = 'STOCK_COUNT_REASON_DIRECTION'");
  });

  it('posts construction use as an issue, the rest as a valued adjustment, then resyncs the item cache', () => {
    expect(sql).toContain("'EXPORT', now(), v_issue");
    expect(sql).toContain("'ADJUSTMENT', now(), v_adj");
    expect(sql).toContain('app_private.stock_count_unit_cost(item_id, v_c.warehouse_id)');
    expect(sql).toContain('to_jsonb(app_private.stock_count_ledger_qty(i.id, v_c.warehouse_id))');
  });
});
