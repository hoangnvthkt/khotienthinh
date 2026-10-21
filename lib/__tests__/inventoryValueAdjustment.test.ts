import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapUnpricedLine, previewAdjustment, valueAdjustmentErrorText } from '../inventoryValueAdjustment';

const line = (overrides: Record<string, unknown> = {}) => mapUnpricedLine({
  ledgerEntryId: 'e1', date: '2026-07-11T15:36:52Z', documentCode: 'NK20260711-00190', quantity: 163, unit: 'Cái',
  route: 'adjust', suggestedPrice: null, remainingQty: 115, ...overrides,
});

describe('phiếu điều chỉnh giá trị (bổ sung đơn giá dòng nhập giá 0)', () => {
  it('chia giá trị: phần còn tồn vào tồn kho, phần đã xuất vào giá trị xuất', () => {
    const preview = previewAdjustment([line(), line({ ledgerEntryId: 'e0', remainingQty: 0 })], { e1: 50000, e0: 50000 });
    // Mũ bảo hộ: nhận 2 × 163, còn 115 → tồn 5,75 tr; đã xuất 211 → 10,55 tr.
    expect(preview).toEqual({ lines: 2, valueIn: 16300000, valueStock: 5750000, valueOut: 10550000 });
  });

  it('bỏ qua dòng chưa nhập giá và dòng thuộc Tài chính', () => {
    const preview = previewAdjustment([line(), line({ ledgerEntryId: 'f1', route: 'finance' })], { f1: 20000 });
    expect(preview.lines).toBe(0);
    expect(preview.valueIn).toBe(0);
  });

  it('phần còn tồn không vượt SL nhập, không âm', () => {
    expect(line({ remainingQty: 999 }).remainingQty).toBe(163);
    expect(line({ remainingQty: -5 }).remainingQty).toBe(0);
  });

  it('báo lỗi bằng tiếng Việt theo mã máy chủ', () => {
    expect(valueAdjustmentErrorText({ message: 'INVENTORY_VALUE_FINANCE_ROUTE' })).toContain('Tài chính');
    expect(valueAdjustmentErrorText({ message: 'INVENTORY_VALUE_DENIED' })).toContain('Kế toán kho');
  });

  it('migration: nhập trước – xuất trước, chặn phiếu nhập NCC chưa ghi công nợ, NXT cộng phiếu điều chỉnh', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261024180000_inventory_value_adjustment.sql'), 'utf8');
    expect(sql).toContain('inventory_receipt_remaining_qty');
    expect(sql).toContain("message = 'INVENTORY_VALUE_FINANCE_ROUTE'");
    expect(sql).toContain("wms_has_action('wms.accounting.manage'");
    expect(sql).toContain('from public.inventory_value_adjustment_lines l');
    // Lỗi PO-261: đợt giao giá 0 lấy giá dòng Đơn mua.
    expect(sql).toContain('app_private.procurement_po_line_unit_price(v_po.items, v_line.purchase_order_line_id)');
  });
});
