// Trợ lý v2 · T1 (chủ SP 18/10/2026): vòng gọi công cụ đọc — AI tự tra hồ sơ, tồn kho, đơn mua… bằng phiên người hỏi.
//   * Tin nhắn trung lập (AgentMsg) → định dạng từng nhà cung cấp (chuẩn OpenAI / Anthropic). Gemini chưa nối công cụ.
//   * Mỗi hồ sơ công cụ trả về được đánh mã ngắn h1, h2… AI dẫn [[h2]] ngay sau ý; cổng chỉ giữ mã có thật → nút mở hồ sơ.
// Tệp này không dùng API Deno để vitest kiểm thử được.
import type { ImagePart } from './images.ts';

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export type AgentMsg =
  /** images (T3): ảnh người dùng đính kèm lượt hỏi này — chỉ gửi ở lượt vừa hỏi, không lưu, không gửi lại ở lượt sau. */
  | { role: 'user'; content: string; images?: ImagePart[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; results: Array<{ id: string; name: string; content: string }> };

export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }

/** Nguồn mở được: hồ sơ của Tìm kiếm toàn cục (màn hình tự biết mở màn nào) hoặc một việc của Việc của tôi. */
export type SourceRef =
  | { ref: string; type: 'record'; record: Record<string, unknown> }
  | { ref: string; type: 'work'; item: Record<string, unknown> }
  /** B3 (22/10): màn hình / thao tác từ sổ tay — client vẽ nút mở đường dẫn. */
  | { ref: string; type: 'page'; page: { route: string; label: string; title?: string } }
  /** Thẻ biểu đồ công cụ dựng từ số máy chủ (lib/assistantChart.ts đọc lại) — luôn đi kèm câu trả lời, không cần AI dẫn. */
  | { ref: string; type: 'chart'; chart: Record<string, unknown> };

export const MAX_AGENT_STEPS = 5;
export const MAX_TOOL_CALLS = 8;

const asObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {});

/** Tham số công cụ do model gửi (chuỗi JSON, có khi rỗng / hỏng) → object; hỏng thì {}. */
export const parseToolArgs = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object') return asObject(raw);
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { return asObject(JSON.parse(raw)); } catch { return {}; }
};

/** Ghép các mảnh tool_calls của luồng chuẩn OpenAI (theo index: id, tên, tham số từng đoạn). */
export const accumulateToolDeltas = (acc: Array<{ id: string; name: string; args: string }>, deltas: unknown) => {
  for (const d of Array.isArray(deltas) ? deltas : []) {
    const o = asObject(d);
    const index = typeof o.index === 'number' ? o.index : acc.length;
    const fn = asObject(o.function);
    const slot = acc[index] || (acc[index] = { id: '', name: '', args: '' });
    if (typeof o.id === 'string' && o.id) slot.id = o.id;
    if (typeof fn.name === 'string' && fn.name) slot.name = fn.name;
    if (typeof fn.arguments === 'string') slot.args += fn.arguments;
  }
  return acc;
};

export const finishToolCalls = (acc: Array<{ id: string; name: string; args: string }>): ToolCall[] =>
  acc.filter(Boolean).filter(c => c.name).map((c, i) => ({ id: c.id || `call_${i + 1}`, name: c.name, args: parseToolArgs(c.args) }));

export const openAITools = (tools: ToolSpec[]) => tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
export const anthropicTools = (tools: ToolSpec[]) => tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));

type OpenAIMessage = Record<string, unknown>;
export const toOpenAIMessages = (system: string, msgs: AgentMsg[]): OpenAIMessage[] => [
  { role: 'system', content: system },
  ...msgs.flatMap((m): OpenAIMessage[] => {
    if (m.role === 'tool') return m.results.map(r => ({ role: 'tool', tool_call_id: r.id, content: r.content }));
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return [{ role: 'assistant', content: m.content || null,
        tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }];
    }
    if (m.role === 'user' && m.images?.length) {
      return [{ role: 'user', content: [...m.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } })), { type: 'text', text: m.content }] }];
    }
    return [{ role: m.role, content: m.content }];
  }),
];

export const toAnthropicMessages = (msgs: AgentMsg[]) => msgs.map(m => {
  if (m.role === 'tool') return { role: 'user', content: m.results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return { role: 'assistant', content: [
      ...(m.content ? [{ type: 'text', text: m.content }] : []),
      ...m.toolCalls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
    ] };
  }
  if (m.role === 'user' && m.images?.length) {
    return { role: 'user', content: [...m.images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } })), { type: 'text', text: m.content }] };
  }
  return { role: m.role, content: m.content };
});

/** Sổ nguồn của một lượt hỏi: hồ sơ mới thì cấp mã h1, h2…; hồ sơ đã có thì dùng lại mã cũ. */
export class SourceBook {
  private items: SourceRef[] = [];
  private byKey = new Map<string, string>();
  private charts: SourceRef[] = [];

  record(record: Record<string, unknown>): string {
    const key = `r:${record.kind}:${record.id}`;
    const hit = this.byKey.get(key);
    if (hit) return hit;
    const ref = `h${this.items.length + 1}`;
    this.items.push({ ref, type: 'record', record });
    this.byKey.set(key, ref);
    return ref;
  }

  work(item: Record<string, unknown>): string {
    const key = `w:${item.source}:${item.id}`;
    const hit = this.byKey.get(key);
    if (hit) return hit;
    const ref = `h${this.items.length + 1}`;
    this.items.push({ ref, type: 'work', item });
    this.byKey.set(key, ref);
    return ref;
  }

  /** Màn hình / thao tác (sổ tay): mã hN như hồ sơ; cùng đường dẫn thì dùng lại mã. */
  page(route: string, label: string, title?: string): string {
    const key = `p:${route}`;
    const hit = this.byKey.get(key);
    if (hit) return hit;
    const ref = `h${this.items.length + 1}`;
    this.items.push({ ref, type: 'page', page: { route, label, ...(title ? { title } : {}) } });
    this.byKey.set(key, ref);
    return ref;
  }

  /** Biểu đồ: mã b1, b2… (tối đa 2 mỗi lượt để vừa chỗ lưu hội thoại). */
  chart(chart: Record<string, unknown>): string | null {
    if (this.charts.length >= 2) return null;
    const ref = `b${this.charts.length + 1}`;
    this.charts.push({ ref, type: 'chart', chart });
    return ref;
  }

  get chartSources(): SourceRef[] { return [...this.charts]; }

  get size() { return this.items.length; }

  /** Hồ sơ đã cấp mã hN — kể cả hồ sơ ô tìm ngay gửi kèm câu hỏi (19/10) — để công cụ chi tiết nhận "ma: h2". */
  find(ref: string): SourceRef | undefined { const key = ref.trim().toLowerCase(); return this.items.find(s => s.ref === key); }

  /** Nguồn AI đã dẫn [[hN]] trong câu trả lời, đúng thứ tự xuất hiện, tối đa 8. */
  cited(answer: string): SourceRef[] {
    const out: SourceRef[] = [];
    for (const m of answer.matchAll(/\[\[(h\d{1,3})\]\]/g)) {
      const found = this.items.find(s => s.ref === m[1]);
      if (found && !out.includes(found)) out.push(found);
      if (out.length >= 8) break;
    }
    return out;
  }
}
