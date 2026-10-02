import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261008133100_finance_k3b2_po_payment_status.sql'), 'utf8').toLowerCase();

describe('K3b-2 — tình trạng thanh toán PO cho Mua hàng', () => {
  it('derives status from receipt payables of the PO only', () => {
    expect(sql).toContain("d.source_type = 'purchase_delivery_receipt'");
    expect(sql).toContain("when sum(outstanding) <= 0.5 then 'paid' when sum(paid_amount) > 0.5 then 'partial' else 'unpaid'");
  });
  it('lets procurement viewers read it without finance rights', () => {
    expect(sql).toContain("app_private.procurement_can('view') or app_private.finance_can('view')");
  });
});
