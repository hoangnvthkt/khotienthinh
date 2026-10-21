import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Phải trả → NCC: đơn hàng bấm được + danh sách đơn của NCC (chủ SP 12/10/2026). Rollback: .superpowers/ap-po/test.mjs (8/8).

const sql = readFileSync('supabase/migrations/20261012200000_finance_supplier_orders.sql', 'utf8');
const panel = readFileSync('components/finance/SupplierPanel.tsx', 'utf8');

describe('Tài chính — đơn hàng theo NCC', () => {
  it('chỉ người Xem Tài chính, chỉ đơn đã gửi, có giới hạn', () => {
    expect(sql).toContain("if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'");
    expect(sql).toContain("po.status not in ('draft', 'returned', 'cancelled')");
    expect(sql).toContain('limit 500');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_finance_supplier_orders_v1(text) FROM PUBLIC, anon;');
  });

  it('số PO ở chứng từ và danh sách đơn mở chi tiết đơn ngay trong Tài chính', () => {
    expect(panel).toContain('<PoLink poId={p.poId} poNumber={p.poNumber} onOpen={onOpenPo} />');
    expect(panel).toContain('<OrderDrawer orderId={openPo}');
    expect(panel).toContain("financeService.supplierOrders(supplierId)");
  });
});
