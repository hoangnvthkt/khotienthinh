import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TransactionStatus, TransactionType, type Transaction } from '../../types';
import { buildWmsVoucherHtml, ledgerCodes } from '../wmsVoucherPrint';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20261011150000_wms_print_continue_delivery.sql');

const tx = (patch: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1', type: TransactionType.IMPORT, date: '2026-10-11T05:00:00Z', status: TransactionStatus.COMPLETED, requesterId: 'u1',
  targetWarehouseId: 'wh-1', note: 'PO-449-01 dang giao',
  items: [{ itemId: 'it-1', quantity: 40, orderedQty: 100, price: 17500, itemNameSnapshot: 'Sơn chống thấm', varianceReason: 'NCC giao tiếp phần còn lại' }],
  ...patch,
});
const ctx = { items: [{ id: 'it-1', name: 'Sơn', sku: 'VT01', unit: 'Thùng' }], users: [{ id: 'u1', name: 'Luật' }], warehouses: [{ id: 'wh-1', name: 'Kho SMB' }], supplyName: 'NCC A' };

describe('in phiếu kho', () => {
  it('in số phiếu sổ kho, SL theo đợt giao, thiếu và lý do', () => {
    const html = buildWmsVoucherHtml(tx(), ctx, [{ itemId: 'it-1', direction: 'in', qty: 40, allocations: null, code: 'NK20261011-00675' }]);
    expect(html).toContain('Số: NK20261011-00675');
    expect(html).toContain('Theo đợt giao');
    expect(html).toContain('thiếu 60');
    expect(html).toContain('Lý do lệch: NCC giao tiếp phần còn lại');
    expect(html).toContain('Người giao hàng');
  });
  it('phiếu chưa ghi sổ in "Chưa ghi sổ"; chuyển kho in đủ XK + NK', () => {
    expect(buildWmsVoucherHtml(tx({ status: TransactionStatus.PENDING }), ctx, [])).toContain('Số: Chưa ghi sổ');
    expect(ledgerCodes([{ itemId: 'a', direction: 'out', qty: 1, allocations: null, code: 'XK1' }, { itemId: 'a', direction: 'in', qty: 1, allocations: null, code: 'NK1' },
      { itemId: 'b', direction: 'out', qty: 1, allocations: null, code: 'XK1' }])).toEqual(['XK1', 'NK1']);
  });
  it('không chèn HTML từ dữ liệu', () => {
    expect(buildWmsVoucherHtml(tx({ note: '<script>x</script>' }), ctx, [])).not.toContain('<script>x</script>');
  });
});

describe('NCC giao một đơn nhiều lần', () => {
  it('máy chủ: chỉ đợt nhận thiếu, không vượt phần chưa giao, bấm lại không sinh trùng', () => {
    expect(migration).toContain("if v_batch.status <> 'received_short' then");
    expect(migration).toContain('app_private.procurement_po_line_undelivered(v_po.id, v_po.items, v_line.purchase_order_line_id)');
    expect(migration).toContain("e.action = 'delivery_continue' and e.payload->>'fromDeliveryId' = v_batch.id::text");
    expect(migration).toContain("app_private.wms_has_action('wms.transaction.approve', v_wh, v_wh)");
  });
  it('giao diện: nhận thiếu phải chọn NCC giao tiếp / chốt thiếu; phiếu cũ có nút NCC giao tiếp', () => {
    const modal = read('components/TransactionDetailModal.tsx');
    expect(modal).toContain("continue: 'NCC giao tiếp phần còn lại'");
    expect(modal).toContain('purchaseReceiptService.continueDelivery(deliveryBatchId)');
    expect(read('components/wms/KhoView.tsx')).toContain('purchaseReceiptService.continueDelivery(tx.sourceId!)');
  });
});
