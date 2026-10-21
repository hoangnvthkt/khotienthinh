import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProjectTransactionImportPreviewRows } from '../projectTransactionImport';
import type { ContractCostItem } from '../../types';

// Xuất bản Module Tài chính P3 (doc 14 câu 5, 6, 8, 9). Rollback: tools/p3-test.mjs 50/50.

const sql = readFileSync('supabase/migrations/20261008134800_finance_module_p3.sql', 'utf8');
const dashboard = readFileSync('pages/ProjectDashboard.tsx', 'utf8');
const cost = readFileSync('components/finance/CostView.tsx', 'utf8');
const misa = readFileSync('components/finance/MisaImport.tsx', 'utf8');
const app = readFileSync('routes/appPages.tsx', 'utf8');
const sidebar = readFileSync('components/Sidebar.tsx', 'utf8');

describe('Tài chính — P3', () => {
  it('nhập số MISA ở Tài chính: máy chủ kiểm từng dòng, nhập theo lô, huỷ lô cần Xác nhận + lý do', () => {
    expect(sql).toContain("if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'");
    expect(sql).toContain("v_status := 'after_cutover'");
    expect(sql).toContain("v_status := 'duplicate_in_file'");
    expect(sql).toContain("v_status := 'period_locked'");
    expect(sql).toContain("message = 'FINANCE_MISA_ROWS_INVALID'");
    expect(sql).toContain("'misa:' || v_batch || ':' || v_n");
    expect(sql).toContain("if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'");
    expect(sql).toContain("message = 'FINANCE_REASON_REQUIRED'");
    // Vật tư theo mã luôn là materials → không lách được mốc chi phí.
    expect(sql).toContain("when upper(coalesce(p_symbol, '')) ~ '^(CPNVL|CPVL|NVL|VL$|VATTU|VAT_TU)' then 'materials'");
    expect(cost).toContain("setDrawer({ kind: 'misa' })");
    expect(cost).toContain('<MisaImportHistory');
    expect(misa).toContain('financeService.importMisa(');
    expect(misa).toContain('strictDate: true');
    expect(misa).toContain("intent: 'danger'");
  });

  it('máy chủ chặn ghi tay sổ giao dịch dự án; chỉ chốt đầu kỳ vật tư của đúng bản đầu kỳ được ghi thẳng', () => {
    expect(sql).toContain("message = 'PROJECT_TRANSACTION_FINANCE_ONLY'");
    expect(sql).toContain('before insert or update or delete on public.project_transactions');
    expect(sql).toContain("substring(v_ref from '^opening_balance:(.+):materials$')");
    // Dự án không còn nút thêm / nhập / sửa / xoá giao dịch, không còn form ngân sách cũ.
    for (const t of ['<Plus size={12} /> Giao dịch', 'onChange={handleImportExcel}', '{renderTxForm()}', '{renderBudgetForm()}', '<ProjectTransactionImportPreviewModal\n'])
      expect(dashboard).not.toContain(t);
    expect(dashboard).not.toContain('<SensitiveDataGate access={sensitiveAccess} domain="finance">');
  });

  it('module Chi phí cũ ẩn khỏi menu, link cũ mở Tài chính → Chi phí & ngân sách', () => {
    expect(app).toContain('<Route path="expense" element={<Navigate to="/finance/cost" replace />} />');
    expect(app).not.toContain('BudgetDashboard');
    expect(sidebar).not.toContain("route: '/expense'");
  });

  it('mẫu quyền Tài chính: Kế toán (xem + ghi nhận), Kế toán trưởng (+ xác nhận), Giám đốc tài chính (+ quản trị)', () => {
    expect(sql).toContain("where t.code = 'accountant'");
    expect(sql).toContain("where t.code = 'chief_accountant'");
    expect(sql).toContain("select 'finance_director', 'Giám đốc tài chính'");
    expect(sql).toContain('{"permissionCode":"system.finance.manage","scopeType":"global"}');
  });

  it('nhập MISA: ô ngày trống không bị đổi thành hôm nay', () => {
    const items = [{ id: 'nc', symbol: 'CPNC', name: 'Chi phí nhân công', status: 'active', parentId: null } as unknown as ContractCostItem];
    const base = { projectId: 'p', projectFinanceId: '', constructionSiteId: '', costItems: items, partners: [] };
    const rows = [{ 'Ngày': '', 'Mã khoản mục': 'CPNC', 'Số tiền': 1000, 'Nội dung': 'x' }, { 'Ngày': '05/09/2026', 'Mã khoản mục': 'CPNC', 'Số tiền': 2000, 'Nội dung': 'y' }];
    const strict = parseProjectTransactionImportPreviewRows(rows, { ...base, strictDate: true });
    expect(strict.items.map(i => i.tx.date)).toEqual(['', '2026-09-05']);
    expect(strict.items[1].tx.contractCostItemId).toBe('nc');
    const legacy = parseProjectTransactionImportPreviewRows(rows, base);
    expect(legacy.items[0].tx.date).not.toBe('');
  });
});
