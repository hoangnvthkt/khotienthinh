import { describe, expect, it } from 'vitest';
import { parseTableMatrix } from '../excelTableImport';
import {
  PO_IMPORT_ALIASES, PO_IMPORT_COLUMNS, mergeImportedLines, nameSimilarity, normalizeUnit, pickCatalogMatch,
  readPoImportRows, searchQueriesFor, toImportedLine,
} from '../procurementExcelImport';
import type { ProcurementCatalogItem } from '../procurementInboxService';

const item = (over: Partial<ProcurementCatalogItem>): ProcurementCatalogItem => ({
  id: 'x', name: 'x', sku: null, unit: 'kg', purchaseUnit: null, purchaseFactor: null, inBoq: false, boqQty: 0, orderedQty: 0, ...over,
});
const THEP = item({ id: 'thep', name: 'Thép D10 CB300', sku: 'VT-THEP-D10', unit: 'kg', purchaseUnit: 'cây', purchaseFactor: 7.22, inBoq: true });
const XI = item({ id: 'xm', name: 'Xi măng PCB40 Bút Sơn', sku: 'VT-XM-40', unit: 'bao' });

describe('procurement Excel import', () => {
  it('reads a supplier quote with its own column names', () => {
    const result = parseTableMatrix([
      ['BÁO GIÁ VẬT TƯ'],
      ['STT', 'Tên hàng hóa', 'ĐVT', 'KL', 'Đơn giá (VNĐ)', 'Thành tiền'],
      [1, 'Thép D10 CB300', 'cây', 20, '185.000', 3700000],
      [2, 'Xi mang PCB40', 'bao', '50', 92000, 4600000],
    ], PO_IMPORT_COLUMNS, PO_IMPORT_ALIASES);
    expect(readPoImportRows(result)).toEqual([
      { index: 1, sku: '', name: 'Thép D10 CB300', spec: '', unit: 'cây', qty: 20, price: 185000 },
      { index: 2, sku: '', name: 'Xi mang PCB40', spec: '', unit: 'bao', qty: 50, price: 92000 },
    ]);
  });

  it('matches by code first, then by name without accents', () => {
    expect(pickCatalogMatch({ sku: 'vt-thep-d10', name: 'bất kỳ' }, [XI, THEP])).toMatchObject({ item: { id: 'thep' }, confidence: 'sku' });
    expect(pickCatalogMatch({ sku: '', name: 'THÉP D10 CB300' }, [XI, THEP])).toMatchObject({ item: { id: 'thep' }, confidence: 'name' });
    expect(pickCatalogMatch({ sku: '', name: 'Xi mang PCB40' }, [THEP, XI])).toMatchObject({ item: { id: 'xm' }, confidence: 'suggested' });
    expect(pickCatalogMatch({ sku: '', name: 'Ống nhựa PPR 25' }, [THEP, XI]).item).toBeNull();
    expect(nameSimilarity('Thép D10', 'Thép D12')).toBeCloseTo(1 / 3);
  });

  it('builds server queries from code then shorter names', () => {
    expect(searchQueriesFor({ sku: 'T10', name: 'Thép cuộn D6 Hòa Phát loại 1' })).toEqual([
      'T10', 'Thép cuộn D6 Hòa', 'Thép cuộn D6', 'Thép cuộn', 'Thép',
    ]);
  });

  it('converts purchase units to stock units and warns on unknown units', () => {
    const asPurchase = toImportedLine({ index: 1, sku: '', name: '', spec: '', unit: 'Cây', qty: 20, price: 185000 }, THEP);
    expect(asPurchase).toMatchObject({ altUnit: true, purchaseQty: 20, stockQty: 144.4, price: 185000, warnings: [] });
    const odd = toImportedLine({ index: 2, sku: '', name: '', spec: '', unit: 'tấn', qty: 1, price: null }, THEP);
    expect(odd.altUnit).toBe(false);
    expect(odd.warnings[0]).toContain('ĐVT trong file "tấn"');
    expect(normalizeUnit('m²')).toBe('m2');
    expect(normalizeUnit('Chiếc')).toBe('cai');
  });

  it('merges repeated items and keeps the first price', () => {
    const a = toImportedLine({ index: 1, sku: '', name: '', spec: 'KT 30x30', unit: 'bao', qty: 10, price: 92000 }, XI);
    const b = toImportedLine({ index: 4, sku: '', name: '', spec: '', unit: 'bao', qty: 5, price: 90000 }, XI);
    const [merged] = mergeImportedLines([a, b]);
    expect(merged).toMatchObject({ stockQty: 15, price: 92000, spec: 'KT 30x30', sourceRows: [1, 4] });
    expect(merged.warnings[0]).toContain('đơn giá khác');
  });
});
