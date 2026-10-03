import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogErrorMessage, catalogNameKey, guessInventoryMode, similarCatalogItems } from '../wmsCatalogService';

const sql = readFileSync(new URL('../../supabase/migrations/20261008137100_wms_v1_catalog_stock.sql', import.meta.url), 'utf8');

describe('V1 Module Vật tư — danh mục một cửa', () => {
  it('chặn xóa vật tư và chỉ cho sửa danh mục qua hàm', () => {
    expect(sql).toContain('ITEM_DELETE_FORBIDDEN');
    expect(sql).toContain('ITEM_CATALOG_VIA_RPC');
    expect(sql).toContain("before update or delete on public.items");
  });
  it('một cửa tạo mã: chỉ người Cấp mã / Admin', () => {
    expect(sql).toContain('alter policy items_phase4_insert on public.items with check (app_private.wms_can_issue_code())');
    expect(sql).toContain('drop policy if exists items_settings_insert on public.items');
    expect(sql).toContain("'wms.master_data.issue_code'");
  });
  it('mã đã có chứng từ: khóa đổi bản chất tên và ĐVT, ngừng dùng khi còn tồn / đơn mở', () => {
    for (const code of ['ITEM_RENAME_CHANGES_NATURE', 'ITEM_UNIT_LOCKED', 'ITEM_RETIRE_HAS_STOCK', 'ITEM_RETIRE_OPEN_PO', 'ITEM_NAME_DUPLICATE']) expect(sql).toContain(code);
  });
  it('mã mới VT + 7 chữ số', () => {
    expect(sql).toContain("'VT' || lpad(v_next::text, 7, '0')");
  });
});

describe('so trùng tên vật tư', () => {
  it('bỏ dấu, khoảng trắng, ký tự nối; x/*/× như nhau; ly = mm', () => {
    expect(catalogNameKey('Thép XD  D8')).toBe(catalogNameKey('thep xd d8'));
    expect(catalogNameKey('Bulong móng M24*650')).toBe(catalogNameKey('Bulong móng M24x650'));
    expect(catalogNameKey('Thép tấm 10 ly')).toBe(catalogNameKey('thép tấm 10 mm'));
  });
  it('gợi ý mã gần giống, khớp khóa chuẩn hóa xếp đầu', () => {
    const items = [{ name: 'Thép XD D8' }, { name: 'Thép XD D10' }, { name: 'Xi măng PCB40' }];
    const hits = similarCatalogItems(items, 'thep xd d8');
    expect(hits[0]).toEqual({ item: items[0], score: 99 });
    expect(hits.some(h => h.item.name === 'Xi măng PCB40')).toBe(false);
  });
  it('gợi ý cách quản lý kho', () => {
    expect(guessInventoryMode('Bê tông thương phẩm M350', 'm3')).toBe('use');
    expect(guessInventoryMode('Chi phí bơm cần (ca)', 'Ca')).toBe('service');
    expect(guessInventoryMode('Thép XD D8', 'Kg')).toBe('stock');
  });
  it('đổi mã lỗi server thành câu tiếng Việt', () => {
    expect(catalogErrorMessage({ message: 'ITEM_NAME_DUPLICATE:VT0000824' })).toContain('VT0000824');
    expect(catalogErrorMessage({ message: 'ITEM_RETIRE_HAS_STOCK' })).toContain('còn tồn');
    expect(catalogErrorMessage({ message: 'CATALOG_ISSUE_DENIED' })).toContain('Cấp mã');
  });
});
