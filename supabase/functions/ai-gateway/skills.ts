// Cổng AI — danh sách skill cắm vào cổng. Mỗi skill: kiểm đầu vào, hướng dẫn riêng, cách bọc dữ liệu, lược đồ JSON trả về, chuẩn hóa kết quả.
// Bậc, chế độ, bật tắt, hạn mức của skill nằm ở bảng ai_skills (Admin chỉnh trong Cài đặt → Cổng AI); mã ở đây chỉ là cách chạy.
import { clampText, wrapData } from './guard.ts';

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

export const SKILLS: Record<string, SkillDef> = {
  [textSummary.code]: textSummary, [gatewayCheck.code]: gatewayCheck, [centerQuestion.code]: centerQuestion, [morningBrief.code]: morningBrief,
};
