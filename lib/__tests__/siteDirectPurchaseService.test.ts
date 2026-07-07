import { describe, expect, it } from 'vitest';
import type { SiteDirectPurchaseLine } from '../../types';
import {
  calculateSiteDirectPurchaseTotals,
  canRecognizeSiteDirectPurchaseLine,
} from '../siteDirectPurchaseService';

const line = (patch: Partial<SiteDirectPurchaseLine> = {}): SiteDirectPurchaseLine => ({
  id: 'line-1',
  directPurchaseId: 'direct-1',
  lineNo: 1,
  lineType: 'stock_item',
  itemId: 'item-1',
  skuSnapshot: 'VT-001',
  itemNameSnapshot: 'Vat tu mua nong',
  unitSnapshot: 'kg',
  quantity: 10.5,
  unitPrice: 100_000,
  vatRate: 10,
  lineAmount: 1_050_000,
  vatAmount: 105_000,
  acceptedQuantity: 0,
  acceptedAmount: 0,
  status: 'pending',
  ...patch,
});

describe('siteDirectPurchaseService helpers', () => {
  it('calculates decimal quantities and VAT for direct purchase lines', () => {
    const totals = calculateSiteDirectPurchaseTotals([
      line({ quantity: 10.5, unitPrice: 100_000, vatRate: 10 }),
      line({
        id: 'line-2',
        lineNo: 2,
        lineType: 'expense_only',
        quantity: 1,
        unitPrice: 500_000,
        vatRate: 0,
      }),
    ]);

    expect(totals.grossAmount).toBe(1_550_000);
    expect(totals.vatAmount).toBe(105_000);
    expect(totals.totalAmount).toBe(1_655_000);
  });

  it('does not recognize stock-item direct purchase before completed WMS import', () => {
    expect(canRecognizeSiteDirectPurchaseLine(line(), { wmsStatus: 'draft', financeAccepted: true })).toBe(false);
    expect(canRecognizeSiteDirectPurchaseLine(line(), { wmsStatus: 'completed', financeAccepted: true })).toBe(true);
  });

  it('recognizes expense-only lines from finance review without changing inventory', () => {
    expect(canRecognizeSiteDirectPurchaseLine(
      line({ lineType: 'expense_only', itemId: null }),
      { wmsStatus: null, financeAccepted: true },
    )).toBe(true);
  });
});
