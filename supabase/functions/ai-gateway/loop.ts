// Trợ lý v2 · T1: vòng gọi công cụ (chủ SP 18/10/2026) — tối đa 5 bước model / 8 lần tra; quá 80 s hoặc hết lượt tra thì bắt
// trả lời ngay (không gọi thêm công cụ). Mỗi lần tra báo màn hình "đang tra gì"; kết quả tra được che SĐT / CCCD / STK trước khi
// đưa model. Bước model truyền vào (`step`) nên vitest chạy được với model giả; cổng truyền agentStep thật.
import { MAX_AGENT_STEPS, MAX_TOOL_CALLS, type AgentMsg, type SourceBook, type ToolCall, type ToolSpec } from './agent.ts';
import { TOOLS, TOOL_LABEL, runTool, type Rpc } from './tools.ts';

export interface StepRequest { system: string; messages: AgentMsg[]; tools: ToolSpec[]; toolChoice?: 'auto' | 'none' | { name: string }; maxTokens: number; noThinking?: boolean }
export interface StepResult { text: string; toolCalls: ToolCall[]; usage: { tokensIn: number | null; tokensOut: number | null } }
export interface ConverseDeps {
  step: (req: StepRequest, onDelta: (text: string) => void) => Promise<StepResult>;
  rpc: Rpc;
  emit: (event: Record<string, unknown>) => void;
  redact: (text: string) => string;
  system: string;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
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
  started: number;
  now?: () => number;
  maxTokens?: number;
  budgetMs?: number;
}

export async function converse(d: ConverseDeps): Promise<{ text: string; usage: { tokensIn: number | null; tokensOut: number | null; calls: number } }> {
  const now = d.now || Date.now;
  const messages: AgentMsg[] = d.turns.map(t => ({ role: t.role, content: t.content }));
  const refBook = new Map<string, Record<string, unknown>>();
  let text = ''; let tokensIn: number | null = null; let tokensOut: number | null = null; let calls = 0; let steps = 0;
  const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a || 0) + (b || 0));
  for (let step = 0; step <= MAX_AGENT_STEPS; step++) {
    const last = step === MAX_AGENT_STEPS || calls >= MAX_TOOL_CALLS || now() - d.started > (d.budgetMs ?? 80_000);
    let fresh = true;
    const out = await d.step({
      system: last ? `${d.system}\nĐã tra đủ: trả lời ngay từ dữ liệu đã có, không gọi thêm công cụ.` : d.system,
      messages, tools: TOOLS, toolChoice: last ? 'none' : step === 0 && d.forceTool ? { name: d.forceTool } : 'auto', maxTokens: d.maxTokens ?? 1200, noThinking: true,
    }, delta => {
      // Chữ của bước sau nối xuống dòng mới (VD câu dẫn trước khi tra rồi câu trả lời).
      const chunk = fresh && text && !text.endsWith('\n') ? `\n\n${delta}` : delta;
      fresh = false; text += chunk; d.emit({ type: 'delta', text: chunk });
    });
    tokensIn = add(tokensIn, out.usage.tokensIn); tokensOut = add(tokensOut, out.usage.tokensOut); steps++;
    if (!out.toolCalls.length || last) break;
    messages.push({ role: 'assistant', content: out.text, toolCalls: out.toolCalls });
    const results: Array<{ id: string; name: string; content: string }> = [];
    for (const call of out.toolCalls) {
      if (calls >= MAX_TOOL_CALLS) { results.push({ id: call.id, name: call.name, content: JSON.stringify({ loi: 'Đã tra đủ số lần cho câu này.' }) }); continue; }
      calls++; d.used.push(call.name);
      const query = String(call.args.tu_khoa ?? call.args.vat_tu ?? call.args.ma ?? '').slice(0, 60);
      d.emit({ type: 'tool', name: call.name, label: TOOL_LABEL[call.name] || call.name, query });
      let content: string;
      try { content = await runTool(call.name, call.args, { rpc: d.rpc, book: d.book, runId: d.runId, emit: d.emit, projectId: d.projectId, question: d.question }, refBook); } catch (e) {
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
