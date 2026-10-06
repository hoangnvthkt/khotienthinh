import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Sao kê ngân hàng + tự khớp (doc 15 mục 2 "Tiền & ngân hàng"). Rollback: tools/bank-test.mjs 31/31.

const sql = readFileSync('supabase/migrations/20261008135000_finance_bank_statement.sql', 'utf8');
const ui = readFileSync('components/finance/BankStatementDrawer.tsx', 'utf8');
const cash = readFileSync('components/finance/CashView.tsx', 'utf8');

describe('Tài chính — sao kê ngân hàng', () => {
  it('nhập: quyền Ghi nhận, chỉ tài khoản ngân hàng, dòng sai báo số dòng, trùng tự bỏ', () => {
    expect(sql).toContain("if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'");
    expect(sql).toContain("message = 'FINANCE_BANK_ACCOUNT_ONLY'");
    expect(sql).toContain("message = 'FINANCE_BANK_ROWS_INVALID'");
    expect(sql).toContain('on conflict (account_id, dedupe_key) do nothing');
  });

  it('tự khớp: cùng tài khoản, chiều, số tiền, lệch ngày ≤ 5; số chứng từ trong nội dung được ưu tiên; ngang nhau thì để người chọn', () => {
    expect(sql).toContain('e.account_id = p_account and e.direction = l.direction and e.amount = l.amount and abs(e.entry_date - l.txn_date) <= 5');
    expect(sql).toContain('rank() over (order by code_hit desc, gap)');
    expect(sql).toContain('if v_cnt = 1 then');
    expect(sql).toContain('create unique index finance_bank_lines_entry_key on public.finance_bank_statement_lines (matched_entry_id)');
  });

  it('khớp tay lệch tiền phải ghi lý do; bỏ qua có lý do; huỷ file cần Xác nhận + lý do', () => {
    expect(sql).toContain("message = 'FINANCE_BANK_AMOUNT_DIFF_REASON'");
    expect(sql).toContain("if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'");
    expect(ui).toContain("title: 'Bỏ qua dòng sao kê'");
    expect(ui).toContain("title: 'Huỷ file sao kê'");
  });

  it('mở từ tài khoản ngân hàng ở Thu chi & quỹ; dòng chưa có trong sổ lập được phiếu thu / chi điền sẵn', () => {
    expect(cash).toContain("a.kind === 'bank' && <p className=\"mt-1 text-xs font-semibold\"><button type=\"button\" onClick={() => setDrawer({ kind: 'bank', accountId: a.id })}");
    expect(ui).toContain('<MovementDrawer data={cash} kind="receipt" prefill={sub.prefill}');
    expect(ui).toContain('<ExpenseDrawer projects={cash.projects} prefill={sub.prefill}');
  });
});
