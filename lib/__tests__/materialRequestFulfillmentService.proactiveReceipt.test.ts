import { describe, expect, it } from 'vitest';
import { buildReceiptQuantitySnapshot } from '../materialUnitConversion';

describe('proactive PO WMS receipt contract', () => {
  it('keeps accepted purchase and stock quantities in their own units', () => {
    expect(buildReceiptQuantitySnapshot({
      acceptedPurchaseQty: 9.5,
      purchaseUnit: 'Cay',
      stockUnit: 'Kg',
      conversionFactor: 7.2,
    })).toEqual({
      acceptedPurchaseQty: 9.5,
      acceptedStockQty: 68.4,
      purchaseUnit: 'Cay',
      stockUnit: 'Kg',
      conversionFactor: 7.2,
    });
  });
});
