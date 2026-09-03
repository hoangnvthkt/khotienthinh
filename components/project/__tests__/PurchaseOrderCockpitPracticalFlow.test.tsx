import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../PurchaseOrderCockpitDrawer.tsx', import.meta.url),
  'utf8',
);

describe('PurchaseOrderCockpit practical material flow', () => {
  it('presents a single purchase as an ordinary order and multiple purchases as numbered batches', () => {
    expect(source).toContain("po.purchaseMode === 'single' ? 'Đơn mua hàng' : 'Các đợt mua'");
    expect(source).toMatch(/po\.purchaseMode === 'single'\s*\? 'Đơn mua hàng'\s*: `Đợt \$\{String\(batch\.deliveryNo\)\.padStart\(2, '0'\)\}`/);
  });

  it('shows only the four factual quantity totals', () => {
    expect(source).toContain('Nhu cầu Công trường');
    expect(source).toContain('Đã duyệt đặt');
    expect(source).toContain('Đã thực nhập');
    expect(source).toContain('Còn lại / Vượt');
  });

  it('removes rejected implementation language from the practical order view', () => {
    expect(source).not.toContain("title: 'Tạo gói'");
    expect(source).not.toContain("title: 'Duyệt gói'");
    expect(source).not.toContain("mainLabel: ['delivered', 'closed'].includes(po.status) ? 'Đã hoàn tất' : 'Đóng gói PO'");
    expect(source).not.toContain('Giá trị chủ trương gồm VAT');
    expect(source).not.toContain('Tổng tham chiếu gồm VAT');
    expect(source).not.toContain('Mỗi PO có thể chia nhiều đợt giao kèm luồng WMS & mã QR kiểm nhận.');
  });

  it('shows one explicit gross total for multiple delivery batches instead of a duplicate reference amount', () => {
    expect(source).toContain("const isMultipleDeliveryPackage = isPackageV2 && po.purchaseMode === 'multiple';");
    expect(source).toContain("{isMultipleDeliveryPackage ? 'Tổng giá trị các đợt gồm VAT' : 'Tổng thanh toán gồm VAT'}");
    expect(source).toContain('{!isMultipleDeliveryPackage && (');
    expect(source).not.toContain('packageSummary.referenceGross');
  });

  it('keeps the purchase unit on ordered quantities and makes a pending batch actionable from the task panel', () => {
    expect(source).toContain('getPoLinePurchaseUnit');
    expect(source).toContain('{purchaseUnit || item.unit}');
    expect(source).toContain("const effectiveStatusLabel = pendingBatchApproval ? 'Đã gửi duyệt đợt' : statusLabel;");
    expect(source).toContain('const pendingBatchApprovalAction: PurchaseOrderUiAction');
    expect(source).toContain('pendingBatchApprovalAction || uiPolicy.primaryAction');
    expect(source).toContain('canApprovePendingDeliveryBatch');
  });

  it('shows each delivery batch as its VAT-inclusive commercial value', () => {
    expect(source).toContain('totalAmountWithVat: totalAmount + vatAmount');
    expect(source).toContain('Giá trị đợt gồm VAT');
    expect(source).toContain('VAT {fmtQty(group.vatRate)}%: {fmtMoney(group.vatAmount)} đ');
  });
});
