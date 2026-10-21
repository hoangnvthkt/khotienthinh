import { describe, expect, it } from 'vitest';
import {
  NXT_EXCEL_HEADERS,
  buildNxtExcelRows,
  isNegativeStock,
  isValueMissing,
  mapNxtRow,
  rowMissingPrice,
  summarizeNxt,
} from '../inventoryNxtReport';

const raw = (overrides: Record<string, unknown> = {}) => ({
  warehouseId: 'wh-smb',
  warehouseName: 'Kho Sơn Miền Bắc',
  materialId: 'm-1',
  sku: 'VT0000102',
  name: 'Thép tấm 20 ly Q',
  unit: 'kg',
  openingQty: '5652',
  openingValue: '81756010',
  inQty: 0,
  inValue: 0,
  outQty: 0,
  outValue: 0,
  closingQty: '5652',
  closingValue: '81756010',
  unpricedInLines: 0,
  ...overrides,
});

describe('báo cáo nhập xuất tồn kiểu MISA', () => {
  it('đọc số từ RPC (chuỗi numeric) thành số', () => {
    const row = mapNxtRow(raw());
    expect(row.key).toBe('wh-smb:m-1');
    expect(row.openingQty).toBe(5652);
    expect(row.closingValue).toBe(81756010);
  });

  it('có số lượng mà giá trị 0 là THIẾU GIÁ, không phải 0 đồng', () => {
    expect(isValueMissing(10, 0)).toBe(true);
    expect(isValueMissing(0, 0)).toBe(false);
    expect(isValueMissing(10, 125000)).toBe(false);
    expect(rowMissingPrice(mapNxtRow(raw({ closingValue: 0 })))).toBe(true);
    expect(rowMissingPrice(mapNxtRow(raw({ unpricedInLines: 2 })))).toBe(true);
    expect(rowMissingPrice(mapNxtRow(raw()))).toBe(false);
  });

  it('cộng giá trị, đếm dòng thiếu giá và âm kho', () => {
    const totals = summarizeNxt([
      mapNxtRow(raw()),
      mapNxtRow(raw({ materialId: 'm-2', openingQty: 0, openingValue: 0, inQty: 10, inValue: 0, closingQty: 10, closingValue: 0, unpricedInLines: 1 })),
      mapNxtRow(raw({ materialId: 'm-3', openingQty: 0, openingValue: 0, outQty: 3, outValue: 300, closingQty: -3, closingValue: -300 })),
    ]);
    expect(totals).toEqual({
      openingValue: 81756010,
      inValue: 0,
      outValue: 300,
      closingValue: 81755710,
      missingPriceRows: 1,
      negativeRows: 1,
    });
    expect(isNegativeStock(mapNxtRow(raw({ closingQty: -0.00001 })))).toBe(false);
  });

  it('Excel đúng 12 cột như bảng MISA, giá trị làm tròn đồng', () => {
    expect(NXT_EXCEL_HEADERS).toHaveLength(12);
    expect(NXT_EXCEL_HEADERS[0]).toBe('Mã hàng');
    expect(NXT_EXCEL_HEADERS[11]).toBe('Tên kho');
    const [line] = buildNxtExcelRows([mapNxtRow(raw({ openingValue: 81756010.4, inQty: 1.5, inValue: 10.6 }))]);
    expect(line).toEqual(['VT0000102', 'Thép tấm 20 ly Q', 'kg', 5652, 81756010, 1.5, 11, 0, 0, 5652, 81756010, 'Kho Sơn Miền Bắc']);
  });
});
