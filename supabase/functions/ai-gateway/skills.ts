// Cổng AI — danh sách skill cắm vào cổng. Mỗi skill: kiểm đầu vào, hướng dẫn riêng, cách bọc dữ liệu, lược đồ JSON trả về, chuẩn hóa kết quả.
// Bậc, chế độ, bật tắt, hạn mức của skill nằm ở bảng ai_skills (Admin chỉnh trong Cài đặt → Cổng AI); mã ở đây chỉ là cách chạy.
import { clampText, wrapData } from './guard.ts';
import type { ImagePart } from './images.ts';
import { WORK_SKILLS } from './workSkills.ts';

export interface SkillDef {
  code: string;
  /** Tối đa ký tự đầu vào gửi model (sau khi che). */
  maxInputChars: number;
  maxOutputTokens: number;
  /** Lấy đầu vào hợp lệ; sai thì ném AI_BAD_INPUT. */
  parseInput: (raw: unknown) => Record<string, string>;
  system: string;
  /** Nội dung gửi model: dữ liệu đã bọc + yêu cầu. */
  user: (input: Record<string, string>) => string;
  /** Lược đồ JSON kết quả (dùng cho provider hỗ trợ structured output). */
  schema: Record<string, unknown>;
  /** Chuẩn hóa kết quả model trước khi trả về màn hình. */
  parseOutput: (raw: unknown) => Record<string, unknown>;
  /** Một dòng tóm tắt cho nhật ký (không chứa nội dung). */
  summary: (input: Record<string, string>, output: Record<string, unknown>) => string;
  /** Skill đọc ảnh: lấy ảnh hợp lệ từ đầu vào (sai thì ném AI_BAD_INPUT); cổng gửi sang kết nối đọc ảnh (Cài đặt → Kết nối). */
  images?: (raw: unknown) => ImagePart[];
  /** Chỉ chép lại chứng từ (không suy luận, không tính toán): tắt phần suy nghĩ của model để trả lời nhanh. */
  noThinking?: boolean;
  /** Skill đọc được ảnh nhưng lượt này chỉ có chữ: chạy model theo lớp (nhanh) thay vì kết nối đọc ảnh (Vioo Work, chủ SP 20/10). */
  textUsesFast?: boolean;
}

const asObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {});
const strings = (value: unknown, max = 10) => (Array.isArray(value) ? value : []).map(v => String(v ?? '').trim()).filter(Boolean).slice(0, max);

const textSummary: SkillDef = {
  code: 'text_summary',
  maxInputChars: 20000,
  maxOutputTokens: 1200,
  parseInput: raw => {
    const text = clampText(asObject(raw).text, 20000).trim();
    if (text.length < 20) throw new Error('AI_BAD_INPUT');
    return { text };
  },
  system: 'Tóm tắt văn bản tiếng Việt cho người bận: ý chính, việc cần làm (ai, làm gì), thời hạn hoặc mốc ngày. Không thêm thông tin ngoài văn bản.',
  user: input => `${wrapData('van_ban', input.text)}\nTrả JSON: {"summary": "<2–4 câu>", "actions": ["<việc cần làm>"], "deadlines": ["<mốc thời gian kèm việc>"]}. Mảng để rỗng nếu không có.`,
  schema: {
    type: 'object', additionalProperties: false, required: ['summary', 'actions', 'deadlines'],
    properties: { summary: { type: 'string' }, actions: { type: 'array', items: { type: 'string' } }, deadlines: { type: 'array', items: { type: 'string' } } },
  },
  parseOutput: raw => {
    const o = asObject(raw);
    return { summary: clampText(o.summary, 2000).trim(), actions: strings(o.actions), deadlines: strings(o.deadlines) };
  },
  summary: (input, output) => `tóm tắt ${input.text.length} ký tự → ${String(output.summary || '').length} ký tự, ${(output.actions as string[]).length} việc`,
};

const gatewayCheck: SkillDef = {
  code: 'gateway_check',
  maxInputChars: 200,
  maxOutputTokens: 120,
  parseInput: () => ({}),
  system: 'Đây là lượt kiểm tra kết nối của quản trị viên.',
  user: () => 'Trả JSON: {"ok": true, "note": "<một câu chào ngắn bằng tiếng Việt, nêu tên model nếu biết>"}',
  schema: { type: 'object', additionalProperties: false, required: ['ok', 'note'], properties: { ok: { type: 'boolean' }, note: { type: 'string' } } },
  parseOutput: raw => { const o = asObject(raw); return { ok: o.ok === true, note: clampText(o.note, 300).trim() }; },
  summary: () => 'kiểm tra kết nối',
};

// Tab Trợ lý: `facts` = các dòng số liệu của bản tin (mỗi dòng "khóa | nhóm · nhãn: giá trị"), màn hình dựng từ RPC Hôm nay / Việc của tôi
// đã kiểm quyền của chính người hỏi. AI chỉ được trả lời từ đó và trích khóa — màn hình đổi khóa thành nút mở chứng từ / màn gốc.
const factsInput = (raw: unknown) => {
  const facts = clampText(asObject(raw).facts, 12000).trim();
  if (facts.length < 10) throw new Error('AI_BAD_INPUT');
  return facts;
};

const centerQuestion: SkillDef = {
  code: 'center_question',
  maxInputChars: 13000,
  maxOutputTokens: 700,
  parseInput: raw => {
    const question = clampText(asObject(raw).question, 500).trim();
    if (question.length < 3) throw new Error('AI_BAD_INPUT');
    return { question, facts: factsInput(raw) };
  },
  system: 'Trả lời câu hỏi về công việc hôm nay của người dùng CHỈ từ các dòng số liệu được cung cấp (mỗi dòng bắt đầu bằng khóa, rồi "|"). Không suy đoán, không cộng trừ ngoài số đã có. Số liệu không có thì nói rõ "chưa có số trên màn này" và gợi ý mở nhóm nào. Trả lời tối đa 3 câu, tiếng Việt, xưng "bạn".',
  user: input => `${wrapData('so_lieu', input.facts)}\n${wrapData('cau_hoi', input.question)}\nTrả JSON: {"answer": "<câu trả lời>", "sources": ["<khóa các dòng đã dùng, đúng nguyên văn>"]}. sources để rỗng nếu không dùng dòng nào.`,
  schema: { type: 'object', additionalProperties: false, required: ['answer', 'sources'], properties: { answer: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } } } },
  parseOutput: raw => { const o = asObject(raw); return { answer: clampText(o.answer, 1200).trim(), sources: strings(o.sources, 8).map(s => s.replace(/\s+/g, '')) }; },
  summary: (input, output) => `hỏi ${input.question.length} ký tự trên ${input.facts.split('\n').length} dòng số liệu → ${(output.sources as string[]).length} nguồn`,
};

const morningBrief: SkillDef = {
  code: 'morning_brief',
  maxInputChars: 12500,
  maxOutputTokens: 600,
  parseInput: raw => ({ facts: factsInput(raw) }),
  system: 'Viết bản tin đầu ngày 3–5 câu cho người dùng từ các dòng số liệu được cung cấp: việc gấp và quá hạn trước, rồi dự án, vật tư, nhân sự, tiền. Chỉ dùng số đã có, không thêm, không khuyên chung chung. Tiếng Việt, xưng "bạn", giọng ngắn gọn.',
  user: input => `${wrapData('so_lieu', input.facts)}\nTrả JSON: {"brief": "<bản tin 3–5 câu>"}`,
  schema: { type: 'object', additionalProperties: false, required: ['brief'], properties: { brief: { type: 'string' } } },
  parseOutput: raw => ({ brief: clampText(asObject(raw).brief, 1500).trim() }),
  summary: (input, output) => `bản tin từ ${input.facts.split('\n').length} dòng → ${String(output.brief || '').length} ký tự`,
};

// Mua hàng · Tóm tắt trước khi duyệt (A1, chủ SP 16/10): `facts` = các dòng "cần xem / ổn / chưa rõ" màn hình dựng từ get_procurement_po_review_v1
// (đã kiểm quyền). AI chỉ viết một câu từ đúng các dòng đó; người duyệt quyết.
const poReviewBrief: SkillDef = {
  code: 'po_review_brief',
  maxInputChars: 6000,
  maxOutputTokens: 200,
  parseInput: raw => {
    const facts = clampText(asObject(raw).facts, 6000).trim();
    if (facts.length < 10) throw new Error('AI_BAD_INPUT');
    return { facts };
  },
  system: 'Viết MỘT câu tiếng Việt, tối đa 35 từ, cho người duyệt đơn mua từ các dòng kiểm tra được cung cấp: điểm "Cần xem" quan trọng nhất trước (trùng đơn, hàng về trước, giá cao, vượt dự toán), rồi điểm "Ổn" chính. Chỉ dùng thông tin trong các dòng, không thêm số, không khuyên duyệt hay trả lại. Không có điểm cần xem thì nói các kiểm tra không thấy điểm bất thường.',
  user: input => `${wrapData('kiem_tra', input.facts)}\nTrả JSON: {"sentence": "<một câu>"}`,
  schema: { type: 'object', additionalProperties: false, required: ['sentence'], properties: { sentence: { type: 'string' } } },
  parseOutput: raw => ({ sentence: clampText(asObject(raw).sentence, 400).trim() }),
  summary: (input, output) => `đơn mua: ${input.facts.split('\n').length} dòng kiểm tra → ${String(output.sentence || '').length} ký tự`,
};

// Đề xuất vật tư · Từ một câu (A1, chủ SP 16/10): AI chỉ tách câu thành dòng; khớp mã làm trên máy với danh mục dự án (lib/materialRequestText.ts).
const strOrNull = (v: unknown, max: number) => { const t = clampText(v, max).trim(); return t && t.toLowerCase() !== 'null' ? t : null; };
/** Dòng vật tư AI trả (tách câu hoặc đọc ảnh) → chuẩn: bỏ dòng không tên, SL "1,5" → 1.5, tối đa 60 dòng. */
const mrLines = (raw: unknown) => (Array.isArray(raw) ? raw : []).slice(0, 60).flatMap(l => {
  const o = asObject(l);
  const name = strOrNull(o.name, 160);
  if (!name) return [];
  const q = typeof o.qty === 'number' ? o.qty : typeof o.qty === 'string' ? Number(o.qty.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : NaN;
  return [{ name, spec: strOrNull(o.spec, 80), qty: Number.isFinite(q) && q >= 0 ? q : null, unit: strOrNull(o.unit, 20), note: strOrNull(o.note, 200) }];
});
const MR_LINE_SCHEMA = { type: 'object', additionalProperties: false, required: ['name', 'spec', 'qty', 'unit', 'note'], properties: {
  name: { type: 'string' }, spec: { type: ['string', 'null'] }, qty: { type: ['number', 'null'] }, unit: { type: ['string', 'null'] }, note: { type: ['string', 'null'] },
} };
const mrTextLines: SkillDef = {
  code: 'mr_text_lines',
  maxInputChars: 3000,
  maxOutputTokens: 1500,
  parseInput: raw => {
    const text = clampText(asObject(raw).text, 3000).trim();
    if (text.length < 3) throw new Error('AI_BAD_INPUT');
    return { text };
  },
  system: 'Tách yêu cầu vật tư công trường (tiếng Việt, có thể viết tắt, không dấu, nhiều vật tư trong một câu) thành danh sách dòng, giữ thứ tự, mỗi vật tư một dòng. name: tên vật tư như người viết, bỏ từ thừa ("cần", "lấy", "xin", "cho"). spec: quy cách / kích thước / mác / độ dày tách riêng được (VD "PN10", "50x100x1.8", "PCB40"), không có thì null. qty: số lượng dạng số (dấu phẩy là thập phân: 1,5 = 1.5), không có thì null — không đoán. unit: đơn vị như người viết (cây, m, kg, tấn, bao, cái…), không có thì null. note: mục đích, hạng mục, vị trí, người nhận (VD "móng M3"), không có thì null. Không thêm vật tư không có trong câu, không đổi đơn vị.',
  user: input => `${wrapData('yeu_cau', input.text)}\nTrả JSON: {"lines": [{"name": "<tên>", "spec": null, "qty": null, "unit": null, "note": null}]}`,
  schema: {
    type: 'object', additionalProperties: false, required: ['lines'],
    properties: { lines: { type: 'array', items: MR_LINE_SCHEMA } },
  },
  parseOutput: raw => ({ lines: mrLines(asObject(raw).lines) }),
  summary: (input, output) => `tách ${input.text.length} ký tự → ${(output.lines as unknown[]).length} dòng`,
};

// Đề xuất vật tư · Chụp phiếu viết tay (chủ SP 16/10: dùng lại phần đọc ảnh của Kho). Ảnh không che được thông tin nhạy cảm như chữ —
// chỉ gửi ảnh phiếu đề xuất người dùng tự chụp; kết quả là dòng nháp, khớp mã + người xem lại trên máy như Gõ nhanh.
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const mrImages = (raw: unknown): ImagePart[] => {
  const list = asObject(raw).images;
  if (!Array.isArray(list) || list.length < 1 || list.length > 4) throw new Error('AI_BAD_INPUT');
  return list.map(x => {
    const o = asObject(x); const mime = String(o.mime || ''); const b64 = String(o.b64 || '');
    // ~4,5 MB mỗi ảnh (máy đã thu về cạnh 2000 px trước khi gửi).
    if (!IMAGE_MIME.has(mime) || b64.length < 200 || b64.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64.slice(-200))) throw new Error('AI_BAD_INPUT');
    return { mime: mime as ImagePart['mime'], b64 };
  });
};
const mrPhotoLines: SkillDef = {
  code: 'mr_photo_lines',
  maxInputChars: 300,
  maxOutputTokens: 3000,
  parseInput: raw => { mrImages(raw); return { pages: String((asObject(raw).images as unknown[]).length) }; },
  images: mrImages,
  system: 'Đọc ảnh phiếu đề xuất / yêu cầu vật tư của công trường (thường viết tay; có thể là giấy kẻ ô, bảng in, ảnh chụp tin nhắn). Lấy mọi dòng vật tư xin cấp, giữ thứ tự. name: tên vật tư như trên phiếu; spec: quy cách / kích thước / mác ghi riêng, không có thì null; qty: số lượng dạng số (chấm phân cách nghìn, phẩy thập phân kiểu Việt: 1.500 = 1500, 7,5 = 7.5), không đọc được thì null — không đoán; unit: đơn vị như trên phiếu; note: mục đích / hạng mục / ghi chú riêng của dòng. Bỏ dòng bị gạch, dòng tiêu đề, dòng cộng, chữ ký, tên người. purpose: hạng mục / mục đích chung ghi ở đầu phiếu, không có thì null. neededDate: ngày cần hàng nếu ghi (YYYY-MM-DD, ngày Việt dd/mm), không có thì null. Chữ không chắc: vẫn ghi giá trị đoán được và thêm một câu ngắn vào warnings.',
  user: input => `Ảnh: ${input.pages} trang của cùng một phiếu.\nTrả JSON: {"lines": [{"name": "<tên>", "spec": null, "qty": null, "unit": null, "note": null}], "purpose": null, "neededDate": null, "warnings": []}`,
  schema: {
    type: 'object', additionalProperties: false, required: ['lines', 'purpose', 'neededDate', 'warnings'],
    properties: { lines: { type: 'array', items: MR_LINE_SCHEMA }, purpose: { type: ['string', 'null'] }, neededDate: { type: ['string', 'null'] }, warnings: { type: 'array', items: { type: 'string' } } },
  },
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    const date = strOrNull(o.neededDate, 10);
    return {
      lines: mrLines(o.lines), purpose: strOrNull(o.purpose, 200),
      neededDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : null,
      warnings: strings(o.warnings, 8).map(w => w.slice(0, 200)),
    };
  },
  summary: (input, output) => `đọc ${input.pages} ảnh phiếu đề xuất → ${(output.lines as unknown[]).length} dòng, ${(output.warnings as unknown[]).length} cảnh báo`,
};

// Mua hàng · Lập đơn chủ động từ báo giá (chủ SP 16/10): ảnh báo giá / bảng kê / tin Zalo của NCC → dòng như file Excel nhập đơn.
// Khớp mã + quy đổi đơn vị mua ↔ kho làm ở màn xem trước của "Nhập từ Excel" (lib/procurementExcelImport). Không đặt giá thay người.
const quoteInput = (raw: unknown): { text: string; images: ImagePart[] } => {
  const o = asObject(raw);
  const text = clampText(o.text, 6000).trim();
  const images = Array.isArray(o.images) && o.images.length ? mrImages(raw) : [];
  if (!images.length && text.length < 10) throw new Error('AI_BAD_INPUT');
  return { text, images };
};
const QUOTE_LINE_SCHEMA = { type: 'object', additionalProperties: false, required: ['sku', 'name', 'spec', 'unit', 'qty', 'unitPrice', 'amount', 'note'], properties: {
  sku: { type: ['string', 'null'] }, name: { type: 'string' }, spec: { type: ['string', 'null'] }, unit: { type: ['string', 'null'] },
  qty: { type: ['number', 'null'] }, unitPrice: { type: ['number', 'null'] }, amount: { type: ['number', 'null'] }, note: { type: ['string', 'null'] },
} };
/** Số AI trả (thường là number; chuỗi thì nhận kiểu Việt "21.490,1" / "14.930" và kiểu Anh "21,490.1"). */
const numOrNull = (v: unknown) => {
  let n = typeof v === 'number' ? v : NaN;
  if (typeof v === 'string' && !/^\s*-/.test(v)) {
    let t = v.replace(/[^\d.,]/g, '');
    const dot = t.lastIndexOf('.'); const comma = t.lastIndexOf(',');
    if (dot >= 0 && comma >= 0) t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (comma >= 0) t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    n = t ? Number(t) : NaN;
  }
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const poQuoteLines: SkillDef = {
  code: 'po_quote_lines',
  maxInputChars: 6000,
  maxOutputTokens: 4000,
  parseInput: raw => { const q = quoteInput(raw); return { text: q.text, pages: String(q.images.length) }; },
  images: raw => quoteInput(raw).images,
  noThinking: true,
  system: 'Chép lại báo giá / bảng kê / phiếu đặt hàng của nhà cung cấp (ảnh chụp, ảnh màn hình Excel, chữ dán từ Zalo) thành dữ liệu để lập đơn mua. Lấy mọi dòng hàng, giữ thứ tự; bỏ dòng tiêu đề nhóm, dòng cộng, thuế, chữ ký. name: tên hàng như trên dòng (giữ mác ghi ở dòng, VD "Thép D8 CB240"); spec: thương hiệu / quy cách riêng của dòng — tên nhóm như "Thép Shengli CB500" chỉ lấy thương hiệu ("Shengli"), không chép mác của nhóm khi dòng đã ghi mác; sku: mã hàng nếu có. QUAN TRỌNG: qty và unit là số lượng theo ĐÚNG đơn vị mà đơn giá áp dụng (thép bán theo kg thì qty = trọng lượng kg, unit "kg"; "2,5 tấn" giá theo kg thì qty 2500); số cây / tấm / bó kèm theo ghi vào note dạng "3115 cây". unitPrice: đơn giá chưa VAT ("22k" = 22000); amount: thành tiền của dòng. Số: nhận ra kiểu Việt (1.234,5) hay kiểu Anh (1,234.5) theo cả bảng. Chép đúng số trên chứng từ, KHÔNG tự nhân / cộng / kiểm chéo (hệ thống tự kiểm). vendorName, vendorTaxCode: công ty bán / cung cấp hàng ghi trên chứng từ (không lấy Tiến Thịnh, không lấy tên công trình / dự án); không có tên công ty nào thì null. vatRate: % thuế VAT nếu ghi; subtotal, vatAmount, total: số trên chứng từ. Không đọc được thì null — không đoán. warnings: tối đa 5 câu ngắn, chỉ về chữ / số mờ, viết đè hoặc không chắc.',
  user: input => `${input.text ? wrapData('bao_gia', input.text) + '\n' : ''}${Number(input.pages) ? `Ảnh: ${input.pages} trang báo giá.\n` : ''}Trả JSON: {"vendorName": null, "vendorTaxCode": null, "docNo": null, "docDate": null, "vatRate": null, "lines": [{"sku": null, "name": "<tên>", "spec": null, "unit": null, "qty": null, "unitPrice": null, "amount": null, "note": null}], "subtotal": null, "vatAmount": null, "total": null, "warnings": []}`,
  schema: {
    type: 'object', additionalProperties: false, required: ['vendorName', 'vendorTaxCode', 'docNo', 'docDate', 'vatRate', 'lines', 'subtotal', 'vatAmount', 'total', 'warnings'],
    properties: {
      vendorName: { type: ['string', 'null'] }, vendorTaxCode: { type: ['string', 'null'] }, docNo: { type: ['string', 'null'] }, docDate: { type: ['string', 'null'] },
      vatRate: { type: ['number', 'null'] }, lines: { type: 'array', items: QUOTE_LINE_SCHEMA },
      subtotal: { type: ['number', 'null'] }, vatAmount: { type: ['number', 'null'] }, total: { type: ['number', 'null'] }, warnings: { type: 'array', items: { type: 'string' } },
    },
  },
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    const date = strOrNull(o.docDate, 10);
    const vat = numOrNull(o.vatRate);
    return {
      vendorName: strOrNull(o.vendorName, 200), vendorTaxCode: strOrNull(o.vendorTaxCode, 20)?.replace(/[^0-9-]/g, '') || null,
      docNo: strOrNull(o.docNo, 60), docDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      vatRate: vat != null && vat <= 100 ? vat : null,
      lines: (Array.isArray(o.lines) ? o.lines : []).slice(0, 80).flatMap(l => {
        const x = asObject(l); const name = strOrNull(x.name, 200);
        if (!name) return [];
        return [{ sku: strOrNull(x.sku, 40), name, spec: strOrNull(x.spec, 120), unit: strOrNull(x.unit, 20), qty: numOrNull(x.qty),
          unitPrice: numOrNull(x.unitPrice), amount: numOrNull(x.amount), note: strOrNull(x.note, 200) }];
      }),
      subtotal: numOrNull(o.subtotal), vatAmount: numOrNull(o.vatAmount), total: numOrNull(o.total),
      warnings: strings(o.warnings, 10).map(w => w.slice(0, 240)),
    };
  },
  summary: (input, output) => `báo giá ${input.pages} ảnh + ${input.text.length} ký tự → ${(output.lines as unknown[]).length} dòng`,
};

// Nhật ký · Dán báo cáo Zalo / chụp sổ → nhật ký nháp (chủ SP 16–17/10/2026, PR-2). Báo cáo có thể nhiều ngày; AI chỉ chọn mã trong
// danh sách hạng mục máy gửi (cửa sổ kế hoạch quanh ngày báo cáo), máy kiểm lại mã có thật. Không tự ghi tiến độ: KL / % chỉ khi báo cáo ghi số.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const reportInput = (raw: unknown) => {
  const o = asObject(raw);
  const text = clampText(o.text, 8000).trim();
  const images = Array.isArray(o.images) && o.images.length ? mrImages(raw) : [];
  if (!images.length && text.length < 10) throw new Error('AI_BAD_INPUT');
  const reportDate = String(o.reportDate || '').slice(0, 10);
  if (!DAY_RE.test(reportDate)) throw new Error('AI_BAD_INPUT');
  const tasks = clampText(o.tasks, 20000).trim();
  if (tasks.length < 5) throw new Error('AI_BAD_INPUT');
  return { text, images, reportDate, tasks, areas: clampText(o.areas, 2000).trim(), crews: clampText(o.crews, 2000).trim(), hints: clampText(o.hints, 4000).trim() };
};
const REPORT_WORK_SCHEMA = { type: 'object', additionalProperties: false, required: ['text', 'taskCodes', 'location', 'quantity', 'unit', 'percent', 'confidence', 'reason'], properties: {
  text: { type: 'string' }, taskCodes: { type: 'array', items: { type: 'string' } }, location: { type: ['string', 'null'] },
  quantity: { type: ['number', 'null'] }, unit: { type: ['string', 'null'] }, percent: { type: ['number', 'null'] },
  confidence: { type: 'string', enum: ['high', 'low'] }, reason: { type: ['string', 'null'] },
} };
const REPORT_SECTION_SCHEMA = { type: 'object', additionalProperties: false, required: ['area', 'crews', 'works'], properties: {
  area: { type: ['string', 'null'] },
  crews: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'canonical', 'people'], properties: {
    name: { type: 'string' }, canonical: { type: ['string', 'null'] }, people: { type: ['number', 'null'] } } } },
  works: { type: 'array', items: REPORT_WORK_SCHEMA },
} };
const dailyLogFromReport: SkillDef = {
  code: 'daily_log_from_report',
  maxInputChars: 20000,
  maxOutputTokens: 6000,
  parseInput: raw => { const r = reportInput(raw); return { text: r.text, pages: String(r.images.length), reportDate: r.reportDate, tasks: r.tasks, areas: r.areas, crews: r.crews, hints: r.hints }; },
  images: raw => reportInput(raw).images,
  noThinking: true,
  system: 'Chuyển báo cáo công việc của công trường (tin Zalo, sổ viết tay, ảnh chụp; viết tắt, không dấu) thành nhật ký nháp. Báo cáo có thể gồm NHIỀU NGÀY: tách theo ngày ghi trong báo cáo ("Báo cáo ngày 15/10", "Ngày 16/10", "15/10:"); phần không ghi ngày thì dùng ngày báo cáo được cho. Mỗi ngày tách theo khối nhà / khu vực thi công (mũi): area = đúng tên trong danh sách mũi nếu là cùng khu vực, khác thì ghi tên như báo cáo. crews: tổ đội và số người như báo cáo; canonical = tên trong danh sách tổ quen nếu chắc là cùng một tổ (VD "Mr Ích" = "Tổ Đỗ Duy Ích"), không chắc thì null. works: mỗi dòng việc của báo cáo là một phần tử, text giữ chữ gốc. taskCodes: mã hạng mục trong danh sách kế hoạch ứng với việc — một dòng có thể nhiều mã (VD "cofa cổ cột, dầm chân tường"); CHỈ dùng mã có trong danh sách, không bịa; ưu tiên đúng khối nhà / phân đoạn / trục, đang trong kế hoạch quanh ngày báo cáo, chưa xong 100%; không có mã phù hợp thì [] (việc phát sinh). location: trục / vị trí nếu có. quantity + unit chỉ khi báo cáo ghi khối lượng; percent chỉ khi ghi % hoàn thành; không đoán. confidence "low" khi không chắc, kèm reason ngắn. Từ ngữ công trường: cofa / coppha / cốp pha / cốt pha = ván khuôn; GCLD / SXLD / GC LD = gia công (sản xuất) lắp dựng; BT = bê tông; đá base = đắp đá Base; Ubot / U-boot = hộp nhựa sàn; hàng lang = hành lang; ngthu / NT = nghiệm thu (công tác nghiệm thu của việc nào thì gắn mã việc đó); "trục F6-->F16" = trục 6 đến 16. Cách gọi đã xác nhận (nếu có) là đúng — dùng lại. weather, issues (sự cố, vướng mắc), nextDayPlan (kế hoạch ngày mai) nếu báo cáo ghi. warnings: tối đa 5 câu ngắn — hạng mục kế hoạch đã 100% mà vẫn làm, việc không có trong kế hoạch, chữ mờ.',
  user: input => [
    `Ngày báo cáo: ${input.reportDate}`,
    wrapData('danh_sach_hang_muc', `mã | khối › nhóm › việc | kế hoạch | %\n${input.tasks}`),
    input.areas ? wrapData('mui_thi_cong', input.areas) : '',
    input.crews ? wrapData('to_doi_quen', input.crews) : '',
    input.hints ? wrapData('cach_goi_da_xac_nhan', input.hints) : '',
    input.text ? wrapData('bao_cao', input.text) : '',
    Number(input.pages) ? `Ảnh: ${input.pages} trang báo cáo.` : '',
    'Trả JSON: {"days": [{"date": "YYYY-MM-DD", "sections": [{"area": null, "crews": [{"name": "<tổ>", "canonical": null, "people": null}], "works": [{"text": "<dòng việc gốc>", "taskCodes": [], "location": null, "quantity": null, "unit": null, "percent": null, "confidence": "high", "reason": null}]}], "weather": null, "issues": [], "nextDayPlan": null}], "warnings": []}',
  ].filter(Boolean).join('\n'),
  schema: {
    type: 'object', additionalProperties: false, required: ['days', 'warnings'],
    properties: {
      days: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['date', 'sections', 'weather', 'issues', 'nextDayPlan'], properties: {
        date: { type: ['string', 'null'] }, sections: { type: 'array', items: REPORT_SECTION_SCHEMA }, weather: { type: ['string', 'null'] },
        issues: { type: 'array', items: { type: 'string' } }, nextDayPlan: { type: ['string', 'null'] } } } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
  parseOutput: raw => {
    const o = asObject(raw);
    const bounded = (v: unknown, max: number) => { const n = numOrNull(v); return n != null && n <= max ? n : null; };
    const days = (Array.isArray(o.days) ? o.days : []).slice(0, 14).map(d => {
      const day = asObject(d); const date = strOrNull(day.date, 10);
      return {
        date: date && DAY_RE.test(date) ? date : null,
        sections: (Array.isArray(day.sections) ? day.sections : []).slice(0, 10).map(s => {
          const sec = asObject(s);
          return {
            area: strOrNull(sec.area, 80),
            crews: (Array.isArray(sec.crews) ? sec.crews : []).slice(0, 10).flatMap(c => {
              const crew = asObject(c); const name = strOrNull(crew.name, 80);
              return name ? [{ name, canonical: strOrNull(crew.canonical, 80), people: bounded(crew.people, 2000) }] : [];
            }),
            works: (Array.isArray(sec.works) ? sec.works : []).slice(0, 40).flatMap(w => {
              const work = asObject(w); const text = strOrNull(work.text, 300);
              if (!text) return [];
              return [{
                text, taskCodes: strings(work.taskCodes, 5).filter(c => /^[0-9A-Za-z][0-9A-Za-z.\-_]{0,29}$/.test(c)),
                location: strOrNull(work.location, 120), quantity: numOrNull(work.quantity), unit: strOrNull(work.unit, 20),
                percent: bounded(work.percent, 100), confidence: work.confidence === 'low' ? 'low' : 'high', reason: strOrNull(work.reason, 200),
              }];
            }),
          };
        }).filter(sec => sec.works.length || sec.crews.length),
        weather: strOrNull(day.weather, 60), issues: strings(day.issues, 10).map(x => x.slice(0, 300)), nextDayPlan: strOrNull(day.nextDayPlan, 1000),
      };
    }).filter(day => day.sections.length);
    return { days, warnings: strings(o.warnings, 5).map(w => w.slice(0, 240)) };
  },
  summary: (input, output) => `báo cáo ${input.pages} ảnh + ${input.text.length} ký tự, ${input.tasks.split('\n').length} hạng mục → ${(output.days as unknown[]).length} ngày`,
};

// ── B5 (chủ SP 22/10/2026): đọc chứng từ qua đường đọc tệp chung — hợp đồng NCC, hóa đơn NCC, văn bản đến. Chỉ CHÉP LẠI để người dùng kiểm ──
// Đầu vào: chữ (PDF có chữ đọc trên máy) và / hoặc ảnh (ảnh chụp, PDF scan → ảnh trang). Số giữ dạng máy; ngày YYYY-MM-DD; không chắc → null + warnings.
const DOC_READ_RULES = 'Chỉ chép đúng những gì thấy trên chứng từ, không suy luận, không tính thêm; ô không thấy thì null và ghi vào warnings (một câu tiếng Việt). Số tiền trả dạng số máy (6300000, không dấu chấm nghìn, không "đ"); phần trăm trả số (8, không "8%"); ngày trả YYYY-MM-DD (ngày tháng kiểu Việt dd/mm/yyyy → yyyy-mm-dd). Chữ tiếng Việt giữ dấu. Không bịa tên công ty, mã số thuế.';
const docReadInput = (max: number) => (raw: unknown): { text: string; images: ImagePart[] } => {
  const o = asObject(raw);
  const text = clampText(o.text, max).trim();
  const images = Array.isArray(o.images) && o.images.length ? mrImages(raw) : [];
  if (!images.length && text.length < 20) throw new Error('AI_BAD_INPUT');
  return { text, images };
};
const DAY10 = (v: unknown) => { const d = strOrNull(v, 10); return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null; };
const taxCode = (v: unknown) => strOrNull(v, 20)?.replace(/[^0-9-]/g, '') || null;
const pct = (v: unknown) => { const n = numOrNull(v); return n != null && n <= 100 ? n : null; };
const DOC_LINE_SCHEMA = { type: 'object', additionalProperties: false, required: ['name', 'unit', 'qty', 'unitPrice', 'amount'], properties: {
  name: { type: 'string' }, unit: { type: ['string', 'null'] }, qty: { type: ['number', 'null'] }, unitPrice: { type: ['number', 'null'] }, amount: { type: ['number', 'null'] } } };
const docLines = (raw: unknown, max: number) => (Array.isArray(raw) ? raw : []).slice(0, max).flatMap(l => {
  const x = asObject(l); const name = strOrNull(x.name, 200);
  return name ? [{ name, unit: strOrNull(x.unit, 20), qty: numOrNull(x.qty), unitPrice: numOrNull(x.unitPrice), amount: numOrNull(x.amount) }] : [];
});
const contractInput = docReadInput(14000);
const contractRead: SkillDef = {
  code: 'contract_read',
  maxInputChars: 14000,
  maxOutputTokens: 4000,
  parseInput: raw => { const q = contractInput(raw); return { text: q.text, pages: String(q.images.length) }; },
  images: raw => contractInput(raw).images,
  noThinking: true,
  system: `Đọc hợp đồng mua bán / dịch vụ / thầu phụ / thuê giữa công ty Tiến Thịnh và nhà cung cấp (ảnh chụp hoặc chữ PDF) thành dữ liệu để lập hồ sơ hợp đồng. ${DOC_READ_RULES} Bên A thường là bên mua / Tiến Thịnh, bên B là nhà cung cấp — ghi đúng như hợp đồng. value = tổng giá trị hợp đồng (đã gồm VAT nếu hợp đồng ghi "đã bao gồm VAT", ghi rõ ở warnings nếu không rõ). paymentTerms = tóm tắt điều khoản thanh toán 1–3 câu; milestones = các đợt thanh toán (tạm ứng, theo tiến độ, quyết toán, bảo hành) với percent / amount / dueText đúng chữ hợp đồng. guarantee = bảo hành / bảo lãnh; penalty = phạt chậm / vi phạm. items = bảng hàng hóa / hạng mục nếu có (tối đa 40 dòng).`,
  user: input => `${input.text ? wrapData('hop_dong', input.text) + '\n' : ''}${Number(input.pages) ? `Ảnh: ${input.pages} trang hợp đồng.\n` : ''}Trả JSON: {"contractNo", "name", "contractType": "purchase|service|subcontract|lease|other", "partyA": {"name", "taxCode", "representative"}, "partyB": {"name", "taxCode", "representative"}, "signedDate", "effectiveDate", "expiryDate", "value", "currency", "vatRate", "paymentMethod": "bank_transfer|cash|other", "paymentTerms", "milestones": [{"label", "percent", "amount", "dueText"}], "guarantee", "penalty", "items": [{"name", "unit", "qty", "unitPrice", "amount"}], "warnings": []}`,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['contractNo', 'name', 'contractType', 'partyA', 'partyB', 'signedDate', 'effectiveDate', 'expiryDate', 'value', 'currency', 'vatRate', 'paymentMethod', 'paymentTerms', 'milestones', 'guarantee', 'penalty', 'items', 'warnings'],
    properties: {
      contractNo: { type: ['string', 'null'] }, name: { type: ['string', 'null'] }, contractType: { type: ['string', 'null'] },
      partyA: { type: 'object', additionalProperties: false, required: ['name', 'taxCode', 'representative'], properties: { name: { type: ['string', 'null'] }, taxCode: { type: ['string', 'null'] }, representative: { type: ['string', 'null'] } } },
      partyB: { type: 'object', additionalProperties: false, required: ['name', 'taxCode', 'representative'], properties: { name: { type: ['string', 'null'] }, taxCode: { type: ['string', 'null'] }, representative: { type: ['string', 'null'] } } },
      signedDate: { type: ['string', 'null'] }, effectiveDate: { type: ['string', 'null'] }, expiryDate: { type: ['string', 'null'] },
      value: { type: ['number', 'null'] }, currency: { type: ['string', 'null'] }, vatRate: { type: ['number', 'null'] }, paymentMethod: { type: ['string', 'null'] }, paymentTerms: { type: ['string', 'null'] },
      milestones: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'percent', 'amount', 'dueText'], properties: { label: { type: 'string' }, percent: { type: ['number', 'null'] }, amount: { type: ['number', 'null'] }, dueText: { type: ['string', 'null'] } } } },
      guarantee: { type: ['string', 'null'] }, penalty: { type: ['string', 'null'] }, items: { type: 'array', items: DOC_LINE_SCHEMA }, warnings: { type: 'array', items: { type: 'string' } },
    },
  },
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    const party = (v: unknown) => { const x = asObject(v); return { name: strOrNull(x.name, 200), taxCode: taxCode(x.taxCode), representative: strOrNull(x.representative, 120) }; };
    const type = strOrNull(o.contractType, 20)?.toLowerCase();
    const method = strOrNull(o.paymentMethod, 20)?.toLowerCase();
    return {
      contractNo: strOrNull(o.contractNo, 80), name: strOrNull(o.name, 240),
      contractType: type && ['purchase', 'service', 'subcontract', 'lease'].includes(type) ? type : 'other',
      partyA: party(o.partyA), partyB: party(o.partyB),
      signedDate: DAY10(o.signedDate), effectiveDate: DAY10(o.effectiveDate), expiryDate: DAY10(o.expiryDate),
      value: numOrNull(o.value), currency: (strOrNull(o.currency, 8) || 'VND').toUpperCase(), vatRate: pct(o.vatRate),
      paymentMethod: method === 'cash' ? 'cash' : method === 'bank_transfer' || method === 'transfer' ? 'bank_transfer' : 'other',
      paymentTerms: strOrNull(o.paymentTerms, 600),
      milestones: (Array.isArray(o.milestones) ? o.milestones : []).slice(0, 12).flatMap(m => { const x = asObject(m); const label = strOrNull(x.label, 120); return label ? [{ label, percent: pct(x.percent), amount: numOrNull(x.amount), dueText: strOrNull(x.dueText, 160) }] : []; }),
      guarantee: strOrNull(o.guarantee, 400), penalty: strOrNull(o.penalty, 400), items: docLines(o.items, 40),
      warnings: strings(o.warnings, 10).map(w => w.slice(0, 240)),
    };
  },
  summary: (input, output) => `hợp đồng ${input.pages} ảnh + ${input.text.length} ký tự → ${(output.milestones as unknown[]).length} đợt thanh toán, ${(output.items as unknown[]).length} dòng`,
};

const invoiceInput = docReadInput(8000);
const supplierInvoiceRead: SkillDef = {
  code: 'supplier_invoice_read',
  maxInputChars: 8000,
  maxOutputTokens: 3000,
  parseInput: raw => { const q = invoiceInput(raw); return { text: q.text, pages: String(q.images.length) }; },
  images: raw => invoiceInput(raw).images,
  noThinking: true,
  system: `Đọc hóa đơn giá trị gia tăng / hóa đơn bán hàng của nhà cung cấp (ảnh chụp, ảnh hóa đơn điện tử, chữ PDF) thành dữ liệu để ghi hóa đơn NCC. ${DOC_READ_RULES} Người bán = nhà cung cấp (seller), người mua = Tiến Thịnh (buyer). symbol = ký hiệu hóa đơn (VD 1C25TAA), number = số hóa đơn (chỉ chữ số, bỏ số 0 đầu), date = ngày lập. net = tiền hàng chưa VAT, vatRate = thuế suất %, vat = tiền thuế, gross = tổng thanh toán. Hóa đơn nhiều thuế suất thì vatRate null và ghi warnings. lines = dòng hàng (tối đa 60).`,
  user: input => `${input.text ? wrapData('hoa_don', input.text) + '\n' : ''}${Number(input.pages) ? `Ảnh: ${input.pages} trang hóa đơn.\n` : ''}Trả JSON: {"sellerName", "sellerTaxCode", "buyerName", "buyerTaxCode", "symbol", "number", "date", "net", "vatRate", "vat", "gross", "lines": [{"name", "unit", "qty", "unitPrice", "amount"}], "warnings": []}`,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['sellerName', 'sellerTaxCode', 'buyerName', 'buyerTaxCode', 'symbol', 'number', 'date', 'net', 'vatRate', 'vat', 'gross', 'lines', 'warnings'],
    properties: {
      sellerName: { type: ['string', 'null'] }, sellerTaxCode: { type: ['string', 'null'] }, buyerName: { type: ['string', 'null'] }, buyerTaxCode: { type: ['string', 'null'] },
      symbol: { type: ['string', 'null'] }, number: { type: ['string', 'null'] }, date: { type: ['string', 'null'] },
      net: { type: ['number', 'null'] }, vatRate: { type: ['number', 'null'] }, vat: { type: ['number', 'null'] }, gross: { type: ['number', 'null'] },
      lines: { type: 'array', items: DOC_LINE_SCHEMA }, warnings: { type: 'array', items: { type: 'string' } },
    },
  },
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    const number = strOrNull(o.number, 20)?.replace(/\D/g, '').replace(/^0+(?=\d)/, '') || null;
    const net = numOrNull(o.net); const vat = numOrNull(o.vat); const gross = numOrNull(o.gross);
    const warnings = strings(o.warnings, 10).map(w => w.slice(0, 240));
    if (net != null && vat != null && gross != null && Math.abs(net + vat - gross) > 1) warnings.push(`Tiền hàng ${net} + VAT ${vat} ≠ tổng ${gross} — kiểm lại số đọc.`);
    return {
      sellerName: strOrNull(o.sellerName, 200), sellerTaxCode: taxCode(o.sellerTaxCode), buyerName: strOrNull(o.buyerName, 200), buyerTaxCode: taxCode(o.buyerTaxCode),
      symbol: strOrNull(o.symbol, 20)?.toUpperCase() || null, number, date: DAY10(o.date), net, vatRate: pct(o.vatRate), vat, gross,
      lines: docLines(o.lines, 60), warnings: warnings.slice(0, 10),
    };
  },
  summary: (input, output) => `hóa đơn ${input.pages} ảnh + ${input.text.length} ký tự → ${output.number ? 'có số' : 'thiếu số'}, ${(output.lines as unknown[]).length} dòng`,
};

const officeInput = docReadInput(12000);
const officeDocRead: SkillDef = {
  code: 'office_doc_read',
  maxInputChars: 12000,
  maxOutputTokens: 2500,
  parseInput: raw => { const q = officeInput(raw); return { text: q.text, pages: String(q.images.length) }; },
  images: raw => officeInput(raw).images,
  noThinking: true,
  system: `Đọc văn bản hành chính (công văn, quyết định, thông báo, tờ trình, giấy mời… ảnh chụp hoặc chữ PDF) gửi tới công ty Tiến Thịnh thành dữ liệu để tiếp nhận văn bản đến. ${DOC_READ_RULES} sourceOrganization = cơ quan / đơn vị ban hành (dòng đầu, dấu / chữ ký); sourceDocumentNumber = số ký hiệu văn bản (VD 125/CV-UBND); documentDate = ngày ban hành; sender = người ký (họ tên, chức vụ); title = trích yếu "V/v …" hoặc tên văn bản; summary = tóm tắt nội dung 2–3 câu, nêu yêu cầu / việc phải làm; dueDate = hạn phải trả lời / thực hiện nếu văn bản ghi; urgency theo dấu "Khẩn" / "Hỏa tốc" (VERY_URGENT) hoặc hạn gấp (URGENT), còn lại NORMAL; docType = loại văn bản (Công văn, Quyết định, Thông báo, Tờ trình, Giấy mời, Hợp đồng, Khác).`,
  user: input => `${input.text ? wrapData('van_ban', input.text) + '\n' : ''}${Number(input.pages) ? `Ảnh: ${input.pages} trang văn bản.\n` : ''}Trả JSON: {"docType", "sourceOrganization", "sourceDocumentNumber", "documentDate", "sender", "title", "summary", "dueDate", "urgency": "NORMAL|URGENT|VERY_URGENT", "recipients", "warnings": []}`,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['docType', 'sourceOrganization', 'sourceDocumentNumber', 'documentDate', 'sender', 'title', 'summary', 'dueDate', 'urgency', 'recipients', 'warnings'],
    properties: {
      docType: { type: ['string', 'null'] }, sourceOrganization: { type: ['string', 'null'] }, sourceDocumentNumber: { type: ['string', 'null'] }, documentDate: { type: ['string', 'null'] },
      sender: { type: ['string', 'null'] }, title: { type: ['string', 'null'] }, summary: { type: ['string', 'null'] }, dueDate: { type: ['string', 'null'] },
      urgency: { type: ['string', 'null'] }, recipients: { type: ['string', 'null'] }, warnings: { type: 'array', items: { type: 'string' } },
    },
  },
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    const u = strOrNull(o.urgency, 20)?.toUpperCase();
    return {
      docType: strOrNull(o.docType, 60), sourceOrganization: strOrNull(o.sourceOrganization, 200), sourceDocumentNumber: strOrNull(o.sourceDocumentNumber, 60),
      documentDate: DAY10(o.documentDate), sender: strOrNull(o.sender, 160), title: strOrNull(o.title, 300), summary: strOrNull(o.summary, 1200), dueDate: DAY10(o.dueDate),
      urgency: u === 'VERY_URGENT' || u === 'URGENT' ? u : 'NORMAL', recipients: strOrNull(o.recipients, 300),
      warnings: strings(o.warnings, 10).map(w => w.slice(0, 240)),
    };
  },
  summary: (input, output) => `văn bản ${input.pages} ảnh + ${input.text.length} ký tự → ${output.sourceDocumentNumber ? 'có số' : 'thiếu số'}, ${output.dueDate ? 'có hạn' : 'không hạn'}`,
};

export const SKILLS: Record<string, SkillDef> = {
  [textSummary.code]: textSummary, [gatewayCheck.code]: gatewayCheck, [centerQuestion.code]: centerQuestion, [morningBrief.code]: morningBrief,
  [poReviewBrief.code]: poReviewBrief, [mrTextLines.code]: mrTextLines, [mrPhotoLines.code]: mrPhotoLines,
  [poQuoteLines.code]: poQuoteLines, [dailyLogFromReport.code]: dailyLogFromReport,
  [contractRead.code]: contractRead, [supplierInvoiceRead.code]: supplierInvoiceRead, [officeDocRead.code]: officeDocRead,
  ...Object.fromEntries(WORK_SKILLS.map(def => [def.code, def])),
};
