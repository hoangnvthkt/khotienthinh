// Mẫu in "Đề nghị duyệt đơn hàng" của Mua hàng — nội dung theo mẫu in PO ở tab Đơn hàng PO (dự án),
// trình bày lại gọn hơn: dòng vật tư chỉ có tên (kèm quy cách nếu có), không có dòng ghi chú riêng từng vật tư.

export interface ApprovalPrintLine {
  sku: string | null; name: string; specification?: string | null; unit: string | null; qty: number; unitPrice: number;
  stockUnit?: string | null; stockQty?: number | null;
}
export interface ApprovalPrintInput {
  poNumber: string | null; orderDate: string | null; subject: string;
  vendorName: string | null; projectLabel: string | null; warehouseName: string | null; expectedDeliveryDate: string | null;
  requesterName: string; requesterPosition: string; vatRate: number; note: string | null; lines: ApprovalPrintLine[];
  signers: Array<{ role: string; name: string }>;
  place?: string; companyName?: string;
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const num = (n: number, digits = 0) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(digits === 0 ? Math.round(n) : n);
const viDate = (d: string | null) => d ? d.slice(0, 10).split('-').reverse().join('/') : '';

/** Tên hiển thị dòng vật tư: tên chính thức + quy cách/cấu hình (chỉ để hiển thị, kho vẫn theo mã gốc). */
export const lineDisplayName = (name: string, specification?: string | null) => {
  const spec = String(specification || '').trim();
  return spec ? `${name} - ${spec}` : name;
};

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const readTriple = (n: number, full: boolean): string => {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out: string[] = [];
  if (full || h > 0) out.push(`${DIGITS[h]} trăm`);
  if (t > 1) out.push(`${DIGITS[t]} mươi`);
  else if (t === 1) out.push('mười');
  else if ((full || h > 0) && u > 0) out.push('lẻ');
  if (u > 0) out.push(t > 1 && u === 1 ? 'mốt' : t >= 1 && u === 5 ? 'lăm' : t > 1 && u === 4 ? 'tư' : DIGITS[u]);
  return out.join(' ');
};
/** Đọc số tiền bằng chữ tiếng Việt, VD 1.250.000 → "Một triệu hai trăm năm mươi nghìn đồng". */
export const vietnameseMoneyWords = (amount: number): string => {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return 'Không đồng';
  const units = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ', ' triệu tỷ'];
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    parts.push(readTriple(groups[i], i < groups.length - 1) + units[i]);
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} đồng`;
};

export const buildPoApprovalPrintHtml = (p: ApprovalPrintInput): string => {
  const date = p.orderDate ? new Date(p.orderDate) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const dateLine = `${p.place || 'Hưng Yên'}, ngày ${safe.getDate()} tháng ${safe.getMonth() + 1} năm ${safe.getFullYear()}`;
  const hasConversion = p.lines.some(l => l.stockUnit && l.unit && l.stockUnit !== l.unit && l.stockQty != null);
  const net = p.lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0);
  const vat = Math.round(net * (p.vatRate || 0) / 100);
  const total = net + vat;
  const cols = hasConversion ? 9 : 7;
  const rows = p.lines.map((l, i) => `<tr>
      <td class="c">${i + 1}</td><td class="mono">${esc(l.sku || '')}</td>
      <td class="name">${esc(lineDisplayName(l.name, l.specification))}</td>
      <td class="c">${esc(l.unit || '')}</td><td class="r">${num(l.qty, 3)}</td>
      ${hasConversion ? `<td class="c">${esc(l.stockUnit && l.stockUnit !== l.unit ? l.stockUnit : '—')}</td><td class="r">${l.stockUnit && l.stockUnit !== l.unit && l.stockQty != null ? num(l.stockQty, 3) : '—'}</td>` : ''}
      <td class="r">${num(l.unitPrice)}</td><td class="r b">${num(l.qty * l.unitPrice)}</td></tr>`).join('');
  const info: Array<[string, string | null]> = [
    ['Kính gửi', `Ban giám đốc ${p.companyName || 'Cty CP PTĐT & Xây lắp Tiến Thịnh'}`],
    ['Người đề nghị', p.requesterName], ['Chức vụ', p.requesterPosition], ['Số PO', p.poNumber],
    ['Nhà cung cấp', p.vendorName], ['Dự án / kho nhận', [p.projectLabel, p.warehouseName].filter(Boolean).join(' · ') || null],
    ['Ngày cần hàng', viDate(p.expectedDeliveryDate) || null],
  ];
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8" /><title>Đề nghị duyệt đơn hàng ${esc(p.poNumber || '')}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Times New Roman", Times, serif; color: #111; font-size: 13.5px; line-height: 1.35; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; font-size: 12px; }
  .company { font-weight: 700; text-transform: uppercase; }
  .date { font-style: italic; }
  h1 { margin: 14px 0 2px; text-align: center; font-size: 20px; letter-spacing: .03em; }
  .subject { margin: 4px 0 12px; text-align: center; font-weight: 700; text-transform: uppercase; font-size: 14px; }
  .info { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .info td { padding: 2px 4px; vertical-align: top; }
  .info td.k { width: 130px; font-style: italic; white-space: nowrap; }
  .info td.v { font-weight: 700; border-bottom: 1px dotted #555; }
  .intro { margin: 10px 0 6px; font-style: italic; }
  table.lines { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; }
  table.lines th, table.lines td { border: 1px solid #9ca3af; padding: 5px 6px; vertical-align: middle; }
  table.lines th { background: #eef2f0; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  table.lines tfoot td { background: #f7f7f5; font-weight: 700; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; } .b { font-weight: 700; } .mono { font-family: Menlo, Consolas, monospace; font-size: 10.5px; }
  td.name { font-weight: 600; }
  .words { margin-top: 6px; font-style: italic; }
  .note { margin-top: 8px; padding: 6px 8px; border: 1px solid #d1d5db; font-size: 12.5px; }
  .signs { margin-top: 22px; display: grid; grid-template-columns: repeat(${Math.max(p.signers.length, 1)}, 1fr); gap: 8px; text-align: center; }
  .signs strong { display: block; }
  .signs em { display: block; font-size: 11px; color: #555; margin-bottom: 70px; }
  .signs span { font-weight: 700; }
  @media screen { body { max-width: 210mm; margin: 0 auto; padding: 12mm; background: #fff; } }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } tr { page-break-inside: avoid; } }
</style></head><body>
  <div class="top"><div class="company">${esc(p.companyName || 'Cty CP PTĐT & Xây lắp Tiến Thịnh')}</div><div class="date">${esc(dateLine)}</div></div>
  <h1>ĐỀ NGHỊ DUYỆT ĐƠN HÀNG</h1>
  <div class="subject">${esc(p.subject)}</div>
  <table class="info"><tbody>${info.filter(([, v]) => v).map(([k, v]) => `<tr><td class="k">${esc(k)}:</td><td class="v">${esc(v)}</td></tr>`).join('')}</tbody></table>
  <div class="intro">Đề nghị Ban giám đốc duyệt đơn hàng sau:</div>
  <table class="lines">
    <thead><tr><th style="width:34px">STT</th><th style="width:82px">Mã</th><th>Tên hàng hóa</th><th style="width:48px">ĐVT</th><th style="width:70px">Khối lượng</th>
      ${hasConversion ? '<th style="width:52px">ĐVT kho</th><th style="width:66px">KL kho</th>' : ''}<th style="width:92px">Đơn giá</th><th style="width:110px">Thành tiền</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="${cols - 1}" class="r">Cộng tiền hàng</td><td class="r">${num(net)}</td></tr>
      <tr><td colspan="${cols - 1}" class="r">Thuế VAT (${num(p.vatRate || 0, 2)}%)</td><td class="r">${num(vat)}</td></tr>
      <tr><td colspan="${cols - 1}" class="r">TỔNG TIỀN THANH TOÁN</td><td class="r">${num(total)}</td></tr>
    </tfoot>
  </table>
  <div class="words">Bằng chữ: ${esc(vietnameseMoneyWords(total))}.</div>
  ${p.note ? `<div class="note"><b>Ghi chú:</b> ${esc(p.note)}</div>` : ''}
  <div class="signs">${p.signers.map(s => `<div><strong>${esc(s.role)}</strong><em>(Ký, ghi rõ họ tên)</em><span>${esc(s.name)}</span></div>`).join('')}</div>
</body></html>`;
};
