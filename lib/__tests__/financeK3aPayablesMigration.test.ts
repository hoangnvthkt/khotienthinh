import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261006090000_finance_k3a_payables.sql'), 'utf8').toLowerCase();

describe('K3a — Tài chính: phải trả NCC', () => {
  it('registers the finance capabilities and a private attachment bucket', () => {
    for (const action of ['view', 'record', 'confirm', 'manage']) expect(sql).toContain(`'system.finance.${action}'`);
    expect(sql).toContain("values ('finance-attachments', 'finance-attachments', false");
  });

  it('derives due dates from contract → supplier → company default and keeps the source', () => {
    expect(sql).toContain("case when (select d from c) is not null then 'contract' when (select d from s) is not null then 'supplier' else 'default' end");
    expect(sql).toContain('create trigger trg_supplier_payable_due before insert or update on public.supplier_payable_documents');
  });

  it('blocks direct table writes to payables outside business functions', () => {
    expect(sql).toContain("v_path not like '/rpc/%'");
    expect(sql).toContain("message = 'supplier_payable_direct_write'");
  });

  it('enforces segregation of duties on every confirmation', () => {
    expect(sql.match(/message = 'finance_self_confirm'/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('reconciles opening balances against MISA without creating project cost twice', () => {
    expect(sql).toContain("message = 'finance_opening_vioo_higher'");
    expect(sql).toContain("'opening_balance', v_o.id::text");
    expect(sql).toContain("message = 'finance_opening_stale'");
  });

  it('records outside payments with proof and confirms them through the G7 engine', () => {
    expect(sql).toContain("message = 'finance_attachment_required'");
    expect(sql).toContain("message = 'finance_payment_ref_duplicate'");
    expect(sql).toContain('perform app_private.post_supplier_payment_batch(v_b.id, v_actor)');
    expect(sql).toContain("message = 'finance_internal_partner'");
  });

  it('keeps an immutable finance history and a versioned approval matrix', () => {
    expect(sql).toContain("message = 'finance_events_immutable'");
    expect(sql).toContain("message = 'finance_matrix_gap'");
  });
});
