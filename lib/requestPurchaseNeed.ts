import type { RequestTemplateFieldSchema } from '../types';

export const PURCHASE_NEED_KEY = 'purchase_need_v1';
export const PURCHASE_COLUMNS = ['Tên hàng', 'Quy cách', 'Đơn vị', 'Số lượng', 'Loại hàng', 'Kho nhận', 'Ngày cần', 'Người dự kiến nhận', 'Nhóm tài sản'];
export interface PurchaseNeedRow extends Record<string, string> {
  _id: string; _warehouseId: string; _recipientId: string; _categoryId: string;
  'Tên hàng': string; 'Quy cách': string; 'Đơn vị': string; 'Số lượng': string;
  'Loại hàng': 'Vật tư' | 'Tài sản'; 'Kho nhận': string; 'Ngày cần': string;
  'Người dự kiến nhận': string; 'Nhóm tài sản': string;
}
export const purchaseNeedField = (sortOrder: number): RequestTemplateFieldSchema => ({ key: PURCHASE_NEED_KEY, label: 'Nhu cầu mua hàng / tài sản', fieldType: 'table', required: true, options: [...PURCHASE_COLUMNS], sortOrder });
export const emptyPurchaseNeed = (): PurchaseNeedRow => ({ _id: crypto.randomUUID(), _warehouseId: '', _recipientId: '', _categoryId: '', 'Tên hàng': '', 'Quy cách': '', 'Đơn vị': '', 'Số lượng': '', 'Loại hàng': 'Vật tư', 'Kho nhận': '', 'Ngày cần': '', 'Người dự kiến nhận': '', 'Nhóm tài sản': '' });
export function validatePurchaseNeeds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ['Thêm ít nhất một dòng nhu cầu mua hàng.'];
  if (value.length > 100) return ['Một phiếu tối đa 100 dòng nhu cầu.'];
  const errors: string[] = []; const ids = new Set<string>();
  value.forEach((raw, i) => {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const at = `Dòng ${i + 1}`;
    if (!row._id || ids.has(String(row._id))) errors.push(`${at}: mã dòng không hợp lệ. Thêm lại dòng.`);
    ids.add(String(row._id));
    if (!String(row['Tên hàng'] ?? '').trim() || !String(row['Đơn vị'] ?? '').trim()) errors.push(`${at}: nhập tên hàng và đơn vị.`);
    const qty = Number(row['Số lượng']);
    if (!Number.isFinite(qty) || qty <= 0) errors.push(`${at}: số lượng phải lớn hơn 0.`);
    if (!row._warehouseId) errors.push(`${at}: chọn kho nhận.`);
    const day = String(row['Ngày cần'] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) errors.push(`${at}: chọn ngày cần hợp lệ.`);
    if (!['Vật tư', 'Tài sản'].includes(String(row['Loại hàng']))) errors.push(`${at}: chọn loại hàng.`);
    if (row['Loại hàng'] === 'Tài sản') {
      if (!Number.isInteger(qty) || qty > 200) errors.push(`${at}: tài sản cần số lượng nguyên, tối đa 200 chiếc mỗi dòng.`);
      if (!row._categoryId) errors.push(`${at}: chọn nhóm tài sản.`);
    }
  });
  return errors;
}
