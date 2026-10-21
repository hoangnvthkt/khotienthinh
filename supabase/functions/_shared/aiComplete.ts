// Gọi model MỘT lượt trả JSON — đường dùng chung cho ai-gateway (skill đọc ảnh / chữ: báo giá, phiếu viết tay, nhật ký…) và
// wms-doc-reader (phiếu giao ở Kho). B1 (chủ SP 21/10/2026): trước đây Kho / Lập đơn / Đề xuất mỗi nơi một đường, ngưỡng hết giờ
// 55–100 s trong khi RevidAPI đọc ảnh 35–55 s (có hôm hơn 100 s) → màn báo "AI chưa đọc được" dù tab Trợ lý (110 s) vẫn đọc được.
// Ở đây: một ngưỡng (ảnh 110 s như hội thoại), thử lại đúng một lần khi lỗi thoáng qua, và mã lỗi ổn định (AI_TIMEOUT,
// AI_UNREACHABLE, AI_HTTP_<mã>…) để màn hình nói đúng chuyện gì xảy ra. Không dùng API Deno để vitest kiểm thử được.
import Anthropic from '@anthropic-ai/sdk';
import { emptyReplyError, outputTokenCap, stripThinkTags, type AiTarget } from './aiTargets.ts';

/** Trang gửi kèm: ảnh (máy đã thu về cạnh 2000 px) hoặc PDF (chỉ Anthropic / Gemini đọc được). */
export interface VisionPart { mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; b64: string }
/** calls = số lượt gọi model trong lượt AI (vòng công cụ nhiều bước, hoặc thử lại); không ghi = 1. */
export interface Usage { tokensIn: number | null; tokensOut: number | null; calls?: number }
export interface Completion { text: string; usage: Usage }
export interface CompletionRequest {
  system: string; user: string; schema: Record<string, unknown>; maxTokens: number; images?: VisionPart[];
  /** Skill chép lại chứng từ, không cần suy luận: cổng chuẩn OpenAI gửi reasoning_effort "none" (báo giá 41–61 s → 11 s, 17/10/2026). */
  noThinking?: boolean;
  /** Ghi đè ngưỡng hết giờ (lượt thử lại chỉ còn phần thời gian còn lại). */
  timeoutMs?: number;
}

/** Ảnh: 110 s như hội thoại (RevidAPI 35–55 s, 21/10 có lượt hơn 100 s). Đầu ra dài (nhật ký nhiều ngày): 100 s. Còn lại 55 s. */
export const VISION_TIMEOUT_MS = 110_000;
export const LONG_OUTPUT_TIMEOUT_MS = 100_000;
export const TEXT_TIMEOUT_MS = 55_000;
/** Cả lượt kể cả thử lại phải xong trước mốc 150 s không trả byte của Edge Function. */
export const TOTAL_BUDGET_MS = 140_000;
const MIN_RETRY_MS = 15_000;
export const timeoutFor = (req: CompletionRequest) =>
  req.timeoutMs ?? (req.images?.length ? VISION_TIMEOUT_MS : req.maxTokens >= 6000 ? LONG_OUTPUT_TIMEOUT_MS : TEXT_TIMEOUT_MS);

/**
 * Lỗi hết giờ / mạng của fetch và SDK Anthropic → mã AI_* ổn định. Trước đây ai_runs ghi "Signal timed out." và màn hình báo
 * "AI chưa đọc được phiếu" (người dùng hiểu là AI không nhận diện được). Lỗi đã là AI_* giữ nguyên.
 */
export const normalizeAiError = (e: unknown): Error => {
  if (e instanceof Error && e.message.startsWith('AI_')) return e;
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e ?? '');
  if (name === 'TimeoutError' || name === 'AbortError' || name === 'APIConnectionTimeoutError' || /timed out|timeout/i.test(message)) return new Error('AI_TIMEOUT');
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400) return new Error(`AI_HTTP_${status}`);
  if (name === 'APIConnectionError' || (name === 'TypeError' && /fetch|network|connect|socket/i.test(message))) return new Error('AI_UNREACHABLE');
  return e instanceof Error ? e : new Error('AI_FAILED');
};

const toAnthropicPart = (p: VisionPart) => (p.mime === 'application/pdf'
  ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: p.b64 } }
  : { type: 'image' as const, source: { type: 'base64' as const, media_type: p.mime, data: p.b64 } });

async function withAnthropic(t: AiTarget, req: CompletionRequest): Promise<Completion> {
  // maxRetries 0: thử lại do completeWithRetry quyết (SDK mặc định tự thử 2 lần → tốn lượt mà không ghi vào ai_runs).
  const client = new Anthropic({ apiKey: t.apiKey, baseURL: t.baseUrl, timeout: timeoutFor(req), maxRetries: 0 });
  const response = await client.messages.create({
    model: t.model, max_tokens: outputTokenCap(t.kind, req.maxTokens), system: req.system,
    messages: [{ role: 'user', content: req.images?.length
      ? [...req.images.map(toAnthropicPart), { type: 'text' as const, text: req.user }] as Anthropic.ContentBlockParam[]
      : req.user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI_REFUSED');
  const text = stripThinkTags(response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text || '');
  if (!text) throw new Error(emptyReplyError(response.stop_reason));
  return { text, usage: { tokensIn: response.usage?.input_tokens ?? null, tokensOut: response.usage?.output_tokens ?? null } };
}

async function withGemini(t: AiTarget, req: CompletionRequest): Promise<Completion> {
  const res = await fetch(`${t.baseUrl}/v1beta/models/${encodeURIComponent(t.model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': t.apiKey }, signal: AbortSignal.timeout(timeoutFor(req)),
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
  if (req.images?.some(i => i.mime === 'application/pdf')) throw new Error('AI_PDF_UNSUPPORTED');
  // Cổng chuẩn OpenAI khác (9Router, OpenRouter…) thường chưa hỗ trợ json_schema strict / max_completion_tokens: dùng json_object + max_tokens.
  const compatible = t.kind === 'openai_compatible';
  const send = (noThinking: boolean) => fetch(`${t.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` }, signal: AbortSignal.timeout(timeoutFor(req)),
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
  const text = stripThinkTags(String(data?.choices?.[0]?.message?.content ?? ''));
  if (!text) throw new Error(emptyReplyError(data?.choices?.[0]?.finish_reason));
  return { text, usage: { tokensIn: data?.usage?.prompt_tokens ?? null, tokensOut: data?.usage?.completion_tokens ?? null } };
}

/** Một lượt gọi model; mọi lỗi mạng / hết giờ đã quy về mã AI_*. */
export const complete = async (target: AiTarget, req: CompletionRequest): Promise<Completion> => {
  if (target.kind === 'typesafe') throw new Error('AI_KIND_UNSUPPORTED');
  try {
    return target.kind === 'anthropic' ? await withAnthropic(target, req) : target.kind === 'gemini' ? await withGemini(target, req) : await withOpenAI(target, req);
  } catch (e) {
    throw normalizeAiError(e);
  }
};

/** Lỗi thoáng qua đáng thử lại. Hết giờ KHÔNG thử lại: cổng đang chậm, gọi nữa chỉ tốn lượt (chủ SP 21/10 đếm từng request). */
export const isTransientAiError = (code: string) => /^(AI_EMPTY|AI_UNREACHABLE|AI_HTTP_429|AI_HTTP_5\d\d)$/.test(code);

export interface RetriedCompletion extends Completion { retried: boolean }
/** Gọi model, thử lại đúng một lần khi lỗi thoáng qua và còn ≥ 15 s trong quỹ 140 s; lượt thử lại ghi calls = 2 để tính tiền đúng. */
export const completeWithRetry = async (target: AiTarget, req: CompletionRequest, now: () => number = Date.now): Promise<RetriedCompletion> => {
  const started = now();
  try {
    return { ...(await complete(target, req)), retried: false };
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    const remaining = TOTAL_BUDGET_MS - (now() - started);
    if (!isTransientAiError(code) || remaining < MIN_RETRY_MS) throw e;
    const out = await complete(target, { ...req, timeoutMs: Math.min(timeoutFor(req), remaining) });
    return { ...out, usage: { ...out.usage, calls: 2 }, retried: true };
  }
};
