import { describe, expect, it } from 'vitest';
import type { PurchaseOrderItem } from '../../types';
import { findPurchaseOrderCommercialLineIssue } from '../purchaseOrderCommercialLines';

const line = (
  lineId: string | undefined,
  unitPrice: number,
  overrides: Partial<PurchaseOrderItem> = {},
): PurchaseOrderItem => ({
  lineId,
  vendorId: 'supplier-1',
  itemId: 'item-1',
  sku: 'SKU-1',
  name: 'Material 1',
  unit: 'kg',
  qty: 1,
  unitPrice,
  materialBudgetItemId: 'boq-1',
  ...overrides,
});

describe('purchaseOrderCommercialLines', () => {
  it('allows proactive same SKU rows at different prices', () => {
    expect(findPurchaseOrderCommercialLineIssue({
      sourceMode: 'proactive_project',
      items: [line('line-a', 10_000), line('line-b', 11_000)],
    })).toBeNull();
  });

  it('rejects proactive same SKU rows at the same normalized price', () => {
    expect(findPurchaseOrderCommercialLineIssue({
      sourceMode: 'proactive_project',
      items: [line('line-a', 10_000), line('line-b', 10_000)],
    })).toMatchObject({ code: 'duplicate_commercial_price', sku: 'SKU-1', unitPrice: 10_000 });
  });

  it('keeps request-source duplicates blocked even when prices differ', () => {
    expect(findPurchaseOrderCommercialLineIssue({
      sourceMode: 'from_request',
      items: [line('line-a', 10_000), line('line-b', 11_000)],
    })).toMatchObject({ code: 'duplicate_request_source' });
  });

  it('rejects proactive-stock same SKU rows at the same normalized price', () => {
    expect(findPurchaseOrderCommercialLineIssue({
      sourceMode: 'proactive_stock',
      items: [line('line-a', 10_000), line('line-b', 10_000)],
    })).toMatchObject({ code: 'duplicate_commercial_price', sku: 'SKU-1', unitPrice: 10_000 });
  });

  it('requires line IDs when an item is repeated at different prices', () => {
    expect(findPurchaseOrderCommercialLineIssue({
      sourceMode: 'proactive_project',
      items: [line(undefined, 10_000), line('line-b', 11_000)],
    })).toMatchObject({ code: 'missing_line_id', sku: 'SKU-1' });
  });

  it('rejects duplicated line IDs globally', () => {
    expect(findPurchaseOrderCommercialLineIssue({
      sourceMode: 'proactive_project',
      items: [line('line-a', 10_000), line('line-a', 11_000, { itemId: 'item-2', sku: 'SKU-2' })],
    })).toMatchObject({ code: 'duplicate_line_id', sku: 'SKU-2', lineId: 'line-a' });
  });

  it('allows same-price proactive rows from distinct BOQ sources', () => {
    expect(findPurchaseOrderCommercialLineIssue({
      sourceMode: 'proactive_project',
      items: [
        line('line-a', 10_000, { materialBudgetItemId: 'boq-1' }),
        line('line-b', 10_000, { materialBudgetItemId: 'boq-2' }),
      ],
    })).toBeNull();
  });

  it('allows same-price proactive rows from distinct suppliers', () => {
    expect(findPurchaseOrderCommercialLineIssue({
      sourceMode: 'proactive_project',
      items: [
        line('line-a', 10_000, { vendorId: 'supplier-1' }),
        line('line-b', 10_000, { vendorId: 'supplier-2' }),
      ],
    })).toBeNull();
  });
});
