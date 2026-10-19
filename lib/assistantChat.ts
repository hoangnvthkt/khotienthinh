// Trợ lý v2 · T0 (chủ SP duyệt 17/10/2026): hội thoại nhiều lượt ở tab Trợ lý, trả lời chạy dần, mở lại được từ Lịch sử.
// Máy chủ: skill assistant_chat của cổng AI (stream text/event-stream) + RPC list/get_ai_thread_v1 (chỉ chủ hội thoại xem, giữ 90 ngày).
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import { AI_QUOTA_REASONS, type AiGatewayErrorCode, type AiQuotaReason } from './aiGateway';
import { parseSearchResponse } from './search/globalSearchService';
import type { ServerRecord } from './search/searchTypes';
import { parseWorkItem, type WorkItem } from './center/workItemsService';
import { parseCommand, parseCommands, type AssistantCommand } from './assistantCommands';
import { parseChart, type ChartSpec } from './assistantChart';

export const CHAT_SKILL = 'assistant_chat';

/** Nguồn của câu trả lời: khóa dòng số liệu bản tin, hồ sơ công cụ tìm được (màn hình tự biết mở màn nào) hoặc một việc. */
/** Thẻ biểu đồ (19/10) công cụ dựng từ số máy chủ — đi kèm câu trả lời, không phải nút mở. */
export type ChatSource = string | { ref: string; type: 'record'; record: ServerRecord } | { ref: string; type: 'work'; item: WorkItem }
  | { ref: string; type: 'chart'; chart: ChartSpec };
export type ChartSource = Extract<ChatSource, { type: 'chart' }>;
export const isChartSource = (s: ChatSource): s is ChartSource => typeof s !== 'string' && s.type === 'chart';
export interface ChatToolUse { name: string; label: string; query: string }

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Nguồn AI dẫn → nút mở chứng từ / màn gốc. */
  sources: ChatSource[];
  runId: string | null;
  accepted: boolean | null;
  createdAt: string;
  /** T2a: lệnh nháp Trợ lý chuẩn bị trong câu trả lời này (thẻ Xác nhận / biên nhận). */
  commands: AssistantCommand[];
}
export interface ChatThreadSummary { id: string; title: string; messageCount: number; lastMessageAt: string }
export interface ChatThread extends ChatThreadSummary { messages: ChatMessage[] }

export interface ChatSendInput {
  threadId: string | null;
  question: string;
  facts: string;
  pronoun: 'Anh' | 'Chị' | 'Bạn';
  context: Record<string, unknown>;
  /** T3: ảnh (base64 đã thu nhỏ) + bảng tính đã đọc trên máy — chỉ gửi ở lượt này. */
  images?: Array<{ mime: string; b64: string }>;
  files?: Array<{ name: string; text: string }>;
}
export interface ChatHandlers {
  onStart?: (info: { runId: string; model: string }) => void; onDelta: (text: string) => void; onTool?: (tool: ChatToolUse) => void;
  onCommand?: (command: AssistantCommand) => void;
  onChart?: (chart: ChartSource) => void;
}
export type ChatSendResult =
  | { code: 'OK'; runId: string; threadId: string | null; messageId: string | null; answer: string; sources: ChatSource[]; model: string; saved: boolean }
  | { code: AiGatewayErrorCode; runId?: string; error?: string; reason?: AiQuotaReason; usedToday?: number; dailyLimit?: number; partial?: string };

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Nguồn từ máy chủ (đã lưu hoặc vừa trả): bỏ mục hỏng. */
export const parseSources = (raw: unknown): ChatSource[] => (Array.isArray(raw) ? raw : []).flatMap((s): ChatSource[] => {
  if (typeof s === 'string') return s ? [s] : [];
  const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
  const ref = str(o.ref);
  if (o.type === 'record') {
    const record = parseSearchResponse({ records: [o.record] }).records[0];
    return record ? [{ ref, type: 'record', record }] : [];
  }
  if (o.type === 'work') {
    const item = parseWorkItem(o.item);
    return item ? [{ ref, type: 'work', item }] : [];
  }
  if (o.type === 'chart') {
    const chart = parseChart(o.chart);
    return chart ? [{ ref, type: 'chart', chart }] : [];
  }
  return [];
});

export const parseMessage = (raw: unknown): ChatMessage | null => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if ((o.role !== 'user' && o.role !== 'assistant') || !str(o.content)) return null;
  return {
    id: str(o.id) || `${o.role}-${str(o.createdAt)}`, role: o.role, content: str(o.content), sources: parseSources(o.sources),
    runId: str(o.runId) || null, accepted: typeof o.accepted === 'boolean' ? o.accepted : null, createdAt: str(o.createdAt),
    commands: parseCommands(o.commands),
  };
};
const parseSummary = (raw: unknown): ChatThreadSummary => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { id: str(o.id), title: str(o.title) || 'Hội thoại', messageCount: Number(o.messageCount) || 0, lastMessageAt: str(o.lastMessageAt) };
};

/** Tách sự kiện SSE ("data: {json}\n\n") khỏi phần đệm; dòng ": ping" bỏ qua. Phần chưa trọn sự kiện trả lại trong `rest`. */
export const takeSseEvents = (buffer: string): { events: Array<Record<string, unknown>>; rest: string } => {
  const text = buffer.replace(/\r\n?/g, '\n');
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events = blocks.flatMap(block => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return [];
    try { const parsed = JSON.parse(data); return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : []; } catch { return []; }
  });
  return { events, rest };
};

/** Chữ hiện cho người dùng: bỏ khóa [[…]] (đã thành nút), kể cả khóa đang gõ dở ở cuối khi chữ còn chạy. */
export const displayText = (text: string) => text
  .replace(/\s?\[\[[^[\]\n]{0,120}\]\]/g, '')
  .replace(/\s?\[\[[^[\]\n]{0,120}$/, '')
  .replace(/\s?\[$/, '')
  .replace(/[ \t]+([.,;:!?])/g, '$1');

/** Gợi ý bấm (chủ SP 18/10): AI hỏi lại kèm nhãn [[goi_y:…]] → nút; bấm là gửi đúng câu đó, không phải gõ lại. Tối đa 6, bỏ trùng. */
export const suggestionsOf = (text: string): string[] => {
  const out: string[] = [];
  for (const m of text.matchAll(/\[\[goi_y:([^[\]\n]{1,116})\]\]/g)) {
    const option = m[1].trim().slice(0, 60);
    if (option && !out.some(o => o.toLowerCase() === option.toLowerCase())) out.push(option);
  }
  return out.slice(0, 6);
};

export type TextBlock = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };
/** Markdown tối giản AI được dùng: đoạn, gạch đầu dòng "- " / "• ", danh sách "1. ". Chữ đậm xử lý ở boldParts. */
export const textBlocks = (text: string): TextBlock[] => {
  const blocks: TextBlock[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { blocks.push({ kind: 'p', text: '' }); continue; }
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const kind = bullet ? 'ul' : numbered ? 'ol' : null;
    const last = blocks.at(-1);
    if (kind) {
      const item = (bullet || numbered)![1];
      if (last && last.kind === kind) last.items.push(item); else blocks.push({ kind, items: [item] });
    } else if (last && last.kind === 'p' && last.text) last.text += `\n${line}`;
    else blocks.push({ kind: 'p', text: line });
  }
  return blocks.filter(b => b.kind !== 'p' || b.text);
};
export const boldParts = (text: string): Array<{ text: string; bold: boolean }> =>
  text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part => (/^\*\*[^*]+\*\*$/.test(part) ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));

const errorCode = (code: unknown): AiGatewayErrorCode =>
  (['AI_NOT_CONFIGURED', 'AI_DENIED', 'AI_OFF', 'AI_SKILL_OFF', 'AI_SKILL_UNKNOWN', 'AI_QUOTA', 'AI_REFUSED', 'AI_FAILED'] as const)
    .find(c => c === code) || 'AI_FAILED';

export const assistantChat = {
  async listThreads(limit = 30): Promise<ChatThreadSummary[]> {
    const { data, error } = await supabase.rpc('list_ai_threads_v1', { p_limit: limit });
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(parseSummary).filter(t => t.id);
  },

  async getThread(id: string): Promise<ChatThread> {
    const { data, error } = await supabase.rpc('get_ai_thread_v1', { p_thread_id: id, p_limit: 200 });
    if (error) throw error;
    const o = (data || {}) as Record<string, unknown>;
    return { ...parseSummary(o), messages: (Array.isArray(o.messages) ? o.messages : []).map(parseMessage).filter((m): m is ChatMessage => Boolean(m)) };
  },

  /** Gửi một câu hỏi; chữ trả lời đổ dần qua onDelta. signal: người dùng bấm Dừng (máy chủ vẫn ghi lượt khi xong). */
  async send(input: ChatSendInput, handlers: ChatHandlers, signal?: AbortSignal): Promise<ChatSendResult> {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return { code: 'AI_DENIED', error: 'NO_SESSION' };
    let res: Response;
    try {
      res = await fetch(`${supabaseUrl}/functions/v1/ai-gateway`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
        body: JSON.stringify({ skill: CHAT_SKILL, input: { threadId: input.threadId, question: input.question, facts: input.facts, pronoun: input.pronoun, ...(input.images?.length ? { images: input.images } : {}), ...(input.files?.length ? { files: input.files } : {}) }, context: input.context }),
      });
    } catch (e) {
      return { code: 'AI_FAILED', error: signal?.aborted ? 'AI_ABORTED' : e instanceof Error ? e.message : 'AI_FAILED' };
    }
    if (res.status === 404) return { code: 'AI_NOT_CONFIGURED', error: 'AI_NOT_DEPLOYED' };
    if (res.status === 401 || res.status === 403) return { code: 'AI_DENIED', error: `HTTP_${res.status}` };
    if (!(res.headers.get('content-type') || '').includes('event-stream') || !res.body) {
      // Lỗi trước khi bắt đầu (chưa có khóa, hết lượt, không quyền…) trả JSON như skill thường.
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      return { code: errorCode(body.code), runId: str(body.runId) || undefined, error: str(body.error) || undefined,
        reason: AI_QUOTA_REASONS.find(r => r === body.reason),
        usedToday: typeof body.usedToday === 'number' ? body.usedToday : undefined, dailyLimit: typeof body.dailyLimit === 'number' ? body.dailyLimit : undefined };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ''; let runId = ''; let partial = '';
    let result: ChatSendResult | null = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const taken = takeSseEvents(buffer + decoder.decode(value, { stream: true }));
        buffer = taken.rest;
        for (const event of taken.events) {
          if (event.type === 'start') { runId = str(event.runId); handlers.onStart?.({ runId, model: str(event.model) }); }
          else if (event.type === 'delta') { const d = str(event.text); partial += d; handlers.onDelta(d); }
          else if (event.type === 'tool') handlers.onTool?.({ name: str(event.name), label: str(event.label) || str(event.name), query: str(event.query) });
          else if (event.type === 'command') { const command = parseCommand(event.command); if (command) handlers.onCommand?.(command); }
          else if (event.type === 'chart') { const chart = parseSources([event.chart]).find(isChartSource); if (chart) handlers.onChart?.(chart); }
          else if (event.type === 'done') {
            result = { code: 'OK', runId, threadId: str(event.threadId) || null, messageId: str(event.messageId) || null, answer: str(event.answer) || partial,
              sources: parseSources(event.sources), model: str(event.model), saved: event.saved !== false };
          } else if (event.type === 'error') result = { code: errorCode(event.code), runId, error: str(event.error) || undefined, partial };
        }
      }
    } catch (e) {
      return { code: 'AI_FAILED', runId, error: signal?.aborted ? 'AI_ABORTED' : e instanceof Error ? e.message : 'AI_FAILED', partial };
    }
    return result || { code: 'AI_FAILED', runId, error: 'AI_STREAM_CUT', partial };
  },
};

const pad = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** Mốc hội thoại trong Lịch sử: hôm nay "09:41", hôm qua "Hôm qua", còn lại "12/10". */
export const threadTimeLabel = (iso: string, now: Date) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  if (sameDay(at, now)) return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(at, yesterday)) return 'Hôm qua';
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}`;
};
/** Hội thoại có tin cuối trong hôm nay → mở lại khi vào tab Trợ lý (hỏi tiếp được sau khi tải lại trang). */
export const isTodayThread = (thread: Pick<ChatThreadSummary, 'lastMessageAt'>, now: Date) => {
  const at = new Date(thread.lastMessageAt);
  return !Number.isNaN(at.getTime()) && sameDay(at, now);
};
/** Ngày của hội thoại cũ: "12/10". */
export const threadDayLabel = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : `${pad(at.getDate())}/${pad(at.getMonth() + 1)}`;
};
