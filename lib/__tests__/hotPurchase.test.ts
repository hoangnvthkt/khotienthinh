import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: vi.fn() } }));

import { HOT_PURCHASE_PAYMENT_LABELS, hotPurchaseLineAmount, isApPayment } from '../hotPurchaseService';
import { PROJECT_MATERIAL_TAB_PERMISSIONS } from '../projectTabPermissions';

// Việc 3 — M2c Mua nóng / CCDC: ngưỡng gồm VAT, CHT duyệt trước khi mua, dưới ngưỡng mua trước báo sau.

describe('Mua nóng', () => {
  it('thành tiền gồm VAT làm tròn như server (line_amount + vat_amount)', () => {
    expect(hotPurchaseLineAmount({ qty: 25, unitPrice: 35943, vatRate: 10 })).toBe(988432.5);
    expect(hotPurchaseLineAmount({ qty: 300, unitPrice: 35680, vatRate: 10 })).toBe(11774400);
    expect(hotPurchaseLineAmount({ qty: 1, unitPrice: 0, vatRate: 10 })).toBe(0);
  });

  it('chỉ nguồn công ty chuyển khoản / NCC cho nợ mới ghi công nợ NCC', () => {
    expect(isApPayment('company_bank')).toBe(true);
    expect(isApPayment('supplier_credit')).toBe(true);
    expect(isApPayment('site_cash')).toBe(false);
    expect(isApPayment('staff_paid')).toBe(false);
    expect(HOT_PURCHASE_PAYMENT_LABELS.site_cash.settle).toContain('quyết toán');
  });

  it('dự án có tab Mua nóng', () => {
    expect(PROJECT_MATERIAL_TAB_PERMISSIONS.some(tab => tab.key === 'hot_purchase')).toBe(true);
  });

  it('migration giữ đúng luật đã duyệt', () => {
    const sql = readFileSync('supabase/migrations/20261008133400_procurement_hot_purchase_m2c.sql', 'utf8');
    expect(sql).toContain("hot_purchase_threshold numeric(18,2) not null default 5000000");
    expect(sql).toContain("v_needs := v_total >= v_thr or v_total + v_cum >= v_thr");
    expect(sql).toContain("coalesce(p.purchase_date, current_date) - 6");
    expect(sql).toContain("v_over := v_total > coalesce(p.approved_amount, 0) * 1.1");
    expect(sql).toContain("p.name = 'Chỉ huy trưởng'");
    expect(sql).toContain("if v_actor is null or v_actor = p_purchase.created_by then return false; end if;");
    expect(sql).toContain("message = 'HOT_PURCHASE_EVIDENCE_REQUIRED'");
  });
});
