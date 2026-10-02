import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261008090000_finance_k3b_payment_requests.sql'), 'utf8').toLowerCase();

describe('K3b — đề nghị chi, duyệt theo ma trận, xác nhận chi', () => {
  it('freezes the approval route at submit and counts same-supplier requests from the last 7 days', () => {
    expect(sql).toContain("created_at >= now() - interval '7 days'");
    expect(sql).toContain("message = 'finance_no_eligible_approver: ' || (v_route->>'problemstep')");
  });
  it('enforces segregation of duties on approve and confirm', () => {
    expect(sql).toContain("message = 'finance_not_approver'");
    expect(sql).toContain("message = 'finance_self_confirm'");
    expect(sql).toContain('app_private.finance_doc_handlers(l.payable_document_id)');
  });
  it('never pays more than what is still owed and not reserved elsewhere', () => {
    expect(sql).toContain('v_amount > d.outstanding - d.pending_external - app_private.finance_doc_reserved(d.id, p_exclude) + 0.005');
  });
  it('splits payment per project and posts / reverses through the G7 engine', () => {
    expect(sql).toContain('group by project_id, site_id');
    expect(sql).toContain('perform app_private.post_supplier_payment_batch(v_bid, v_actor)');
    expect(sql).toContain("perform app_private.reverse_supplier_payment_batch((b->>'batchid')::uuid, v_actor)");
  });
});
