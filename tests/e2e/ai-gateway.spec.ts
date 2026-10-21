import { test, expect, type Page, type Route } from '@playwright/test';

// Cài đặt → Cổng AI (Admin): tình trạng khóa, công tắc + trần tháng, skill, lượt gần nhất. Fixture với RPC và edge function mock.
const base = '/tests/settings/ai-gateway-fixture.html';

const skill = (over: Record<string, unknown>) => ({
  code: 'x', name: 'x', description: '', tier: 'base', mode: 'read', enabled: true, dailyLimit: 30, modelClass: 'fast', ownerUserId: null, ownerName: null,
  runs: 0, ok: 0, errors: 0, noProvider: 0, quota: 0, denied: 0, users: 0, acceptedRate: null, feedbacks: 0, avgMs: null, lastAt: null, ...over,
});
const OVERVIEW = {
  days: 30, from: '2026-09-13T00:00:00+00:00',
  settings: { enabled: true, monthlyRunCap: 3000, monthlyCostCapUsd: 50, updatedAt: null, updatedByName: null },
  month: { runs: 4, ok: 2, errors: 1, noProvider: 1, quota: 0, denied: 0, users: 2, costUsd: null, costKnown: false },
  skills: [
    skill({ code: 'text_summary', name: 'Tóm tắt văn bản', description: 'Tóm tắt đoạn văn bản người dùng đưa vào.', runs: 3, ok: 2, errors: 1, noProvider: 1, users: 2, acceptedRate: 50, feedbacks: 2, avgMs: 812 }),
    skill({ code: 'gateway_check', name: 'Kiểm tra kết nối', description: 'Admin gọi thử một câu ngắn.', tier: 'executive', dailyLimit: 20, runs: 1, noProvider: 1, users: 1 }),
  ],
  recent: [
    { id: 'r1', createdAt: '2026-10-13T03:12:00+07:00', userName: 'Hoàng', skillCode: 'text_summary', status: 'ok', provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 812, costUsd: null, accepted: true, error: null },
    { id: 'r2', createdAt: '2026-10-13T02:00:00+07:00', userName: 'Luật', skillCode: 'gateway_check', status: 'no_provider', provider: 'anthropic', model: null, durationMs: null, costUsd: null, accepted: null, error: 'AI_NOT_CONFIGURED' },
  ],
};
const STATUS_NO_KEY = { code: 'OK', configured: false, provider: 'anthropic', providerSource: 'default', models: { fast: 'claude-haiku-5-5', reasoning: 'claude-opus-5-5' }, keysPresent: { anthropic: false, gemini: true, openai: false }, priceKnown: false, skills: ['text_summary', 'gateway_check'] };
const STATUS_GEMINI = { ...STATUS_NO_KEY, configured: true, provider: 'gemini', providerSource: 'connection', models: { fast: 'gemini-2.5-flash', reasoning: 'gemini-2.5-pro' },
  targets: { fast: { source: 'connection', name: 'Gemini chính', kind: 'gemini', label: 'Google (Gemini)', model: 'gemini-2.5-flash' }, reasoning: { source: 'secrets', name: 'Gemini (Secrets)', kind: 'gemini', label: 'Google (Gemini)', model: 'gemini-2.5-pro' } } };

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const mock = async (page: Page, opts: { status?: unknown; statusHttp?: number; run?: unknown; calls: Array<{ fn: string; body: unknown }> }) => {
  await page.route('**/rest/v1/**', route => json(route, []));
  await page.route('**/rest/v1/rpc/get_ai_gateway_overview_v1', route => json(route, OVERVIEW));
  await page.route('**/rest/v1/rpc/set_ai_skill_v1', route => { opts.calls.push({ fn: 'set_ai_skill_v1', body: route.request().postDataJSON() }); return json(route, { ok: true }); });
  await page.route('**/rest/v1/rpc/set_ai_settings_v1', route => { opts.calls.push({ fn: 'set_ai_settings_v1', body: route.request().postDataJSON() }); return json(route, { ok: true }); });
  await page.route('**/functions/v1/ai-gateway', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    if (opts.statusHttp) return json(route, { error: 'not found' }, opts.statusHttp);
    const body = route.request().postDataJSON() as { action?: string; skill?: string };
    opts.calls.push({ fn: 'ai-gateway', body });
    return json(route, body?.action === 'status' ? opts.status : opts.run);
  });
};

test('chưa có khóa: báo rõ, nêu khóa có sẵn và cách bật; tháng này, skill, lượt gần nhất; Thử kết nối trả "làm tay"', async ({ page }) => {
  const calls: Array<{ fn: string; body: unknown }> = [];
  await mock(page, { status: STATUS_NO_KEY, run: { code: 'AI_NOT_CONFIGURED', runId: 'r9' }, calls });
  await page.goto(base);
  const root = page.getByTestId('ai-gateway');
  await expect(root.getByText('Chưa có khóa AI — mọi skill trả về "làm tay như thường".')).toBeVisible();
  await expect(root.getByText('Khóa có sẵn trong secrets:')).toContainText('Google (Gemini)');
  await expect(root.getByText(/AI_PROVIDER=gemini/)).toBeVisible();
  await expect(root.getByText('Tháng này:')).toContainText('4 lượt · 2 người · lỗi 1 · chưa có khóa 1 · chi phí — / trần $50');
  const rows = root.getByTestId('skill-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Tóm tắt văn bản');
  await expect(rows.nth(0)).toContainText('Nền');
  await expect(rows.nth(0)).toContainText('3 lượt · 1 lỗi · 1 chưa khóa · nhận 50% (2) · 2 người · 812 ms');
  await expect(rows.nth(1)).toContainText('Điều hành');
  await expect(rows.nth(1)).toContainText('chưa gán');
  const recent = root.getByRole('region', { name: 'Lượt gần nhất' });
  await expect(recent.getByText('Xong')).toBeVisible();
  await expect(recent.getByText('Chưa có khóa')).toBeVisible();
  await expect(recent).toContainText('Hoàng');
  await page.getByRole('button', { name: 'Thử kết nối' }).click();
  await expect(page.getByTestId('check-result')).toHaveText('Chưa cấu hình khóa AI — làm tay như thường.');
  expect(calls.find(c => c.fn === 'ai-gateway' && (c.body as { skill?: string }).skill === 'gateway_check')).toBeTruthy();
});

test('tắt skill, đổi lượt/ngày, lưu công tắc và trần: gọi đúng RPC với đúng giá trị', async ({ page }) => {
  const calls: Array<{ fn: string; body: unknown }> = [];
  await mock(page, { status: STATUS_NO_KEY, run: {}, calls });
  await page.goto(base);
  await page.getByLabel('Bật Tóm tắt văn bản').uncheck();
  await expect.poll(() => calls.filter(c => c.fn === 'set_ai_skill_v1').length).toBe(1);
  expect(calls.find(c => c.fn === 'set_ai_skill_v1')?.body).toEqual({ p_code: 'text_summary', p: { enabled: false } });
  await page.getByLabel('Lượt mỗi ngày Tóm tắt văn bản').fill('10');
  await page.getByLabel('Lượt mỗi ngày Tóm tắt văn bản').blur();
  await expect.poll(() => calls.filter(c => c.fn === 'set_ai_skill_v1').length).toBe(2);
  expect(calls[calls.length - 1].body).toEqual({ p_code: 'text_summary', p: { dailyLimit: 10 } });
  await page.getByLabel('Lớp model Tóm tắt văn bản').selectOption('reasoning');
  await expect.poll(() => calls.filter(c => c.fn === 'set_ai_skill_v1').length).toBe(3);
  expect(calls[calls.length - 1].body).toEqual({ p_code: 'text_summary', p: { modelClass: 'reasoning' } });

  await page.getByLabel('Lượt / tháng').fill('500');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect.poll(() => calls.filter(c => c.fn === 'set_ai_settings_v1').length).toBe(1);
  expect(calls.find(c => c.fn === 'set_ai_settings_v1')?.body).toEqual({ p: { enabled: true, monthlyRunCap: 500, monthlyCostCapUsd: 50 } });
  await expect(page.getByText('Đã lưu cài đặt cổng AI')).toBeVisible();
});

test('đã cấu hình Gemini: hiện nhà cung cấp và model; Thử kết nối báo OK kèm thời gian', async ({ page }) => {
  const calls: Array<{ fn: string; body: unknown }> = [];
  await mock(page, { status: STATUS_GEMINI, run: { code: 'OK', runId: 'r1', result: { ok: true, note: 'Xin chào từ Gemini' }, model: 'gemini-2.5-flash', provider: 'gemini', usage: { tokensIn: 40, tokensOut: 12, costUsd: null, durationMs: 640 } }, calls });
  await page.goto(base);
  await expect(page.getByText('Đang dùng Google (Gemini)')).toBeVisible();
  await expect(page.getByText('Model nhanh:')).toContainText('gemini-2.5-flash · kết nối Gemini chính');
  await expect(page.getByText('Model suy luận:')).toContainText('gemini-2.5-pro · Secrets');
  await expect(page.getByText(/AI_PRICE_IN_PER_M/)).toBeVisible();
  await page.getByRole('button', { name: 'Thử kết nối' }).click();
  await expect(page.getByTestId('check-result')).toHaveText('OK · gemini-2.5-flash · 640 ms · Xin chào từ Gemini');
});

test('hàm chưa triển khai (404): báo rõ, nút Thử kết nối khóa', async ({ page }) => {
  await mock(page, { statusHttp: 404, calls: [] });
  await page.goto(base);
  await expect(page.getByText('Hàm ai-gateway chưa triển khai.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thử kết nối' })).toBeDisabled();
});

test('điện thoại: không tràn ngang', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'chỉ đo trên điện thoại');
  await mock(page, { status: STATUS_NO_KEY, run: {}, calls: [] });
  await page.goto(base);
  await expect(page.getByTestId('skill-row').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
