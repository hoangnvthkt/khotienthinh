import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261001090000_procurement_hub_orders.sql'), 'utf8').toLowerCase();

describe('Mua hàng M2a migration', () => {
  it('creates ordinary project POs marked as Mua hàng orders so the site receives them as usual', () => {
    expect(sql).toContain("'draft', 'from_request', 'single', 'receive_to_stock'");
    expect(sql).toContain("jsonb_build_object('channel', 'procurement_hub')");
    expect(sql).toContain('public.next_purchase_order_number_v2()');
  });

  it('keeps one order within one project/site and one price per item', () => {
    expect(sql).toContain("message = 'procurement_po_scope_mixed'");
    expect(sql).toContain("message = 'procurement_po_duplicate_line'");
    expect(sql).toContain("message = 'procurement_need_closed'");
  });

  it('requires approval by another procurement manager or admin', () => {
    expect(sql).toContain("if v_to is null or v_to = v_actor or not app_private.procurement_po_approver_ok(v_to)");
    expect(sql).toContain("if v_po.status <> 'sent' or v_po.created_by_id = v_actor::text");
    expect(sql).toContain("message = 'procurement_po_return_reason_required'");
  });

  it('orders in the purchase unit while needs stay in the stock unit', () => {
    expect(sql).toContain('round(v_item.qty / v_item.factor, 6)');
    expect(sql).toContain("message = 'procurement_po_price_missing'");
  });

  it('links plan lines and attributes receipts by the PO line received ratio', () => {
    expect(sql).toContain('create table public.procurement_po_plan_links');
    expect(sql).toContain('app_private.procurement_po_line_received_ratio(o.items, l.purchase_order_line_id)');
    expect(sql).toContain('app_private.procurement_po_line_received_ratio(o.items, k.purchase_order_line_id)');
  });

  it('closes needs only with a reason and can reopen them', () => {
    expect(sql).toContain("message = 'procurement_close_reason_required'");
    expect(sql).toContain("when d.closed_at is not null then 'closed'");
  });

  it('moves creation of request-based POs out of the project tab except for admins', () => {
    expect(sql).toContain("if app_private.procurement_hub_context_enabled() then");
    expect(sql).toContain("if new.source_mode = 'from_request' then\n      raise exception using errcode = '42501', message = 'purchase_order_create_moved_to_procurement'");
    const adminBypass = sql.indexOf('if v_is_admin then return new; end if;\n    -- 01/10/2026');
    expect(adminBypass).toBeGreaterThan(0);
  });
});
