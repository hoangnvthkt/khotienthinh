import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../materialRequestFulfillmentService.ts', import.meta.url),
  'utf8',
);

describe('proactive PO WMS receipt contract', () => {
  it('branches before looking up material request links', () => {
    expect(source).toContain("po.sourceMode !== 'from_request'");
    expect(source).toContain('createProactivePoDeliveryReceiptBatch');
  });

  it('uses the delivery batch as the idempotent transaction source', () => {
    expect(source).toContain("sourceType: 'po_delivery_batch'");
    expect(source).toContain('sourceId: deliveryBatch.id');
    expect(source).toContain('wmsTransactionId');
    expect(source).toContain('orderedQty');
  });
});
