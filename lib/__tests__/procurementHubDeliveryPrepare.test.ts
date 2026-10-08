import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20261008137700_procurement_hub_delivery_prepare.sql', import.meta.url), 'utf8');
const supplyChain = readFileSync(new URL('../../pages/project/SupplyChainTab.tsx', import.meta.url), 'utf8');

describe('Đơn chủ động lập được đợt giao bù ở Mua hàng (sự cố PO-143)', () => {
  it('hàm chuẩn bị đợt giao nhận đơn do màn Mua hàng quản lý', () => {
    expect(sql).toContain('and not app_private.procurement_po_is_hub(v_po.metadata)');
  });
  it('màn Cung ứng không còn lặng lẽ đổi trạng thái "Đang giao" khi đơn không có phiếu đề xuất', () => {
    expect(supplyChain).not.toMatch(/if \(links\.length === 0\) \{\s*void updatePoStatus\(po\.id, 'in_transit'\);/);
    expect(supplyChain).toContain('Lập đợt giao ở Mua hàng');
  });
});
