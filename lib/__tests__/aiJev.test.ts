import { describe, expect, it } from 'vitest';
import { JEV_AUTO, actualIntentOf, askJev, buildIntentRequest, decisionLog, parseIntentAnswer } from '../../supabase/functions/ai-gateway/jev';
import { probe } from '../../supabase/functions/_shared/aiTargets';

const answerJson = (intent = 'don_mua', confidence = 0.93, cam = 0.04, model = 'jev-1.14.0') => ({
  model, answers: { y_dinh: { type: 'choice', choice: intent, confidence, probabilities: { don_mua: 0.95, de_xuat_vat_tu: 0.05 } }, cam: { type: 'noul', noul: cam } }, usage: { input_tokens: 412, output_tokens: 9 },
});
const fakeFetch = (status: number, body: unknown) => async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('jev (J1 chạy bóng)', () => {
  it('buildIntentRequest: có câu trước của trợ lý thì gửi cả hai; chữ dài bị cắt; 2 câu hỏi y_dinh (choice) + cam (noul)', () => {
    const r = buildIntentRequest('DA29', 'Anh đề xuất cho dự án nào? [[goi_y:SMB-2026]] [[goi_y:DA29]]', 'jev-1.14.0');
    expect(Object.keys(r.state)).toEqual(['cau_truoc_cua_tro_ly', 'cau_hien_tai_cua_nguoi_dung']);
    expect(r.model).toBe('jev-1.14.0');
    expect((r.questions.y_dinh as { type: string }).type).toBe('choice');
    expect((r.questions.cam as { type: string }).type).toBe('noul');
    const long = buildIntentRequest('x'.repeat(5000), null, 'jev-1.14.0');
    expect(long.state.cau_cua_nguoi_dung).toHaveLength(4000);
  });

  it('parseIntentAnswer: đọc choice + confidence + noul + model + token; thiếu / sai nhãn → AI_BAD_JSON', () => {
    const a = parseIntentAnswer(answerJson());
    expect(a).toMatchObject({ intent: 'don_mua', confidence: 0.93, cam: 0.04, model: 'jev-1.14.0', tokensIn: 412 });
    expect(a.probabilities.don_mua).toBe(0.95);
    expect(() => parseIntentAnswer(answerJson('bay_bong'))).toThrow('AI_BAD_JSON');
    expect(() => parseIntentAnswer({ answers: { y_dinh: { choice: 'khac' } } })).toThrow('AI_BAD_JSON');
  });

  it('askJev: POST /v1/systemone với Bearer; 401 → JEV_HTTP_401', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const ok = await askJev({ baseUrl: 'https://api.typesafe.ai/', apiKey: 'k' }, buildIntentRequest('tạo đơn hàng', null, 'jev-1.14.0'),
      async (url, init) => { calls.push({ url, init }); return fakeFetch(200, answerJson())(url, init); });
    expect(ok.intent).toBe('don_mua');
    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(String(calls[0].init?.body)).model).toBe('jev-1.14.0');
    await expect(askJev({ baseUrl: 'https://api.typesafe.ai', apiKey: 'sai' }, buildIntentRequest('x', null, 'm'), fakeFetch(401, { error: 'bad key' }))).rejects.toThrow('JEV_HTTP_401');
  });

  it('actualIntentOf: công cụ chuẩn bị → ý định; từ chối → khac; chỉ tra → tra_cuu; không gì → null', () => {
    expect(actualIntentOf(['tim_ho_so', 'chuan_bi_don_mua'], null)).toEqual({ intent: 'don_mua', tools: ['tim_ho_so', 'chuan_bi_don_mua'], refusal: null });
    expect(actualIntentOf(['chuan_bi_nhat_ky', 'chuan_bi_nhat_ky'], null).tools).toEqual(['chuan_bi_nhat_ky']);
    expect(actualIntentOf(['ton_kho'], 'thao_tac_cam')).toMatchObject({ intent: 'khac', refusal: 'thao_tac_cam' });
    expect(actualIntentOf(['ton_kho'], null).intent).toBe('tra_cuu');
    expect(actualIntentOf([], null).intent).toBeNull();
  });

  it('decisionLog: agree so với thực tế, tier theo ngưỡng, camAgree chỉ khi có từ chối thao tác cấm hoặc Jev báo cấm; lỗi Jev → status error', () => {
    const a = { ...parseIntentAnswer(answerJson('don_mua', 0.93, 0.04)), ms: 210 };
    const ok = decisionLog({ ok: true, answer: a }, actualIntentOf(['chuan_bi_don_mua'], null), 'jev-1.14.0');
    expect(ok).toMatchObject({ kind: 'intent_route', status: 'ok', agree: true, camAgree: null, durationMs: 210, tokensIn: 412 });
    expect((ok.predicted as { tier: string }).tier).toBe('auto');
    expect(JEV_AUTO).toBe(0.85);
    const unknown = decisionLog({ ok: true, answer: { ...a, confidence: 0.7 } }, actualIntentOf([], null), 'jev-1.14.0');
    expect(unknown.agree).toBeNull();
    expect((unknown.predicted as { tier: string }).tier).toBe('verify');
    const cam = decisionLog({ ok: true, answer: { ...a, intent: 'khac', cam: 0.9 } }, actualIntentOf([], 'thao_tac_cam'), 'jev-1.14.0');
    expect(cam).toMatchObject({ agree: true, camAgree: true });
    const missed = decisionLog({ ok: true, answer: { ...a, intent: 'don_mua', cam: 0.2 } }, actualIntentOf([], 'thao_tac_cam'), 'jev-1.14.0');
    expect(missed).toMatchObject({ agree: false, camAgree: false });
    const err = decisionLog({ ok: false, error: 'JEV_HTTP_429' }, actualIntentOf(['ton_kho'], null), 'jev-1.14.0');
    expect(err).toMatchObject({ status: 'error', error: 'JEV_HTTP_429', predicted: null, agree: null });
  });

  it('probe typesafe: POST systemone nhỏ; 200 có answers → ok + model đã trả lời; 401 → BAD_KEY; 400 → MODEL_NOT_FOUND', async () => {
    const t = { kind: 'typesafe' as const, baseUrl: 'https://api.typesafe.ai', apiKey: 'k', model: 'jev-1.14.0' };
    const ok = await probe(t, async (url, init) => { expect(url).toBe('https://api.typesafe.ai/v1/systemone'); expect(init?.method).toBe('POST'); return new Response(JSON.stringify({ model: 'jev-1.14.0', answers: { ok: { noul: 0.1 } } }), { status: 200 }); });
    expect(ok).toMatchObject({ ok: true, models: 1, modelIds: ['jev-1.14.0'], code: null });
    expect((await probe(t, fakeFetch(401, {}))).code).toBe('BAD_KEY');
    expect((await probe(t, fakeFetch(400, {}))).code).toBe('MODEL_NOT_FOUND');
    expect((await probe({ ...t, baseUrl: 'http://api.typesafe.ai' }, fakeFetch(200, {}))).code).toBe('UNSAFE_ENDPOINT');
  });
});
