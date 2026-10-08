import { describe, expect, it } from 'vitest';
import { isTableEmpty, normalizeHeader, parseTableMatrix, tableTemplateFileName } from '../workflowTableExcel';

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
});
