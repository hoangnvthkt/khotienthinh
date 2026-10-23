import { describe, expect, it } from 'vitest';
import { isTableEmpty, normalizeHeader, parseLooseNumber, parseTableMatrix, tableTemplateFileName, tableExportFileName, buildTableSheetRows } from '../excelTableImport';

const COLUMNS = ['Họ và tên', 'Ngày tháng năm sinh', 'Vị trí công việc', 'Phòng ban'];

describe('workflow table Excel import', () => {
  it('normalizes Vietnamese headers', () => {
    expect(normalizeHeader('  NGÀY THÁNG NĂM SINH (*) ')).toBe('ngay thang nam sinh');
    expect(normalizeHeader('Phòng ban/Đơn vị')).toBe('phong ban don vi');
  });

  it('finds the header below a title, matches columns in any order and skips STT and empty rows', () => {
    const matrix = [
      ['DANH SÁCH NHÂN SỰ MỚI THÁNG 10'],
      [],
      ['STT', 'Phòng ban', 'Họ và tên nhân viên', 'ngay thang nam sinh', 'Ghi chú'],
      [1, 'Kỹ thuật', 'Nguyễn Văn A', new Date(1995, 4, 7), 'x'],
      [null, null, null, null, null],
      [2, 'Kế toán', '  Trần   Thị B ', '01/02/1998', ''],
    ];
    const result = parseTableMatrix(matrix, COLUMNS);
    expect(result.byPosition).toBe(false);
    expect(result.rows).toEqual([
      ['Nguyễn Văn A', '07/05/1995', '', 'Kỹ thuật'],
      ['Trần Thị B', '01/02/1998', '', 'Kế toán'],
    ]);
    expect(result.sourceHeaders).toEqual(['Họ và tên nhân viên', 'ngay thang nam sinh', null, 'Phòng ban']);
    expect(result.ignoredHeaders).toEqual(['STT', 'Ghi chú']);
    expect(result.skippedEmpty).toBe(1);
  });

  it('falls back to column order when no header row matches', () => {
    const result = parseTableMatrix([['A', '1990', 'Thợ', 'Xưởng']], COLUMNS);
    expect(result.byPosition).toBe(true);
    expect(result.rows).toEqual([['A', '1990', 'Thợ', 'Xưởng']]);
  });

  it('treats the default blank row as an empty table', () => {
    expect(isTableEmpty([['', '']])).toBe(true);
    expect(isTableEmpty([['', 'x']])).toBe(false);
    expect(tableTemplateFileName('Thông tin chi tiết')).toBe('Mau_thong_tin_chi_tiet.xlsx');
  });

  it('matches columns by alias and keeps raw cell values', () => {
    const result = parseTableMatrix([['Mã VT', 'Tên hàng', 'ĐVT', 'KL', 'ĐG'], ['T10', 'Thép D10', 'kg', 2.5, 18500]],
      ['Mã vật tư', 'Tên vật tư', 'Đơn vị tính', 'Số lượng', 'Đơn giá'],
      [['mã vt', 'mã hàng'], ['tên hàng'], ['đvt'], ['kl', 'khối lượng'], ['đg']]);
    expect(result.sourceHeaders).toEqual(['Mã VT', 'Tên hàng', 'ĐVT', 'KL', 'ĐG']);
    expect(result.rawRows).toEqual([['T10', 'Thép D10', 'kg', 2.5, 18500]]);
  });

  it('reads Vietnamese and English number formats', () => {
    expect(parseLooseNumber(2.5)).toBe(2.5);
    expect(parseLooseNumber('1.234,5')).toBe(1234.5);
    expect(parseLooseNumber('1,234.5')).toBe(1234.5);
    expect(parseLooseNumber('18.500 đ')).toBe(18500);
    expect(parseLooseNumber('2,5')).toBe(2.5);
    expect(parseLooseNumber('0.5')).toBe(0.5);
    expect(parseLooseNumber('abc')).toBeNull();
  });
});

describe('workflow table Excel export', () => {
  it('builds header + non-empty rows padded to the column count', () => {
    expect(buildTableSheetRows(['Tên', 'ĐVT', 'SL'], [['Dầu', 'Thùng', '1'], ['', '', ''], ['Vỏ']])).toEqual([
      ['Tên', 'ĐVT', 'SL'],
      ['Dầu', 'Thùng', '1'],
      ['Vỏ', '', ''],
    ]);
    expect(buildTableSheetRows(['Tên'], null)).toEqual([['Tên']]);
  });

  it('names the file after the field and the phiếu code', () => {
    expect(tableExportFileName('Bảng kê vật tư', 'YC-0012')).toBe('Bang_ke_vat_tu_YC-0012.xlsx');
    expect(tableExportFileName('Bảng kê vật tư')).toBe('Bang_ke_vat_tu.xlsx');
  });
});
