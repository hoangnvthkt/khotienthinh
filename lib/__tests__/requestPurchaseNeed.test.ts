import { describe, expect, it } from 'vitest';
import { emptyPurchaseNeed, purchaseNeedField, validatePurchaseNeeds, PURCHASE_NEED_KEY } from '../requestPurchaseNeed';
const valid = () => ({ ...emptyPurchaseNeed(), 'Tên hàng': 'Máy tính', 'Đơn vị': 'Cái', 'Số lượng': '2', _warehouseId: 'kho', 'Ngày cần': '2026-10-10' });
describe('purchase need contract', () => {
 it('pins output to a required versioned form field', () => expect(purchaseNeedField(4)).toMatchObject({ key: PURCHASE_NEED_KEY, fieldType: 'table', required: true, sortOrder: 4 }));
 it('requires real destination and date, without treating unknown as zero', () => { expect(validatePurchaseNeeds([valid()])).toEqual([]); expect(validatePurchaseNeeds([emptyPurchaseNeed()]).length).toBeGreaterThan(2); });
 it('rejects duplicate rows, infinity and impossible dates', () => { const a = valid(); expect(validatePurchaseNeeds([a, a]).join(' ')).toContain('mã dòng'); expect(validatePurchaseNeeds([{ ...a, 'Số lượng': 'Infinity', 'Ngày cần': '2026-02-30' }])).toHaveLength(2); });
 it('assets are whole units with a category; recipient can be planned later', () => { const a = { ...valid(), 'Loại hàng': 'Tài sản', _categoryId: 'it' }; expect(validatePurchaseNeeds([a])).toEqual([]); expect(validatePurchaseNeeds([{ ...a, 'Số lượng': '1.5' }])[0]).toContain('nguyên'); });
});
