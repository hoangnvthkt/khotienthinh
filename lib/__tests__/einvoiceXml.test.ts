import { describe, expect, it } from 'vitest';
import { parseEInvoiceXml } from '../einvoiceXml';

const XML = `<?xml version="1.0" encoding="UTF-8"?><HDon><DLHDon Id="data"><TTChung><PBan>2.0.0</PBan><THDon>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</THDon>
<KHMSHDon>1</KHMSHDon><KHHDon>C26TNZ</KHHDon><SHDon>0000101</SHDon><NLap>2026-10-05</NLap><DVTTe>VND</DVTTe></TTChung>
<NDHDon><NBan><Ten>CÔNG TY CỔ PHẦN NAZ TECCON</Ten><MST>0601304965</MST><DChi>Nam Định</DChi></NBan><NMua><Ten>CÔNG TY CỔ PHẦN TIẾN THỊNH</Ten><MST>1000000000</MST></NMua>
<DSHHDVu><HHDVu><STT>1</STT><THHDVu>Thép hộp</THHDVu><TSuat>8%</TSuat><ThTien>155640278</ThTien></HHDVu></DSHHDVu>
<TToan><THTTLTSuat><LTSuat><TSuat>8%</TSuat><ThTien>155640278</ThTien><TThue>12451222</TThue></LTSuat></THTTLTSuat><TgTCThue>155640278</TgTCThue><TgTThue>12451222</TgTThue>
<TgTTTBSo>168091500</TgTTTBSo><TgTTTBChu>Một trăm sáu mươi tám triệu…</TgTTTBChu></TToan></NDHDon></DLHDon></HDon>`;

describe('Đọc XML hóa đơn điện tử', () => {
  it('lấy ký hiệu, số, ngày, người bán (không lấy MST người mua), tiền hàng, VAT, tổng, thuế suất', () => {
    expect(parseEInvoiceXml(XML)).toEqual({ symbol: 'C26TNZ', number: '0000101', date: '2026-10-05', sellerTaxCode: '0601304965', sellerName: 'CÔNG TY CỔ PHẦN NAZ TECCON',
      net: 155640278, vat: 12451222, gross: 168091500, vatPercent: 8 });
  });
  it('file không phải hóa đơn → các trường để trống', () => {
    expect(parseEInvoiceXml('<root><a>1</a></root>')).toMatchObject({ number: null, gross: null, sellerTaxCode: null });
  });
});
