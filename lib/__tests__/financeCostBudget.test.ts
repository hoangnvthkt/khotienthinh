import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Chi phí & ngân sách + Quỹ dự án (Tài chính đợt 3b-1, chủ SP duyệt 8 câu + 4 câu quỹ dự án 03/10/2026).

const sql = readFileSync('supabase/migrations/20261008134300_finance_cost_budget.sql', 'utf8');
const view = readFileSync('components/finance/CostView.tsx', 'utf8');
const drawers = readFileSync('components/finance/CostDrawers.tsx', 'utf8');
const orders = readFileSync('components/procurement/hub/OrdersView.tsx', 'utf8');
const fn = (name: string) => {
  const s = sql.indexOf(`function ${name}(`); expect(s, name).toBeGreaterThan(-1);
  const e = Math.min(...['end $$;', '$$;\n', '$function$;'].map(m => { const i = sql.indexOf(m, s); return i < 0 ? Infinity : i + m.length; }));
  return sql.slice(s, e);
};

describe('Chi phí & ngân sách', () => {
  it('ngân sách theo cây khoản mục: vật tư lấy số sống từ dự toán, không nhập tay; bỏ VAT / thu nhập chịu thuế', () => {
    expect(fn('app_private.finance_budget_items')).toContain("upper(c.symbol) not in ('VAT', 'TNCT')");
    const lines = fn('app_private.finance_project_cost_lines');
    expect(lines).toContain("case when c.symbol = 'CPNVL' then (select v from mat)");
    expect(lines).toContain("coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'");
    expect(fn('public.save_finance_project_budget_v1')).toContain("i.symbol <> 'CPNVL'");
  });

  it('người lập ≠ người duyệt (Quản trị Tài chính); điều chỉnh là phiên bản mới, bản cũ superseded', () => {
    const d = fn('public.decide_finance_project_budget_v1');
    expect(d).toContain("message = 'FINANCE_BUDGET_SELF_DECIDE'");
    expect(d).toContain("app_private.finance_can('manage')");
    expect(d).toContain("set status = 'superseded'");
    expect(sql).toContain('finance_project_budgets_one_pending');
    expect(fn('public.save_finance_project_budget_v1')).toContain("message = 'FINANCE_BUDGET_PENDING'");
  });

  it('chưa có ngân sách thì không coi là 0: không xét vượt, giao diện ghi "chưa lập"', () => {
    expect(fn('app_private.finance_budget_check')).toContain('l.budget is not null and');
    expect(view).toContain('chưa lập ngân sách');
    expect(drawers).toContain('Để trống = chưa lập (không tính là 0)');
  });

  it('dự báo khi hoàn thành = chi phí ÷ tiến độ Gantt, chỉ khi tiến độ ≥ 20%', () => {
    expect(fn('app_private.finance_project_cost_summary')).toContain("case when v_progress >= 20 then round((r->>'actual')::numeric * 100 / v_progress) end");
    expect(view).toContain('tiến độ < 20% — chưa dự báo');
  });

  it('vượt ngân sách: phiếu chi khác thêm bước, đơn Mua hàng chờ duyệt ở Tài chính trước khi duyệt đơn', () => {
    expect(fn('app_private.finance_route_extras')).toContain("'Duyệt vượt ngân sách', v_set.budget_extra_approver_ids");
    expect(sql).toContain("if v_project is not null then\n    v_route := app_private.finance_route_extras(v_route, jsonb_build_array(jsonb_build_object('projectId', v_project, 'amount', v_amount, 'costCategory'");
    expect(sql).toContain("if coalesce((v_budget->>'over')::boolean, false) and v_budget->>'status' <> 'approved' then");
    const po = fn('public.decide_finance_po_budget_v1');
    expect(po).toContain("message = 'FINANCE_BUDGET_APPROVER_DENIED'");
    expect(po).toContain("'Không duyệt vượt ngân sách vật tư: ' || v_reason");
  });

  it('đơn mua quá hẹn giao > 30 ngày: nhắc ở Tài chính và Mua hàng', () => {
    expect(fn('app_private.finance_po_commitments')).toContain("(now() at time zone 'Asia/Ho_Chi_Minh')::date - 30");
    expect(orders).toContain('đơn quá hẹn giao hơn 30 ngày');
  });
});

describe('Quỹ dự án', () => {
  it('đầu kỳ 30/09 theo MISA: bắt buộc chứng từ, người lập ≠ người chốt; chưa chốt thì số dư null', () => {
    expect(fn('public.save_finance_project_fund_opening_v1')).toContain("message = 'FINANCE_ATTACHMENT_REQUIRED'");
    expect(fn('public.decide_finance_project_fund_opening_v1')).toContain("message = 'FINANCE_SELF_CONFIRM'");
    expect(fn('app_private.finance_project_fund')).toContain("'balance', (select balance from o) + coalesce((select sum(amount) from r), 0)");
    expect(view).toContain("v == null ? 'Chưa biết'");
  });

  it('dòng tiền lấy từ sổ thu chi; quỹ công trường của dự án coi như đã chi, không tính lại', () => {
    const rows = fn('app_private.finance_project_fund_rows');
    expect(rows).toContain("where x.account_id not in (select id from site)");
    expect(rows).toContain("'site_transfer'");
    expect(rows).toContain('x.project_id = p_project');
  });

  it('khoản chi làm quỹ âm → bước "Cấp vốn dự án"; chi xong tự ghi vốn cấp, đảo phiếu chi thì đảo theo', () => {
    expect(fn('app_private.finance_route_extras')).toContain("v_set.capital_provider_ids, p_creator, 'fund'");
    expect(sql).toContain("perform app_private.finance_fund_auto_capital(v_req.id, v_date, v_actor);");
    expect(fn('app_private.finance_fund_auto_capital')).toContain('least(-v_bal, p.share)');
    expect(sql).toContain("where source_type = 'payment_request' and source_id = v_req.id::text and status = 'posted';");
  });

  it('cấp / thu hồi vốn tay: chỉ người cấp vốn, bắt buộc lý do, thu hồi không vượt số đang ứng', () => {
    const c = fn('public.save_finance_project_capital_v1');
    expect(c).toContain("message = 'FINANCE_CAPITAL_DENIED'");
    expect(c).toContain("message = 'FINANCE_CAPITAL_RETURN_EXCEEDS'");
    expect(fn('public.reverse_finance_project_capital_v1')).toContain("message = 'FINANCE_CAPITAL_AUTO'");
  });

  it('bảng mới chỉ đọc qua RLS, ghi qua hàm', () => {
    expect(sql).toContain("execute format('revoke insert, update, delete on public.%I from authenticated', t);");
    expect(sql).toContain("revoke all on sequence public.finance_capital_seq from public, anon, authenticated;");
  });
});
