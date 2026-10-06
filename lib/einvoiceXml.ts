// Đọc file XML hóa đơn điện tử Việt Nam (Nghị định 123/2020, Thông tư 78/2021) để điền sẵn hóa đơn đầu vào.
// Các thẻ chuẩn: KHHDon (ký hiệu), SHDon (số), NLap (ngày lập), NBan (người bán: MST, Ten), TToan (TgTCThue, TgTThue, TgTTTBSo), TSuat (thuế suất).

export interface EInvoice { symbol: string | null; number: string | null; date: string | null; sellerTaxCode: string | null; sellerName: string | null;
  net: number | null; vat: number | null; gross: number | null; vatPercent: number | null }

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : null;
};
const num = (v: string | null) => { if (v == null || v === '') return null; const n = Number(v.replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

export const parseEInvoiceXml = (xml: string): EInvoice => {
  const seller = tag(xml, 'NBan') || '';
  const pay = tag(xml, 'TToan') || xml;
  const rate = tag(xml, 'TSuat') || tag(pay, 'LTSuat') && tag(tag(pay, 'LTSuat') || '', 'TSuat');
  const date = tag(xml, 'NLap');
  const net = num(tag(pay, 'TgTCThue')); const vat = num(tag(pay, 'TgTThue')); const gross = num(tag(pay, 'TgTTTBSo'));
  const pct = rate ? Number(rate.replace('%', '').trim()) : NaN;
  return {
    symbol: tag(xml, 'KHHDon'), number: tag(xml, 'SHDon'), date: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
    sellerTaxCode: tag(seller, 'MST'), sellerName: tag(seller, 'Ten'),
    net, vat, gross: gross ?? (net != null && vat != null ? net + vat : null), vatPercent: Number.isFinite(pct) ? pct : null,
  };
};
