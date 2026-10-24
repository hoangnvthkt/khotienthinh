// Trợ lý v2 · T1: vòng gọi công cụ (chủ SP 18/10/2026) — tối đa 5 bước model / 8 lần tra; quá 80 s hoặc hết lượt tra thì bắt
// trả lời ngay (không gọi thêm công cụ). Mỗi lần tra báo màn hình "đang tra gì"; kết quả tra được che SĐT / CCCD / STK trước khi
// đưa model. Bước model truyền vào (`step`) nên vitest chạy được với model giả; cổng truyền agentStep thật.
import type { ImagePart } from './images.ts';
import { MAX_AGENT_STEPS, MAX_TOOL_CALLS, type AgentMsg, type SourceBook, type ToolCall, type ToolSpec } from './agent.ts';
import { TOOLS, TOOL_LABEL, runTool, type Rpc, type ToolContext } from './tools.ts';


// Chặn bịa (sự cố 24/10/2026): hỏi "phòng HCNS ai chưa chấm công" → gọi công cụ, trả 8 người THẬT. Hỏi tiếp
// "tìm trong cả công ty" → model KHÔNG gọi lại công cụ mà tự suy ra, bịa ra 56/101 người, bịa cả tên và mã
// (TT039 "Nguyễn Ngọc Điệp" không có thật) lẫn tên phòng ("Kỹ thuật xây dựng" không tồn tại). Nhật ký lượt đó
// ghi "0 nguồn" — tức là không tra gì.
//   Lời nhắc không đủ chắc, nên chặn bằng mã: lượt nào KHÔNG tra công cụ mà câu trả lời lại nêu mã nhân viên /
//   mã chứng từ thì bắt model đi tra thật rồi trả lời lại (một lần duy nhất, không lặp).
const MA_DU_LIEU = /\b[A-ZĐ]{2}\d{3,}\b|\b(?:PO|MR|DX|YC|NK|XK|CG|AP)-\d+/gi;
export const looksLikeFabricatedRows = (text: string): boolean => {
  const hits = text.match(MA_DU_LIEU);
  return (hits?.length ?? 0) >= 2;
};
const NHAC_TRA = 'Dừng lại. Câu này hỏi số liệu / danh sách người hoặc chứng từ, mà em chưa tra công cụ nào ở lượt này. '
  + 'Em PHẢI gọi công cụ để lấy dữ liệu thật rồi mới trả lời. TUYỆT ĐỐI không liệt kê tên người, mã nhân viên, mã chứng từ '
  + 'hay con số tổng từ trí nhớ hoặc suy ra từ câu trả lời trước — đổi phạm vi (cả công ty, phòng khác, ngày khác) thì phải tra lại.';

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
      // Không tra gì cả lượt mà lại nêu mã nhân viên / chứng từ → bắt tra thật, đúng một lần.
      if (!last && calls === 0 && !daBatTra && looksLikeFabricatedRows(stepText)) {
        daBatTra = true;
        if (shown) d.emit({ type: 'reset' });
        messages.push({ role: 'assistant', content: stepText });
        messages.push({ role: 'user', content: NHAC_TRA });
        continue;
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
