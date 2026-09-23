import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20260923161912_procurement_material_plan_po_allocation.sql', import.meta.url), 'utf8');

describe('mixed-source atomic PO migration', () => {
  it('locks canonical demand lines and creates one allocation per selected line', () => {
    expect(sql).toContain('create_procurement_purchase_order_v1');
    expect(sql).toContain('for update of line');
    expect(sql).toContain('app_private.save_purchase_order_aggregate_v1');
    expect(sql).toContain('app_private.save_procurement_allocation_v1');
    expect(sql).toContain('PROCUREMENT_AVAILABLE_EXCEEDED');
  });

  it('requires exact MR links only for MR demand and never fabricates a plan request', () => {
    expect(sql).toContain("source_adapter = 'project_material_request'");
    expect(sql).toContain("source_adapter = 'material_plan'");
    expect(sql).toContain('PROCUREMENT_REQUEST_LINK_MISMATCH');
    expect(sql).toContain('purchaseOrderLineId');
    expect(sql).not.toContain('fabricated_request');
  });
});
