import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261002150000_procurement_k2_supplier_returns.sql'), 'utf8').toLowerCase();

describe('K2 — trả hàng NCC', () => {
  it('records a standard reason and lets Mua hàng choose replacement or credit', () => {
    expect(sql).toContain("add column reason_code text check (reason_code in ('quality', 'spec', 'excess', 'damaged', 'other'))");
    expect(sql).toContain("add column resolution text check (resolution in ('replace', 'credit'))");
    expect(sql).toContain("message = 'supplier_return_already_decided'");
  });

  it('puts replaced goods back to "còn phải giao" and reopens a delivered order', () => {
    expect(sql).toContain("app_private.procurement_po_line_returned(p_po_id, p_line_id, 'replace')");
    expect(sql).toContain("update public.purchase_orders set status = 'partial'");
  });

  it('returns credited goods to Cần mua and counts received net of returns', () => {
    expect(sql).toContain("app_private.procurement_po_line_returned(p_po_id, p_line_id, 'credit')");
    expect(sql).toContain("- coalesce(nullif(x.value->>'returnedqty', '')::numeric, 0)");
    expect(sql).toContain('app_private.procurement_link_credited(o.id, l.purchase_order_line_id, l.ordered_qty)');
  });
});
