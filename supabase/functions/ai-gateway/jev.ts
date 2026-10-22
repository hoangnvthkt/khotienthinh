// Trợ lý v2 · J1 (chủ SP 18/10/2026): Jev (TypeSafe AI) — model "System One" trả quyết định có kiểu + xác suất hiệu chỉnh, không sinh chữ.
//   Đợt J1 CHẠY BÓNG: mỗi lượt hội thoại hỏi Jev song song với model chính (ý định + câu đòi thao tác cấm), rồi ghi dự đoán cạnh
//   việc model chính thực làm (công cụ đã gọi / từ chối) vào ai_decisions. Không đổi câu trả lời, không chặn gì. Lỗi Jev → chỉ ghi lỗi.
//   J0 (scripts/jev-evals, 18/10): ý định 87 %, lệnh cấm 15/15, conf ≥ 0,85 đúng 100 % → ngưỡng 0,85 / 0,6 dùng cho đợt sau.
// Tệp này không dùng API Deno để vitest kiểm thử được.
import type { AiTarget } from '../_shared/aiTargets.ts';

export const JEV_INTENTS = ['nhat_ky', 'de_xuat_vat_tu', 'don_mua', 'nghi_phep', 'tra_cuu', 'ghi_nho', 'khac'] as const;
export type JevIntent = typeof JEV_INTENTS[number];
/** Ngưỡng theo J0 + tài liệu TypeSafe: ≥ AUTO tự chạy (người vẫn thấy), ≥ VERIFY gợi ý bấm, dưới thì hỏi lại. Đợt J1 chưa dùng để quyết định. */
export const JEV_AUTO = 0.85;
export const JEV_VERIFY = 0.6;
export const JEV_TIMEOUT_MS = 4000;

export const INTENT_CRITERIA: Record<JevIntent, string> = {
  nhat_ky: 'Báo cáo công việc ngày của tổ / nhân công / khối lượng / máy, hoặc trả lời tiếp cho một báo cáo vừa dán',
  de_xuat_vat_tu: 'Xin / đề xuất / cần vật tư cho công trình hoặc xưởng (chưa có giá, chưa có nhà cung cấp)',
  don_mua: 'Lập đơn mua / PO từ báo giá, có nhà cung cấp hoặc giá, hoặc trả lời tiếp cho một đơn mua đang lập',
  nghi_phep: 'Xin nghỉ phép / nghỉ ốm / về sớm / đổi ngày nghỉ, kể cả nhờ chuẩn bị đơn cho người khác',
  tra_cuu: 'Hỏi số liệu, trạng thái, tiến độ, tồn kho, đơn chờ duyệt, giá, việc của tôi — chỉ cần đọc và trả lời',
  ghi_nho: 'Nhờ trợ lý nhớ / lưu thói quen, cách gọi, người duyệt, kho mặc định, cách trả lời',
  khac: 'Ngoài công việc, chào hỏi, mở màn hình, hỏi về trợ lý, hoặc đòi trợ lý tự thực hiện thao tác (xóa, duyệt, ghi sổ, thanh toán, cấp quyền)',
};
const CAM_INSTRUCTIONS = 'Câu này yêu cầu trợ lý AI TỰ THỰC HIỆN một thao tác bị cấm với AI: xóa, hủy, trả lại, duyệt, ghi sổ, khóa, thanh toán, cấp quyền, sửa số đã ghi — thay vì chỉ chuẩn bị nháp cho người bấm.';

export interface JevRequest { state: Record<string, string>; model: string; questions: Record<string, unknown> }
/** Câu hỏi hiện tại (+ câu trước của trợ lý nếu có — J0: câu ngắn như "DA29" không có ngữ cảnh thì không đoán được). Chữ đã che SĐT / CCCD. */
export const buildIntentRequest = (question: string, prevAssistant: string | null, model: string): JevRequest => ({
  state: prevAssistant
    ? { cau_truoc_cua_tro_ly: prevAssistant.slice(0, 1500), cau_hien_tai_cua_nguoi_dung: question.slice(0, 4000) }
    : { cau_cua_nguoi_dung: question.slice(0, 4000) },
  model,
  questions: {
    y_dinh: { type: 'choice', instructions: 'Người dùng (nhân viên công ty xây dựng / nhà máy kết cấu thép) muốn trợ lý làm gì?', criteria: INTENT_CRITERIA },
    cam: { type: 'noul', instructions: CAM_INSTRUCTIONS },
  },
});

export interface JevIntentAnswer { intent: JevIntent; confidence: number; probabilities: Record<string, number>; cam: number; model: string; tokensIn: number | null }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Đọc JSON systemone → câu trả lời; sai định dạng thì ném AI_BAD_JSON. */
export const parseIntentAnswer = (data: unknown): JevIntentAnswer => {
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const answers = (o.answers && typeof o.answers === 'object' ? o.answers : {}) as Record<string, Record<string, unknown>>;
  const y = answers.y_dinh || {}; const c = answers.cam || {};
  const intent = String(y.choice || '') as JevIntent;
  if (!(JEV_INTENTS as readonly string[]).includes(intent)) throw new Error('AI_BAD_JSON');
  const probabilities: Record<string, number> = {};
  for (const [k, v] of Object.entries((y.probabilities && typeof y.probabilities === 'object' ? y.probabilities : {}) as Record<string, unknown>)) { const n = num(v); if (n != null) probabilities[k] = Math.round(n * 1000) / 1000; }
  const cam = num(c.noul);
  if (cam == null) throw new Error('AI_BAD_JSON');
  const usage = (o.usage && typeof o.usage === 'object' ? o.usage : {}) as Record<string, unknown>;
  return { intent, confidence: Math.round((num(y.confidence) ?? 0) * 1000) / 1000, probabilities, cam: Math.round(cam * 1000) / 1000, model: String(o.model || ''), tokensIn: num(usage.input_tokens) };
};

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
/** Gọi POST {baseUrl}/v1/systemone. Lỗi HTTP → ném "JEV_HTTP_<mã>"; quá JEV_TIMEOUT_MS → ném lỗi timeout của fetch. */
const postJev = async (target: Pick<AiTarget, 'baseUrl' | 'apiKey'>, body: JevRequest, fetchFn: FetchFn, timeoutMs: number): Promise<{ data: unknown; ms: number }> => {
  const started = Date.now();
  const res = await fetchFn(`${target.baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
    method: 'POST', headers: { Authorization: `Bearer ${target.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`JEV_HTTP_${res.status}`);
  return { data: await res.json(), ms: Date.now() - started };
};
export const askJev = async (target: Pick<AiTarget, 'baseUrl' | 'apiKey'>, body: JevRequest, fetchFn: FetchFn, timeoutMs = JEV_TIMEOUT_MS): Promise<JevIntentAnswer & { ms: number }> => {
  const { data, ms } = await postJev(target, body, fetchFn, timeoutMs);
  return { ...parseIntentAnswer(data), ms };
};

// ── B2 (chủ SP 21/10): phiếu sự cố — Jev chọn loại góp ý + mức khẩn (Choice có tiêu chí), model chính cũng đề xuất; ≥ JEV_AUTO lấy của Jev. ──
export const ISSUE_TYPES = ['bug', 'ui', 'feature', 'workflow', 'performance', 'permission', 'data', 'other'] as const;
export type IssueType = typeof ISSUE_TYPES[number];
export const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type IssuePriority = typeof ISSUE_PRIORITIES[number];
export const ISSUE_TYPE_CRITERIA: Record<IssueType, string> = {
  bug: 'Phần mềm báo lỗi, không lưu / không gửi được, màn hình trắng, số liệu không hiện dù thao tác đúng',
  ui: 'Hiển thị sai, lệch, chữ tràn, nút khó bấm — vẫn làm được việc',
  feature: 'Muốn thêm tính năng hoặc cách làm mới chưa có trong phần mềm',
  workflow: 'Luồng duyệt, bước quy trình, người duyệt, trạng thái chưa đúng ý',
  performance: 'Chậm, treo, tải lâu, hết giờ',
  permission: 'Không thấy nút / màn hình / dữ liệu vì chưa được cấp quyền; bị báo "không có quyền" hoặc "ngoài phạm vi"',
  data: 'Số liệu sai, thiếu, trùng, lệch giữa hai màn (mã vật tư, tồn kho, tiền, ngày phép)',
  other: 'Không thuộc các loại trên, hoặc chỉ là câu hỏi cách dùng',
};
export const ISSUE_PRIORITY_CRITERIA: Record<IssuePriority, string> = {
  urgent: 'Chặn công việc ngay hôm nay của nhiều người: không xuất / nhận kho được, không chấm công, không đăng nhập được',
  high: 'Chặn một việc quan trọng của người báo, chưa có cách làm khác',
  medium: 'Vẫn làm được bằng cách khác hoặc nhập tay, nhưng phiền hoặc tốn thời gian',
  low: 'Góp ý nhỏ, không gấp, chỉ để cải thiện',
};
export const buildIssueRequest = (title: string, description: string, screen: string | null, model: string): JevRequest => ({
  state: { tieu_de: title.slice(0, 200), mo_ta: description.slice(0, 3000), man_hinh: screen ? screen.slice(0, 120) : 'chưa rõ' },
  model,
  questions: {
    loai: { type: 'choice', instructions: 'Phiếu sự cố / góp ý này của nhân viên công ty xây dựng thuộc loại nào?', criteria: ISSUE_TYPE_CRITERIA },
    muc_khan: { type: 'choice', instructions: 'Mức khẩn của sự cố này?', criteria: ISSUE_PRIORITY_CRITERIA },
  },
});
export interface JevIssueAnswer { type: IssueType; typeConfidence: number; priority: IssuePriority; priorityConfidence: number; model: string; tokensIn: number | null }
export const parseIssueAnswer = (data: unknown): JevIssueAnswer => {
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const answers = (o.answers && typeof o.answers === 'object' ? o.answers : {}) as Record<string, Record<string, unknown>>;
  const t = answers.loai || {}; const p = answers.muc_khan || {};
  const type = String(t.choice || '') as IssueType; const priority = String(p.choice || '') as IssuePriority;
  if (!(ISSUE_TYPES as readonly string[]).includes(type) || !(ISSUE_PRIORITIES as readonly string[]).includes(priority)) throw new Error('AI_BAD_JSON');
  const usage = (o.usage && typeof o.usage === 'object' ? o.usage : {}) as Record<string, unknown>;
  const r3 = (v: unknown) => Math.round((num(v) ?? 0) * 1000) / 1000;
  return { type, typeConfidence: r3(t.confidence), priority, priorityConfidence: r3(p.confidence), model: String(o.model || ''), tokensIn: num(usage.input_tokens) };
};
export const askJevIssue = async (target: Pick<AiTarget, 'baseUrl' | 'apiKey'>, body: JevRequest, fetchFn: FetchFn, timeoutMs = JEV_TIMEOUT_MS): Promise<JevIssueAnswer & { ms: number }> => {
  const { data, ms } = await postJev(target, body, fetchFn, timeoutMs);
  return { ...parseIssueAnswer(data), ms };
};
/** Ghi vào ai_decisions kind issue_class: dự đoán của Jev cạnh lựa chọn của model chính (agree = cùng loại). */
export const issueDecisionLog = (jev: { ok: true; answer: JevIssueAnswer & { ms: number } } | { ok: false; error: string; ms?: number }, actual: { type: string; priority: string }, configuredModel: string) => {
  if (!('answer' in jev)) {
    const failed = jev as { ok: false; error: string; ms?: number };
    return { kind: 'issue_class', status: 'error', model: configuredModel, error: failed.error.slice(0, 200), durationMs: failed.ms ?? null, predicted: null, actual, agree: null };
  }
  const a = jev.answer;
  return {
    kind: 'issue_class', status: 'ok', model: a.model || configuredModel, durationMs: a.ms, tokensIn: a.tokensIn,
    predicted: { type: a.type, typeConfidence: a.typeConfidence, priority: a.priority, priorityConfidence: a.priorityConfidence, tier: a.typeConfidence >= JEV_AUTO ? 'auto' : a.typeConfidence >= JEV_VERIFY ? 'verify' : 'ask' },
    actual, agree: a.type === actual.type, camAgree: null,
  };
};

/** Model chính thực làm gì trong lượt: công cụ chuẩn bị nháp → ý định tương ứng; từ chối → khac; chỉ tra đọc → tra_cuu; không gì → chưa rõ (null). */
const PREPARE_INTENT: Record<string, JevIntent> = {
  chuan_bi_nhat_ky: 'nhat_ky', chuan_bi_de_xuat_vat_tu: 'de_xuat_vat_tu', chuan_bi_don_mua: 'don_mua', chuan_bi_don_nghi_phep: 'nghi_phep', chuan_bi_ghi_nho: 'ghi_nho',
};
export interface ActualIntent { intent: JevIntent | null; tools: string[]; refusal: string | null }
export const actualIntentOf = (used: string[], refusal: string | null): ActualIntent => {
  const tools = [...new Set(used)];
  if (refusal) return { intent: 'khac', tools, refusal };
  const prepared = tools.map(t => PREPARE_INTENT[t]).filter(Boolean);
  if (prepared.length) return { intent: prepared[prepared.length - 1], tools, refusal: null };
  return { intent: tools.length ? 'tra_cuu' : null, tools, refusal: null };
};

/** Bản ghi ai_decisions cho một lượt (dự đoán Jev + thực tế model chính). */
export type JevOutcome = { ok: true; answer: JevIntentAnswer & { ms: number } } | { ok: false; error: string; ms?: number };
export const decisionLog = (jev: JevOutcome, actual: ActualIntent, configuredModel: string) => {
  if (!('answer' in jev)) {
    const failed = jev as { ok: false; error: string; ms?: number };
    return { kind: 'intent_route', status: 'error', model: configuredModel, error: failed.error.slice(0, 200), durationMs: failed.ms ?? null, predicted: null, actual, agree: null };
  }
  const a = jev.answer;
  const predictedCam = a.cam >= 0.5;
  const actualCam = actual.refusal === 'thao_tac_cam';
  return {
    kind: 'intent_route', status: 'ok', model: a.model || configuredModel, durationMs: a.ms, tokensIn: a.tokensIn,
    predicted: { intent: a.intent, confidence: a.confidence, probabilities: a.probabilities, cam: a.cam, tier: a.confidence >= JEV_AUTO ? 'auto' : a.confidence >= JEV_VERIFY ? 'verify' : 'ask' },
    actual, agree: actual.intent == null ? null : a.intent === actual.intent,
    // Noul cấm chỉ so được khi model chính nói rõ từ chối thao tác cấm; còn lại để null (không ép).
    camAgree: actual.refusal === 'thao_tac_cam' || predictedCam ? predictedCam === actualCam : null,
  };
};
