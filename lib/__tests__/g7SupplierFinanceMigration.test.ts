import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../../supabase/migrations/20260921143000_g7_supplier_finance_matching_valuation.sql', import.meta.url);

describe('G7 supplier finance migration', () => {
  it('exists and replaces the temporary invoice guard with allocation authority', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/record_supplier_invoice_reconciliation_v3/);
    expect(sql).toMatch(/supplier_invoice_receipt_allocations/);
    expect(sql).toMatch(/invoiced_to_date/);
    expect(sql).toMatch(/normalize_supplier_invoice_link_v2_compat/);
    expect(sql).not.toMatch(/supplier-invoice-adjustment-/);
  });

  it('defines versioned payment commands, period locks and valuation provenance', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/finance_accounting_period_locks/);
    expect(sql).toMatch(/post_supplier_payment_batch_v2/);
    expect(sql).toMatch(/reverse_supplier_payment_batch_v2/);
    expect(sql).toMatch(/SUPPLIER_PAYABLE_SETTLEMENT_EXCEEDED/);
    expect(sql).toMatch(/deferrable initially deferred/);
    expect(sql).toMatch(/get_supplier_finance_control_v1/);
    expect(sql).toMatch(/priceSource/);
    expect(sql).toMatch(/unit_price = 0/);
  });

  it('keeps privileged owners private and public wrappers invoker-scoped', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/security definer\s+set search_path = ''/i);
    expect(sql).toMatch(/security invoker\s+set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function app_private\.[\s\S]+from public, anon, authenticated/i);
  });
});
