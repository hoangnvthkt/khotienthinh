import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calcStatement, invoiceTolerance } from '../statementInvoiceAmounts';

// Bảng đối soát DCHD-202610-E9A518 (Hợp Thành, 10/2026): NCC xuất HĐ theo giá gồm VAT nên đơn giá chưa VAT lẻ.
// Rollback trên Cloud: .superpowers/stmt/test.mjs (21/21).
const LINES = [
  { qty: 460, price: 1583333.33, vatRate: 8 }, { qty: 265, price: 83333.33, vatRate: 8 }, { qty: 190, price: 78703.7, vatRate: 8 },
  { qty: 12, price: 1574074.07, vatRate: 8 }, { qty: 9.5, price: 1537037.04, vatRate: 8 }, { qty: 1.5, price: 5370370.37, vatRate: 8 },
];

describe('tiền theo hóa đơn ở bảng đối soát', () => {
  it('không sửa: đúng số máy chủ đang tính (806.916.664 + 64.553.333)', () => {
    const c = calcStatement(LINES);
    expect([c.gross, c.vat, c.total, c.delta, c.overLimit]).toEqual([806916664, 64553333, 871469997, 0, false]);
  });

  it('sửa thành tiền một dòng + tổng VAT theo hóa đơn, trong dung sai', () => {
    const lines = LINES.map((l, i) => i === 0 ? { ...l, amount: 728333333 } : l);
    const c = calcStatement(lines, 64553334);
    expect([c.gross, c.vat, c.total, c.delta, c.overLimit]).toEqual([806916665, 64553334, 871469999, 2, false]);
  });

  it('vượt dung sai: dòng lệch > 1.000 đ, cả bảng > 0,5% (tối thiểu 50.000 đ), hoặc sửa VAT khi không dòng nào có VAT', () => {
    expect(invoiceTolerance(728333332)).toBe(3641666.66);
    expect(invoiceTolerance(8055556)).toBe(50000);
    expect(calcStatement(LINES.map((l, i) => i === 0 ? { ...l, amount: 728333332 + 1000 } : l)).overLimit).toBe(false);
    expect(calcStatement(LINES.map((l, i) => i === 0 ? { ...l, amount: 728333332 + 1001 } : l)).overLimit).toBe(true);
    expect(calcStatement(LINES.map((l, i) => i === 5 ? { ...l, amount: 8100000 } : l)).overLimit).toBe(true);
    expect(calcStatement([{ qty: 1, price: 100, vatRate: 0 }], 1).overLimit).toBe(true);
  });

  it('máy chủ: chỉ kế toán sửa, kiểm dung sai từng dòng và cả bảng, lưu dấu vết', () => {
    const sql = readFileSync('supabase/migrations/20261012210000_statement_invoice_amounts.sql', 'utf8');
    expect(sql).toContain("and not app_private.finance_can('record') then");
    expect(sql).toContain("message = 'PROCUREMENT_STATEMENT_INVOICE_DENIED'");
    expect(sql).toContain('abs(t.inv_amount - sl.accepted_amount) > app_private.finance_invoice_tolerance(sl.accepted_amount)');
    expect(sql).toContain('abs((v_g + v_v) - (v_cg + v_cv)) > app_private.finance_invoice_tolerance(v_cg + v_cv)');
    expect(sql).toContain("'statement_invoice_adjust'");
    // 12/10: siết mỗi dòng xuống 1.000 đ.
    const tight = readFileSync('supabase/migrations/20261012230000_statement_line_rounding_1000.sql', 'utf8');
    expect(tight).toContain('abs(t.inv_amount - sl.accepted_amount) > 1000) then');
    expect(tight).not.toContain('finance_invoice_tolerance(sl.accepted_amount)');
    expect(sql).toContain("jsonb_build_object('invoiceAdjust'");
  });
});
