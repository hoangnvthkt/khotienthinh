// Cổng AI — gọi model theo nhà cung cấp chọn bằng biến môi trường (chủ SP 12/10: không cố định một hãng).
//   AI_PROVIDER = anthropic | gemini | openai   (mặc định anthropic; chưa đặt thì dùng WMS_AI_PROVIDER nếu có)
//   AI_MODEL_FAST / AI_MODEL_REASONING = model theo lớp skill (openai bắt buộc khai báo)
//   ANTHROPIC_API_KEY | GEMINI_API_KEY | OPENAI_API_KEY (dùng chung với wms-doc-reader)
//   AI_PRICE_IN_PER_M / AI_PRICE_OUT_PER_M = USD mỗi triệu token (không đặt → chi phí ghi "chưa rõ")
//   Kết nối Admin thêm ở Cài đặt → Kết nối (khóa trong Vault) được ưu tiên; chưa gán thì dùng các biến trên (index.ts chọn đích).
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_BASE_URL, KIND_LABEL, emptyReplyError, outputTokenCap, type AiTarget, type ModelClass } from '../_shared/aiTargets.ts';

export type Provider = 'anthropic' | 'gemini' | 'openai';
export type { ModelClass };
export interface Usage { tokensIn: number | null; tokensOut: number | null }
export interface Completion { text: string; usage: Usage }
import type { ImagePart } from './images.ts';
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

export const costUsd = (usage: Usage, price: GatewayConfig['price']) =>
  usage.tokensIn == null || usage.tokensOut == null || price.inPerM == null || price.outPerM == null
    ? null : Math.round(((usage.tokensIn * price.inPerM + usage.tokensOut * price.outPerM) / 1e6) * 1e5) / 1e5;

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
  target.kind === 'anthropic' ? withAnthropic(target, req) : target.kind === 'gemini' ? withGemini(target, req) : withOpenAI(target, req);
