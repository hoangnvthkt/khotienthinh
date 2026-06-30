import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { customMaterialSmartImportService } from '../customMaterialSmartImportService';

const makeMergedXaGoWorkbookFile = () => {
  const rows = [
    ['DỰ TRÙ VẬT TƯ'],
    ['CÔNG TRÌNH: RICO'],
    ['MỤC: XÀ GỒ'],
    ['STT', 'Diễn Giải', 'Chủng loại', 'Quy cách', 'Số CK', 'Kích thước', '', 'Khối lượng', 'Ghi chú'],
    ['', '', '', '', '', 'Dài (mm)', 'Kg/m', '(kg)', ''],
    [1, 'Xà gồ: Phôi G350 hoặc tương đương; Độ mạ Z120', '', '', '1.486', '', '', '92.209,59', ''],
    [1, 'XCT1', 'Mạ kẽm', 'ZZ250-2-20-72-20-78', '48', '10.345', '6,78', '3.367,87', ''],
    [2, 'XCT2', 'Mạ kẽm', 'ZZ250-2-20-72-20-78', 12, 9660, '6,78', '', ''],
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges'] = [
    { s: { r: 3, c: 5 }, e: { r: 3, c: 6 } },
    { s: { r: 3, c: 7 }, e: { r: 3, c: 7 } },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Đề xuất XG');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([output], 'xa-go-ca-nhan.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

describe('customMaterialSmartImportService', () => {
  it('detects merged Xà gồ headers, maps columns, and skips group summary rows', async () => {
    const sheet = await customMaterialSmartImportService.previewWorkbook(makeMergedXaGoWorkbookFile());
    const preview = customMaterialSmartImportService.suggestLocal(sheet, 'xa_go');

    expect(preview.source).toBe('local');
    expect(preview.confidenceScore).toBeGreaterThanOrEqual(0.7);
    expect(preview.mapping.quantity?.label).toContain('Số CK');
    expect(preview.mapping.lengthMm?.label).toContain('Dài');
    expect(preview.mapping.kgPerM?.label).toContain('Kg/m');
    expect(preview.rows).toHaveLength(2);

    const first = preview.rows[0];
    expect(first.rowNumber).toBe(7);
    expect(first.status).toBe('create');
    expect(first.line.description).toBe('XCT1');
    expect(first.line.quantity).toBe(48);
    expect(first.line.length).toBe(10.345);
    expect(first.line.lengthMd).toBeCloseTo(496.56);
    expect(first.line.specJson).toMatchObject({
      templateKey: 'xa_go',
      chung_loai: 'Mạ kẽm',
      quy_cach: 'ZZ250-2-20-72-20-78',
      length_mm: 10345,
      kg_per_m: 6.78,
      weight_kg: 3367.87,
    });
  });

  it('calculates missing Xà gồ weight from quantity, length and kg/m', async () => {
    const sheet = await customMaterialSmartImportService.previewWorkbook(makeMergedXaGoWorkbookFile());
    const preview = customMaterialSmartImportService.suggestLocal(sheet, 'xa_go');
    const second = preview.rows[1];

    expect(second.status).toBe('create');
    expect(second.warnings).toEqual([]);
    expect(second.line.specJson).toMatchObject({
      length_mm: 9660,
      kg_per_m: 6.78,
      calculated_weight_kg: 785.94,
      weight_kg: 785.94,
    });
  });

  it('parses 4.000 as four thousand millimeters in smart import', async () => {
    const rows = [
      ['STT', 'Diễn giải', 'Chủng loại', 'Quy cách', 'SL cấu kiện', 'Dài (mm)', 'Kg/m', 'Khối lượng (kg)', 'Ghi chú'],
      [1, 'XCT3', 'Mạ kẽm', 'ZZ250-2-20-72-20-78', '2', '4.000', '6,78', '', ''],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Xà gồ');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const file = new File([output], 'xa-go-4000.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const sheet = await customMaterialSmartImportService.previewWorkbook(file);
    const preview = customMaterialSmartImportService.suggestLocal(sheet, 'xa_go');

    expect(preview.rows[0].line.length).toBe(4);
    expect(preview.rows[0].line.lengthMd).toBe(8);
    expect(preview.rows[0].line.specJson).toMatchObject({
      length_mm: 4000,
      kg_per_m: 6.78,
      calculated_weight_kg: 54.24,
    });
  });
});
