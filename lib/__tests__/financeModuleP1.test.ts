import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canAccessNavigationModule, canAccessRoute } from '../routeAccess';

// Xuất bản Module Tài chính P1 (doc 14, chủ SP duyệt 05/10/2026). Kịch bản chạy thật: tools/p1-test.mjs (rollback, 20/20).

const sql = readFileSync('supabase/migrations/20261008134600_finance_module_p1.sql', 'utf8');
const sidebar = readFileSync('components/Sidebar.tsx', 'utf8');
const app = readFileSync('routes/appPages.tsx', 'utf8');

describe('Tài chính — P1 xuất bản module', () => {
  it('xem tài chính dự án = Tài chính — Xem hoặc công tắc xem tài chính của đúng dự án (không thêm quyền mới)', () => {
    expect(sql).toContain("(app_private.finance_can('view') or app_private.sensitive_can_view('finance', p_project, null))");
    expect(sql).toContain("message = 'FINANCE_PROJECT_VIEW_DENIED'");
    // 3 hàm chi tiết mở cho người xem theo dự án; nút ghi vẫn theo quyền toàn công ty.
    for (const f of ['get_finance_project_cost_v1', 'get_finance_customer_contract_v1', 'get_finance_subcontract_v1'])
      expect(sql).toMatch(new RegExp(`FUNCTION public\\.${f}[\\s\\S]*?finance_project_visible`));
    expect(sql).toContain("'can', app_private.finance_can_flags()");
  });

  it('menu Tài chính có đường dẫn riêng từng mục; Tài chính dự án mở cho người đăng nhập (máy chủ lọc)', () => {
    for (const s of ['overview', 'todo', 'receivables', 'payables', 'subcontracts', 'cash', 'cost', 'project', 'settings'])
      expect(sidebar).toContain(`to: '/finance/${s}'`);
    expect(app).toContain('<Route path="finance/:section" element={<FinanceHub />} />');
    const noFinance = { role: 'EMPLOYEE', permissionGrants: [], effectivePermissionSources: [], authorizationSnapshot: null } as never;
    expect(canAccessRoute(noFinance, '/finance/project')).toBe(true);
    expect(canAccessRoute(noFinance, '/finance/payables')).toBe(false);
  });

  it('mọi chỉ số bấm được: khoản mục → Sổ giao dịch đúng khoản mục; đơn mua → mở đơn; sổ 10 dòng/trang, chi −, thu +', () => {
    const view = readFileSync('components/finance/ProjectFinanceView.tsx', 'utf8');
    const cost = readFileSync('components/finance/CostView.tsx', 'utf8');
    expect(cost).toContain("onClick={() => openLedger({ item: l.symbol || '__none__' })}");
    expect(cost).toContain('href={`#/procurement?po=${encodeURIComponent(c.poId)}`}');
    expect(view).toContain('const PAGE = 10;');
    expect(view).toContain("const signedOf = (x: Row) => (x.type === 'revenue_received' ? 1 : -1) * x.amount;");
    for (const s of ['date_desc', 'date_asc', 'amount_desc', 'amount_asc']) expect(view).toContain(`'${s}'`);
    expect(sql).toContain("'poId', c.po_id");
  });

  it('Admin luôn thấy module Tài chính trên menu (máy chủ cho Admin làm mọi việc ở Tài chính)', () => {
    const admin = { role: 'ADMIN', permissionGrants: [], effectivePermissionSources: [], authorizationSnapshot: null } as never;
    expect(canAccessRoute(admin, '/finance/overview')).toBe(true);
    expect(canAccessNavigationModule(admin, 'FINANCE', '/finance')).toBe(true);
    const staff = { role: 'EMPLOYEE', permissionGrants: [], effectivePermissionSources: [], authorizationSnapshot: null } as never;
    expect(canAccessNavigationModule(staff, 'FINANCE', '/finance')).toBe(false);
  });
});
