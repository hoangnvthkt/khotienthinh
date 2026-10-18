// Cổng AI — gọi model theo nhà cung cấp chọn bằng biến môi trường (chủ SP 12/10: không cố định một hãng).
//   AI_PROVIDER = anthropic | gemini | openai   (mặc định anthropic; chưa đặt thì dùng WMS_AI_PROVIDER nếu có)
//   AI_MODEL_FAST / AI_MODEL_REASONING = model theo lớp skill (openai bắt buộc khai báo)
//   ANTHROPIC_API_KEY | GEMINI_API_KEY | OPENAI_API_KEY (dùng chung với wms-doc-reader)
//   AI_PRICE_IN_PER_M / AI_PRICE_OUT_PER_M = USD mỗi triệu token (không đặt → chi phí ghi "chưa rõ")
//   Kết nối Admin thêm ở Cài đặt → Kết nối (khóa trong Vault) được ưu tiên; chưa gán thì dùng các biến trên (index.ts chọn đích).
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_BASE_URL, KIND_LABEL, emptyReplyError, outputTokenCap, runCostUsd, type AiPrice, type AiTarget, type ModelClass } from '../_shared/aiTargets.ts';

export type Provider = 'anthropic' | 'gemini' | 'openai';
export type { ModelClass };
/** calls = số lượt gọi model trong lượt AI (vòng gọi công cụ nhiều bước); không ghi = 1. */
export interface Usage { tokensIn: number | null; tokensOut: number | null; calls?: number }
export interface Completion { text: string; usage: Usage }
import type { ImagePart } from './images.ts';
import { readSse } from './chat.ts';
import { accumulateToolDeltas, anthropicTools, finishToolCalls, openAITools, parseToolArgs, toAnthropicMessages, toOpenAIMessages, type AgentMsg, type ToolCall, type ToolSpec } from './agent.ts';
export type { ImagePart };
export interface CompletionRequest {
  system: string; user: string; schema: Record<string, unknown>; maxTokens: number; images?: ImagePart[];
  /** Skill chép lại chứng từ, không cần suy luận: cổng chuẩn OpenAI gửi reasoning_effort "none" (báo giá 41–61 s → 11 s, 17/10/2026). */
  noThinking?: boolean;
}
/** Ảnh hoặc đầu ra dài (báo giá nhiều dòng, nhật ký nhiều ngày 40–60 s) — chờ tới 100 s; còn lại 55 s. Hàm Edge còn dư thời gian trước mốc cắt. */
const timeoutMs = (req: CompletionRequest) => (req.images?.length || req.maxTokens >= 6000 ? 100_000 : 55_000);

const DEFAULT_MODELS: Record<Provider, Record<ModelClass, string>> = {
  anthropic: { fast: 'claude-haiku-5-5', reasoning: 'claude-opus-5-5' },
  gemini: { fast: 'gemini-2.5-flash', reasoning: 'gemini-2.5-pro' },
  openai: { fast: '', reasoning: '' },
};

export interface GatewayConfig {
  provider: Provider;
  providerSource: 'AI_PROVIDER' | 'WMS_AI_PROVIDER' | 'default';
  key: string | undefined;
  models: Record<ModelClass, string>;
  /** Khóa nào đang có trong secrets (chỉ tên, không giá trị). */
  keysPresent: Record<Provider, boolean>;
  price: { inPerM: number | null; outPerM: number | null };
}

const num = (value: string | undefined) => { const n = Number(value); return value && Number.isFinite(n) && n >= 0 ? n : null; };

export const readConfig = (env: (name: string) => string | undefined): GatewayConfig => {
  const explicit = env('AI_PROVIDER'); const legacy = env('WMS_AI_PROVIDER');
  const raw = (explicit || legacy || 'anthropic').toLowerCase();
  const provider: Provider = raw === 'gemini' || raw === 'openai' ? raw : 'anthropic';
  const keysPresent = {
    anthropic: Boolean(env('ANTHROPIC_API_KEY')),
    gemini: Boolean(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY')),
    openai: Boolean(env('OPENAI_API_KEY')),
  };
  const key = provider === 'anthropic' ? env('ANTHROPIC_API_KEY') : provider === 'gemini' ? (env('GEMINI_API_KEY') || env('GOOGLE_API_KEY')) : env('OPENAI_API_KEY');
  return {
    provider, providerSource: explicit ? 'AI_PROVIDER' : legacy ? 'WMS_AI_PROVIDER' : 'default', key, keysPresent,
    models: { fast: env('AI_MODEL_FAST') || DEFAULT_MODELS[provider].fast, reasoning: env('AI_MODEL_REASONING') || DEFAULT_MODELS[provider].reasoning },
    price: { inPerM: num(env('AI_PRICE_IN_PER_M')), outPerM: num(env('AI_PRICE_OUT_PER_M')) },
  };
};

export const costUsd = (usage: Usage, price: AiPrice | null | undefined) => runCostUsd(usage, price, usage.calls ?? 1);

/** Đích từ Secrets (chưa gán kết nối). */
export const envTarget = (config: GatewayConfig, modelClass: ModelClass): AiTarget | null => config.key
  ? { kind: config.provider, baseUrl: DEFAULT_BASE_URL[config.provider], apiKey: config.key, model: config.models[modelClass], source: 'secrets', name: `${KIND_LABEL[config.provider]} (Secrets)` }
  : null;

async function withAnthropic(t: AiTarget, req: CompletionRequest): Promise<Completion> {
  const client = new Anthropic({ apiKey: t.apiKey, baseURL: t.baseUrl });
  const response = await client.messages.create({
    model: t.model, max_tokens: req.maxTokens, system: req.system,
    messages: [{ role: 'user', content: req.images?.length
      ? [...req.images.map(i => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mime, data: i.b64 } })), { type: 'text' as const, text: req.user }]
      : req.user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI_REFUSED');
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('AI_EMPTY');
  return { text, usage: { tokensIn: response.usage?.input_tokens ?? null, tokensOut: response.usage?.output_tokens ?? null } };
}

async function withGemini(t: AiTarget, req: CompletionRequest): Promise<Completion> {
  const res = await fetch(`${t.baseUrl}/v1beta/models/${encodeURIComponent(t.model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': t.apiKey }, signal: AbortSignal.timeout(timeoutMs(req)),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [...(req.images || []).map(i => ({ inline_data: { mime_type: i.mime, data: i.b64 } })), { text: req.user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: outputTokenCap(t.kind, req.maxTokens), responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`AI_HTTP_${res.status}`);
  const data = await res.json();
  if (data?.promptFeedback?.blockReason) throw new Error('AI_REFUSED');
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
  if (!text) throw new Error(emptyReplyError(data?.candidates?.[0]?.finishReason));
  return { text, usage: { tokensIn: data?.usageMetadata?.promptTokenCount ?? null, tokensOut: data?.usageMetadata?.candidatesTokenCount ?? null } };
}

async function withOpenAI(t: AiTarget, req: CompletionRequest): Promise<Completion> {
  if (!t.model) throw new Error('AI_MODEL_REQUIRED');
  // Cổng chuẩn OpenAI khác (9Router, OpenRouter…) thường chưa hỗ trợ json_schema strict / max_completion_tokens: dùng json_object + max_tokens.
  const compatible = t.kind === 'openai_compatible';
  const send = (noThinking: boolean) => fetch(`${t.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` }, signal: AbortSignal.timeout(timeoutMs(req)),
    body: JSON.stringify({
      model: t.model, ...(noThinking ? { reasoning_effort: 'none' } : {}), ...(compatible ? { max_tokens: outputTokenCap(t.kind, req.maxTokens) } : { max_completion_tokens: outputTokenCap(t.kind, req.maxTokens) }),
      response_format: compatible ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'skill_output', schema: req.schema, strict: true } },
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.images?.length
        ? [...req.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } })), { type: 'text', text: req.user }]
        : req.user }],
    }),
  });
  const thinkingOff = compatible && Boolean(req.noThinking);
  let res = await send(thinkingOff);
  // Cổng không nhận reasoning_effort → gửi lại một lần như thường.
  if (thinkingOff && res.status === 400) res = await send(false);
  if (!res.ok) throw new Error(`AI_HTTP_${res.status}`);
  const data = await res.json();
  if (data?.choices?.[0]?.finish_reason === 'content_filter') throw new Error('AI_REFUSED');
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(emptyReplyError(data?.choices?.[0]?.finish_reason));
  return { text, usage: { tokensIn: data?.usage?.prompt_tokens ?? null, tokensOut: data?.usage?.completion_tokens ?? null } };
}

export const complete = (target: AiTarget, req: CompletionRequest): Promise<Completion> =>
  target.kind === 'typesafe' ? Promise.reject(new Error('AI_KIND_UNSUPPORTED')) : target.kind === 'anthropic' ? withAnthropic(target, req) : target.kind === 'gemini' ? withGemini(target, req) : withOpenAI(target, req);

// ── Trợ lý · hội thoại (T0): trả lời chạy dần. Chữ thường (không JSON), nhiều lượt. ─────────────────────────────────────────────
export interface ChatRequest { system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens: number; noThinking?: boolean }
/** Cả lượt (kể cả chờ model suy nghĩ) tối đa 110 s; cổng gửi nhịp giữ kết nối nên không chạm mốc 150 s không trả byte của Supabase. */
const CHAT_TIMEOUT_MS = 110_000;

async function streamAnthropic(t: AiTarget, req: ChatRequest, onDelta: (text: string) => void): Promise<Completion> {
  const client = new Anthropic({ apiKey: t.apiKey, baseURL: t.baseUrl });
  const stream = client.messages.stream(
    { model: t.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages },
    { signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) },
  );
  let text = '';
  stream.on('text', delta => { text += delta; onDelta(delta); });
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') throw new Error('AI_REFUSED');
  if (!text) throw new Error(emptyReplyError(final.stop_reason));
  return { text, usage: { tokensIn: final.usage?.input_tokens ?? null, tokensOut: final.usage?.output_tokens ?? null } };
}

async function streamGemini(t: AiTarget, req: ChatRequest, onDelta: (text: string) => void): Promise<Completion> {
  const res = await fetch(`${t.baseUrl}/v1beta/models/${encodeURIComponent(t.model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': t.apiKey }, signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.3, maxOutputTokens: outputTokenCap(t.kind, req.maxTokens) },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`AI_HTTP_${res.status}`);
  let text = ''; let finish: unknown = null; let blocked = false; let usage: Usage = { tokensIn: null, tokensOut: null };
  await readSse(res.body, data => {
    let j: Record<string, any>;
    try { j = JSON.parse(data); } catch { return; }
    if (j?.promptFeedback?.blockReason) blocked = true;
    const candidate = j?.candidates?.[0];
    const delta = (candidate?.content?.parts || []).map((p: { text?: string; thought?: boolean }) => (p.thought ? '' : p.text || '')).join('');
    if (delta) { text += delta; onDelta(delta); }
    if (candidate?.finishReason) finish = candidate.finishReason;
    if (j?.usageMetadata) usage = { tokensIn: j.usageMetadata.promptTokenCount ?? null, tokensOut: j.usageMetadata.candidatesTokenCount ?? null };
  });
  if (blocked || finish === 'SAFETY') throw new Error('AI_REFUSED');
  if (!text) throw new Error(emptyReplyError(finish === 'MAX_TOKENS' ? 'length' : finish));
  return { text, usage };
}

async function streamOpenAI(t: AiTarget, req: ChatRequest, onDelta: (text: string) => void): Promise<Completion> {
  if (!t.model) throw new Error('AI_MODEL_REQUIRED');
  const compatible = t.kind === 'openai_compatible';
  const cap = outputTokenCap(t.kind, req.maxTokens);
  // Lần đầu xin cả số token và tắt suy nghĩ; cổng không nhận tham số lạ (400) thì gửi lại bản tối giản.
  const send = (extras: boolean) => fetch(`${t.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` }, signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    body: JSON.stringify({
      model: t.model, stream: true, messages: [{ role: 'system', content: req.system }, ...req.messages],
      ...(compatible ? { max_tokens: cap } : { max_completion_tokens: cap }),
      ...(extras ? { stream_options: { include_usage: true }, ...(compatible && req.noThinking ? { reasoning_effort: 'none' } : {}) } : {}),
    }),
  });
  let res = await send(true);
  if (res.status === 400) res = await send(false);
  if (!res.ok || !res.body) throw new Error(`AI_HTTP_${res.status}`);
  // Cổng bỏ qua stream → trả nguyên câu một lần.
  if (!(res.headers.get('content-type') || '').includes('event-stream')) {
    const data = await res.json();
    if (data?.choices?.[0]?.finish_reason === 'content_filter') throw new Error('AI_REFUSED');
    const whole = data?.choices?.[0]?.message?.content;
    if (!whole) throw new Error(emptyReplyError(data?.choices?.[0]?.finish_reason));
    onDelta(whole);
    return { text: whole, usage: { tokensIn: data?.usage?.prompt_tokens ?? null, tokensOut: data?.usage?.completion_tokens ?? null } };
  }
  let text = ''; let finish: unknown = null; let usage: Usage = { tokensIn: null, tokensOut: null };
  await readSse(res.body, data => {
    if (data === '[DONE]') return;
    let j: Record<string, any>;
    try { j = JSON.parse(data); } catch { return; }
    const choice = j?.choices?.[0];
    // Model suy nghĩ (deepseek…) gửi reasoning_content trước — không hiện cho người dùng.
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) { text += delta; onDelta(delta); }
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (j?.usage) usage = { tokensIn: j.usage.prompt_tokens ?? null, tokensOut: j.usage.completion_tokens ?? null };
  });
  if (finish === 'content_filter') throw new Error('AI_REFUSED');
  if (!text) throw new Error(emptyReplyError(finish));
  return { text, usage };
}

export const streamChat = (target: AiTarget, req: ChatRequest, onDelta: (text: string) => void): Promise<Completion> =>
  target.kind === 'typesafe' ? Promise.reject(new Error('AI_KIND_UNSUPPORTED')) : target.kind === 'anthropic' ? streamAnthropic(target, req, onDelta) : target.kind === 'gemini' ? streamGemini(target, req, onDelta) : streamOpenAI(target, req, onDelta);

// ── Trợ lý T1: một bước của vòng gọi công cụ (chữ chạy dần + lệnh gọi công cụ). Chuẩn OpenAI (RevidAPI…) và Anthropic. ─────────────
/** toolChoice { name }: buộc gọi đúng công cụ đó ở bước này (VD tin dán là báo cáo thi công → chuan_bi_nhat_ky). */
export type ToolChoice = 'auto' | 'none' | { name: string };
export interface AgentStepRequest { system: string; messages: AgentMsg[]; tools: ToolSpec[]; toolChoice?: ToolChoice; maxTokens: number; noThinking?: boolean }
const openAIToolChoice = (c: ToolChoice | undefined) => (typeof c === 'object' ? { type: 'function', function: { name: c.name } } : c || 'auto');
const anthropicToolChoice = (c: ToolChoice | undefined) => (typeof c === 'object' ? { type: 'tool', name: c.name } : { type: c || 'auto' });
export interface AgentStep { text: string; toolCalls: ToolCall[]; usage: Usage }
/** Nhà cung cấp nối được công cụ; Gemini chưa nối (Trợ lý trả lời từ số liệu bản tin như T0). */
export const supportsTools = (target: AiTarget) => target.kind !== 'gemini' && target.kind !== 'typesafe';

async function agentStepOpenAI(t: AiTarget, req: AgentStepRequest, onDelta: (text: string) => void): Promise<AgentStep> {
  if (!t.model) throw new Error('AI_MODEL_REQUIRED');
  const compatible = t.kind === 'openai_compatible';
  const cap = outputTokenCap(t.kind, req.maxTokens);
  const body = (extras: boolean) => JSON.stringify({
    model: t.model, stream: true, messages: toOpenAIMessages(req.system, req.messages),
    ...(req.tools.length ? { tools: openAITools(req.tools), tool_choice: openAIToolChoice(req.toolChoice) } : {}),
    ...(compatible ? { max_tokens: cap } : { max_completion_tokens: cap }),
    ...(extras ? { stream_options: { include_usage: true }, ...(compatible && req.noThinking ? { reasoning_effort: 'none' } : {}) } : {}),
  });
  const send = (extras: boolean) => fetch(`${t.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` }, signal: AbortSignal.timeout(CHAT_TIMEOUT_MS), body: body(extras),
  });
  let res = await send(true);
  if (res.status === 400) res = await send(false);
  if (!res.ok || !res.body) throw new Error(`AI_HTTP_${res.status}`);
  if (!(res.headers.get('content-type') || '').includes('event-stream')) {
    const data = await res.json();
    const msg = data?.choices?.[0]?.message || {};
    if (data?.choices?.[0]?.finish_reason === 'content_filter') throw new Error('AI_REFUSED');
    const calls = finishToolCalls(accumulateToolDeltas([], (msg.tool_calls || []).map((c: Record<string, unknown>, index: number) => ({ ...c, index }))));
    const whole = typeof msg.content === 'string' ? msg.content : '';
    if (whole) onDelta(whole);
    if (!whole && !calls.length) throw new Error(emptyReplyError(data?.choices?.[0]?.finish_reason));
    return { text: whole, toolCalls: calls, usage: { tokensIn: data?.usage?.prompt_tokens ?? null, tokensOut: data?.usage?.completion_tokens ?? null } };
  }
  let text = ''; let finish: unknown = null; let usage: Usage = { tokensIn: null, tokensOut: null };
  const acc: Array<{ id: string; name: string; args: string }> = [];
  await readSse(res.body, data => {
    if (data === '[DONE]') return;
    let j: Record<string, any>;
    try { j = JSON.parse(data); } catch { return; }
    const choice = j?.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) { text += delta; onDelta(delta); }
    if (choice?.delta?.tool_calls) accumulateToolDeltas(acc, choice.delta.tool_calls);
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (j?.usage) usage = { tokensIn: j.usage.prompt_tokens ?? null, tokensOut: j.usage.completion_tokens ?? null };
  });
  if (finish === 'content_filter') throw new Error('AI_REFUSED');
  const toolCalls = finishToolCalls(acc);
  if (!text && !toolCalls.length) throw new Error(emptyReplyError(finish));
  return { text, toolCalls, usage };
}

async function agentStepAnthropic(t: AiTarget, req: AgentStepRequest, onDelta: (text: string) => void): Promise<AgentStep> {
  const client = new Anthropic({ apiKey: t.apiKey, baseURL: t.baseUrl });
  const stream = client.messages.stream({
    model: t.model, max_tokens: req.maxTokens, system: req.system,
    messages: toAnthropicMessages(req.messages) as Anthropic.MessageParam[],
    ...(req.tools.length ? { tools: anthropicTools(req.tools) as Anthropic.Tool[], tool_choice: anthropicToolChoice(req.toolChoice) as Anthropic.ToolChoice } : {}),
  }, { signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) });
  let text = '';
  stream.on('text', delta => { text += delta; onDelta(delta); });
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') throw new Error('AI_REFUSED');
  const toolCalls: ToolCall[] = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map(b => ({ id: b.id, name: b.name, args: parseToolArgs(b.input) }));
  if (!text && !toolCalls.length) throw new Error(emptyReplyError(final.stop_reason));
  return { text, toolCalls, usage: { tokensIn: final.usage?.input_tokens ?? null, tokensOut: final.usage?.output_tokens ?? null } };
}

export const agentStep = (target: AiTarget, req: AgentStepRequest, onDelta: (text: string) => void): Promise<AgentStep> =>
  target.kind === 'typesafe' ? Promise.reject(new Error('AI_KIND_UNSUPPORTED')) : target.kind === 'anthropic' ? agentStepAnthropic(target, req, onDelta) : agentStepOpenAI(target, req, onDelta);
