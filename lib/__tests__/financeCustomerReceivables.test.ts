import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Phải thu chủ đầu tư (Tài chính đợt 2, chủ SP duyệt 8 câu 03/10/2026).

const sql = readFileSync('supabase/migrations/20261008134100_finance_customer_receivables.sql', 'utf8');
const panel = readFileSync('components/finance/CustomerContractPanel.tsx', 'utf8');
const schedule = readFileSync('components/project/ContractPaymentSchedulePanel.tsx', 'utf8');
const cert = readFileSync('components/project/PaymentCertificatePanel.tsx', 'utf8');
const fn = (name: string) => { const s = sql.indexOf(`function ${name}(`); expect(s, name).toBeGreaterThan(-1); return sql.slice(s, sql.indexOf('end $$;', s) + 7); };

describe('Phải thu chủ đầu tư', () => {
  it('phải thu = giá trị đợt gồm VAT − thu hồi tạm ứng − giữ lại; gợi ý theo HĐ, khác gợi ý phải có lý do', () => {
    expect(sql).toContain('receivable numeric(18,2) generated always as (gross_amount - advance_recovery - retention) stored');
    const suggest = fn('app_private.finance_round_suggest');
    expect(suggest).toContain("coalesce((m->>'retentionPercent')::numeric, 5)");
    expect(fn('app_private.finance_customer_contract_metrics')).toContain('coalesce(c.advance_recovery_percent, case when v_gross > 0');
    expect(fn('public.save_finance_receivable_round_v1')).toContain("message = 'FINANCE_ROUND_ADJUST_REASON'");
  });

  it('chỉ thành phải thu khi CĐT xác nhận; hạn = ngày xác nhận + số ngày HĐ (mặc định 30); duyệt thấp hơn phải ghi lý do', () => {
    const t = fn('public.transition_finance_receivable_round_v1');
    expect(t).toContain('due_date = v_date + coalesce(c.payment_term_days, 30)');
    expect(t).toContain("if abs(v_gross - r.gross_amount) > 0.5 and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'");
    expect(fn('app_private.finance_receivable_round_rows')).toContain("case when r.status = 'confirmed' then greatest(r.receivable - r.legacy_received");
  });

  it('phiếu thu: kế toán ghi, người khác xác nhận mới ghi dòng tiền vào; đảo không xóa; thu thừa = trả trước', () => {
    const d = fn('public.decide_finance_customer_receipt_v1');
    expect(d).toContain("if v_actor = rc.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'");
    expect(d).toContain("'revenue_received', 'other', rc.amount");
    expect(d).toContain("-rc.amount, 'Đảo phiếu thu '");
    expect(fn('public.apply_finance_customer_prepayment_v1')).toContain("'prepayment'");
  });

  it('đầu kỳ MISA người lập ≠ người chốt; bảo lãnh hiệu lực cần số tiền + hạn', () => {
    expect(fn('public.decide_finance_customer_opening_v1')).toContain("if v_actor = o.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'");
    expect(fn('public.save_finance_guarantee_v1')).toContain("(v_status = 'active' and (v_amount <= 0 or v_expiry is null))");
  });

  it('Dự án chỉ xem phần CĐT: máy chủ chặn ghi ngoài hàm Tài chính, giao diện ẩn thao tác', () => {
    expect(sql).toContain("raise exception using errcode = '42501', message = 'CUSTOMER_RECEIVABLE_FINANCE_ONLY'");
    expect(sql).toContain('create trigger trg_guard_customer_receivable_schedule before insert or update or delete on public.payment_schedules');
    expect(schedule).toContain("const financeOnly = contractType === 'customer';");
    expect(cert).toContain("const financeOnly = contractType === 'customer';");
    expect(panel).toContain('Chưa đối chiếu đầu kỳ với MISA');
  });
});
