import { describe, expect, it } from 'vitest';
import { changedFields } from '../wmsCatalogService';

describe('nhật ký sửa mã vật tư', () => {
  it('liệt kê từng trường đổi, trước → sau', () => {
    expect(changedFields(
      { name: 'Thép U200', unit: 'Kg', category: 'Sắt thép', purchaseUnit: null, purchaseConversionFactor: 1, minStock: 0, inventoryMode: 'stock' },
      { name: 'Thép U200x75x6', unit: 'Kg', category: 'Sắt thép', purchaseUnit: 'Cây', purchaseConversionFactor: 140, minStock: 5, inventoryMode: 'use' },
    )).toEqual([
      { label: 'Tên', from: 'Thép U200', to: 'Thép U200x75x6' },
      { label: 'ĐV mua', from: '—', to: 'Cây' },
      { label: 'Hệ số quy đổi', from: '1', to: '140' },
      { label: 'Tồn tối thiểu', from: '0', to: '5' },
      { label: 'Cách quản lý kho', from: 'Lưu kho', to: 'Dùng ngay' },
    ]);
  });
  it('không đổi gì thì rỗng', () => {
    expect(changedFields({ name: 'A', minStock: 0 }, { name: 'A', minStock: 0 })).toEqual([]);
  });
});
