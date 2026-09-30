import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261003090000_procurement_receipt_reconciliation.sql'), 'utf8').toLowerCase();

describe('Đối chiếu nhận hàng tồn đọng', () => {
  it('needs Mua hàng and thủ kho, two different people, on the current revision', () => {
    expect(sql).toContain("message = 'receipt_recon_same_person'");
    expect(sql).toContain("message = 'receipt_recon_revision_conflict'");
    expect(sql).toContain('revision = revision + 1, buyer_confirmed_by = null, buyer_confirmed_at = null, keeper_confirmed_by = null, keeper_confirmed_at = null');
    expect(sql).toContain("message = 'receipt_recon_post_denied'");
  });

  it('keeps an append-only history', () => {
    expect(sql).toContain('before update or delete on public.procurement_receipt_reconciliation_events');
    expect(sql).toContain("message = 'receipt_recon_history_immutable'");
  });

  it('books stock, project cost and payables on the actual arrival date', () => {
    expect(sql).toContain("date = v_arrival_ts");
    expect(sql).toContain('set document_date = v_r.arrival_date');
    expect(sql).toContain("'origin', 'receipt_reconciliation'");
    expect(sql).toContain("update public.project_transactions set date = v_r.arrival_date::text");
  });

  it('never re-imports stock the warehouse already recorded, and refuses to go below it', () => {
    expect(sql).toContain("message = 'receipt_recon_below_stocked'");
    expect(sql).toContain("'receipt_reconciliation', v_r.id::text, 'request_po_receipt'");
  });
});
