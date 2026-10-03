import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Thu chi & quỹ (Tài chính đợt 3a, chủ SP duyệt 9 câu 03/10/2026).

const sql = readFileSync('supabase/migrations/20261008134200_finance_cash_treasury.sql', 'utf8');
const view = readFileSync('components/finance/CashView.tsx', 'utf8');
const pay = readFileSync('components/finance/PaymentRequestsView.tsx', 'utf8');
const fn = (name: string) => { const s = sql.indexOf(`function ${name}(`); expect(s, name).toBeGreaterThan(-1); return sql.slice(s, sql.indexOf('end $$;', s) + 7); };

describe('Thu chi & quỹ', () => {
  it('sổ thu chi bất biến, không ghi trước mốc, không ghi vào tháng đã chốt đối chiếu', () => {
    const g = fn('app_private.trg_finance_cash_entry_guard');
    expect(g).toContain("message = 'FINANCE_CASH_ENTRY_IMMUTABLE'");
    expect(g).toContain("message = 'FINANCE_CASH_BEFORE_CUTOVER'");
    expect(g).toContain("message = 'FINANCE_CASH_PERIOD_LOCKED'");
    expect(fn('app_private.finance_cash_reverse_source')).toContain("case e.direction when 'in' then 'out' else 'in' end");
  });

  it('xác nhận chi NCC / tạm ứng / chi khác, phiếu thu CĐT, NCC hoàn tạm ứng bắt buộc chọn tài khoản', () => {
    expect(sql).toContain("v_cash := app_private.finance_cash_require_account(nullif(p_input->>'cashAccountId', '')::uuid);\n  perform app_private.finance_cash_entry(v_cash, v_date, 'out', v_req.amount, 'payment_request'");
    expect(sql).toContain("'in', rc.amount, 'customer_receipt'");
    expect(sql).toContain("'in', a.amount, 'advance_refund'");
    expect(sql).toContain("if v_date >= (select ap_cutover_date from public.finance_settings where id = 1) then\n    v_cash := app_private.finance_cash_require_account");
  });

  it('phiếu chi khác = đề nghị chi loại expense (ma trận + 3 người); gắn dự án thì ghi chi phí dự án', () => {
    expect(sql).toContain("check (kind in ('payable', 'advance', 'expense'))");
    expect(fn('public.save_finance_expense_request_v1')).toContain("app_private.finance_payment_route(null, v_amount");
    expect(fn('app_private.finance_confirm_expense')).toContain("'finance_expense:' || v_req.id::text");
  });

  it('đầu kỳ, thu khác, chuyển tiền, đối chiếu: người lập ≠ người xác nhận', () => {
    for (const f of ['public.decide_finance_cash_opening_v1', 'public.decide_finance_cash_movement_v1', 'public.decide_finance_cash_reconciliation_v1'])
      expect(fn(f)).toContain("message = 'FINANCE_SELF_CONFIRM'");
    expect(fn('public.decide_finance_cash_reconciliation_v1')).toContain("message = 'FINANCE_RECON_STALE'");
  });

  it('dự báo 8 tuần có tồn quỹ tối thiểu; giao diện không che số chưa đủ', () => {
    const f = fn('app_private.finance_cash_forecast');
    expect(f).toContain('for i in 0..7 loop');
    expect(f).toContain("if v_below is null and v_sure < v_min then v_below := ws; end if;");
    expect(sql).toContain('add column cash_min_balance numeric(18,2) not null default 2000000000');
    expect(view).toContain('tài khoản chưa chốt đầu kỳ — số chưa đủ');
    expect(pay).toContain('label="Chi từ tài khoản"');
  });
});
