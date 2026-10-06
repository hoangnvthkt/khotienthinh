import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dự báo dòng tiền 1 / 3 / 6 tháng (doc 15 mục 4, chủ SP duyệt 8 câu). Rollback: tools/forecast-test.mjs 43/43.

const sql = readFileSync('supabase/migrations/20261008134900_finance_forecast.sql', 'utf8');
const view = readFileSync('components/finance/ForecastView.tsx', 'utf8');
const hub = readFileSync('components/finance/FinanceHubView.tsx', 'utf8');
const project = readFileSync('components/finance/ProjectFinanceView.tsx', 'utf8');
const sidebar = readFileSync('components/Sidebar.tsx', 'utf8');

describe('Tài chính — Dự báo dòng tiền', () => {
  it('xem: Quản trị Tài chính / Admin toàn công ty; người xem theo dự án chỉ dự án của mình (câu 7)', () => {
    expect(sql).toContain("v_company boolean := app_private.finance_can('manage')");
    expect(sql).toContain("if not (v_company or app_private.finance_project_visible(v_project)) then raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'");
    expect(sql).toContain("elsif not v_company then raise exception using errcode = '42501', message = 'FINANCE_FORECAST_DENIED'");
  });

  it('nguồn tiền: phải thu, đã gửi, đã làm chưa đề nghị, Gantt, công nợ, đơn mua, vật tư, thầu phụ, nhân công ước, lương, định kỳ, vay, khoản dự kiến', () => {
    for (const key of ['in_receivable', 'in_sent', 'in_unbilled', 'in_progress', 'out_payable', 'out_request', 'out_po_stale', 'out_material', 'out_subcontract', 'out_labor',
      'out_payroll', 'out_recurring', 'out_loan_interest', 'out_loan_principal', 'out_item']) {
      expect(sql).toContain(`'${key}'`);
      expect(view).toContain(`${key}: {`);
    }
  });

  it('kịch bản và giả định do Quản trị sửa, có lý do (câu 6)', () => {
    expect(sql).toContain("v_delay := case v_sc when 'safe' then s.forecast_safe_delay_days when 'good' then -s.forecast_good_early_days else 0 end");
    expect(sql).toContain("if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'");
    expect(view).toContain("aria-label=\"Kịch bản\"");
  });

  it('thiếu dữ liệu thì nói rõ thiếu gì, không che bằng 0', () => {
    for (const code of ['cash_accounts', 'cash_openings', 'recurring', 'loans', 'tax', 'payroll', 'receivable_opening', 'material_budget', 'no_subcontract', 'subcontract_opening', 'stale_po'])
      expect(sql).toContain(`'code', '${code}'`);
    expect(view).toContain("unknownCash ? 'Chưa biết'");
  });

  it('có ở menu Tài chính và tab Dự báo của Tài chính dự án', () => {
    expect(sidebar).toContain("{ to: '/finance/forecast', icon: CalendarRange, label: 'Dự báo dòng tiền' }");
    expect(hub).toContain("section === 'forecast' ? <ForecastView />");
    expect(project).toContain("tab === 'forecast' ? <ForecastView key={data.project.id} projectId={data.project.id} />");
  });
});
