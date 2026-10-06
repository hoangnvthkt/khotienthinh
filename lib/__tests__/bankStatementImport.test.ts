import { describe, expect, it } from 'vitest';
import { detectColumns, parseBankStatementGrid, parseDate, parseNumber } from '../bankStatementImport';

// Đọc sao kê ngân hàng: nhận cột theo tên của nhiều ngân hàng, ghi nợ = tiền ra, ghi có = tiền vào.

describe('Đọc sao kê ngân hàng', () => {
  it('đọc số kiểu Việt Nam và kiểu quốc tế', () => {
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('1,234,567')).toBe(1234567);
    expect(parseNumber('1.234.567,5')).toBe(1234567.5);
    expect(parseNumber('1,234,567.89')).toBe(1234567.89);
    expect(parseNumber('(500.000)')).toBe(-500000);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(2500000)).toBe(2500000);
  });

  it('đọc ngày dd/mm/yyyy, yyyy-mm-dd và số ngày Excel', () => {
    expect(parseDate('05/10/2026')).toBe('2026-10-05');
    expect(parseDate('5-10-2026 14:22:01')).toBe('2026-10-05');
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate(46300)).toBe('2026-10-05');
    expect(parseDate('Tổng cộng')).toBeNull();
  });

  it('nhận cột Vietcombank, Techcombank; không nhầm "Chi tiết giao dịch" là cột chi', () => {
    const vcb = detectColumns(['STT', 'Ngày giao dịch', 'Số tham chiếu', 'Số tiền ghi nợ', 'Số tiền ghi có', 'Số dư', 'Nội dung chi tiết']);
    expect(vcb).toMatchObject({ date: 1, reference: 2, debit: 3, credit: 4, balance: 5, description: 6 });
    const tcb = detectColumns(['Ngày giao dịch', 'Đối tác', 'Diễn giải', 'Nợ/Debit', 'Có/Credit', 'Số dư/Balance']);
    expect(tcb).toMatchObject({ date: 0, counterparty: 1, description: 2, debit: 3, credit: 4, balance: 5 });
    const other = detectColumns(['Ngày', 'Chi tiết giao dịch', 'Loại tiền', 'Số tiền', 'Loại']);
    expect(other).toMatchObject({ date: 0, description: 1, amount: 3, sign: 4, debit: null });
  });

  it('bỏ dòng tiêu đề công ty, dòng số dư đầu / tổng cộng; ghi nợ = chi, ghi có = thu', () => {
    const p = parseBankStatementGrid([
      ['NGÂN HÀNG TMCP NGOẠI THƯƠNG VIỆT NAM'], ['SAO KÊ TÀI KHOẢN 0011001234567'], ['Từ ngày 01/10/2026 đến ngày 05/10/2026'], [],
      ['STT', 'Ngày giao dịch', 'Số tham chiếu', 'Số tiền ghi nợ', 'Số tiền ghi có', 'Số dư', 'Nội dung chi tiết'],
      ['', 'Số dư đầu kỳ', '', '', '', '100.000.000', ''],
      [1, '02/10/2026', 'FT001', '', '500.000.000', '600.000.000', 'CTY ABC TT HD SMB'],
      [2, '03/10/2026', 'FT002', '120.000.000', '', '480.000.000', 'TT DNC-2610-006 THEP'],
      [3, 'ngày lỗi', 'FT003', '5.000', '', '', 'Phi'],
      ['', 'Tổng cộng', '', '120.005.000', '500.000.000', '', ''],
    ]);
    expect(p.headerRow).toBe(5);
    expect(p.rows).toEqual([
      { row: 7, date: '2026-10-02', direction: 'in', amount: 500000000, description: 'CTY ABC TT HD SMB', reference: 'FT001', counterparty: null, balance: 600000000 },
      { row: 8, date: '2026-10-03', direction: 'out', amount: 120000000, description: 'TT DNC-2610-006 THEP', reference: 'FT002', counterparty: null, balance: 480000000 },
    ]);
    expect(p.skipped).toEqual([{ row: 9, reason: 'Không đọc được ngày' }]);
  });

  it('một cột số tiền + cột loại C/D hoặc số âm', () => {
    const p = parseBankStatementGrid([
      ['Ngày', 'Số tiền', 'Loại', 'Diễn giải'],
      ['01/10/2026', '2.000.000', 'C', 'Lai'], ['01/10/2026', '11.000', 'D', 'Phi SMS'], ['02/10/2026', '-300.000', '', 'Phi chuyen tien'],
    ]);
    expect(p.rows.map(r => `${r.direction}:${r.amount}`)).toEqual(['in:2000000', 'out:11000', 'out:300000']);
  });
});
