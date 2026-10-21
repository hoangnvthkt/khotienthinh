// Đường đọc một lượt dùng chung (B1, 21/10/2026): ngưỡng hết giờ theo loại yêu cầu, mã lỗi ổn định, thử lại đúng một lần khi lỗi
// thoáng qua — chạy đúng mã _shared/aiComplete.ts với fetch giả, không cần mạng.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LONG_OUTPUT_TIMEOUT_MS, TEXT_TIMEOUT_MS, VISION_TIMEOUT_MS, complete, completeWithRetry, isTransientAiError, normalizeAiError, timeoutFor } from '../../supabase/functions/_shared/aiComplete';
import type { AiTarget } from '../../supabase/functions/_shared/aiTargets';

const target = (kind: AiTarget['kind'] = 'openai_compatible'): AiTarget => ({ kind, baseUrl: 'https://cong-gia.test/v1', apiKey: 'k', model: 'claude-sonnet-5-5', source: 'connection', name: 'Cổng giả' });
const img = { mime: 'image/jpeg' as const, b64: 'A'.repeat(300) };
const req = (extra: Partial<Parameters<typeof complete>[1]> = {}) => ({ system: 'SYS', user: 'Đọc báo giá', schema: {}, maxTokens: 1500, ...extra });
const ok = (content: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
const timedOut = () => Object.assign(new Error('Signal timed out.'), { name: 'TimeoutError' });

let fetchMock: ReturnType<typeof vi.fn>;
const gateway = (handler: (n: number, init?: RequestInit) => Response | Promise<Response>) => {
  let n = 0;
  fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => handler(++n, init));
  vi.stubGlobal('fetch', fetchMock);
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('ngưỡng hết giờ theo yêu cầu', () => {
  it('ảnh 110 s như hội thoại; đầu ra dài 100 s; chữ 55 s; ghi đè khi thử lại', () => {
    expect(timeoutFor(req({ images: [img] }))).toBe(VISION_TIMEOUT_MS);
    expect(VISION_TIMEOUT_MS).toBe(110_000);
    expect(timeoutFor(req({ maxTokens: 8000 }))).toBe(LONG_OUTPUT_TIMEOUT_MS);
    expect(timeoutFor(req())).toBe(TEXT_TIMEOUT_MS);
    expect(timeoutFor(req({ images: [img], timeoutMs: 20_000 }))).toBe(20_000);
  });
});

describe('mã lỗi ổn định', () => {
  it('hết giờ của fetch / SDK → AI_TIMEOUT; mạng → AI_UNREACHABLE; HTTP có status → AI_HTTP_<mã>; AI_* giữ nguyên', () => {
    expect(normalizeAiError(timedOut()).message).toBe('AI_TIMEOUT');
    expect(normalizeAiError(Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })).message).toBe('AI_TIMEOUT');
    expect(normalizeAiError(Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' })).message).toBe('AI_UNREACHABLE');
    expect(normalizeAiError(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' })).message).toBe('AI_UNREACHABLE');
    expect(normalizeAiError(Object.assign(new Error('overloaded'), { status: 529 })).message).toBe('AI_HTTP_529');
    expect(normalizeAiError(new Error('AI_REFUSED')).message).toBe('AI_REFUSED');
    expect(normalizeAiError(new TypeError('x is not a function')).message).toBe('x is not a function');
  });

  it('fetch hết giờ khi đọc ảnh → lỗi AI_TIMEOUT (trước đây "Signal timed out." lọt vào ai_runs)', async () => {
    gateway(() => { throw timedOut(); });
    await expect(complete(target(), req({ images: [img] }))).rejects.toThrow('AI_TIMEOUT');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('cổng chuẩn OpenAI không đọc PDF → AI_PDF_UNSUPPORTED trước khi gọi mạng', async () => {
    gateway(() => ok({}));
    await expect(complete(target(), req({ images: [{ mime: 'application/pdf', b64: 'A'.repeat(300) }] }))).rejects.toThrow('AI_PDF_UNSUPPORTED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('thử lại đúng một lần', () => {
  it('503 rồi OK → kết quả, calls = 2, retried', async () => {
    gateway(n => (n === 1 ? new Response('busy', { status: 503 }) : ok({ lines: [{ qty: 6300 }] })));
    const out = await completeWithRetry(target(), req({ images: [img] }), () => 0);
    expect(JSON.parse(out.text)).toEqual({ lines: [{ qty: 6300 }] });
    expect(out.retried).toBe(true);
    expect(out.usage.calls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('trả lời rỗng rồi OK → thử lại; lượt thử lại chỉ còn phần quỹ còn lại', async () => {
    gateway(n => (n === 1 ? ok('') : ok({ a: 1 })));
    let t = 0; const now = () => (t += 100_000); // lượt 1 mất 100 s → còn 40 s
    const out = await completeWithRetry(target(), req({ images: [img] }), now);
    expect(out.retried).toBe(true);
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('hết giờ KHÔNG thử lại (cổng đang chậm, gọi nữa chỉ tốn lượt); 401 / từ chối cũng không', async () => {
    gateway(() => { throw timedOut(); });
    await expect(completeWithRetry(target(), req({ images: [img] }), () => 0)).rejects.toThrow('AI_TIMEOUT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gateway(() => new Response('no', { status: 401 }));
    await expect(completeWithRetry(target(), req(), () => 0)).rejects.toThrow('AI_HTTP_401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isTransientAiError('AI_TIMEOUT')).toBe(false);
    expect(isTransientAiError('AI_HTTP_502')).toBe(true);
    expect(isTransientAiError('AI_HTTP_429')).toBe(true);
    expect(isTransientAiError('AI_EMPTY')).toBe(true);
  });

  it('hết quỹ 140 s thì không thử lại dù lỗi thoáng qua', async () => {
    gateway(() => new Response('busy', { status: 502 }));
    let t = 0; const now = () => (t += 130_000);
    await expect(completeWithRetry(target(), req(), now)).rejects.toThrow('AI_HTTP_502');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('phiếu giao Kho: tắt suy nghĩ ở cổng chuẩn OpenAI, cổng không nhận → gửi lại thường (vẫn tính một lượt)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    gateway((n, init) => { bodies.push(JSON.parse(String(init?.body))); return n === 1 ? new Response('bad', { status: 400 }) : ok({ docType: 'phieu_giao' }); });
    const out = await completeWithRetry(target(), req({ images: [img], noThinking: true }), () => 0);
    expect(out.retried).toBe(false);
    expect(bodies[0].reasoning_effort).toBe('none');
    expect(bodies[1].reasoning_effort).toBeUndefined();
  });
});
