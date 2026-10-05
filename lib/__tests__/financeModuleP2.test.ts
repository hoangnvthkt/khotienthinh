import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Xuất bản Module Tài chính P2 (doc 14, chủ SP chọn "P2 tách hẳn" 05/10/2026). Rollback: tools/p2-test.mjs 6/6.

const dashboard = readFileSync('pages/ProjectDashboard.tsx', 'utf8');
const exec = readFileSync('components/project/FastConsDashboard.tsx', 'utf8');
const sql = readFileSync('supabase/migrations/20261008134700_finance_module_p2.sql', 'utf8');

describe('Tài chính — P2 tách hẳn khỏi Dự án', () => {
  it('Dự án không còn tab Tài chính; link cũ mở Tài chính → Tài chính dự án', () => {
    expect(dashboard).toContain("!isProjectFinanceLegacyTabKey(tab.key) && tab.key !== 'finance' &&");
    expect(dashboard).not.toContain('<ProjectFinanceWorkspace');
    expect(dashboard).not.toContain('<CashFlowTab');
    expect(dashboard).not.toContain('<PaymentWorkbenchTab');
    expect(dashboard).toContain('<FinanceMovedRedirect');
  });

  it('chốt sản lượng ở Chốt tiến độ, bằng chứng nguồn lực ở Nhật ký, Báo cáo không còn cổng tài chính', () => {
    expect(dashboard).toContain('<ActualProductionCard');
    expect(dashboard).toContain('<ResourceEvidenceSection');
    expect(dashboard).toContain('<ReportTab constructionSiteId={effectiveSiteId!} projectId={selectedProject.id} />');
  });

  it('Điều hành: số tài chính lấy từ module Tài chính (thẻ tóm tắt), bỏ các khối tài chính cũ', () => {
    expect(dashboard).toContain('<ProjectFinanceSummaryCard projectId={selectedProject.id} />');
    for (const t of ['title="Đã thu"', 'title="Đã chi"', 'title="Sắp thu 30 ngày"', 'title="Sắp chi 30 ngày"', '<ReconciliationTable owner', '<PaymentRiskPanel metrics'])
      expect(exec).not.toContain(t);
    // Người không được xem tài chính dự án: máy chủ trả null, thẻ tự ẩn.
    expect(sql).toContain('if not found or not app_private.finance_project_visible(v_p.id) then return null; end if;');
  });
});
