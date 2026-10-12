// Cổng AI — gọi model theo nhà cung cấp chọn bằng biến môi trường (chủ SP 12/10: không cố định một hãng).
//   AI_PROVIDER = anthropic | gemini | openai   (mặc định anthropic; chưa đặt thì dùng WMS_AI_PROVIDER nếu có)
//   AI_MODEL_FAST / AI_MODEL_REASONING = model theo lớp skill (openai bắt buộc khai báo)
//   ANTHROPIC_API_KEY | GEMINI_API_KEY | OPENAI_API_KEY (dùng chung với wms-doc-reader)
//   AI_PRICE_IN_PER_M / AI_PRICE_OUT_PER_M = USD mỗi triệu token (không đặt → chi phí ghi "chưa rõ")
import Anthropic from '@anthropic-ai/sdk';

export type Provider = 'anthropic' | 'gemini' | 'openai';
export type ModelClass = 'fast' | 'reasoning';
export interface Usage { tokensIn: number | null; tokensOut: number | null }
export interface Completion { text: string; usage: Usage }
export interface CompletionRequest { system: string; user: string; schema: Record<string, unknown>; maxTokens: number }

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

async function withAnthropic(key: string, model: string, req: CompletionRequest): Promise<Completion> {
  const client = new Anthropic({ apiKey: key });
  const response = await client.messages.create({
    model, max_tokens: req.maxTokens, system: req.system,
    messages: [{ role: 'user', content: req.user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI_REFUSED');
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('AI_EMPTY');
  return { text, usage: { tokensIn: response.usage?.input_tokens ?? null, tokensOut: response.usage?.output_tokens ?? null } };
}

async function withGemini(key: string, model: string, req: CompletionRequest): Promise<Completion> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(55000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: req.maxTokens, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`AI_HTTP_${res.status}`);
  const data = await res.json();
  if (data?.promptFeedback?.blockReason) throw new Error('AI_REFUSED');
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
  if (!text) throw new Error('AI_EMPTY');
  return { text, usage: { tokensIn: data?.usageMetadata?.promptTokenCount ?? null, tokensOut: data?.usageMetadata?.candidatesTokenCount ?? null } };
}

async function withOpenAI(key: string, model: string, req: CompletionRequest): Promise<Completion> {
  if (!model) throw new Error('AI_MODEL_REQUIRED');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(55000),
    body: JSON.stringify({
      model, max_completion_tokens: req.maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: 'skill_output', schema: req.schema, strict: true } },
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
    }),
  });
  if (!res.ok) throw new Error(`AI_HTTP_${res.status}`);
  const data = await res.json();
  if (data?.choices?.[0]?.finish_reason === 'content_filter') throw new Error('AI_REFUSED');
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI_EMPTY');
  return { text, usage: { tokensIn: data?.usage?.prompt_tokens ?? null, tokensOut: data?.usage?.completion_tokens ?? null } };
}

export const complete = (config: GatewayConfig, model: string, req: CompletionRequest): Promise<Completion> => {
  if (!config.key) throw new Error('AI_NOT_CONFIGURED');
  return config.provider === 'anthropic' ? withAnthropic(config.key, model, req)
    : config.provider === 'gemini' ? withGemini(config.key, model, req) : withOpenAI(config.key, model, req);
};
