// Cổng AI · cổng giả cho từng loại cổng (21/10/2026): luồng SSE chuẩn OpenAI / Anthropic dựng tay, fetch giả — chạy đúng mã
// providers.ts + SDK Anthropic thật, không cần model hay mạng. Mỗi ca là một kiểu cổng gửi suy nghĩ / từ chối tham số đã gặp hoặc
// sẽ gặp khi thêm cổng mới (DeepSeek-R1 / Qwen qua vLLM, OpenRouter, API Anthropic thật, RevidAPI).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentStep, complete, streamChat } from '../../supabase/functions/ai-gateway/providers';
import { converse } from '../../supabase/functions/ai-gateway/loop';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS } from '../../supabase/functions/ai-gateway/tools';
import { THINKING_HEADROOM, type AiTarget } from '../../supabase/functions/_shared/aiTargets';

type Body = Record<string, any>;
const calls: Array<{ url: string; body: Body }> = [];
const gateway = (handler: (body: Body, n: number) => Response) => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Body;
    calls.push({ url: String(url), body });
    return handler(body, calls.length);
  }));
};
afterEach(() => { vi.unstubAllGlobals(); });

const sse = (frames: string[]) => new Response(new ReadableStream({
  start(c) { const enc = new TextEncoder(); for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
}), { headers: { 'content-type': 'text/event-stream' } });
/** Chuẩn OpenAI: mỗi phần tử là một delta; finish cuối luồng. */
const openAISse = (deltas: Array<Record<string, unknown>>, finish = 'stop') => sse([
  ...deltas.map(delta => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`),
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`, 'data: [DONE]\n\n',
]);
type Block = { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
/** Chuẩn Anthropic: chữ cắt mảnh 7 ký tự (thẻ <think> rơi giữa hai mảnh). */
const anthropicSse = (blocks: Block[], stop = 'end_turn') => {
  const ev = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const frames = [ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })];
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      frames.push(ev('content_block_start', { index, content_block: { type: 'text', text: '' } }));
      for (const piece of b.text.match(/[\s\S]{1,7}/g) || []) frames.push(ev('content_block_delta', { index, delta: { type: 'text_delta', text: piece } }));
    } else if (b.type === 'thinking') {
      frames.push(ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } }),
        ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.thinking } }), ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig' } }));
    } else {
      frames.push(ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }),
        ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }));
    }
    frames.push(ev('content_block_stop', { index }));
  });
  frames.push(ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }), ev('message_stop', {}));
  return sse(frames);
};
const anthropicError = (status: number, message: string) => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }), { status, headers: { 'content-type': 'application/json' } });

const openAITarget = (model = 'deepseek-r1'): AiTarget => ({ kind: 'openai_compatible', baseUrl: 'https://cong-gia.test/v1', apiKey: 'k', model, source: 'connection', name: 'Cổng giả' });
let anthropicSeq = 0;
/** Mỗi ca một endpoint riêng: cổng nhớ endpoint + model đã từ chối buộc gọi công cụ. */
const anthropicTarget = (model = 'claude-sonnet-5-5'): AiTarget => ({ kind: 'anthropic', baseUrl: `https://cong-anthropic-${++anthropicSeq}.test`, apiKey: 'k', model, source: 'connection', name: 'Cổng giả' });
const step = (toolChoice: 'auto' | { name: string } = 'auto') => ({ system: 'SYS', messages: [{ role: 'user' as const, content: 'Thép D16 còn bao nhiêu?' }], tools: TOOLS, toolChoice, maxTokens: 1200, noThinking: true });
const run = async (target: AiTarget, req = step()) => { const shown: string[] = []; const out = await agentStep(target, req, d => shown.push(d)); return { out, shown: shown.join('') }; };

describe('Cổng chuẩn OpenAI (DeepSeek-R1, Qwen, OpenRouter, RevidAPI…)', () => {
  it('<think>…</think> trong content (thẻ cắt giữa mảnh) + reasoning_content + reasoning → chỉ hiện câu trả lời', async () => {
    gateway(() => openAISse([{ role: 'assistant' }, { reasoning_content: 'Suy nghĩ riêng kiểu DeepSeek.' }, { reasoning: 'Suy nghĩ riêng kiểu OpenRouter.' },
      { content: '<thi' }, { content: 'nk>The user asks about stock. I should' }, { content: ' answer briefly.</th' }, { content: 'ink>\n\nCòn 12.400 kg' }, { content: ' [[h1]].' }]));
    const { out, shown } = await run(openAITarget());
    expect(out.text).toBe('Còn 12.400 kg [[h1]].');
    expect(shown).toBe(out.text);
    expect(calls[0].body).toMatchObject({ reasoning_effort: 'none', max_tokens: 1200 + THINKING_HEADROOM });
  });

  it('cổng không nhận tham số lạ (400 với reasoning_effort) → gửi lại bản tối giản một lần', async () => {
    gateway((body) => (body.reasoning_effort ? new Response('{"error":"unknown field reasoning_effort"}', { status: 400 }) : openAISse([{ content: 'Còn 12.400 kg.' }])));
    const { out } = await run(openAITarget());
    expect(out.text).toBe('Còn 12.400 kg.');
    expect(calls).toHaveLength(2);
    expect(calls[1].body.reasoning_effort).toBeUndefined();
    expect(calls[1].body.stream_options).toBeUndefined();
  });

  it('cổng bỏ qua stream, trả JSON một lần: lọc <think>, vẫn đọc lệnh gọi công cụ', async () => {
    gateway(() => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: '<think>Cần tra tồn kho trước.</think>',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ton_kho', arguments: '{"vat_tu":"thép D16"}' } }] } }] }), { headers: { 'content-type': 'application/json' } }));
    const { out, shown } = await run(openAITarget());
    expect(out.text).toBe('');
    expect(shown).toBe('');
    expect(out.toolCalls).toEqual([{ id: 'call_1', name: 'ton_kho', args: { vat_tu: 'thép D16' } }]);
  });

  it('chat không công cụ và skill JSON cũng lọc <think>', async () => {
    gateway(() => openAISse([{ content: '<think>chào hỏi</think>Chào anh, ' }, { content: 'em giúp gì ạ?' }]));
    const shown: string[] = [];
    const chat = await streamChat(openAITarget(), { system: 'SYS', messages: [{ role: 'user', content: 'Chào em' }], maxTokens: 300, noThinking: true }, d => shown.push(d));
    expect(chat.text).toBe('Chào anh, em giúp gì ạ?');
    expect(shown.join('')).toBe(chat.text);
    gateway(() => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '<think>Đọc bảng {cột}…</think>\n{"lines":[{"qty":6300}]}' } }] }), { headers: { 'content-type': 'application/json' } }));
    const json = await complete(openAITarget(), { system: 'SYS', user: 'Báo giá', schema: {}, maxTokens: 600 });
    expect(JSON.parse(json.text)).toEqual({ lines: [{ qty: 6300 }] });
  });

  it('cả vòng Trợ lý qua cổng giả: ghi chú trước khi tra + <think> ở câu trả lời → người dùng chỉ thấy câu trả lời', async () => {
    gateway((_body, n) => (n === 1
      ? openAISse([{ content: 'Let me check ton_kho first.\n\n' }, { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'ton_kho', arguments: '{"vat_tu":"thép D16"}' } }] }], 'tool_calls')
      : openAISse([{ content: '<think>Kho SMB có 12,4 tấn.</think>' }, { content: '\n\nCòn 12,4 tấn ở Kho SMB [[h1]].' }])));
    const events: Array<Record<string, unknown>> = [];
    const rpc = async (fn: string) => ({ data: fn === 'search_global_v1' ? { records: [{ kind: 'item', id: 'it-1', code: 'THEP-D16', title: 'Thép CB400 D16', extra: { unit: 'tấn' } }] }
      : fn === 'ai_stock_by_items_v1' ? [{ itemId: 'it-1', warehouseName: 'Kho SMB', qty: 12.4, unit: 'tấn' }] : null, error: null });
    const out = await converse({ step: (req, onDelta) => agentStep(openAITarget(), req, onDelta), rpc, emit: e => events.push(e), redact: t => t,
      system: 'SYS', turns: [{ role: 'user', content: 'Thép D16?' }], book: new SourceBook(), used: [], started: 0, now: () => 0 });
    expect(out.text).toBe('Còn 12,4 tấn ở Kho SMB [[h1]].');
    expect(events.filter(e => e.type === 'delta').map(e => e.text).join('')).toBe(out.text);
    expect(events.some(e => e.type === 'tool' && e.name === 'ton_kho')).toBe(true);
  });
});

describe('Cổng chuẩn Anthropic (API Anthropic, RevidAPI /v1/messages…)', () => {
  it('khối thinking + thẻ <thinking> lọt trong chữ → chỉ hiện câu trả lời; max_tokens chừa phần suy nghĩ (Claude đời 5 tự suy nghĩ)', async () => {
    gateway(() => anthropicSse([{ type: 'thinking', thinking: 'The user wants stock. Let me answer.' }, { type: 'text', text: '<thinking>kiểm lại số</thinking>Còn 12.400 kg [[h1]].' }]));
    const { out, shown } = await run(anthropicTarget());
    expect(out.text).toBe('Còn 12.400 kg [[h1]].');
    expect(shown).toBe(out.text);
    expect(calls[0].url).toMatch(/\/v1\/messages$/);
    expect(calls[0].body).toMatchObject({ max_tokens: 1200 + THINKING_HEADROOM, tool_choice: { type: 'auto' } });
  });

  it('model từ chối buộc gọi công cụ (400 như Sonnet 5.5 / Opus 5.5) → gửi lại auto + dặn trong lời nhắc; lần sau gửi auto luôn', async () => {
    gateway(body => (body.tool_choice?.type === 'tool'
      ? anthropicError(400, 'tool_choice: type "tool" and "any" are not supported for this model.')
      : anthropicSse([{ type: 'tool_use', id: 'toolu_1', name: 'chuan_bi_nhat_ky', input: { ngay_bao_cao: '2026-10-15' } }], 'tool_use')));
    const target = anthropicTarget();
    const { out, shown } = await run(target, step({ name: 'chuan_bi_nhat_ky' }));
    expect(out.toolCalls).toEqual([{ id: 'toolu_1', name: 'chuan_bi_nhat_ky', args: { ngay_bao_cao: '2026-10-15' } }]);
    expect(shown).toBe('');
    expect(calls.map(c => c.body.tool_choice)).toEqual([{ type: 'tool', name: 'chuan_bi_nhat_ky' }, { type: 'auto' }]);
    expect(calls[0].body.system).toBe('SYS');
    expect(calls[1].body.system).toContain('gọi ngay công cụ chuan_bi_nhat_ky');
    await run(target, step({ name: 'chuan_bi_nhat_ky' }));
    expect(calls.slice(2).map(c => c.body.tool_choice)).toEqual([{ type: 'auto' }]);
  });

  it('cổng nhận buộc gọi công cụ (RevidAPI, model cũ) → giữ tool_choice tool; lỗi 400 khác thì báo lỗi, không gửi lại', async () => {
    gateway(() => anthropicSse([{ type: 'tool_use', id: 'toolu_2', name: 'chuan_bi_nhat_ky', input: {} }], 'tool_use'));
    const { out } = await run(anthropicTarget('claude-haiku-4-5'), step({ name: 'chuan_bi_nhat_ky' }));
    expect(out.toolCalls.map(c => c.name)).toEqual(['chuan_bi_nhat_ky']);
    expect(calls.map(c => c.body.tool_choice)).toEqual([{ type: 'tool', name: 'chuan_bi_nhat_ky' }]);
    gateway(() => anthropicError(400, 'messages: text content blocks must be non-empty'));
    await expect(run(anthropicTarget(), step({ name: 'chuan_bi_nhat_ky' }))).rejects.toThrow(/non-empty/);
    expect(calls).toHaveLength(1);
  });
});
