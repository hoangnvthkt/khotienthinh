import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Tài chính đợt 3b-2: phân bổ tháng + quỹ công trường / hoàn ứng (chủ SP duyệt 8 câu, 04/10/2026).

const sql = readFileSync('supabase/migrations/20261008134400_finance_allocation_site_fund.sql', 'utf8');
const workspace = readFileSync('pages/project/ProjectFinanceWorkspace.tsx', 'utf8');
const routes = readFileSync('lib/routeAccess.ts', 'utf8');
const settings = readFileSync('components/finance/FinanceSettingsView.tsx', 'utf8');
const fn = (name: string) => {
  const s = sql.indexOf(`function ${name}(`); expect(s, name).toBeGreaterThan(-1);
  const e = Math.min(...['end $$;', '$$;\n', '$function$;'].map(m => { const i = sql.indexOf(m, s); return i < 0 ? Infinity : i + m.length; }));
  return sql.slice(s, e);
};

describe('Phân bổ tháng', () => {
  it('chỉ tháng đã kết thúc, từ mốc 10/2026; gửi chốt khi bảng công đã chốt và bảng lương đã duyệt', () => {
    const c = fn('public.create_finance_allocation_v1');
    expect(c).toContain('v_month < v_cut');
    expect(c).toContain("message = 'FINANCE_ALLOCATION_MONTH_INVALID'");
    const d = fn('public.decide_finance_allocation_v1');
    expect(d).toContain("coalesce(v_ready->'timesheet'->>'status', '') <> 'closed'");
    expect(d).toContain("message = 'FINANCE_ALLOCATION_NOT_READY'");
  });

  it('lương = lương gộp bảng lương đã duyệt × công ở công trường (bản chốt + chấm công); chỉ dự án có HĐ chủ đầu tư', () => {
    const b = fn('app_private.finance_allocation_build');
    expect(b).toContain("p.status in ('confirmed', 'paid')");
    expect(b).toContain('s.version = v_period.version');
    expect(b).toContain('a."constructionSiteId"');
    expect(fn('app_private.finance_allocation_projects')).toContain("c.status <> 'cancelled'");
  });

  it('sửa số công bắt buộc lý do và không bị làm mới ghi đè', () => {
    const s = fn('public.save_finance_allocation_v1');
    expect(s).toContain("message = 'FINANCE_REASON_REQUIRED'");
    expect(fn('app_private.finance_allocation_build')).toContain('case when public.finance_allocation_staff.edited then public.finance_allocation_staff.site_days else excluded.site_days end');
  });

  it('chi phí chung: mặc định bỏ lương / trả nợ gốc / tạm ứng / thuế; chia theo tiền CĐT trả, tháng không có thì để lại công ty', () => {
    const b = fn('app_private.finance_allocation_build');
    expect(b).toContain("not in ('salary', 'loan_repay', 'staff_advance', 'tax')");
    expect(b).toContain('if v_receipts > 0 and v_pool > 0 then');
  });

  it('người chốt khác người lập; chốt ghi chi phí ngày cuối tháng + trừ quỹ dự án; đảo cả kỳ ghi dòng âm', () => {
    const d = fn('public.decide_finance_allocation_v1');
    expect(d).toContain("message = 'FINANCE_SELF_CONFIRM'");
    expect(d).toContain('app_private.finance_post_project_cost(');
    expect(d).toContain("app_private.finance_reverse_project_cost('finance_allocation:' || r.id::text");
    expect(sql).toContain("kind in ('supplier_payment', 'expense', 'site_transfer', 'allocation')");
  });
});

describe('Quỹ công trường', () => {
  it('người giữ quỹ là tài khoản người dùng, ghi khoản chi không cần quyền Tài chính; tệp chứng từ theo thư mục quỹ', () => {
    expect(sql).toContain('add column holder_user_id uuid references public.users(id)');
    expect(fn('public.save_finance_site_expense_v1')).toContain("f.holder_user_id = v_actor or app_private.finance_can('record')");
    expect(sql).toContain('create policy finance_attachments_site_insert on storage.objects');
    expect(routes).toContain("'/site-fund',");
  });

  it('người duyệt khác người lập và khác người giữ quỹ; trả lại / đảo bắt buộc lý do', () => {
    const d = fn('public.decide_finance_site_expenses_v1');
    expect(d).toContain('v_actor = x.created_by or v_actor = f.holder_user_id');
    expect(d).toContain("if v_action in ('reject', 'reverse') and v_reason is null");
  });

  it('duyệt = trừ quỹ công trường + chi phí dự án theo khoản mục, không trừ lại quỹ dự án; đảo ghi ngược cả hai', () => {
    const d = fn('public.decide_finance_site_expenses_v1');
    expect(d).toContain("app_private.finance_cash_entry(f.id, x.spent_date, 'out', x.amount, 'site_expense'");
    expect(d).toContain("app_private.finance_cash_reverse_source('site_expense'");
    expect(d).toContain('app_private.finance_reverse_project_cost(v_ref');
  });
});

describe('Dọn dẹp và phân quyền', () => {
  it('tab Tài chính trong Dự án chỉ xem (trừ chốt sản lượng, tab Thanh toán)', () => {
    expect(workspace).toContain('const canManageFinance = false;');
    expect(workspace).toContain('const canEditActualProduction = canManageFinanceProp;');
    expect(workspace).toContain('Mở Tài chính dự án này');
  });

  it('hủy quyết toán quỹ công trường kiểu cũ còn nháp rỗng; mô tả 4 quyền Tài chính theo việc mới', () => {
    expect(sql).toContain("update public.site_cash_settlement_batches b set status = 'cancelled'");
    expect(sql).toContain("set label = 'Xem Tài chính toàn công ty'");
    expect(settings).toContain('lập phân bổ tháng, duyệt / trả lại khoản chi quỹ công trường');
    expect(settings).toContain('chốt / đảo phân bổ tháng');
  });
});
