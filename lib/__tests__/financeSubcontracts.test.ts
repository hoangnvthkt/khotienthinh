import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Tài chính F4 — Thầu phụ (chủ SP duyệt 11 câu 05/10/2026). Kịch bản chạy thật: .superpowers tools/sc-test.mjs (rollback trên production).

const sql = readFileSync('supabase/migrations/20261008134500_finance_subcontracts.sql', 'utf8');
const view = readFileSync('components/finance/SubcontractsView.tsx', 'utf8');
const drawers = readFileSync('components/finance/SubcontractDrawers.tsx', 'utf8');
const service = readFileSync('lib/financeService.ts', 'utf8');
const quantity = readFileSync('components/project/QuantityAcceptancePanel.tsx', 'utf8');
const workbench = readFileSync('pages/project/PaymentWorkbenchTab.tsx', 'utf8');
const fn = (name: string) => { const s = sql.indexOf(`function ${name}(`); expect(s, name).toBeGreaterThan(-1); return sql.slice(s, sql.indexOf('end $$;', s) + 7); };

describe('Tài chính — Thầu phụ', () => {
  it('nhập lũy kế, Vioo tự trừ đợt trước; lũy kế phải tăng; vượt HĐ phải có lý do; không bắt buộc BOQ', () => {
    const calc = fn('app_private.finance_sub_round_calc');
    expect(calc).toContain('v_net := v_cum - v_prev;');
    expect(calc).toContain("message = 'FINANCE_SUB_CUMULATIVE_INVALID'");
    expect(calc).toContain("message = 'FINANCE_SUB_OVER_CONTRACT'");
    expect(calc).not.toContain('contract_items');
  });

  it('phải trả = gồm VAT − thu hồi tạm ứng − giữ lại − TNCN − khấu trừ khác; khác gợi ý phải có lý do', () => {
    expect(sql).toContain('payable numeric(18,2) generated always as (gross_amount - advance_recovery - retention - pit_amount - other_deduction) stored');
    expect(fn('app_private.finance_sub_suggest')).toContain("pit := case when (m->>'withholdPit')::boolean then round(p_net * coalesce((m->>'pitPercent')::numeric, 10) / 100, 2) else 0 end;");
    expect(fn('app_private.finance_sub_round_calc')).toContain("message = 'FINANCE_ROUND_ADJUST_REASON'");
  });

  it('chưa chốt đầu kỳ MISA thì không lập đợt; đầu kỳ người lập ≠ người chốt, bắt buộc file, không ghi chi phí', () => {
    expect(fn('app_private.finance_sub_round_calc')).toContain("message = 'FINANCE_SUB_OPENING_REQUIRED'");
    expect(fn('public.save_finance_subcontract_opening_v1')).toContain("message = 'FINANCE_ATTACHMENT_REQUIRED'");
    const decide = fn('public.decide_finance_subcontract_opening_v1');
    expect(decide).toContain("if o.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'");
    expect(decide).not.toContain('finance_post_project_cost');
  });

  it('ghi nhận: người khác người lập; ghi chi phí CPNC gồm VAT, công nợ + giữ lại tách riêng; đảo không xóa', () => {
    const t = fn('public.transition_finance_subcontract_round_v1');
    expect(t).toContain("if r.created_by = v_actor or r.submitted_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'");
    expect(t).toContain("app_private.finance_post_project_cost('fsc-' || r.id::text, r.project_id, app_private.finance_sub_cost_item(), r.gross_amount");
    expect(t).toContain("'subcontract_retention'");
    expect(t).toContain("message = 'FINANCE_DOCUMENT_HAS_PAYMENTS'");
    expect(t).toContain("app_private.finance_reverse_project_cost('finance_subcontract_round:' || r.id::text, v_reason, v_actor)");
    expect(t).not.toMatch(/delete from public\.(finance_subcontract_rounds|supplier_payable_documents)/);
  });

  it('giữ lại chưa đến hạn không lập đề nghị chi; tạm ứng thầu phụ cấn trừ vào chứng từ cùng HĐ', () => {
    expect(sql).toContain("message = 'FINANCE_RETENTION_NOT_DUE'");
    expect(sql).toContain('or (v_doc.subcontract_id is not null and v_doc.subcontract_id = (select q.subcontract_id from public.finance_payment_requests q where q.id = p_request))');
    expect(sql).toContain('num_nonnulls(purchase_order_id, supplier_contract_id, subcontract_id) = 1');
  });

  it('chi phí ghi tay trùng MISA: đảo bằng dòng âm có lý do, không xóa', () => {
    const r = fn('public.review_finance_manual_cost_v1');
    expect(r).toContain("message = 'FINANCE_REASON_REQUIRED'");
    expect(r).toContain('-v_amount');
    expect(r).not.toContain('delete from');
  });

  it('Dự án chỉ xem phần thầu phụ: máy chủ chặn ghi, giao diện ẩn thao tác', () => {
    expect(sql).toContain("message = 'SUBCONTRACT_FINANCE_ONLY'");
    for (const t of ['payment_certificates', 'payment_schedules', 'advance_payments', 'quantity_acceptances', 'acceptance_records'])
      expect(sql).toContain(`before insert or update or delete on public.${t}`);
    expect(quantity).toContain("const financeOnly = contractType === 'subcontractor';");
    expect(workbench).toContain('const financeOnly = true;');
  });

  it('giao diện: không che "chưa biết" bằng 0, có cảnh báo thiếu điều kiện, xác nhận / lý do, thông báo lỗi tiếng Việt', () => {
    expect(view).toContain('chưa biết');
    expect(view).toContain('Chưa lập đợt được:');
    expect(view).toContain('useReasonConfirm');
    expect(view).toContain("confirmText: 'Ghi nhận'");
    expect(drawers).toContain("toast.error(");
    for (const code of ['FINANCE_SUB_OPENING_REQUIRED', 'FINANCE_SUB_OVER_CONTRACT', 'FINANCE_RETENTION_NOT_DUE', 'SUBCONTRACT_FINANCE_ONLY'])
      expect(service).toContain(`${code}: '`);
  });
});
