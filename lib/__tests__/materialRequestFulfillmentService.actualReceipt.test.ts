import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const serviceSource = readFileSync(
  new URL('../materialRequestFulfillmentService.ts', import.meta.url),
  'utf8',
);
const migrationSource = readFileSync(
  new URL('../../supabase/migrations/20260723061800_po_actual_receipt_wms.sql', import.meta.url),
  'utf8',
);

describe('actual PO receipt contract', () => {
  it('prepares proactive transactions without request links', () => {
    expect(serviceSource).toContain('prepareProactivePoReceiptForQualityReview');
    expect(serviceSource).toContain("input.po.sourceMode !== 'from_request'");
    expect(serviceSource).toContain('materialRequestIds: []');
  });

  it('preserves ordered baseline and sends variance reason to the RPC', () => {
    expect(serviceSource).toContain('buildActualReceiptItems');
    expect(serviceSource).toContain('orderedQty');
    expect(serviceSource).toContain('varianceReason');
  });

  it('syncs actual receipt without capping it to ordered quantity', () => {
    expect(migrationSource).toContain('ir.current_received_qty + coalesce(r.received_qty, 0)');
    expect(migrationSource).not.toContain('least(ir.ordered_qty');
  });
});
