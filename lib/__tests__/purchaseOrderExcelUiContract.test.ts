import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');

describe('PO Excel commercial-line UI wiring', () => {
  it('uses source-mode-aware create keys and all supported PO price aliases', () => {
    expect(source).toContain("const unitPriceAliases = ['Đơn giá theo ĐVT mua', 'Đơn giá', 'Giá'];");
    expect(source.match(/getPoExcelCreateImportKey\(pSourceMode,/g)).toHaveLength(2);
  });

  it('applies PO duplicate guidance to create previews', () => {
    expect(source).toContain('replacePoExcelCreateDuplicateErrors(');
    expect(source).toContain('Vui lòng gộp số lượng');
  });

  it('applies update records by stable PO line identity', () => {
    expect(source).toContain('const recordsByLineId = new Map(records.map(record => [record.lineId || record.itemId, record]));');
    expect(source).toContain('recordsByLineId.get(item.lineId || item.itemId)');
    expect(source).not.toContain('records.find(record => record.sku');
  });

  it('keeps create columns stable and documents line-aware update templates', () => {
    expect(source).toContain("const headers = [['Mã SKU *', 'Tên vật tư', 'ĐVT mua', 'Khối lượng đặt *', 'Đơn giá theo ĐVT mua', 'Ngày cần', 'Ghi chú']];");
    expect(source).toContain("['Mã dòng PO', 'Mã SKU *', 'Khối lượng đặt', 'Đơn giá', 'Ngày cần', 'Ghi chú']");
    expect(source).toContain('Khi một SKU có nhiều dòng giá, Mã dòng PO là bắt buộc để cập nhật đúng dòng.');
  });
});
