import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ORDER_STATUS_LABELS, STOCK_STATE_LABELS } from '../procurementContractService';

// Việc 4 — Mua theo HĐ nguyên tắc nằm hẳn trong Mua hàng (chủ SP duyệt 03/10/2026).

const sql = readFileSync('supabase/migrations/20261008133600_procurement_framework_contract_orders.sql', 'utf8');
const fn = (name: string) => {
  const start = sql.search(new RegExp(`FUNCTION ${name.replace('.', '\\.')}\\(`, 'i'));
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('\n$$;', start));
};

describe('Mua theo HĐ nguyên tắc', () => {
  it('bỏ ràng buộc phải xuất kho mới đối soát / ghi nợ: chỉ cần nhập kho xong', () => {
    for (const name of ['app_private.procurement_contract_delivery_lines', 'app_private.guard_supplier_delivery_statement_line_wms', 'public.post_supplier_delivery_statement']) {
      const body = fn(name);
      expect(body, name).toContain('app_private.supplier_delivery_line_ready(');
      expect(body, name).not.toContain("wms_status, 'not_required') = 'exported'");
      expect(body, name).not.toContain("wms_status, 'not_required') <> 'exported'");
    }
    expect(fn('app_private.supplier_delivery_line_ready')).toContain("t.status = 'COMPLETED'::public.transaction_status");
  });

  it('nhận hàng đơn theo HĐ không ghi nợ / chi phí, tạo phiếu chờ đối soát; trả NCC giảm SL chờ đối soát', () => {
    const receipt = fn('app_private.post_purchase_receipt_finance_v2');
    const bridge = receipt.indexOf('procurement_contract_receipt_note(');
    expect(bridge).toBeGreaterThan(-1);
    expect(bridge).toBeLessThan(receipt.indexOf('insert into public.project_transactions'));
    expect(bridge).toBeLessThan(receipt.indexOf('insert into public.supplier_payable_documents'));
    expect(fn('app_private.procurement_contract_receipt_note')).toContain("'accepted', p_actor");
    const ret = fn('app_private.post_purchase_receipt_return_finance_v2');
    expect(ret.indexOf('procurement_contract_return_adjust(')).toBeLessThan(ret.indexOf('purchaseReceiptReturnCredits'));
  });

  it('gọi hàng: giá theo HĐ, không duyệt trong hạn mức, vượt hạn mức gửi Mua hàng; quyền gọi hàng theo dự án', () => {
    const save = fn('public.save_procurement_contract_order_v1');
    expect(save).toContain('app_private.procurement_contract_price(v_c.id, v_item.id, v_date)');
    expect(save).toContain("message = 'PROCUREMENT_CONTRACT_WAREHOUSE_SCOPE'");
    expect(save).toContain("message = 'PROCUREMENT_CONTRACT_VAT_MIXED'");
    const send = fn('public.transition_procurement_contract_order_v1');
    expect(send).toContain("message = 'PROCUREMENT_CONTRACT_LIMIT_APPROVAL'");
    expect(send).toContain("set status = 'confirmed', approved_total_amount = total_amount");
    expect(send).toContain('create_delivery_batch_with_wms_qr_core_v2(');
    expect(fn('app_private.procurement_contract_can_order')).toContain("'project.material_supplier_delivery.create'");
  });

  it('đối soát: giá khác giá HĐ bắt buộc lý do; công trường không thấy đối soát', () => {
    expect(fn('public.save_procurement_contract_statement_v1')).toContain("message = 'PROCUREMENT_STATEMENT_PRICE_REASON'");
    expect(fn('public.get_procurement_contract_v1')).toContain("'statements', case when not v_buyer then '[]'::jsonb");
    expect(sql).toContain('alter table public.supplier_delivery_statements drop constraint if exists supplier_delivery_statements_check;');
  });

  it('nhãn trạng thái đủ cho mọi trạng thái hiển thị', () => {
    expect(Object.keys(STOCK_STATE_LABELS).sort()).toEqual(['direct', 'none', 'pending', 'stock']);
    for (const s of ['draft', 'sent', 'confirmed', 'partial', 'delivered', 'closed']) expect(ORDER_STATUS_LABELS[s], s).toBeTruthy();
  });
});
