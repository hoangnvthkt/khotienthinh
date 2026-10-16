import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../supabase/functions/ai-gateway/skills';
import { mergeImportedLines, pickCatalogMatch, toImportedLine } from '../procurementExcelImport';
import type { ProcurementCatalogItem } from '../procurementInboxService';
import { quoteChecks, quoteRows, type QuoteRead } from '../procurementQuoteRead';

const item = (over: Partial<ProcurementCatalogItem>): ProcurementCatalogItem => ({
  id: 'x', name: 'x', sku: null, unit: 'Kg', purchaseUnit: null, purchaseFactor: null, inBoq: false, boqQty: 0, orderedQty: 0, ...over,
});
// Danh mục thật 17/10/2026: Thép XD quản kho theo Cây, mua theo Kg (hệ số = cây / kg); tròn trơn theo Kg.
const XD10 = item({ id: 'xd10', sku: 'VT0000825', name: 'Thép XD D10', unit: 'Cây', purchaseUnit: 'Kg', purchaseFactor: 0.138888888889 });
const XD16 = item({ id: 'xd16', sku: 'VT0000828', name: 'Thép XD D16', unit: 'Cây', purchaseUnit: 'Kg', purchaseFactor: 0.054094990804 });
const TRON16 = item({ id: 'tron16', sku: 'VT0000109', name: 'Thép tròn trơn D16', unit: 'Kg' });
const XD8 = item({ id: 'xd8', sku: 'VT0000824', name: 'Thép XD D8', unit: 'Kg' });
const VAN8 = item({ id: 'van8', name: 'Thép vằn D8', unit: 'Kg' });
const TRON8 = item({ id: 'tron8', name: 'Thép tròn trơn D8', unit: 'Kg' });

// Kết quả AI thật đọc báo giá HANAKA (claude-sonnet-5-5, 16/10/2026), rút gọn 3 dòng + tổng thật.
const HANAKA: QuoteRead = {
  vendorName: null, vendorTaxCode: null, docNo: null, docDate: null, vatRate: 10,
  lines: [
    { sku: null, name: 'Thép D10 CB500', spec: 'Shengli CB500', unit: 'kg', qty: 21490.1, unitPrice: 14930, amount: 320846447, note: '3115 cây' },
    { sku: null, name: 'Thép D8 CB240', spec: 'Shengli CB240', unit: 'kg', qty: 6300, unitPrice: 14640, amount: 92232000, note: null },
    { sku: null, name: 'Thép D16 CB500', spec: 'Shengli CB500', unit: 'kg', qty: 10192, unitPrice: null, amount: 150332000, note: '560 cây' },
  ],
  subtotal: 563410447, vatAmount: 56341045, total: 619751492, warnings: [],
};

describe('skill po_quote_lines (đọc báo giá NCC)', () => {
  const skill = SKILLS.po_quote_lines;
  const img = { mime: 'image/jpeg', b64: 'A'.repeat(400) };
  it('nhận chữ dán hoặc 1–4 ảnh; có ảnh thì cổng gửi sang kết nối đọc ảnh', () => {
    expect(skill.parseInput({ text: 'Thép D10 CB500 21.490 kg x 14.930' })).toEqual({ text: 'Thép D10 CB500 21.490 kg x 14.930', pages: '0' });
    expect(skill.images!({ text: 'Thép D10 CB500 21.490 kg x 14.930' })).toEqual([]);
    expect(skill.parseInput({ images: [img, img] })).toEqual({ text: '', pages: '2' });
    expect(skill.images!({ images: [img] })).toEqual([img]);
    expect(() => skill.parseInput({ text: 'thép' })).toThrow('AI_BAD_INPUT');
    expect(() => skill.parseInput({ images: [img, img, img, img, img] })).toThrow('AI_BAD_INPUT');
  });
  it('chuẩn hóa số kiểu Việt / Anh, bỏ dòng không tên, VAT > 100 và ngày sai thành null, MST chỉ giữ số', () => {
    const out = skill.parseOutput([{
      vendorName: 'Công ty TNHH Thép HANAKA', vendorTaxCode: 'MST: 0101234567', docNo: 'BG-15', docDate: '15/10/2026', vatRate: 1000,
      lines: [
        { sku: null, name: 'Thép D10', spec: 'CB500', unit: 'kg', qty: '21.490,1', unitPrice: '14.930', amount: '320,846,447', note: '3115 cây' },
        { name: ' ', qty: 1 }, { name: 'Đai', qty: '-5', unitPrice: '7,5' },
      ],
      subtotal: '985.957.679', vatAmount: null, total: null, warnings: ['Dòng D10 lệch 746 đ'],
    }]);
    expect(out).toEqual({
      vendorName: 'Công ty TNHH Thép HANAKA', vendorTaxCode: '0101234567', docNo: 'BG-15', docDate: null, vatRate: null,
      lines: [
        { sku: null, name: 'Thép D10', spec: 'CB500', unit: 'kg', qty: 21490.1, unitPrice: 14930, amount: 320846447, note: '3115 cây' },
        { sku: null, name: 'Đai', spec: null, unit: null, qty: null, unitPrice: 7.5, amount: null, note: null },
      ],
      subtotal: 985957679, vatAmount: null, total: null, warnings: ['Dòng D10 lệch 746 đ'],
    });
  });
});

describe('báo giá → dòng đơn', () => {
  it('thiếu đơn giá thì suy từ thành tiền / SL; giữ ghi chú số cây', () => {
    const rows = quoteRows(HANAKA);
    expect(rows[0]).toEqual({ index: 1, sku: '', name: 'Thép D10 CB500', spec: 'Shengli CB500', unit: 'kg', qty: 21490.1, price: 14930, note: '3115 cây' });
    expect(rows[2].price).toBe(14750);
  });

  it('kiểm cộng dòng với "Cộng" và VAT; lệch vài đồng do làm tròn vẫn là khớp', () => {
    expect(quoteChecks(HANAKA)).toEqual([
      { level: 'ok', text: 'Cộng tiền hàng 563.410.447 đ khớp cộng dòng' },
      { level: 'ok', text: 'VAT 10% = 56.341.045 đ' },
    ]);
    expect(quoteChecks({ ...HANAKA, subtotal: 563410448 })[0].text).toContain('lệch 1 đ do làm tròn');
    expect(quoteChecks({ ...HANAKA, subtotal: 600000000, vatAmount: 56341045 })).toEqual([
      { level: 'warn', text: 'Cộng dòng 563.410.447 đ khác "Cộng" trên báo giá 600.000.000 đ (lệch 36.589.553 đ)' },
      { level: 'warn', text: 'VAT ghi 56.341.045 đ, tính 10% ra 60.000.000 đ' },
    ]);
    expect(quoteChecks({ ...HANAKA, lines: [{ ...HANAKA.lines[0], amount: null }], vatRate: null })).toEqual([]);
  });

  it('mác thép quyết định loại: CB500 là thép vằn (XD), CB240 là tròn trơn', () => {
    expect(pickCatalogMatch({ sku: '', name: 'Thép D16', spec: 'Shengli CB500' }, [TRON16, XD16]).options[0].id).toBe('xd16');
    expect(pickCatalogMatch({ sku: '', name: 'Thép D8', spec: 'CB240' }, [VAN8, TRON8]).options[0].id).toBe('tron8');
    // Danh mục chỉ có "Thép XD D8" (cuộn, Kg) → vẫn chọn được.
    expect(pickCatalogMatch({ sku: '', name: 'Thép D8', spec: 'CB240' }, [XD8, XD16]).options[0].id).toBe('xd8');
  });

  it('bán theo kg, ghi kèm số cây: kho nhận theo số cây NCC ghi, tiền theo kg; lệch hệ số > 2% thì báo', () => {
    const [d10, , d16] = quoteRows(HANAKA);
    const a = toImportedLine(d10, XD10);
    expect(a).toMatchObject({ altUnit: true, purchaseQty: 21490.1, stockQty: 3115, price: 14930 });
    expect(a.warnings).toEqual(['Báo giá ghi 3.115 Cây; hệ số danh mục ra 2.984,7 Cây (lệch 4,2%) — đơn lấy 3.115 Cây theo báo giá, kiểm barem / cân thực tế.']);
    const b = toImportedLine(d16, XD16);
    expect(b).toMatchObject({ purchaseQty: 10192, stockQty: 560, warnings: [] });
    // Không ghi số cây → quy đổi theo hệ số như nhập Excel.
    expect(toImportedLine({ ...d10, note: null }, XD10)).toMatchObject({ stockQty: 2984.736, warnings: [] });
    const [merged] = mergeImportedLines([a, toImportedLine({ ...d10, index: 4 }, XD10)]);
    expect(merged).toMatchObject({ stockQty: 6230, purchaseQty: 42980.2 });
  });
});
