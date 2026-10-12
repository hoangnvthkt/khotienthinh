import { describe, expect, it } from 'vitest';
import type { ProcurementVendorPrefill, ProcurementVendorPrefillLine } from '../procurementInboxService';
import { vendorItemHint, vendorItems } from '../procurementPrefill';

const line = (over: Partial<ProcurementVendorPrefillLine>): ProcurementVendorPrefillLine => ({
  itemId: 'i1', itemName: 'Bê tông M300', sku: 'BT300', orders: 1, specification: '', unit: 'm³', stockUnit: 'm³', factor: 1, unitPrice: 1_250_000,
  poNumber: 'PO-627', orderDate: '2026-10-08', ...over,
});
const prefill = (lines: ProcurementVendorPrefillLine[]): ProcurementVendorPrefill => ({ order: null, lines });

describe('vendorItems — vật tư đã mua của NCC', () => {
  it('mỗi mã một dòng (nhiều quy cách gộp), hay mua trước, cùng số đơn thì gần đây trước', () => {
    const items = vendorItems(prefill([
      line({ itemId: 'i1', specification: 'M300 R28', orders: 3, orderDate: '2026-10-08' }),
      line({ itemId: 'i1', specification: 'M300 R7', orders: 3, orderDate: '2026-09-20', poNumber: 'PO-600' }),
      line({ itemId: 'i2', itemName: 'Thép D16', sku: 'TD16', orders: 5, orderDate: '2026-09-01', poNumber: 'PO-580' }),
      line({ itemId: 'i3', itemName: 'Cát vàng', sku: null, orders: 3, orderDate: '2026-10-10', poNumber: 'PO-630' }),
    ]));
    expect(items.map(i => i.itemId)).toEqual(['i2', 'i3', 'i1']);
    expect(items[2]).toMatchObject({ name: 'Bê tông M300', sku: 'BT300', orders: 3, poNumber: 'PO-627', orderDate: '2026-10-08' });
  });

  it('bỏ dòng máy chủ cũ chưa có tên; giới hạn số dòng; không có gợi ý thì rỗng', () => {
    expect(vendorItems(prefill([line({ itemName: null, orders: undefined })]))).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => line({ itemId: `i${i}`, itemName: `Vật tư ${i}`, orders: 12 - i }));
    expect(vendorItems(prefill(many)).length).toBe(8);
    expect(vendorItems(prefill(many), 3).map(i => i.itemId)).toEqual(['i0', 'i1', 'i2']);
    expect(vendorItems(null)).toEqual([]);
  });

  it('dòng phụ: số đơn và lần gần nhất, hoặc số PO khi mới mua một lần', () => {
    const [item] = vendorItems(prefill([line({ orders: 3 })]));
    expect(vendorItemHint(item)).toBe('3 đơn · gần nhất 8/10');
    expect(vendorItemHint({ ...item, orders: 1 })).toBe('PO-627 (8/10)');
  });
});
