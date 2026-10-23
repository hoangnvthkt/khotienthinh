import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editor = readFileSync('components/procurement/hub/ContractOrderEditor.tsx', 'utf8');
const hub = readFileSync('components/procurement/hub/ProcurementHubView.tsx', 'utf8');

describe('Gọi hàng theo HĐ: gửi NCC sau khi lùi ngày đặt hàng (23/10, PO-700/702)', () => {
  it('lấy lại phiên bản đơn sau khi đổi ngày đặt hàng rồi mới gửi', () => {
    const dateAt = editor.indexOf('procurementInboxService.setOrderDate(');
    const refreshAt = editor.indexOf('(await procurementInboxService.getOrder(r.purchaseOrderId)).rowVersion');
    expect(dateAt).toBeGreaterThan(0);
    expect(refreshAt).toBeGreaterThan(dateAt);
    expect(editor).toContain('const next = { id: r.purchaseOrderId, rowVersion };');
  });
});

describe('Nút "Mở đơn" khi đang ở sẵn trang Mua hàng', () => {
  it('mở đơn khi ?po đổi và bỏ ?po khi đóng', () => {
    expect(hub).toMatch(/useEffect\(\(\) => \{\s*if \(!initialOrderId\) return;\s*setMode\('orders'\);\s*setOrderId\(initialOrderId\);\s*\}, \[initialOrderId\]\);/);
    expect(hub).toContain("params.delete('po');");
    expect(hub).toContain('onClose={closeOrder}');
  });
});
