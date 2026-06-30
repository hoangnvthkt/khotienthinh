import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { customMaterialRequestService } from '../customMaterialRequestService';

const makeWorkbookFile = (rows: unknown[][]) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Xà gồ');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([output], 'xa-go.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

describe('customMaterialRequestService import templates', () => {
  it('parses Xà gồ rows with Vietnamese numbers and warning mismatch weight', async () => {
    const file = makeWorkbookFile([
      ['STT', 'Diễn giải', 'Chủng loại', 'Quy cách', 'SL cấu kiện', 'Dài (mm)', 'Kg/m', 'Khối lượng (kg)', 'Ghi chú'],
      [1, 'XCT1', 'Mạ kẽm', 'ZZ250-2-20-72-20-78', '48', '10.345', '6,78', '3.367,87', ''],
    ]);

    const rows = await customMaterialRequestService.importExcelPreview(file, 'xa_go');
    const line = rows[0].line;

    expect(rows[0].status).toBe('create');
    expect(rows[0].warnings?.[0]).toContain('lệch công thức');
    expect(line.profileType).toBe('xa_go');
    expect(line.description).toBe('XCT1');
    expect(line.quantity).toBe(48);
    expect(line.length).toBe(10.345);
    expect(line.lengthMd).toBeCloseTo(496.56);
    expect(line.unit).toBe('cấu kiện');
    expect(line.specJson).toMatchObject({
      templateKey: 'xa_go',
      chung_loai: 'Mạ kẽm',
      quy_cach: 'ZZ250-2-20-72-20-78',
      length_mm: 10345,
      kg_per_m: 6.78,
      weight_kg: 3367.87,
    });
  });

  it('calculates Xà gồ weight when the Excel weight cell is empty', async () => {
    const file = makeWorkbookFile([
      ['STT', 'Diễn giải', 'Chủng loại', 'Quy cách', 'SL cấu kiện', 'Dài (mm)', 'Kg/m', 'Khối lượng (kg)', 'Ghi chú'],
      [1, 'XCT2', 'Mạ kẽm', 'ZZ250-2-20-72-20-78', 12, 9660, 6.78, '', ''],
    ]);

    const rows = await customMaterialRequestService.importExcelPreview(file, 'xa_go');

    expect(rows[0].warnings).toEqual([]);
    expect(rows[0].line.specJson).toMatchObject({
      calculated_weight_kg: 785.94,
      weight_kg: 785.94,
    });
  });

  it('treats dot as thousands separator and comma as decimal separator', async () => {
    const file = makeWorkbookFile([
      ['STT', 'Diễn giải', 'Chủng loại', 'Quy cách', 'SL cấu kiện', 'Dài (mm)', 'Kg/m', 'Khối lượng (kg)', 'Ghi chú'],
      [1, 'XCT3', 'Mạ kẽm', 'ZZ250-2-20-72-20-78', '2', '4.000', '6,78', '', ''],
    ]);

    const rows = await customMaterialRequestService.importExcelPreview(file, 'xa_go');

    expect(rows[0].line.length).toBe(4);
    expect(rows[0].line.lengthMd).toBe(8);
    expect(rows[0].line.specJson).toMatchObject({
      length_mm: 4000,
      kg_per_m: 6.78,
      calculated_weight_kg: 54.24,
      weight_kg: 54.24,
    });
  });
});
