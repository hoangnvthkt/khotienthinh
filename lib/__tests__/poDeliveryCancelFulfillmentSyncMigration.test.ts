import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260826094218_fix_po_delivery_cancel_fulfillment_sync.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('PO delivery cancellation fulfillment sync migration', () => {
  it('matches an open fulfillment through the delivery batch when its transaction id is missing', () => {
    expect(sql).toContain("v_tx.source_type = 'po_delivery_batch'");
    expect(sql).toContain('batch.po_delivery_batch_id::text = v_tx.source_id');
    expect(sql).toContain('batch.transaction_id::text = v_tx.id::text');
    expect(sql).toContain('coalesce(line.received_qty, 0) > 0');
  });

  it('repairs safe historical rows by replaying cancelled WMS synchronization', () => {
    expect(sql).toMatch(/status\s*=\s*'cancelled'::public\.transaction_status/);
    expect(sql).toMatch(/source_type\s*=\s*'po_delivery_batch'/);
    expect(sql).toContain('project_po_sync_cancelled_receipt_transaction_v1(tx.id::text');
  });
});
