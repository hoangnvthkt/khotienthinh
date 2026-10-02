import { describe, expect, it } from 'vitest';
import { findImportPricingIssue, vatFields } from '../wmsImportPricing';

const line = (unitPrice: number, catalogPrice = 0) => ({ itemId: 'i', name: 'Thép XD D20', unit: 'Cây', stockQty: 10, unitPrice, catalogPrice });

describe('findImportPricingIssue', () => {
  it('requires VAT before anything else', () => {
    expect(findImportPricingIssue([line(100)], '')).toEqual({ kind: 'vat' });
  });
  it('requires a positive price on every line', () => {
    expect(findImportPricingIssue([line(100), line(0)], '8')).toMatchObject({ kind: 'price' });
    expect(findImportPricingIssue([line(Number.NaN)], '8')).toMatchObject({ kind: 'price' });
  });
  it('flags prices far above the catalog (per-ton typed into per-kg)', () => {
    expect(findImportPricingIssue([line(409141055, 439609)], '10')).toMatchObject({ kind: 'outlier', ratio: 931 });
    expect(findImportPricingIssue([line(409141, 439609)], '10')).toBeNull();
    expect(findImportPricingIssue([line(409141055, 0)], '10')).toBeNull();
  });
});

describe('vatFields', () => {
  it('stores the rate or the VAT-inclusive flag', () => {
    expect(vatFields('8')).toEqual({ vatRate: 8, priceIncludesVat: false });
    expect(vatFields('incl')).toEqual({ vatRate: undefined, priceIncludesVat: true });
  });
});
