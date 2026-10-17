// Lập đơn chủ động từ báo giá (chủ SP 16/10/2026): AI đọc ảnh / chữ báo giá NCC (skill po_quote_lines) → dòng như file Excel nhập đơn,
// rồi đi qua cùng màn xem trước (khớp mã, quy đổi đơn vị mua ↔ kho). Tệp này chỉ chuyển dữ liệu + kiểm số, không gọi mạng.
import type { PoImportRow } from './procurementExcelImport';

export interface QuoteLine { sku: string | null; name: string; spec: string | null; unit: string | null; qty: number | null; unitPrice: number | null; amount: number | null; note: string | null }
export interface QuoteRead {
  vendorName: string | null; vendorTaxCode: string | null; docNo: string | null; docDate: string | null; vatRate: number | null;
  lines: QuoteLine[]; subtotal: number | null; vatAmount: number | null; total: number | null; warnings: string[];
}
/** Thông tin đầu báo giá đi kèm khi đưa dòng vào đơn. */
export interface QuoteMeta { vendorName: string | null; vendorTaxCode: string | null; vatRate: number | null; runId?: string }

/** Dòng AI đọc → dòng nhập đơn. Thiếu đơn giá mà có thành tiền + SL thì suy ra đơn giá. */
export const quoteRows = (read: QuoteRead): PoImportRow[] => read.lines.map((l, i) => ({
  index: i + 1, sku: l.sku || '', name: l.name, spec: l.spec || '', unit: l.unit || '',
  qty: l.qty, price: l.unitPrice ?? (l.amount != null && l.qty ? Math.round((l.amount / l.qty) * 100) / 100 : null),
  note: l.note,
}));

const vi = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(n));

/** Kiểm số trên báo giá (AI chỉ chép, không tính): SL × đơn giá từng dòng so với thành tiền (cho lệch do SL hiển thị làm tròn),
 *  cộng thành tiền các dòng so với "Cộng", VAT = cộng × %. Lệch ≤ 1.000 đ (làm tròn) chỉ ghi chú. */
export const quoteChecks = (read: QuoteRead): Array<{ level: 'ok' | 'warn'; text: string }> => {
  const out: Array<{ level: 'ok' | 'warn'; text: string }> = [];
  read.lines.forEach((l, i) => {
    if (l.qty == null || l.unitPrice == null || l.amount == null) return;
    const calc = l.qty * l.unitPrice;
    if (Math.abs(calc - l.amount) > Math.max(1000, l.unitPrice * 0.5)) {
      out.push({ level: 'warn', text: `Dòng ${i + 1} ${l.name}: SL × đơn giá = ${vi(calc)} đ, thành tiền ghi ${vi(l.amount)} đ — kiểm SL / đơn giá` });
    }
  });
  const amounts = read.lines.map(l => l.amount).filter((a): a is number => a != null);
  if (amounts.length === read.lines.length && amounts.length && read.subtotal != null) {
    const sum = amounts.reduce((a, b) => a + b, 0); const d = Math.abs(sum - read.subtotal);
    out.push(d <= 1000 ? { level: 'ok', text: `Cộng tiền hàng ${vi(read.subtotal)} đ${d ? ` (cộng dòng lệch ${vi(d)} đ do làm tròn)` : ' khớp cộng dòng'}` }
      : { level: 'warn', text: `Cộng dòng ${vi(sum)} đ khác "Cộng" trên báo giá ${vi(read.subtotal)} đ (lệch ${vi(d)} đ)` });
  }
  if (read.vatRate != null && read.subtotal != null && read.vatAmount != null) {
    const want = read.subtotal * read.vatRate / 100; const d = Math.abs(want - read.vatAmount);
    out.push(d <= 1000 ? { level: 'ok', text: `VAT ${read.vatRate}% = ${vi(read.vatAmount)} đ` }
      : { level: 'warn', text: `VAT ghi ${vi(read.vatAmount)} đ, tính ${read.vatRate}% ra ${vi(want)} đ` });
  }
  return out;
};
