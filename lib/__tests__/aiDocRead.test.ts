// B5 (22/10/2026) — đọc chứng từ qua đường đọc tệp chung: 3 skill cổng (chuẩn hóa kết quả model: ngày, số máy, MST, cảnh báo lệch tiền)
// và hàm điền form phía máy (chỉ điền ô trống, khớp NCC theo MST / tên).
import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../supabase/functions/ai-gateway/skills';
import { contractTermsText, contractToForm, matchPartner, officeDocToDraft, type ContractRead, type InvoiceRead, type OfficeDocRead } from '../aiDocRead';

const img = { mime: 'image/jpeg', b64: 'A'.repeat(300) };

describe('skill contract_read', () => {
  const s = SKILLS.contract_read;
  it('đầu vào: ảnh hoặc chữ ≥ 20 ký tự; kết quả chuẩn hóa loại, ngày, MST, hình thức thanh toán, đợt thanh toán ≤ 12, dòng ≤ 40', () => {
    expect(() => s.parseInput({ text: 'ngắn' })).toThrow('AI_BAD_INPUT');
    expect(s.parseInput({ text: 'HỢP ĐỒNG MUA BÁN số 12/2026/HĐMB giữa hai bên' })).toEqual({ text: 'HỢP ĐỒNG MUA BÁN số 12/2026/HĐMB giữa hai bên', pages: '0' });
    expect(s.images!({ images: [img] })).toHaveLength(1);
    const out = s.parseOutput({ contractNo: ' 12/2026/HĐMB ', name: 'Mua thép', contractType: 'Purchase', partyA: { name: 'Tiến Thịnh', taxCode: '0101234567' }, partyB: { name: 'Cty Hanaka', taxCode: 'MST 2300 123 456', representative: 'Ông A' },
      signedDate: '2026-10-01', effectiveDate: '01/10/2026', expiryDate: null, value: '1.250.000.000', currency: 'vnd', vatRate: '8%', paymentMethod: 'Transfer', paymentTerms: 'Tạm ứng 30 %, còn lại theo tiến độ.',
      milestones: [{ label: 'Tạm ứng', percent: 30, amount: 375000000, dueText: 'trong 5 ngày sau ký' }, { label: '', percent: 70 }], guarantee: null, penalty: '0,05 %/ngày', items: [{ name: 'Thép D16', unit: 'kg', qty: '6.300', unitPrice: 15850, amount: 99855000 }, { name: '' }], warnings: ['Không thấy ngày hết hạn'] });
    expect(out).toMatchObject({ contractNo: '12/2026/HĐMB', contractType: 'purchase', partyB: { taxCode: '2300123456', representative: 'Ông A' }, signedDate: '2026-10-01', effectiveDate: null, value: 1_250_000_000, currency: 'VND', vatRate: 8, paymentMethod: 'bank_transfer',
      milestones: [{ label: 'Tạm ứng', percent: 30, amount: 375_000_000 }], items: [{ name: 'Thép D16', qty: 6300 }], warnings: ['Không thấy ngày hết hạn'] });
    expect(s.summary({ text: 'x'.repeat(100), pages: '2' }, out)).toContain('1 đợt thanh toán, 1 dòng');
  });
});

describe('skill supplier_invoice_read', () => {
  const s = SKILLS.supplier_invoice_read;
  it('số hóa đơn chỉ chữ số bỏ 0 đầu, ký hiệu hoa, MST sạch; tiền hàng + VAT ≠ tổng → thêm cảnh báo', () => {
    const out = s.parseOutput({ sellerName: 'Hanaka', sellerTaxCode: '2300123456', buyerName: 'Tiến Thịnh', buyerTaxCode: null, symbol: '1c25taa', number: '0000123', date: '2026-10-15', net: '209.671.000', vatRate: 8, vat: 16773680, gross: 226444680, lines: [], warnings: [] });
    expect(out).toMatchObject({ symbol: '1C25TAA', number: '123', date: '2026-10-15', net: 209_671_000, vat: 16_773_680, gross: 226_444_680, warnings: [] });
    const bad = s.parseOutput({ number: 'HD-77', date: '15/10/2026', net: 100, vatRate: 8, vat: 8, gross: 120, lines: [{ name: 'A', qty: 1 }], warnings: [] });
    expect(bad).toMatchObject({ number: '77', date: null, lines: [{ name: 'A', qty: 1 }] });
    expect(bad.warnings).toEqual(['Tiền hàng 100 + VAT 8 ≠ tổng 120 — kiểm lại số đọc.']);
  });
});

describe('skill office_doc_read', () => {
  const s = SKILLS.office_doc_read;
  it('mức khẩn chỉ 3 giá trị, ngày đúng dạng, tóm tắt ≤ 1200', () => {
    const out = s.parseOutput({ docType: 'Công văn', sourceOrganization: 'UBND huyện Văn Lâm', sourceDocumentNumber: '125/CV-UBND', documentDate: '2026-10-20', sender: 'Nguyễn Văn B — Phó Chủ tịch', title: 'V/v kiểm tra PCCC', summary: 'Yêu cầu báo cáo trước 30/10.', dueDate: '2026-10-30', urgency: 'hỏa tốc', recipients: null, warnings: [] });
    expect(out).toMatchObject({ sourceDocumentNumber: '125/CV-UBND', documentDate: '2026-10-20', dueDate: '2026-10-30', urgency: 'NORMAL' });
    expect(s.parseOutput({ urgency: 'very_urgent' }).urgency).toBe('VERY_URGENT');
    expect(s.parseOutput({ urgency: 'URGENT', documentDate: '2026-13-40' })).toMatchObject({ urgency: 'URGENT', documentDate: null });
  });
});

describe('điền form phía máy', () => {
  const partners = [{ id: 'p1', name: 'CÔNG TY TNHH HANAKA VIỆT NAM', taxCode: '2300123456' }, { id: 'p2', name: 'Công ty CP Thép Hòa Phát', taxCode: '0900123456' }, { id: 'p3', name: 'Hòa Phát Hưng Yên', taxCode: null }];
  const contract: ContractRead = { contractNo: '12/2026', name: 'Mua thép', contractType: 'purchase', partyA: { name: 'Tiến Thịnh', taxCode: null, representative: null }, partyB: { name: 'Hanaka Việt Nam', taxCode: '2300123456', representative: 'Ông A' },
    signedDate: '2026-10-01', effectiveDate: '2026-10-01', expiryDate: '2026-12-31', value: 1_250_000_000, currency: 'VND', vatRate: 8, paymentMethod: 'bank_transfer', paymentTerms: 'Tạm ứng 30 %.',
    milestones: [{ label: 'Tạm ứng', percent: 30, amount: 375_000_000, dueText: '5 ngày sau ký' }], guarantee: '12 tháng', penalty: '0,05 %/ngày', items: [{ name: 'Thép', unit: 'kg', qty: 1, unitPrice: 1, amount: 1 }], warnings: [] };
  it('khớp NCC: MST trước, tên bỏ hậu tố pháp lý; nhiều kết quả sát nhau → null', () => {
    expect(matchPartner(partners, { name: 'Hanaka', taxCode: '2300 123 456' })?.id).toBe('p1');
    expect(matchPartner(partners, { name: 'Công ty TNHH Hanaka Việt Nam', taxCode: null })?.id).toBe('p1');
    expect(matchPartner(partners, { name: 'Hòa Phát', taxCode: null })).toBeNull();
    expect(matchPartner(partners, { name: 'Ab', taxCode: null })).toBeNull();
  });
  it('hợp đồng → chỉ điền ô trống; điều khoản gộp các đợt; NCC khớp thì điền id, không khớp chỉ điền tên', () => {
    const r = contractToForm(contract, { code: '', name: 'Đã có tên', type: 'purchase', supplierId: '', supplierName: '', value: 0, paymentMethod: 'bank_transfer', paymentTerms: '', guaranteeInfo: '', signedDate: '', effectiveDate: '', expiryDate: '', note: '' }, partners);
    expect(r.patch).toMatchObject({ code: '12/2026', supplierId: 'p1', supplierName: 'CÔNG TY TNHH HANAKA VIỆT NAM', supplierRepresentative: 'Ông A', value: 1_250_000_000, guaranteeInfo: '12 tháng', signedDate: '2026-10-01', expiryDate: '2026-12-31' });
    expect(r.patch.name).toBeUndefined();
    expect(r.patch.paymentTerms).toBe('Tạm ứng 30 %.\nĐợt 1: Tạm ứng — 30% — 375.000.000 đ — 5 ngày sau ký');
    expect(r.patch.note).toBe('Phạt / vi phạm: 0,05 %/ngày · VAT 8% · 1 dòng hàng hóa / hạng mục (xem hợp đồng)');
    expect(r.filled).toContain('nhà cung cấp'); expect(r.filled).not.toContain('tên');
    const none = contractToForm({ ...contract, partyB: { name: 'Cty lạ', taxCode: null, representative: null } }, { supplierId: '', supplierName: '' }, partners);
    expect(none.patch.supplierId).toBeUndefined(); expect(none.patch.supplierName).toBe('Cty lạ'); expect(none.supplier).toBeNull();
    expect(contractTermsText({ ...contract, paymentTerms: null, milestones: [] })).toBe('');
  });
  it('văn bản đến → phần tiếp nhận: ngày nhận = hôm nay khi trống; mức khẩn chỉ nâng, không hạ; không ghi đè trích yếu đã gõ', () => {
    const d: OfficeDocRead = { docType: 'Công văn', sourceOrganization: 'UBND', sourceDocumentNumber: '125/CV', documentDate: '2026-10-20', sender: 'Ông B', title: 'V/v PCCC', summary: 'Báo cáo trước 30/10.', dueDate: '2026-10-30', urgency: 'URGENT', recipients: null, warnings: [] };
    const r = officeDocToDraft(d, { source_organization: '', source_document_number: null, source_sender: '', document_date: '', received_date: null, due_date: null, urgency: 'NORMAL', title: 'Đã gõ', summary: '' }, '2026-10-22');
    expect(r.patch).toEqual({ source_organization: 'UBND', source_document_number: '125/CV', source_sender: 'Ông B', document_date: '2026-10-20', received_date: '2026-10-22', due_date: '2026-10-30', urgency: 'URGENT', summary: 'Báo cáo trước 30/10.' });
    expect(r.filled).toEqual(['đơn vị gửi', 'số văn bản bên gửi', 'người gửi', 'ngày văn bản', 'ngày nhận', 'hạn xử lý', 'mức khẩn', 'tóm tắt']);
    expect(officeDocToDraft({ ...d, urgency: 'NORMAL' }, { urgency: 'URGENT', received_date: '2026-10-21' }, '2026-10-22').patch).not.toHaveProperty('urgency');
    const inv: InvoiceRead = { sellerName: null, sellerTaxCode: null, buyerName: null, buyerTaxCode: null, symbol: null, number: null, date: null, net: null, vatRate: null, vat: null, gross: null, lines: [], warnings: [] };
    expect(inv.lines).toEqual([]);
  });
});
