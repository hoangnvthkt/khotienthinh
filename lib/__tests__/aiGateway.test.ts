import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock('../supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) }, rpc: (...args: unknown[]) => rpc(...args) } }));

import { aiErrorMessage, aiGateway } from '../aiGateway';

beforeEach(() => { invoke.mockReset(); rpc.mockReset(); });

describe('aiGateway (client)', () => {
  it('status: hàm chưa triển khai (404) → deployed=false, không ném lỗi', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'not found', context: { status: 404 } } });
    const s = await aiGateway.status();
    expect(s).toMatchObject({ deployed: false, configured: false });
  });

  it('status: đã triển khai nhưng chưa có khóa → configured=false, biết khóa nào có sẵn', async () => {
    invoke.mockResolvedValueOnce({ data: { code: 'OK', configured: false, provider: 'anthropic', providerSource: 'default', models: { fast: 'claude-haiku-5-5', reasoning: 'claude-opus-5-5' }, keysPresent: { anthropic: false, gemini: true, openai: false }, priceKnown: false, skills: ['text_summary'] }, error: null });
    const s = await aiGateway.status();
    expect(s).toMatchObject({ deployed: true, configured: false, provider: 'anthropic', keysPresent: { gemini: true, anthropic: false } });
    expect(invoke).toHaveBeenCalledWith('ai-gateway', { body: { action: 'status' } });
  });

  it('run: gửi skill + input + context; trả nguyên kết quả OK', async () => {
    invoke.mockResolvedValueOnce({ data: { code: 'OK', runId: 'r1', result: { summary: 'x' }, model: 'm', provider: 'gemini', usage: { tokensIn: 1, tokensOut: 2, costUsd: null, durationMs: 300 } }, error: null });
    const out = await aiGateway.run<{ summary: string }>('text_summary', { text: 'abc' }, { docId: 'd1' });
    expect(out.code).toBe('OK');
    if (out.code === 'OK') expect(out.result.summary).toBe('x');
    expect(invoke).toHaveBeenCalledWith('ai-gateway', { body: { skill: 'text_summary', input: { text: 'abc' }, context: { docId: 'd1' } } });
  });

  it('run: máy chủ trả mã nghiệp vụ (hết lượt) thì giữ nguyên; lỗi HTTP 403 → AI_DENIED; 404 → chưa triển khai', async () => {
    invoke.mockResolvedValueOnce({ data: { code: 'AI_QUOTA', reason: 'day', usedToday: 30, dailyLimit: 30 }, error: null });
    const quota = await aiGateway.run('text_summary', { text: 'abc' });
    expect(quota).toMatchObject({ code: 'AI_QUOTA', reason: 'day' });
    expect(aiErrorMessage(quota as { code: 'AI_QUOTA'; reason: 'day'; usedToday: number; dailyLimit: number })).toBe('Hết lượt AI hôm nay (30/30).');

    invoke.mockResolvedValueOnce({ data: null, error: { message: 'forbidden', context: { status: 403 } } });
    expect((await aiGateway.run('text_summary', { text: 'abc' })).code).toBe('AI_DENIED');

    invoke.mockResolvedValueOnce({ data: null, error: { message: 'nf', context: { status: 404 } } });
    const nd = await aiGateway.run('text_summary', { text: 'abc' });
    expect(nd).toMatchObject({ code: 'AI_NOT_CONFIGURED', error: 'AI_NOT_DEPLOYED' });
    expect(aiErrorMessage(nd as { code: 'AI_NOT_CONFIGURED'; error: string })).toBe('Hàm ai-gateway chưa triển khai.');
    // Chống spam (18/10): còn câu đang trả lời / gửi quá nhanh trong một phút.
    expect(aiErrorMessage({ code: 'AI_QUOTA', reason: 'busy' })).toBe('Trợ lý đang trả lời câu trước — đợi xong rồi hỏi tiếp.');
    expect(aiErrorMessage({ code: 'AI_QUOTA', reason: 'minute' })).toBe('Bạn gửi hơi nhanh — đợi vài giây rồi hỏi tiếp.');
  });

  it('overview: ép số, giữ chi phí chưa rõ là null; setSkill / setSettings gọi đúng RPC', async () => {
    rpc.mockResolvedValueOnce({ data: {
      days: '30', from: 'x', settings: { enabled: true, monthlyRunCap: '3000', monthlyCostCapUsd: '50.00', updatedAt: null, updatedByName: null },
      month: { runs: '2', ok: '1', errors: '1', noProvider: '0', quota: '0', denied: '0', users: '1', costUsd: null, costKnown: false },
      skills: [{ code: 'text_summary', name: 'Tóm tắt', tier: 'base', mode: 'read', enabled: true, dailyLimit: '30', modelClass: 'fast', runs: '2', ok: '1', errors: '1', acceptedRate: null, feedbacks: '0', avgMs: '812', lastAt: null }],
      recent: [{ id: 'r1', createdAt: '2026-10-13T03:00:00Z', userName: 'Hoàng', skillCode: 'text_summary', status: 'ok', durationMs: '812', costUsd: null, accepted: null, error: null }],
    }, error: null });
    const o = await aiGateway.overview(30);
    expect(o.month).toMatchObject({ runs: 2, costUsd: null, costKnown: false });
    expect(o.skills[0]).toMatchObject({ dailyLimit: 30, avgMs: 812, acceptedRate: null });
    expect(o.recent[0]).toMatchObject({ durationMs: 812, accepted: null });

    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await aiGateway.setSkill('text_summary', { enabled: false, dailyLimit: 10 });
    expect(rpc).toHaveBeenLastCalledWith('set_ai_skill_v1', { p_code: 'text_summary', p: { enabled: false, dailyLimit: 10 } });
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await aiGateway.setSettings({ monthlyRunCap: 500 });
    expect(rpc).toHaveBeenLastCalledWith('set_ai_settings_v1', { p: { monthlyRunCap: 500 } });
  });
});
