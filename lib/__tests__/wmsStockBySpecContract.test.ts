import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20261010191100_wms_stock_by_spec.sql');

// V1-3b (doc 13 mục 9, 16; chủ SP duyệt câu 28–32): tồn theo quy cách, giá vốn / NXT / MISA vẫn theo mã + kho.
describe('tồn theo quy cách — máy chủ', () => {
  it('mọi dòng sổ kho ghi phân bổ quy cách qua hàm ghi sổ duy nhất', () => {
    expect(migration).toContain("coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('specAllocations', v_spec_alloc)");
    expect(migration).toContain('v_spec_alloc := app_private.wms_spec_alloc_for_entry(p_inventory_transaction_id');
  });

  it('xuất không ghi quy cách lấy quy cách nhập trước; chuyển kho / đảo giữ quy cách gốc', () => {
    expect(migration).toContain('order by b.first_in nulls last, b.spec_key');
    expect(migration).toContain("e.transaction_type = 'transfer_issue' and e.source_code = p_source_code");
    expect(migration).toContain("app_private.uuid_or_null(p_metadata->>'reversalOfInventoryTransactionId')");
  });

  it('phiếu chuyển quy cách: đúng người, có lý do, không vượt tồn quy cách', () => {
    expect(migration).toContain("message = 'WMS_SPEC_DENIED'");
    expect(migration).toContain("message = 'WMS_SPEC_REASON'");
    expect(migration).toContain("'WMS_SPEC_INSUFFICIENT: Quy cách");
    expect(migration).toContain('pg_advisory_xact_lock');
  });
});

describe('tồn theo quy cách — giao diện', () => {
  it('màn Tồn kho có mục Theo quy cách + phiếu chuyển, thẻ kho hiện phân bổ', () => {
    const view = read('components/wms/WmsStockView.tsx');
    expect(view).toContain('<SpecStockSection card={card.data}');
    expect(view).toContain('<SpecChips allocations={c.specAllocations} fallback={c.specification} />');
    const section = read('components/wms/SpecStockSection.tsx');
    expect(section).toContain('xuất tự lấy từ trên xuống');
    expect(section).toContain('Gắn quy cách cho hàng tồn');
    // index.css ép text-xs trong khung lưới thành một dòng trên mobile — form không dùng text-xs cho nhãn có ô nhập.
    expect(section).not.toMatch(/<label className="text-xs/);
  });
});
