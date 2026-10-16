// Cổng AI — danh sách skill cắm vào cổng. Mỗi skill: kiểm đầu vào, hướng dẫn riêng, cách bọc dữ liệu, lược đồ JSON trả về, chuẩn hóa kết quả.
// Bậc, chế độ, bật tắt, hạn mức của skill nằm ở bảng ai_skills (Admin chỉnh trong Cài đặt → Cổng AI); mã ở đây chỉ là cách chạy.
import { clampText, wrapData } from './guard.ts';
import type { ImagePart } from './images.ts';

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
  system: 'Đọc báo giá / bảng kê / phiếu đặt hàng của nhà cung cấp (ảnh chụp, ảnh màn hình Excel, chữ dán từ Zalo) để lập đơn mua. Lấy mọi dòng hàng, giữ thứ tự; bỏ dòng tiêu đề nhóm, dòng cộng, thuế, chữ ký. name: tên hàng như trên báo giá; spec: quy cách / mác / thương hiệu (tên nhóm như "Thép Shengli CB500" ghi vào spec nếu dòng không ghi); sku: mã hàng nếu có. QUAN TRỌNG: qty và unit là số lượng theo ĐÚNG đơn vị mà đơn giá áp dụng (thép bán theo kg thì qty = trọng lượng kg, unit "kg"); số cây / tấm / bó kèm theo ghi vào note dạng "3115 cây". unitPrice: đơn giá chưa VAT; amount: thành tiền của dòng. Số: nhận ra kiểu Việt (1.234,5) hay kiểu Anh (1,234.5) theo cả bảng. Kiểm chéo qty × unitPrice với amount, lệch thì thêm warning (VD do khối lượng hiển thị làm tròn). vendorName, vendorTaxCode: bên BÁN (không lấy Tiến Thịnh). vatRate: % thuế VAT nếu ghi; subtotal, vatAmount, total: số trên báo giá. Không đọc được thì null — không đoán.',
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

export const SKILLS: Record<string, SkillDef> = {
  [textSummary.code]: textSummary, [gatewayCheck.code]: gatewayCheck, [centerQuestion.code]: centerQuestion, [morningBrief.code]: morningBrief,
  [poReviewBrief.code]: poReviewBrief, [mrTextLines.code]: mrTextLines, [mrPhotoLines.code]: mrPhotoLines,
  [poQuoteLines.code]: poQuoteLines,
};
