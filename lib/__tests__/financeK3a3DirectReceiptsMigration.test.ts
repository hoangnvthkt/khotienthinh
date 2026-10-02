import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261007090000_finance_k3a3_direct_receipts.sql'), 'utf8').toLowerCase();

describe('K3a-3 — phiếu nhập trực tiếp NCC vào công nợ', () => {
  it('adds the direct receipt payable source and recognises project cost through the shared trigger', () => {
    expect(sql).toContain("'manual_adjustment', 'direct_supplier_receipt']");
    expect(sql).toContain("if new.source_type not in ('supplier_delivery_statement', 'direct_supplier_receipt') or (new.project_id is null and new.construction_site_id is null) then");
  });
  it('keeps segregation of duties, VAT, prices and duplicates enforced on the server', () => {
    expect(sql).toContain("message = 'finance_direct_receipt_self_post'");
    expect(sql).toContain("message = 'finance_vat_required'");
    expect(sql).toContain("message = 'finance_price_required'");
    expect(sql).toContain("message = 'finance_duplicate_unchecked'");
  });
  it('writes filled prices back to the stock ledger and blocks cancelling a paid receipt', () => {
    expect(sql).toContain('update public.inventory_ledger_entries set unit_price = p_price');
    expect(sql).toContain("finance_direct_receipt_paid");
  });
});
