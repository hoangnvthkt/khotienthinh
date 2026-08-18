import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { InventoryItem } from '../../types';
import {
  buildImportedMaterialRequestItem,
  parseMaterialRequestExcel,
} from '../materialRequestImportService';

const item: InventoryItem = {
  id: 'item-valve',
  sku: 'VT0001489',
  name: 'Van PPR D32',
  category: 'Ống nước',
  unit: 'Cái',
  priceIn: 0,
  priceOut: 0,
  minStock: 0,
  stockByWarehouse: {},
};

const makeWorkbookBuffer = (rows: unknown[][]): ArrayBuffer => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'De_Xuat_Vat_Tu');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};

const repeatedCodeWorkbook = () => makeWorkbookBuffer([
  ['Mã/Tên Phiếu đề xuất', 'Mã vật tư/SKU', 'Tên trên đề xuất', 'Quy cách/mô tả', 'Đơn vị tính', 'Số lượng đề xuất'],
  ['DX-VT-001', 'VT0001489', 'Van chặn PPR D32', 'PN20', 'Cái', 2],
  ['DX-VT-001', 'VT0001489', 'Van PPR D32', 'Loại thường', 'Cái', 10],
]);

describe('material request Excel commercial descriptions', () => {
  it('keeps repeated material codes as separate rows with their Excel descriptions', async () => {
    const preview = await parseMaterialRequestExcel(repeatedCodeWorkbook(), 'mr.xlsx', [item], [], []);

    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.map(row => ({
      itemId: row.matchedInventoryItem?.id,
      name: row.materialName,
      specification: row.specification,
      qty: row.requestQty,
    }))).toEqual([
      { itemId: 'item-valve', name: 'Van chặn PPR D32', specification: 'PN20', qty: 2 },
      { itemId: 'item-valve', name: 'Van PPR D32', specification: 'Loại thường', qty: 10 },
    ]);
  });

  it('builds two traceable RequestItems without replacing Excel names by the catalog name', async () => {
    const preview = await parseMaterialRequestExcel(repeatedCodeWorkbook(), 'mr.xlsx', [item], [], []);
    const requestItems = preview.rows.map((row, index) =>
      buildImportedMaterialRequestItem(row, `line-${index + 1}`));

    expect(requestItems.map(line => ({
      lineId: line.lineId,
      itemId: line.itemId,
      sku: line.skuSnapshot,
      name: line.itemNameSnapshot,
      specification: line.specification,
      unit: line.unitSnapshot,
    }))).toEqual([
      { lineId: 'line-1', itemId: 'item-valve', sku: 'VT0001489', name: 'Van chặn PPR D32', specification: 'PN20', unit: 'Cái' },
      { lineId: 'line-2', itemId: 'item-valve', sku: 'VT0001489', name: 'Van PPR D32', specification: 'Loại thường', unit: 'Cái' },
    ]);
  });

  it('warns when the Excel unit differs from the catalog stock unit', async () => {
    const buffer = makeWorkbookBuffer([
      ['Mã vật tư/SKU', 'Tên trên đề xuất', 'Đơn vị tính', 'Số lượng đề xuất'],
      ['VT0001489', 'Van chặn PPR D32', 'Hộp', 2],
    ]);

    const preview = await parseMaterialRequestExcel(buffer, 'mr-unit.xlsx', [item], [], []);

    expect(preview.rows[0].warnings).toContain("ĐVT Excel 'Hộp' khác ĐVT tồn kho 'Cái'; MR sẽ dùng ĐVT tồn kho.");
    expect(buildImportedMaterialRequestItem(preview.rows[0], 'line-unit').unitSnapshot).toBe('Cái');
  });

  it('blocks a declared material code that does not exist even when the row has a name', async () => {
    const buffer = makeWorkbookBuffer([
      ['Mã vật tư/SKU', 'Tên trên đề xuất', 'Số lượng đề xuất'],
      ['VT-KHONG-TON-TAI', 'Tên nhập từ Excel', 1],
    ]);

    const preview = await parseMaterialRequestExcel(buffer, 'mr-unknown.xlsx', [item], [], []);

    expect(preview.rows[0].status).toBe('error');
    expect(preview.rows[0].errors).toContain("Mã vật tư 'VT-KHONG-TON-TAI' không tồn tại trong danh mục kho hệ thống");
  });
});
