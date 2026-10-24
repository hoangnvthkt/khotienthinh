// Trợ lý v2 · T1: vòng gọi công cụ (chủ SP 18/10/2026) — tối đa 5 bước model / 8 lần tra; quá 80 s hoặc hết lượt tra thì bắt
// trả lời ngay (không gọi thêm công cụ). Mỗi lần tra báo màn hình "đang tra gì"; kết quả tra được che SĐT / CCCD / STK trước khi
// đưa model. Bước model truyền vào (`step`) nên vitest chạy được với model giả; cổng truyền agentStep thật.
import type { ImagePart } from './images.ts';
import { MAX_AGENT_STEPS, MAX_TOOL_CALLS, type AgentMsg, type SourceBook, type ToolCall, type ToolSpec } from './agent.ts';
import { TOOLS, TOOL_LABEL, runTool, type Rpc, type ToolContext } from './tools.ts';


// CHẶN CỨNG BỊA (chủ SP 24/10/2026: "dữ liệu mà bịa thì quá nguy hiểm", nhất là tài chính).
// Sự cố: hỏi "phòng HCNS ai chưa chấm công" → tra đúng, 8 người thật. Hỏi tiếp "tìm trong cả công ty" → model
// KHÔNG tra lại mà tự suy ra: bịa 56/101 người (thật là 38/89), bịa tên + mã (TT039 "Nguyễn Ngọc Điệp" không có
// thật), bịa cả tên phòng. Nhật ký lượt đó ghi "0 nguồn".
//   Cách chặn: lấy mọi "mẩu dữ liệu" trong câu trả lời (mã chứng từ / nhân viên, SỐ TIỀN, số đếm người / chứng từ)
//   rồi đối chiếu với BẰNG CHỨNG của lượt này = kết quả công cụ đã tra + các câu trả lời trước trong hội thoại
//   (những câu đó cũng đã qua cổng chặn này). Mẩu nào không có trong bằng chứng là chưa tra ra mà vẫn nói.
const RE_MA = /\b[A-ZĐ]{2}\d{3,}\b|\b(?:PO|MR|DX|YC|NK|XK|CG|AP|NP|DC|KK)-\d+/gi;
/** "1.500.000.000 đ" — số có phân cách nghìn, phải đủ dài mới tính (tránh bắt "8 đ"). */
const RE_TIEN = /\b\d{1,3}(?:[.,]\d{3})+(?=\s*(?:đ|vnđ|vnd|đồng))/gi;
/** "4,2 tỷ" / "230 triệu" — ít chữ số nhưng là số tiền lớn, phải quy ra đủ số rồi mới đối chiếu. */
// `\b` sau "tỷ" KHÔNG khớp: trong regex JS không cờ `u`, ký tự có dấu không phải word char nên không có ranh giới từ.
const RE_TIEN_DON_VI = /(\d+(?:[.,]\d+)?)\s*(triệu|tỷ|tỉ)(?!\p{L})/giu;
const RE_DEM = /\b\d{1,6}(?=\s*(?:người|nhân viên|đơn|phiếu|chứng từ|dòng|lệch|công trường|ngày công|bản ghi))/gi;
const so = (x: string) => x.replace(/[^0-9]/g, '');

/** Mẩu dữ liệu trong câu trả lời mà bằng chứng của lượt này không có. `chiMa` = chỉ xét mã (dùng khi đã tra công cụ). */
export const unverifiedClaims = (text: string, evidence: string, chiMa = false): string[] => {
  const bcChu = evidence.toLowerCase();
  const bcSo = so(evidence);
  const out: string[] = [];
  for (const m of text.match(RE_MA) ?? []) if (!bcChu.includes(m.toLowerCase())) out.push(m);
  if (chiMa) return out;
  for (const m of text.match(RE_TIEN) ?? []) if (so(m).length >= 4 && !bcSo.includes(so(m))) out.push(m);
  for (const m of text.matchAll(RE_TIEN_DON_VI)) {
    const value = Math.round(Number(m[1].replace(/\./g, '').replace(',', '.')) * (/tri/i.test(m[2]) ? 1e6 : 1e9));
    if (Number.isFinite(value) && value > 0 && !bcSo.includes(String(value)) && !bcSo.includes(so(m[1]))) out.push(m[1]);
  }
  for (const m of text.match(RE_DEM) ?? []) if (!bcSo.includes(so(m))) out.push(m);
  return out;
};
/** Giữ tên cũ cho chỗ gọi sẵn có: lượt không tra gì mà nêu từ 2 mẩu dữ liệu trở lên. */
export const looksLikeFabricatedRows = (text: string): boolean => unverifiedClaims(text, '').length >= 2;

const NHAC_TRA = 'Dừng lại. Câu này hỏi số liệu / danh sách người hoặc chứng từ, mà em chưa tra công cụ nào ở lượt này. '
  + 'Em PHẢI gọi công cụ để lấy dữ liệu thật rồi mới trả lời. TUYỆT ĐỐI không liệt kê tên người, mã nhân viên, mã chứng từ, '
  + 'số tiền hay con số tổng từ trí nhớ hoặc suy ra từ câu trả lời trước — đổi phạm vi (cả công ty, phòng khác, ngày khác) thì phải tra lại.';
const CAU_TU_CHOI = 'Em chưa tra được số liệu cho câu này nên không trả lời được — em không muốn đưa ra con số hay tên người '
  + 'mà mình chưa kiểm. Có thể do chưa có công cụ tra việc này, hoặc anh/chị không có quyền xem phần dữ liệu đó. '
  + 'Anh/chị hỏi lại rõ phạm vi (phòng nào, ngày nào, dự án nào) giúp em, hoặc xem thẳng trên màn hình của phân hệ tương ứng.';

export interface StepRequest { system: string; messages: AgentMsg[]; tools: ToolSpec[]; toolChoice?: 'auto' | 'none' | { name: string }; maxTokens: number; noThinking?: boolean }
export interface StepResult { text: string; toolCalls: ToolCall[]; usage: { tokensIn: number | null; tokensOut: number | null } }
export interface ConverseDeps {
  step: (req: StepRequest, onDelta: (text: string) => void) => Promise<StepResult>;
  rpc: Rpc;
  emit: (event: Record<string, unknown>) => void;
  redact: (text: string) => string;
  system: string;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** T3: ảnh đính kèm câu vừa hỏi (gắn vào lượt người dùng cuối). */
  images?: ImagePart[];
  book: SourceBook;
  /** Tên công cụ đã gọi (ghi nhật ký). */
  used: string[];
  /** Lượt AI (ai_runs) — công cụ chuẩn bị lệnh nháp ghi vào đây. */
  runId?: string;
  /** Dự án đang xem ở Trung tâm (mặc định cho lệnh theo dự án). */
  projectId?: string | null;
  /** Nguyên văn tin người dùng (công cụ nhật ký lưu báo cáo dán vào). */
  question?: string;
  /** Bước đầu buộc gọi công cụ này (máy chủ nhận ra loại tin chắc chắn — VD báo cáo thi công dán vào). */
  forceTool?: string;
  /** B2: Jev phân loại phiếu sự cố cho công cụ chuan_bi_su_co (khi Admin đã gán kết nối). */
  issueClassifier?: ToolContext['issueClassifier'];
  /** Đợt 1 hỗ trợ: đường dẫn màn người hỏi vừa mở (quyen_cua_toi). */
  screenPath?: string | null;
  started: number;
  now?: () => number;
  maxTokens?: number;
  budgetMs?: number;
}

/** Chữ đầu mỗi bước giữ lại tới chừng này ký tự rồi mới chạy dần ra màn hình: bước hóa ra có gọi công cụ thì bỏ hẳn. */
export const HOLD_CHARS = 400;

export async function converse(d: ConverseDeps): Promise<{ text: string; usage: { tokensIn: number | null; tokensOut: number | null; calls: number } }> {
  const now = d.now || Date.now;
  const messages: AgentMsg[] = d.turns.map((t, i) => (t.role === 'user' && i === d.turns.length - 1 && d.images?.length
    ? { role: 'user', content: t.content, images: d.images } : { role: t.role, content: t.content }));
  const refBook = new Map<string, Record<string, unknown>>();
  let text = ''; let daBatTra = false; let tokensIn: number | null = null; let tokensOut: number | null = null; let calls = 0; let steps = 0;
  const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a || 0) + (b || 0));
  for (let step = 0; step <= MAX_AGENT_STEPS; step++) {
    const last = step === MAX_AGENT_STEPS || calls >= MAX_TOOL_CALLS || now() - d.started > (d.budgetMs ?? 80_000);
    // Câu trả lời = chữ của bước cuối (không gọi công cụ). Chữ của bước có gọi công cụ là ghi chú lập kế hoạch của model
    // ("Let me try tim_ho_so…", 20/10/2026) — chỉ giữ trong lịch sử gửi model, không hiện cho người dùng.
    let stepText = ''; let shown = false;
    const out = await d.step({
      system: last ? `${d.system}\nĐã tra đủ: trả lời ngay từ dữ liệu đã có, không gọi thêm công cụ.` : d.system,
      messages, tools: TOOLS, toolChoice: last ? 'none' : step === 0 && d.forceTool ? { name: d.forceTool } : 'auto', maxTokens: d.maxTokens ?? 1200, noThinking: true,
    }, delta => {
      stepText += delta;
      if (shown) d.emit({ type: 'delta', text: delta });
      else if (stepText.length >= HOLD_CHARS) { shown = true; d.emit({ type: 'delta', text: stepText }); }
    });
    tokensIn = add(tokensIn, out.usage.tokensIn); tokensOut = add(tokensOut, out.usage.tokensOut); steps++;
    if (!out.toolCalls.length || last) {
      // Bằng chứng của lượt này: kết quả công cụ đã tra + các câu trả lời trước trong hội thoại.
      const bangChung = [
        ...messages.flatMap(m => (m.role === 'tool' ? m.results.map(r => r.content) : [])),
        ...d.turns.filter(t => t.role === 'assistant').map(t => t.content),
      ].join('\n');
      // Mã bịa thì chặn kể cả khi ĐÃ tra (mã là chuỗi chính xác, không có chuyện diễn đạt lại).
      // Tiền / số đếm chỉ chặn khi cả lượt KHÔNG tra gì — tra rồi mà diễn đạt lại số thì không chặn oan.
      const chuaKiem = unverifiedClaims(stepText, bangChung, calls > 0);
      if (chuaKiem.length) {
        if (!last && !daBatTra) {
          daBatTra = true;
          if (shown) d.emit({ type: 'reset' });
          messages.push({ role: 'assistant', content: stepText });
          messages.push({ role: 'user', content: NHAC_TRA });
          continue;
        }
        // Đã bắt tra lại mà vẫn nêu dữ liệu chưa kiểm → KHÔNG đưa ra người dùng. Thà nói không biết.
        console.error('ai-gateway chan bia', { runId: d.runId, calls, chuaKiem: chuaKiem.slice(0, 8) });
        if (shown) d.emit({ type: 'reset' });
        d.emit({ type: 'delta', text: CAU_TU_CHOI });
        text = CAU_TU_CHOI;
        break;
      }
      if (!shown && stepText) d.emit({ type: 'delta', text: stepText });
      text = stepText;
      break;
    }
    // Bước dài đã lỡ chạy ra màn hình rồi mới gọi công cụ: màn hình xóa chữ đang hiện.
    if (shown) d.emit({ type: 'reset' });
    messages.push({ role: 'assistant', content: out.text, toolCalls: out.toolCalls });
    const results: Array<{ id: string; name: string; content: string }> = [];
    for (const call of out.toolCalls) {
      if (calls >= MAX_TOOL_CALLS) { results.push({ id: call.id, name: call.name, content: JSON.stringify({ loi: 'Đã tra đủ số lần cho câu này.' }) }); continue; }
      calls++; d.used.push(call.name);
      const query = String(call.args.tu_khoa ?? call.args.vat_tu ?? call.args.ma ?? call.args.ten ?? '').slice(0, 60);
      d.emit({ type: 'tool', name: call.name, label: TOOL_LABEL[call.name] || call.name, query });
      let content: string;
      try { content = await runTool(call.name, call.args, { rpc: d.rpc, book: d.book, runId: d.runId, emit: d.emit, projectId: d.projectId, question: d.question, issueClassifier: d.issueClassifier, screenPath: d.screenPath }, refBook); } catch (e) {
        console.error('ai-gateway tool failed', call.name, e instanceof Error ? e.message : e);
        content = JSON.stringify({ loi: 'Chưa tra được, thử lại sau.' });
      }
      results.push({ id: call.id, name: call.name, content: d.redact(content).slice(0, 8000) });
    }
    messages.push({ role: 'tool', results });
  }
  // calls = số lượt gọi model (tính chi phí theo lượt).
  return { text, usage: { tokensIn, tokensOut, calls: steps } };
}
