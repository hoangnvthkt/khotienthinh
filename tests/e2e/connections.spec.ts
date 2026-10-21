import { test, expect, type Page, type Route } from '@playwright/test';

// Cài đặt → Kết nối (Admin, chủ SP 16/10): thêm endpoint + API key, Kiểm tra kết nối, gán cho tính năng, khóa trong Secrets chỉ đọc.
// Fixture với RPC + edge function integrations giả lập (máy chủ giả giữ trạng thái trong bộ nhớ). Desktop + iPhone WebKit.
const base = '/tests/settings/connections-fixture.html';

type Conn = { id: string; kind: string; name: string; baseUrl: string; model: string | null; hasKey: boolean; keyHint: string | null; enabled: boolean;
  status: string; lastTestedAt: string | null; lastTest: Record<string, unknown>; updatedAt: string; updatedByName: string };

const MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
};

const server = (page: Page) => {
  const state = {
    connections: [{ id: 'c1', kind: 'gemini', name: 'Gemini chính', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', hasKey: true, keyHint: '7Qx2',
      enabled: true, status: 'ok', lastTestedAt: new Date().toISOString(), lastTest: { ms: 412, httpStatus: 200, models: 37 }, updatedAt: new Date().toISOString(), updatedByName: 'Hoàng' }] as Conn[],
    assignments: { 'ai.fast': 'c1', 'ai.reasoning': null, 'wms.doc_reader': 'c1' } as Record<string, string | null>,
    keys: { c1: 'AIza-real-7Qx2' } as Record<string, string>,
    calls: [] as Array<{ fn: string; body: Record<string, unknown> }>,
  };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const probe = (kind: string, key: string, model?: string | null) => key.startsWith('bad')
    ? { ok: false, ms: 180, httpStatus: 401, models: null, modelIds: [], code: 'BAD_KEY', message: 'Sai khóa hoặc khóa không có quyền' }
    : { ok: true, ms: 420, httpStatus: 200, models: (MODELS[kind] || ['gpt-x']).length, modelIds: MODELS[kind] || ['gpt-x'],
        code: model && !(MODELS[kind] || ['gpt-x']).includes(model) ? 'MODEL_NOT_FOUND' : null, message: 'Kết nối được' };
  return {
    state,
    install: async () => {
      await page.route('**/rest/v1/**', route => json(route, []));
      await page.route('**/rest/v1/rpc/*', route => {
        const fn = new URL(route.request().url()).pathname.split('/').pop()!;
        const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
        state.calls.push({ fn, body });
        if (fn === 'get_integration_connections_v1') return json(route, { connections: state.connections, assignments: state.assignments });
        if (fn === 'save_integration_connection_v1') {
          const p = body.p as Record<string, string | boolean | null>;
          const key = (p.apiKey as string) || '';
          if (p.id) {
            const c = state.connections.find(x => x.id === p.id)!;
            Object.assign(c, { kind: p.kind, name: p.name, baseUrl: String(p.baseUrl).replace(/\/+$/, ''), model: p.model, enabled: p.enabled !== false });
            // Giá USD / 1 triệu token (18/10): chuỗi rỗng = xóa giá.
            Object.assign(c, { priceInPerM: p.priceInPerM ? Number(p.priceInPerM) : null, priceOutPerM: p.priceOutPerM ? Number(p.priceOutPerM) : null,
              pricePerCall: p.pricePerCall ? Number(p.pricePerCall) : null });
            if (key) { state.keys[c.id] = key; c.keyHint = key.slice(-4); c.status = 'untested'; }
            return json(route, c);
          }
          const c: Conn = { id: `c${state.connections.length + 1}`, kind: String(p.kind), name: String(p.name), baseUrl: String(p.baseUrl).replace(/\/+$/, ''), model: (p.model as string) || null,
            hasKey: true, keyHint: key.slice(-4), enabled: true, status: 'untested', lastTestedAt: null, lastTest: {}, updatedAt: new Date().toISOString(), updatedByName: 'Hoàng' };
          state.connections.push(c); state.keys[c.id] = key;
          return json(route, c);
        }
        if (fn === 'delete_integration_connection_v1') {
          state.connections = state.connections.filter(c => c.id !== body.p_id);
          Object.keys(state.assignments).forEach(k => { if (state.assignments[k] === body.p_id) state.assignments[k] = null; });
          return json(route, { ok: true });
        }
        if (fn === 'set_integration_assignment_v1') { state.assignments[String(body.p_feature)] = (body.p_connection_id as string) || null; return json(route, body); }
        return json(route, []);
      });
      await page.route('**/functions/v1/integrations', route => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
        const body = route.request().postDataJSON() as Record<string, unknown>;
        state.calls.push({ fn: 'integrations', body });
        if (body.action === 'env') return json(route, { code: 'OK', entries: [
          { id: 'env:gemini', kind: 'gemini', name: 'Gemini (Secrets)', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', keyHint: 'k9Ab' },
          { id: 'env:ninerouter', kind: 'openai_compatible', name: '9Router (Secrets)', baseUrl: 'https://router.example.com/v1', model: '', keyHint: '3f0e' },
        ] });
        if (body.envId) return json(route, { code: 'OK', result: body.envId === 'env:ninerouter' ? probe('openai_compatible', 'bad') : probe('gemini', 'ok') });
        if (body.draft) {
          const d = body.draft as Record<string, string>;
          const key = d.apiKey || state.keys[String(body.connectionId)] || '';
          return json(route, { code: 'OK', result: probe(d.kind, key, d.model) });
        }
        const c = state.connections.find(x => x.id === body.connectionId)!;
        const result = probe(c.kind, state.keys[c.id], c.model);
        Object.assign(c, { status: result.ok ? 'ok' : 'error', lastTestedAt: new Date().toISOString(), lastTest: { ms: result.ms, httpStatus: result.httpStatus, models: result.models, code: result.code, message: result.message } });
        return json(route, { code: 'OK', result, connection: c });
      });
    },
  };
};

const rowOf = (page: Page, name: string) => page.getByTestId('connection-row').filter({ hasText: name });

test('danh sách: kết nối đã lưu (đang chạy, dùng cho…), khóa trong Secrets chỉ đọc; khóa chỉ hiện 4 ký tự cuối', async ({ page }) => {
  const s = server(page); await s.install();
  await page.goto(base);
  const gemini = rowOf(page, 'Gemini chính');
  await expect(gemini).toContainText('Dùng cho: Trợ lý · model nhanh, Đọc ảnh chứng từ · Kho, Lập đơn, Đề xuất');
  await expect(gemini).toContainText('khóa •••• 7Qx2');
  await expect(gemini.getByTestId('connection-status')).toContainText(/Đang chạy · thử \d\d:\d\d/);
  await expect(gemini.getByRole('button', { name: 'Sửa Gemini chính' })).toBeVisible();
  const router = rowOf(page, '9Router (Secrets)');
  await expect(router).toContainText('Secrets · chỉ đọc');
  await expect(router.getByRole('button', { name: /^Sửa/ })).toHaveCount(0);
  await router.getByRole('button', { name: 'Thử 9Router (Secrets)' }).click();
  await expect(router.getByTestId('connection-status')).toHaveText('Lỗi 401 — Sai khóa hoặc khóa không có quyền');
  await expect(page.getByLabel('Trợ lý · model nhanh')).toHaveValue('c1');
  await expect(page.getByLabel('Trợ lý · model suy luận')).toHaveValue('');
  expect(await page.content()).not.toContain('AIza-real-7Qx2');
});

test('thêm kết nối: chọn loại điền sẵn endpoint, kiểm tra trước khi lưu (sai khóa báo rõ), lưu xong tự thử và hiện Đang chạy', async ({ page }) => {
  const s = server(page); await s.install();
  await page.goto(base);
  await page.getByRole('button', { name: 'Thêm kết nối' }).click();
  const drawer = page.getByRole('dialog', { name: 'Thêm kết nối' });
  await drawer.getByLabel('Loại kết nối').selectOption('anthropic');
  await expect(drawer.getByLabel('Endpoint')).toHaveValue('https://api.anthropic.com');
  await expect(drawer.getByLabel('Tên kết nối')).toHaveValue('Anthropic');
  await expect(drawer.getByRole('button', { name: 'Kiểm tra kết nối' })).toBeDisabled();
  await expect(drawer.getByRole('button', { name: 'Lưu' })).toBeDisabled();

  await drawer.getByLabel('API key').fill('bad-key-0000');
  await drawer.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(drawer.getByTestId('draft-result')).toHaveText('Lỗi 401 — Sai khóa hoặc khóa không có quyền');

  await drawer.getByLabel('API key').fill('sk-ant-good-AbC9');
  await drawer.getByLabel('Model').fill('claude-haiku-5-5');
  await drawer.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(drawer.getByTestId('draft-result')).toHaveText(/^Kết nối được · \d+ ms · 3 model$/);
  await drawer.getByRole('button', { name: 'Lưu' }).click();
  await expect(drawer).toHaveCount(0);

  const row = rowOf(page, 'Anthropic');
  await expect(row).toContainText('khóa •••• AbC9');
  await expect(row.getByTestId('connection-status')).toContainText('Đang chạy');
  const save = s.state.calls.find(c => c.fn === 'save_integration_connection_v1')!.body.p as Record<string, unknown>;
  expect(save).toMatchObject({ kind: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-good-AbC9', model: 'claude-haiku-5-5' });
  expect(s.state.calls.some(c => c.fn === 'integrations' && c.body.connectionId === 'c2' && !c.body.draft)).toBe(true);
  expect(await page.content()).not.toContain('sk-ant-good-AbC9');
});

test('sửa: khóa để trống = giữ khóa cũ; đổi endpoint thì bắt nhập lại khóa; gán cho tính năng; xóa có xác nhận', async ({ page }) => {
  const s = server(page); await s.install();
  await page.goto(base);
  await page.getByRole('button', { name: 'Sửa Gemini chính' }).click();
  const drawer = page.getByRole('dialog', { name: 'Sửa kết nối Gemini chính' });
  await expect(drawer.getByLabel('API key')).toHaveValue('');
  await expect(drawer.getByLabel('API key')).toHaveAttribute('placeholder', '•••• 7Qx2 — để trống nếu giữ khóa cũ');
  await drawer.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(drawer.getByTestId('draft-result')).toContainText('Kết nối được');
  expect(s.state.calls.at(-1)?.body).toMatchObject({ action: 'test', connectionId: 'c1', draft: { apiKey: '' } });

  await drawer.getByLabel('Endpoint').fill('https://proxy.example.com');
  await expect(drawer.getByLabel('API key')).toHaveAttribute('placeholder', /đổi endpoint thì nhập lại khóa/);
  await expect(drawer.getByRole('button', { name: 'Kiểm tra kết nối' })).toBeDisabled();
  await expect(drawer.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  await drawer.getByLabel('Endpoint').fill('https://generativelanguage.googleapis.com');
  await drawer.getByLabel('Tên kết nối').fill('Gemini công ty');
  await drawer.getByLabel('Giá vào (USD / 1 triệu token)').fill('0,33');
  await drawer.getByLabel('Giá ra (USD / 1 triệu token)').fill('1,64');
  await drawer.getByRole('button', { name: 'Lưu' }).click();
  await expect(drawer).toHaveCount(0);
  const saved = s.state.calls.filter(c => c.fn === 'save_integration_connection_v1').at(-1)!.body.p as Record<string, unknown>;
  expect(saved.apiKey).toBeNull();
  expect(saved).toMatchObject({ priceInPerM: '0.33', priceOutPerM: '1.64', pricePerCall: '' });
  await expect(rowOf(page, 'Gemini công ty')).toBeVisible();
  await expect(rowOf(page, 'Gemini công ty')).toContainText('0,33 / 1,64 $');
  // Giá mỗi lượt gọi (cổng báo token vào không ổn định): hiện "$/lượt + ra …", bỏ giá vào.
  await page.getByRole('button', { name: 'Sửa Gemini công ty' }).click();
  const again = page.getByRole('dialog', { name: 'Sửa kết nối Gemini công ty' });
  await expect(again.getByLabel('Giá vào (USD / 1 triệu token)')).toHaveValue('0,33');
  await again.getByLabel('Giá mỗi lượt gọi (USD)').fill('0,008');
  await again.getByRole('button', { name: 'Lưu' }).click();
  await expect(again).toHaveCount(0);
  await expect(rowOf(page, 'Gemini công ty')).toContainText('0,008 $/lượt + ra 1,64');
  // Trợ lý · hội thoại chưa gán thì dùng như model suy luận.
  await expect(page.getByLabel('Trợ lý · hội thoại').locator('option').first()).toHaveText('Như Trợ lý · model suy luận');

  await page.getByLabel('Trợ lý · model suy luận').selectOption('c1');
  await expect.poll(() => s.state.assignments['ai.reasoning']).toBe('c1');
  await expect(rowOf(page, 'Gemini công ty')).toContainText('Trợ lý · model suy luận');

  await page.getByRole('button', { name: 'Sửa Gemini công ty' }).click();
  await page.getByRole('dialog', { name: 'Sửa kết nối Gemini công ty' }).getByRole('button', { name: 'Xóa' }).click();
  // Hộp xác nhận chung (ConfirmDeleteModal) đếm ngược 3 giây rồi mới cho bấm.
  const confirmDelete = page.locator('.z-\\[1200\\]').getByRole('button', { name: /Xóa/ });
  await expect(confirmDelete).toBeEnabled({ timeout: 6000 });
  await confirmDelete.click();
  await expect(rowOf(page, 'Gemini công ty')).toHaveCount(0);
  await expect(page.getByLabel('Trợ lý · model nhanh')).toHaveValue('');
});

test('mẫu RevidAPI: điền sẵn endpoint chuẩn OpenAI, tên và model; lưu đúng loại', async ({ page }) => {
  const s = server(page); await s.install();
  await page.goto(base);
  await page.getByRole('button', { name: 'Thêm kết nối' }).click();
  const drawer = page.getByRole('dialog', { name: 'Thêm kết nối' });
  await drawer.getByLabel('Loại kết nối').selectOption('revidapi');
  await expect(drawer.getByLabel('Endpoint')).toHaveValue('https://revidapi.com/v1');
  await expect(drawer.getByLabel('Tên kết nối')).toHaveValue('RevidAPI');
  await expect(drawer.getByLabel('Model')).toHaveValue('claude-sonnet-5');
  await drawer.getByLabel('API key').fill('sk_live_revid_9Z1k');
  await drawer.getByRole('button', { name: 'Lưu' }).click();
  await expect(rowOf(page, 'RevidAPI')).toContainText('khóa •••• 9Z1k');
  expect((s.state.calls.find(c => c.fn === 'save_integration_connection_v1')!.body.p as Record<string, unknown>)).toMatchObject({ kind: 'openai_compatible', baseUrl: 'https://revidapi.com/v1', model: 'claude-sonnet-5' });
  await page.getByRole('button', { name: 'Sửa RevidAPI' }).click();
  await expect(page.getByRole('dialog', { name: 'Sửa kết nối RevidAPI' }).getByLabel('Loại kết nối')).toHaveValue('revidapi');
});

test('điện thoại: không tràn ngang, hộp thêm kết nối toàn màn hình', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'chỉ đo trên điện thoại');
  const s = server(page); await s.install();
  await page.goto(base);
  await expect(rowOf(page, 'Gemini chính')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Thêm kết nối' }).tap();
  await expect(page.getByRole('dialog', { name: 'Thêm kết nối' }).getByLabel('API key')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
