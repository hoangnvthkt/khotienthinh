import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261001150000_procurement_hub_deliveries.sql'), 'utf8').toLowerCase();

describe('Mua hàng M3 migration', () => {
  it('lets procurement create deliveries with their own quantities, price and VAT', () => {
    expect(sql).toContain("'purchaseqty', v_pq");
    expect(sql).toContain("'stockqty', v_sq");
    expect(sql).toContain("'vat_rate', v_vat");
  });

  it('creates the warehouse receipt at once within the approved value, otherwise asks another approver', () => {
    expect(sql).toContain('v_over := app_private.procurement_po_committed_amount(v_po.id, v_batch_id) + v_amount > v_budget * 1.0001 + 1');
    expect(sql).toContain("message = 'procurement_delivery_approver_required'");
    expect(sql).toContain('perform app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(v_batch_id, v_actor, gen_random_uuid())');
    expect(sql).toContain('or v_batch.created_by = v_actor');
  });

  it('closes an order short only when no delivery is open, returning the shortfall to Cần mua by default', () => {
    expect(sql).toContain("message = 'procurement_delivery_still_open'");
    expect(sql).toContain("coalesce((p_input->>'returntoneed')::boolean, true)");
    expect(sql).toContain('set ordered_qty = r.received');
  });

  it('cancels only deliveries the warehouse has not started receiving', () => {
    expect(sql).toContain("v_batch.status = 'planned' or (v_batch.status = 'receiving' and v_tx_status = 'pending')");
  });

  it('shares received stock of a PO line across needs by ordered quantity', () => {
    expect(sql).toContain('app_private.procurement_link_received(o.id, o.items, l.purchase_order_line_id, l.ordered_qty)');
  });
});
