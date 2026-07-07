import { describe, expect, it } from 'vitest';
import {
  aggregateMaterialWasteRows,
  formatVietnameseMoney,
  importNumber,
  parseVietnameseMoney,
  parseVietnameseNumber,
} from '../projectMaterialTabUtils';

describe('projectMaterialTabUtils Vietnamese number parsing', () => {
  it('parses dot thousands and comma decimals', () => {
    expect(parseVietnameseNumber('14,000')).toBe(14);
    expect(parseVietnameseNumber('343.000,00')).toBe(343000);
    expect(parseVietnameseNumber('4.802.000')).toBe(4802000);
    expect(parseVietnameseNumber('1.000,000')).toBe(1000);
    expect(parseVietnameseNumber('0,5')).toBe(0.5);
  });

  it('treats dots as thousands separators for BOQ imports', () => {
    expect(importNumber('8.914')).toBe(8914);
    expect(importNumber('8,914')).toBe(8.914);
  });

  it('parses unit prices and money values with comma thousands from Excel formatting', () => {
    expect(parseVietnameseNumber('343,000')).toBe(343);
    expect(parseVietnameseMoney('343,000')).toBe(343000);
    expect(parseVietnameseMoney('343.000,00')).toBe(343000);
    expect(formatVietnameseMoney(343000)).toBe('343.000,00');
  });
});

describe('projectMaterialTabUtils material waste aggregation', () => {
  it('groups waste rows by material code and unit while summing quantities and recomputing waste percent', () => {
    const rows = aggregateMaterialWasteRows([
      {
        id: 'boq-1',
        materialCode: 'D10',
        category: 'Thép',
        itemName: 'Thép XD D10',
        unit: 'Kg',
        budgetQty: 10,
        budgetUnitPrice: 100,
        budgetTotal: 1000,
        actualQty: 14,
        actualTotal: 1400,
        wasteQty: 4,
        wastePercent: 40,
        wasteValue: 400,
        wasteThreshold: 1,
        cumulativeRequested: 12,
        cumulativeImported: 20,
        cumulativeExported: 14,
      },
      {
        id: 'boq-2',
        materialCode: ' d10 ',
        category: 'Thép',
        itemName: 'Thép D10 công tác khác',
        unit: 'kg',
        budgetQty: 5,
        budgetUnitPrice: 120,
        budgetTotal: 600,
        actualQty: 6,
        actualTotal: 720,
        wasteQty: 1,
        wastePercent: 20,
        wasteValue: 120,
        wasteThreshold: 1.5,
        cumulativeRequested: 5,
        cumulativeImported: 8,
        cumulativeExported: 6,
      },
      {
        id: 'boq-3',
        materialCode: 'D10',
        category: 'Thép',
        itemName: 'Thép XD D10',
        unit: 'Cây',
        budgetQty: 2,
        budgetUnitPrice: 50,
        budgetTotal: 100,
        actualQty: 3,
        actualTotal: 150,
        wasteQty: 1,
        wastePercent: 50,
        wasteValue: 50,
        wasteThreshold: 1,
      },
    ]);

    expect(rows).toHaveLength(2);
    const kgRow = rows.find(row => row.unit === 'Kg');
    expect(kgRow).toMatchObject({
      id: 'waste:D10:kg',
      materialCode: 'D10',
      itemName: 'Thép XD D10',
      budgetQty: 15,
      budgetTotal: 1600,
      actualQty: 20,
      actualTotal: 2120,
      wasteQty: 5,
      wastePercent: 33.3,
      wasteValue: 520,
      cumulativeRequested: 17,
      cumulativeImported: 28,
      cumulativeExported: 20,
      stockBalance: 8,
      budgetOverPercent: 13.3,
      aggregateSourceCount: 2,
    });
    expect(kgRow?.wasteThreshold).toBeCloseTo(1.166667, 5);

    const cayRow = rows.find(row => row.unit === 'Cây');
    expect(cayRow).toMatchObject({
      id: 'waste:D10:cay',
      budgetQty: 2,
      actualQty: 3,
      aggregateSourceCount: 1,
    });
  });
});
