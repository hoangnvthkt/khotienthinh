import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Báo cáo Tài chính: tuổi nợ phải trả / phải thu, lãi lỗ dự án (doc 15 mục 8). Rollback: tools/reports-test.mjs 11/11.

const sql = readFileSync('supabase/migrations/20261008135200_finance_reports.sql', 'utf8');
const view = readFileSync('components/finance/ReportsView.tsx', 'utf8');
const sidebar = readFileSync('components/Sidebar.tsx', 'utf8');

describe('Tài chính — Báo cáo', () => {
  it('chỉ người có quyền Tài chính — Xem; cùng nguồn số với Phải trả, Phải thu, Chi phí', () => {
    expect(sql).toContain("if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'");
    expect(sql).toContain('from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal');
    expect(sql).toContain("from app_private.finance_receivable_round_rows() x where x.contract_id = c.id and x.status = 'confirmed'");
    expect(sql).toContain("not like 'supplier_payment_batch:%'");
  });

  it('nhóm tuổi nợ: chưa đến hạn, 1–30, 31–60, 61–90, trên 90, chưa có hạn', () => {
    for (const k of ['not_due', 'd30', 'd60', 'd90', 'over90', 'no_due']) expect(sql).toContain(` ${k}`);
    expect(view).toContain("['over90', '> 90 ngày']");
  });

  it('lãi lỗ: doanh thu theo sản lượng (Gantt) và theo nghiệm thu, chi phí, dự kiến khi xong; menu Báo cáo', () => {
    expect(sql).toContain("'outputNet', case when (cs->>'progress') is not null then round(h.net * (cs->>'progress')::numeric / 100, 2) end");
    expect(view).toContain('Lãi dự kiến khi xong');
    expect(sidebar).toContain("{ to: '/finance/reports', icon: BarChart3, label: 'Báo cáo' }");
  });
});
