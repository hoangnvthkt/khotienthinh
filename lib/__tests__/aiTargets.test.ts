import { describe, expect, it, vi } from 'vitest';
import { envEntries, isSafeEndpoint, probe, readBalance, targetFromConnection } from '../../supabase/functions/_shared/aiTargets';

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const clock = () => { let t = 1000; return () => (t += 210); };

describe('aiTargets — thử kết nối', () => {
  it('Anthropic: đọc /v1/models với x-api-key; đếm model; model đã chọn có trong danh sách', async () => {
    const fetchFn = vi.fn(() => reply(200, { data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }] }));
    const r = await probe({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com/', apiKey: 'sk-ant-x', model: 'claude-haiku-5-5' }, fetchFn, clock());
    expect(r).toMatchObject({ ok: true, httpStatus: 200, models: 2, code: null, message: 'Kết nối được', ms: 210 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-x', 'anthropic-version': '2023-06-01' });
  });

  it('Gemini: bỏ tiền tố models/; model không có thì vẫn ok nhưng báo MODEL_NOT_FOUND', async () => {
    const fetchFn = vi.fn(() => reply(200, { models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-pro' }] }));
    const r = await probe({ kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'AIza', model: 'gemini-9' }, fetchFn);
    expect(r).toMatchObject({ ok: true, models: 2, modelIds: ['gemini-2.5-flash', 'gemini-2.5-pro'], code: 'MODEL_NOT_FOUND' });
    expect((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-goog-api-key': 'AIza' });
  });

  it('Chuẩn OpenAI (9Router): Bearer tới {endpoint}/models; lỗi 401 / 404 / 429 / mạng ra mã dễ hiểu', async () => {
    const base = { kind: 'openai_compatible' as const, baseUrl: 'https://router.example.com/v1', apiKey: 'nr-key', model: '' };
    const ok = vi.fn(() => reply(200, { data: [{ id: 'gpt-x' }] }));
    expect(await probe(base, ok)).toMatchObject({ ok: true, models: 1 });
    expect((ok.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://router.example.com/v1/models');
    expect((ok.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer nr-key' });
    expect(await probe(base, () => reply(401, {}))).toMatchObject({ ok: false, code: 'BAD_KEY', message: 'Sai khóa hoặc khóa không có quyền', httpStatus: 401 });
    expect(await probe(base, () => reply(404, {}))).toMatchObject({ ok: false, code: 'BAD_ENDPOINT' });
    expect(await probe(base, () => reply(429, {}))).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
    expect(await probe(base, () => reply(502, {}))).toMatchObject({ ok: false, code: 'HTTP_502', message: 'Nhà cung cấp trả lỗi 502' });
    expect(await probe(base, () => Promise.reject(new Error('dns')))).toMatchObject({ ok: false, code: 'UNREACHABLE' });
  });

  it('chặn endpoint không an toàn trước khi gọi (http, máy nội bộ, IP riêng)', async () => {
    const fetchFn = vi.fn(() => reply(200, {}));
    for (const url of ['http://api.openai.com/v1', 'https://localhost:8080', 'https://10.0.0.5/v1', 'https://192.168.1.2', 'https://169.254.169.254/latest', 'https://user:pw@x.com', 'https://[::1]/v1']) {
      expect(isSafeEndpoint(url)).toBe(false);
      expect(await probe({ kind: 'openai', baseUrl: url, apiKey: 'k', model: '' }, fetchFn)).toMatchObject({ ok: false, code: 'UNSAFE_ENDPOINT' });
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(isSafeEndpoint('https://api.openai.com/v1')).toBe(true);
  });

  it('Secrets: liệt kê khóa có sẵn (4 ký tự cuối), 9Router cần cả URL lẫn KEY; kết nối từ Vault ra đích', () => {
    const env: Record<string, string> = { GEMINI_API_KEY: 'AIzaSy-abcd-7Qx2', GEMINI_FAST_MODEL: 'gemini-2.5-flash', NINEROUTER_URL: 'https://router.example.com/v1/', NINEROUTER_KEY: 'nr-1234' };
    const entries = envEntries(name => env[name]);
    expect(entries.map(e => [e.id, e.kind, e.baseUrl, e.model, e.keyHint])).toEqual([
      ['env:gemini', 'gemini', 'https://generativelanguage.googleapis.com', 'gemini-2.5-flash', '7Qx2'],
      ['env:ninerouter', 'openai_compatible', 'https://router.example.com/v1', '', '1234'],
    ]);
    expect(envEntries(name => (name === 'NINEROUTER_KEY' ? 'x' : undefined))).toEqual([]);
    expect(targetFromConnection({ id: 'c1', kind: 'anthropic', name: 'Claude', baseUrl: 'https://api.anthropic.com/', model: null, apiKey: 'sk' }, 'reasoning'))
      .toMatchObject({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', source: 'connection', connectionId: 'c1' });
    expect(targetFromConnection(null, 'fast')).toBeNull();
    expect(targetFromConnection({ kind: 'gemini', apiKey: '' }, 'fast')).toBeNull();
  });

  it('RevidAPI: danh sách model công khai → kiểm thêm /v1/credits; khóa sai báo BAD_KEY, khóa đúng hiện số credit', async () => {
    const models = { object: 'list', data: [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }] };
    const target = { kind: 'openai_compatible' as const, baseUrl: 'https://revidapi.com/v1', apiKey: 'sk_x', model: 'claude-sonnet-5' };
    const bad = vi.fn((url: string) => url.endsWith('/v1/models') ? reply(200, models) : reply(401, { error: { message: 'api key không hợp lệ' } }));
    expect(await probe(target, bad)).toMatchObject({ ok: false, code: 'BAD_KEY', httpStatus: 401, models: 2 });
    expect((bad.mock.calls[1] as unknown as [string, RequestInit])[0]).toBe('https://revidapi.com/v1/credits');
    expect((bad.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer sk_x' });
    const good = vi.fn((url: string) => url.endsWith('/v1/models') ? reply(200, models) : reply(200, { credits: 1234.5 }));
    expect(await probe(target, good)).toMatchObject({ ok: true, code: null, models: 2, balance: { amount: 1234.5, unit: 'credit' } });
    // Cổng khác không có bước kiểm thêm.
    const other = vi.fn(() => reply(200, models));
    expect(await probe({ ...target, baseUrl: 'https://router.example.com/v1' }, other)).toMatchObject({ ok: true, balance: null });
    expect(other).toHaveBeenCalledTimes(1);
    expect(readBalance({ data: { balance: '88' } })).toBe(88);
    expect(readBalance({ nope: 1 })).toBeNull();
  });
});
