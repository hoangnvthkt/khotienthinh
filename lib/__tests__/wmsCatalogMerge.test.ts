import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getItemSelectionResults } from '../itemSelectionSearch';
import { suggestKeep, verdictOf, type DuplicateGroup, type DuplicateItem } from '../wmsCatalogMerge';

const sql = readFileSync(new URL('../../supabase/migrations/20261008137400_wms_v1_3a_catalog_merge.sql', import.meta.url), 'utf8');
const usage = { ledger: 0, requests: 0, stockQty: 0, transactions: 0, purchaseOrders: 0, openPurchaseOrders: 0 };
const mk = (sku: string, name: string, unit: string, numbers: string[], extra: Partial<DuplicateItem> = {}): DuplicateItem =>
  ({ id: sku, sku, name, unit, numbers, usage, stock: [], plan: 0, pending: 0, lastUsed: null, ...extra });
const g = (...items: DuplicateItem[]): DuplicateGroup => ({ key: 'k', items });

describe('V1-3a — phân loại nhóm mã có thể trùng (dữ liệu thật 04/10)', () => {
  it('chỉ khác cách viết → Trùng', () => {
    expect(verdictOf(g(mk('VT0001618', 'Bulong móng M24x650', 'Bộ', ['24', '650']), mk('VTM020', 'Bulong móng M24*650', 'Bộ', ['24', '650']))).v).toBe('dup');
    expect(verdictOf(g(mk('VT0000137', 'Bi treo cửa xếp', 'Cái', []), mk('VTPHU099', 'Bi treo cửa xếp', 'cái', []))).v).toBe('dup');
  });
  it('khác số kích thước → không trùng', () => {
    expect(verdictOf(g(mk('VT0000988', 'Cáp CXV 4x25', 'Mét', ['25', '4']), mk('VT0001002', 'Cáp CXV 4x2.5', 'Mét', ['2.5', '4']))).v).toBe('diffnum');
  });
  it('khác ĐVT hoặc khác dấu → cần người xem', () => {
    expect(verdictOf(g(mk('VT0000965', 'Bulong M16x50', 'Bộ', ['16', '50']), mk('VT00014', 'Bulong M16*50', 'Cái', ['16', '50']))).v).toBe('unit');
    expect(verdictOf(g(mk('VT0000873', 'Tụ điện', 'Cái', []), mk('VT0001074', 'Tủ điện', 'Cái', []))).v).toBe('accent');
    expect(verdictOf(g(mk('VT0000155', 'Bulong móng M24x750', 'Bộ', ['24', '750']), mk('VTM008', 'Bu lông móng M24x750', 'Bộ', ['24', '750']))).v).toBe('accent');
  });
  it('gợi ý mã giữ: mã có kế hoạch / đơn mua mở trước', () => {
    const a = mk('VT0000843', 'Đá 1x2', 'm3', ['1', '2'], { usage: { ...usage, ledger: 2 } });
    const b = mk('VT00028', 'Đá 1x2', 'm3', ['1', '2'], { plan: 4, usage: { ...usage, openPurchaseOrders: 1 } });
    expect(suggestKeep(g(a, b)).sku).toBe('VT00028');
  });
});

describe('V1-3a — tìm mã cũ ra mã giữ', () => {
  it('gõ mã đã gộp vẫn ra mã giữ', () => {
    const items = [{ id: 'keep', sku: 'VT0000155', name: 'Bulong móng M24x750', stockByWarehouse: {} }] as any;
    expect(getItemSelectionResults(items, { query: 'VTM008', allowAllItems: true }).items).toHaveLength(0);
    expect(getItemSelectionResults(items, { query: 'VTM008', allowAllItems: true, aliases: { keep: ['VTM008', 'Bu lông móng M24x750'] } }).items).toHaveLength(1);
  });
});

describe('V1-3a — migration', () => {
  it('không sửa lịch sử: chuyển tồn bằng phiếu điều chỉnh giữ nguyên giá trị', () => {
    expect(sql).toContain("'ADJUSTMENT', now(), v_lines");
    expect(sql).toContain('x.v / x.q');
    expect(sql).not.toMatch(/update public\.inventory_ledger_entries/);
    expect(sql).not.toMatch(/update public\.transactions/);
  });
  it('chặn khi còn chứng từ mở, khác số, khác ĐVT chưa xác nhận; chỉ người Cấp mã', () => {
    for (const code of ['MERGE_BLOCKED', 'MERGE_SIZE_DIFF', 'MERGE_UNIT_CONFIRM', 'CATALOG_ISSUE_DENIED']) expect(sql).toContain(code);
    expect(sql).toContain('create function app_private.catalog_merge_blockers');
  });
  it('mã phụ thành "Đã gộp vào", thẻ kho mã giữ kèm lịch sử mã cũ', () => {
    expect(sql).toContain("check (merged_into_id is null or status = 'retired')");
    expect(sql).toContain("'fromSku'");
    expect(sql).toContain('m.merged_into_id = p_item_id');
  });
  it('thủ kho xem được danh mục và đề xuất mã mới', () => {
    expect(sql).toContain('create function app_private.wms_can_view_catalog()');
    expect(sql).toContain('app_private.wms_can_propose_code(requested_by_user_id)');
  });
});
