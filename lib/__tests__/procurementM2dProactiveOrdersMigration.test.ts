import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261005090000_procurement_m2d_proactive_orders.sql'), 'utf8').toLowerCase();

describe('M2d — đơn chủ động tại Mua hàng', () => {
  it('creates hub proactive orders for one project with a mandatory reason', () => {
    expect(sql).toContain("'draft', 'proactive_project', v_mode, 'receive_to_stock'");
    expect(sql).toContain("jsonb_build_object('channel', 'procurement_hub', 'proactive', v_meta)");
    expect(sql).toContain("v_reason_code not in ('price_lock', 'long_lead', 'min_stock', 'other')");
    expect(sql).toContain("message = 'procurement_proactive_reason_required'");
    expect(sql).toContain("w.type = 'site'");
  });

  it('requires a reason for over-BOQ or outside-BOQ items and snapshots the BOQ position', () => {
    expect(sql).toContain("message = 'procurement_proactive_over_boq_reason'");
    expect(sql).toContain("'boq', jsonb_build_object('status', v_status, 'boqqty', v_boq.boq_qty, 'orderedbefore', v_boq.ordered_qty)");
  });

  it('keeps linked needs safe when the order is edited', () => {
    expect(sql).toContain("message = 'procurement_proactive_allocated'");
    expect(sql).toContain("message = 'procurement_proactive_project_locked'");
    expect(sql).toContain("message = 'procurement_po_proactive_use_editor'");
  });

  it('links needs to the unallocated part instead of buying again, with history on both sides', () => {
    expect(sql).toContain("message = 'procurement_proactive_over_need'");
    expect(sql).toContain("message = 'procurement_proactive_over_unallocated'");
    expect(sql).toContain("message = 'procurement_unlink_reason_required'");
    expect(sql).toContain("('need', v_source_type || ':' || v_source_id, v_action || '_proactive_po'");
  });

  it('charges supplier-return credits to the unallocated part first', () => {
    expect(sql).toContain('greatest(c.stock_qty - greatest(coalesce(line.stock_qty, 0) - t.n, 0), 0)');
  });
});
