// B5 (chủ SP 22/10/2026) — đọc chứng từ bằng AI qua ĐƯỜNG ĐỌC TỆP CHUNG: ảnh (thu về 2000 px) + PDF (chữ đọc trên máy bằng pdf.js; PDF scan → ảnh
// trang) → cổng AI (skill contract_read / supplier_invoice_read / office_doc_read, kết nối "Đọc ảnh chứng từ", 110 s, thử lại lỗi thoáng qua)
// → kết quả có kiểu để màn hình ĐIỀN SẴN form; người dùng kiểm rồi tự lưu. Tệp không lưu ở máy chủ AI; màn nào cần đính kèm thì tự tải lên kho của màn đó.
import { aiGateway, type AiRunResult } from './aiGateway';
import { isPdfFile, readPdf } from './assistantPdf';
import { prepareCapturePhoto } from './wmsDeliveryCaptureService';

export type DocReadSkill = 'contract_read' | 'supplier_invoice_read' | 'office_doc_read';
export interface DocReadInput { text: string; images: Array<{ mime: string; b64: string }> }
export const DOC_READ_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf';
export const MAX_DOC_IMAGES = 6;
const MAX_TEXT = 14000;

const fileToB64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Không đọc được tệp.'));
  r.readAsDataURL(f);
});
const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

/** Tệp người dùng chọn → đầu vào cổng AI: PDF có chữ → chữ; PDF scan → ảnh trang; ảnh → thu nhỏ. Tối đa 6 ảnh, 14.000 ký tự. */
export const prepareDocReadInput = async (files: File[]): Promise<{ input: DocReadInput; errors: string[]; pages: number }> => {
  const images: DocReadInput['images'] = []; const texts: string[] = []; const errors: string[] = []; let pages = 0;
  for (const file of files) {
    try {
      if (isPdfFile(file)) {
        const read = await readPdf(file, MAX_DOC_IMAGES - images.length, MAX_TEXT - texts.join('\n').length);
        pages += read.pages;
        if (read.kind === 'text' && read.text?.text) texts.push(read.text.text);
        else {
          for (const img of read.images || []) images.push({ mime: 'image/jpeg', b64: await fileToB64(img.blob) });
          if (read.pages > (read.images || []).length) errors.push(`${file.name}: PDF scan — chỉ đọc ${(read.images || []).length}/${read.pages} trang đầu.`);
        }
      } else if (isImage(file)) {
        if (images.length >= MAX_DOC_IMAGES) { errors.push(`Tối đa ${MAX_DOC_IMAGES} ảnh mỗi lần.`); continue; }
        const prepared = await prepareCapturePhoto(file).catch(() => file);
        images.push({ mime: ['image/jpeg', 'image/png', 'image/webp'].includes(prepared.type) ? prepared.type : 'image/jpeg', b64: await fileToB64(prepared) });
        pages += 1;
      } else errors.push(`${file.name}: chỉ đọc ảnh (JPG, PNG) hoặc PDF.`);
    } catch (e) { errors.push(e instanceof Error ? e.message : `${file.name}: chưa đọc được.`); }
  }
  return { input: { text: texts.join('\n\n').slice(0, MAX_TEXT), images }, errors: Array.from(new Set(errors)), pages };
};

// ── Kết quả có kiểu (đã chuẩn hóa ở cổng) ────────────────────────────────────────────────────────────────────────────
export interface DocLine { name: string; unit: string | null; qty: number | null; unitPrice: number | null; amount: number | null }
export interface ContractRead {
  contractNo: string | null; name: string | null; contractType: 'purchase' | 'service' | 'subcontract' | 'lease' | 'other';
  partyA: { name: string | null; taxCode: string | null; representative: string | null }; partyB: { name: string | null; taxCode: string | null; representative: string | null };
  signedDate: string | null; effectiveDate: string | null; expiryDate: string | null; value: number | null; currency: string; vatRate: number | null;
  paymentMethod: 'bank_transfer' | 'cash' | 'other'; paymentTerms: string | null; milestones: Array<{ label: string; percent: number | null; amount: number | null; dueText: string | null }>;
  guarantee: string | null; penalty: string | null; items: DocLine[]; warnings: string[];
}
export interface InvoiceRead {
  sellerName: string | null; sellerTaxCode: string | null; buyerName: string | null; buyerTaxCode: string | null; symbol: string | null; number: string | null; date: string | null;
  net: number | null; vatRate: number | null; vat: number | null; gross: number | null; lines: DocLine[]; warnings: string[];
}
export interface OfficeDocRead {
  docType: string | null; sourceOrganization: string | null; sourceDocumentNumber: string | null; documentDate: string | null; sender: string | null; title: string | null;
  summary: string | null; dueDate: string | null; urgency: 'NORMAL' | 'URGENT' | 'VERY_URGENT'; recipients: string | null; warnings: string[];
}
export type DocReadResult = { contract_read: ContractRead; supplier_invoice_read: InvoiceRead; office_doc_read: OfficeDocRead };

export interface DocReadHooks {
  available: (skill: DocReadSkill) => Promise<boolean>;
  run: <S extends DocReadSkill>(skill: S, input: DocReadInput, screen: string) => Promise<AiRunResult<DocReadResult[S]>>;
  feedback: (runId: string, accepted: boolean) => void;
}
export const defaultDocReadHooks: DocReadHooks = {
  available: skill => aiGateway.status().then(st => st.configured && st.skills.includes(skill)).catch(() => false),
  run: (skill, input, screen) => aiGateway.run(skill, input as unknown as Record<string, unknown>, { screen, pages: input.images.length, chars: input.text.length }),
  feedback: (runId, accepted) => aiGateway.feedback(runId, accepted),
};

// ── Điền form: chỉ điền ô còn trống (không ghi đè chữ người dùng đã gõ), trả danh sách ô đã điền để báo ─────────────
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
const normName = (s: string) => stripAccents(s).replace(/\b(cong ty|cty|co phan|cp|tnhh|mtv|mot thanh vien|thuong mai|tm|dich vu|dv|san xuat|sx|xay dung|xd|va|&)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** Khớp đối tác theo MST (ưu tiên) rồi theo tên đã bỏ hậu tố pháp lý; nhiều kết quả sát nhau → null (người dùng tự chọn). */
export const matchPartner = <P extends { id: string; name: string; taxCode?: string | null }>(partners: P[], read: { name: string | null; taxCode: string | null }): P | null => {
  const tax = (read.taxCode || '').replace(/\D/g, '');
  if (tax) { const byTax = partners.filter(p => (p.taxCode || '').replace(/\D/g, '') === tax); if (byTax.length === 1) return byTax[0]; if (byTax.length > 1) return byTax[0]; }
  const n = read.name ? normName(read.name) : '';
  if (n.length < 4) return null;
  const exact = partners.filter(p => normName(p.name) === n);
  if (exact.length === 1) return exact[0];
  const partial = partners.filter(p => { const q = normName(p.name); return q.length >= 4 && (q.includes(n) || n.includes(q)); });
  return partial.length === 1 ? partial[0] : null;
};

/** Điều khoản thanh toán thành một đoạn để điền ô "Điều khoản thanh toán" (điều khoản + từng đợt). */
export const contractTermsText = (c: ContractRead) => [c.paymentTerms,
  ...c.milestones.map((m, i) => `Đợt ${i + 1}: ${m.label}${m.percent != null ? ` — ${m.percent}%` : ''}${m.amount != null ? ` — ${m.amount.toLocaleString('vi-VN')} đ` : ''}${m.dueText ? ` — ${m.dueText}` : ''}`)]
  .filter(Boolean).join('\n');

/** Loại hợp đồng NCC trong form: mua bán / dịch vụ / cung ứng / kỹ thuật — thầu phụ, thuê xếp vào dịch vụ; không rõ thì không điền. */
export const CONTRACT_FORM_TYPE: Record<ContractRead['contractType'], 'purchase' | 'service' | 'supply' | 'technical' | null> = { purchase: 'purchase', service: 'service', subcontract: 'service', lease: 'service', other: null };
export interface ContractFormPatch { code?: string; name?: string; type?: 'purchase' | 'service' | 'supply' | 'technical'; supplierId?: string; supplierName?: string; supplierRepresentative?: string;
  value?: number; paymentMethod?: 'bank_transfer' | 'cash'; paymentTerms?: string; guaranteeInfo?: string; signedDate?: string; effectiveDate?: string; expiryDate?: string; note?: string }
/** Hợp đồng đọc → ô form còn trống. Bên B = nhà cung cấp (khớp danh mục); không khớp thì chỉ điền tên để người dùng chọn. */
export const contractToForm = <P extends { id: string; name: string; taxCode?: string | null }>(c: ContractRead, form: Record<string, unknown>, partners: P[]): { patch: ContractFormPatch; filled: string[]; supplier: P | null } => {
  const patch: ContractFormPatch = {}; const filled: string[] = [];
  const empty = (k: string) => { const v = form[k]; return v == null || v === '' || v === 0; };
  const put = <K extends keyof ContractFormPatch>(k: K, v: ContractFormPatch[K] | null | undefined, label: string) => { if (v != null && v !== '' && empty(k)) { patch[k] = v; filled.push(label); } };
  put('code', c.contractNo, 'mã'); put('name', c.name, 'tên'); if (empty('type') || form.type === 'purchase') put('type', CONTRACT_FORM_TYPE[c.contractType] || undefined, 'loại');
  const supplier = matchPartner(partners, c.partyB);
  if (supplier && empty('supplierId')) { patch.supplierId = supplier.id; patch.supplierName = supplier.name; filled.push('nhà cung cấp'); }
  else if (!supplier && c.partyB.name && empty('supplierName')) { patch.supplierName = c.partyB.name; filled.push('tên NCC (chưa khớp danh mục)'); }
  put('supplierRepresentative', c.partyB.representative, 'đại diện NCC');
  put('value', c.value, 'giá trị'); if (c.paymentMethod !== 'other') put('paymentMethod', c.paymentMethod, 'hình thức thanh toán');
  put('paymentTerms', contractTermsText(c) || undefined, 'điều khoản thanh toán'); put('guaranteeInfo', c.guarantee, 'bảo hành / bảo lãnh');
  put('signedDate', c.signedDate, 'ngày ký'); put('effectiveDate', c.effectiveDate, 'hiệu lực'); put('expiryDate', c.expiryDate, 'hết hạn');
  const noteBits = [c.penalty ? `Phạt / vi phạm: ${c.penalty}` : '', c.vatRate != null ? `VAT ${c.vatRate}%` : '', c.items.length ? `${c.items.length} dòng hàng hóa / hạng mục (xem hợp đồng)` : ''].filter(Boolean).join(' · ');
  put('note', noteBits || undefined, 'ghi chú');
  return { patch, filled, supplier };
};

export interface OfficeDraftPatch { source_organization?: string; source_document_number?: string; source_sender?: string; document_date?: string; received_date?: string; due_date?: string;
  urgency?: 'NORMAL' | 'URGENT' | 'VERY_URGENT'; title?: string; summary?: string }
/** Văn bản đến đọc → ô tiếp nhận còn trống; ngày nhận = hôm nay nếu chưa có. */
export const officeDocToDraft = (d: OfficeDocRead, draft: Record<string, unknown>, today: string): { patch: OfficeDraftPatch; filled: string[] } => {
  const patch: OfficeDraftPatch = {}; const filled: string[] = [];
  const empty = (k: string) => { const v = draft[k]; return v == null || v === ''; };
  const put = <K extends keyof OfficeDraftPatch>(k: K, v: OfficeDraftPatch[K] | null | undefined, label: string) => { if (v != null && v !== '' && empty(k)) { patch[k] = v; filled.push(label); } };
  put('source_organization', d.sourceOrganization, 'đơn vị gửi'); put('source_document_number', d.sourceDocumentNumber, 'số văn bản bên gửi'); put('source_sender', d.sender, 'người gửi');
  put('document_date', d.documentDate, 'ngày văn bản'); put('received_date', today, 'ngày nhận'); put('due_date', d.dueDate, 'hạn xử lý');
  if (d.urgency !== 'NORMAL' && (empty('urgency') || draft.urgency === 'NORMAL')) { patch.urgency = d.urgency; filled.push('mức khẩn'); }
  put('title', d.title, 'trích yếu'); put('summary', d.summary, 'tóm tắt');
  return { patch, filled };
};
