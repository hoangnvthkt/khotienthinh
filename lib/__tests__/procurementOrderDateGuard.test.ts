import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 24/10/2026 — PO-703/704/705: đơn chủ động đã lưu (200), bước đặt Ngày đặt hàng 14/10 bị 403 vì người lập
// thiếu quyền "Nhập dữ liệu quá khứ". Màn báo câu chung chung nên người lập bấm lưu lại 3 lần → 3 đơn nháp trùng.
const EDITORS = ['OrderEditor', 'ProactiveOrderEditor', 'ContractOrderEditor'] as const;
const src = (name: string) => readFileSync(`components/procurement/hub/${name}.tsx`, 'utf8');
const service = readFileSync('lib/procurementInboxService.ts', 'utf8');

describe('Ngày đặt hàng: chặn ở màn, không để máy chủ từ chối sau khi đã lưu', () => {
  it.each(EDITORS)('%s dùng ô ngày chung và chặn trước khi gọi máy chủ', name => {
    const editor = src(name);
    expect(editor).toContain('<OrderDateField');
    expect(editor).toContain('businessDateIssue(orderDate, canBackdate)');
    expect(editor).toMatch(/if \(dateIssue\?\.blocked\)/);
  });
  it('ô ngày khóa lịch 7 ngày gần đây khi thiếu quyền', () => {
    const parts = src('OrderFormParts');
    expect(parts).toContain("canPerform(user, 'system.procurement.backdate')");
    expect(parts).toContain('min={canBackdate ? undefined : earliestBusinessDate()}');
  });
  it('câu lỗi ngày nghiệp vụ của máy chủ được hiện nguyên văn', () => {
    expect(service).toContain('/^(BUSINESS_DATE_[A-Z_]+): (.+)$/s');
  });
});

describe('Bấm Lưu lại sửa đơn vừa lưu, không tạo đơn nháp mới', () => {
  it.each(EDITORS)('%s nhớ đơn đã lưu rồi gửi lại id và phiên bản của nó', name => {
    const editor = src(name);
    expect(editor).toMatch(/purchaseOrderId: saved\?\.id/);
    expect(editor).toMatch(/expectedRowVersion: saved\?\.rowVersion/);
    // Đổi ngày đặt hàng tăng phiên bản đơn: phải lấy lại phiên bản mới cho lần lưu / gửi sau.
    const dateAt = editor.indexOf('procurementInboxService.setOrderDate(');
    expect(editor.indexOf('procurementInboxService.getOrder(')).toBeGreaterThan(dateAt);
  });
});
