// Trung tâm AI · tab Skill · "Xem bên trong" (chủ SP 19/10/2026): mỗi skill / công cụ nói gì với model và làm gì với dữ liệu,
// lấy thẳng từ mã cổng đang chạy (không chép ra bảng → không lệch). Chỉ Quản trị AI xem (index.ts kiểm is_admin trước khi trả).
// Tệp này không dùng API Deno để vitest kiểm thử được.
import { SKILLS } from './skills.ts';
import { TOOLS, TOOL_INFO, TOOL_LABEL } from './tools.ts';
import { CHAT_SKILL, chatSystem } from './chat.ts';
import { GUARD_SYSTEM } from './guard.ts';

/** Skill gắn nút: màn nào gọi (null = chưa màn nào gọi) + kết quả trả về màn hình. Thêm skill mới phải thêm dòng ở đây (test kiểm). */
export const SKILL_INFO: Record<string, { where: string | null; result: string }> = {
  text_summary: { where: null, result: 'Tóm tắt 2–4 câu, việc cần làm, mốc thời gian' },
  gateway_check: { where: 'Cài đặt → Cổng AI → Kiểm tra kết nối', result: 'Một câu chào để xác nhận khóa và model chạy được' },
  center_question: { where: null, result: 'Câu trả lời ≤ 3 câu kèm khóa dòng số liệu đã dùng' },
  morning_brief: { where: 'Trung tâm điều hành → Trợ lý → nút Tóm tắt trên bản tin', result: 'Bản tin 3–5 câu từ số liệu trên màn' },
  po_review_brief: { where: 'Mua hàng → đơn chờ duyệt → Tóm tắt trước khi duyệt', result: 'Một câu cho người duyệt (cần xem / ổn)' },
  mr_text_lines: { where: 'Đề xuất vật tư → Gõ nhanh → Nhờ AI tách', result: 'Danh sách dòng vật tư (tên, quy cách, SL, ĐV) để người dùng khớp mã' },
  mr_photo_lines: { where: 'Đề xuất vật tư → Gõ nhanh → Chụp phiếu viết tay', result: 'Danh sách dòng vật tư đọc từ ảnh' },
  po_quote_lines: { where: 'Mua hàng → Lập đơn chủ động → Chụp / dán báo giá', result: 'Dòng đơn mua (tên, quy cách, SL, đơn giá, VAT) để người dùng kiểm' },
  daily_log_from_report: { where: 'Nhật ký công trường → Dán báo cáo Zalo / ảnh sổ', result: 'Ngày × mũi × dòng việc, hạng mục, tổ đội để tạo phiếu nháp' },
  work_task_draft: { where: 'Vioo Work → Giao nhanh → ✨ Điền giúp', result: 'Một việc nháp: tên, người làm (chữ trong câu), hạn, mức A/B/C, yêu cầu, checklist, thẻ' },
  work_meeting_tasks: { where: 'Vioo Work → Giao nhanh → Dán biên bản (chữ / ảnh sổ họp)', result: 'Danh sách việc (người, hạn, mức, câu gốc) + tên cuộc họp, ngày họp, người chỉ đạo' },
  work_update_draft: { where: 'Vioo Work → Chi tiết việc → Cập nhật tiến độ → ✨ Viết giúp', result: 'Đã làm, Đang làm, Sẽ làm, Vướng + % khi ghi chú nói rõ' },
  work_task_writer: { where: 'Vioo Work → Giao nhanh → Chi tiết → ✨ Viết yêu cầu', result: 'Yêu cầu 2–4 câu, checklist 3–6 bước, bằng chứng cần nộp' },
  work_task_brief: { where: 'Vioo Work → Chi tiết việc → ✨ Tóm tắt', result: '2–3 câu: đang ở đâu, vướng gì, có kịp hạn không' },
  work_period_review: { where: 'Vioo Work → Phòng tôi / Toàn công ty → Chốt kỳ → ✨ AI soạn nháp', result: 'Nháp Đánh giá + Giải pháp từng mục tiêu và nhận xét kỳ' },
  [CHAT_SKILL]: { where: 'Trung tâm điều hành → tab Trợ lý (hội thoại)', result: 'Câu trả lời chữ + nút mở hồ sơ + thẻ nháp / thẻ biểu đồ từ công cụ' },
};

export interface CatalogParam { name: string; description: string; required: boolean }
export interface CatalogTool { name: string; label: string; description: string; params: CatalogParam[]; kind: string; rpcs: string[]; permission: string; result: string; commandKind: string | null }
export interface CatalogSkill { code: string; where: string | null; result: string; instructions: string; readsImages: boolean; tools: string[] }
export interface SkillCatalog { guard: string; skills: CatalogSkill[]; tools: CatalogTool[] }

const asObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {});

/** Tham số công cụ (lược đồ JSON gửi model) → tên + mô tả; mảng dòng giữ mô tả của mảng. */
const paramsOf = (schema: Record<string, unknown>): CatalogParam[] => {
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  return Object.entries(asObject(schema.properties)).map(([name, raw]) => {
    const p = asObject(raw);
    const options = Array.isArray(p.enum) ? ` (${(p.enum as unknown[]).join(' / ')})` : '';
    return { name, description: `${typeof p.description === 'string' ? p.description : ''}${options}`.trim(), required: required.includes(name) };
  });
};

/** today: nhãn ngày giờ VN như lượt hỏi thật (lời dặn Trợ lý có câu "Hôm nay là …"). */
export const skillCatalog = (today: string): SkillCatalog => ({
  guard: GUARD_SYSTEM,
  skills: [
    ...Object.values(SKILLS).map(def => ({ code: def.code, where: SKILL_INFO[def.code]?.where ?? null, result: SKILL_INFO[def.code]?.result ?? '',
      instructions: def.system, readsImages: Boolean(def.images), tools: [] })),
    { code: CHAT_SKILL, where: SKILL_INFO[CHAT_SKILL].where, result: SKILL_INFO[CHAT_SKILL].result,
      instructions: chatSystem('Anh', [], true, today), readsImages: true, tools: TOOLS.map(t => t.name) },
  ],
  tools: TOOLS.map(t => {
    const info = TOOL_INFO[t.name];
    return { name: t.name, label: TOOL_LABEL[t.name] || t.name, description: t.description, params: paramsOf(t.parameters),
      kind: info?.kind ?? 'tra_cuu', rpcs: info?.rpcs ?? [], permission: info?.permission ?? '', result: info?.result ?? '', commandKind: info?.commandKind ?? null };
  }),
});
