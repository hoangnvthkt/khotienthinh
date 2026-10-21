import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261016233000_capture_order_kinds_hot_purchase.sql', 'utf8');
const panel = readFileSync('components/wms/KhoCapture.tsx', 'utf8');

// Kho PR-3 (chủ SP 16/10): gợi ý đơn phân biệt PO / HĐ nguyên tắc / Mua nóng.
describe('loại đơn của phiếu giao chụp', () => {
  it('PO và gọi hàng theo HĐ nguyên tắc có nhãn + số HĐ', () => {
    expect(sql).toContain("'kind', case when v_po.supplier_contract_id is not null then 'contract' else 'po' end");
    expect(sql).toContain('select sc.code from public.supplier_contracts sc where sc.id = v_po.supplier_contract_id');
  });

  it('Mua nóng đã mua, về đúng kho, có dòng vật tư / CCDC mới vào gợi ý', () => {
    expect(sql).toContain("hp.hub_flow and hp.status = 'purchased' and hp.target_warehouse_id = v_c.warehouse_id");
    expect(sql).toContain("l.line_type in ('stock_item', 'small_tool')");
    expect(sql).toContain("'approved', v_hp.overrun_status is distinct from 'pending'");
  });

  it('nhận Mua nóng qua phiếu chụp: dùng luật Mua nóng, ảnh thành chứng từ', () => {
    expect(sql).toContain("v_res := public.receive_hot_purchase_v1(jsonb_build_object('id', v_hp.id));");
    expect(sql).toContain("update public.transactions set attachments = coalesce(attachments, '[]'::jsonb) || v_att where id = v_tx;");
    expect(sql).toContain('hot_purchase_id = v_hp.id');
  });

  it('màn Kho: nhãn loại đơn, Mua nóng nhận cả phiếu', () => {
    expect(panel).toContain("{s.kind === 'hot' ? 'Mua nóng' : s.kind === 'contract'");
    expect(panel).toContain('svc.receiveHot(c.id, sug.purchaseOrderId)');
    expect(panel).toContain("{sug && !isHot && <div className=\"mt-1.5\">");
  });
});
