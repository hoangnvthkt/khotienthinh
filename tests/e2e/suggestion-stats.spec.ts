import { test, expect, type Page, type Route } from '@playwright/test';

// Cài đặt → Gợi ý nhập liệu (Admin): tỷ lệ dùng / sửa / bỏ gợi ý in mờ theo màn và ô. Fixture với RPC mock.
const base = '/tests/settings/suggestion-stats-fixture.html';

const STATS = {
  days: 30, from: '2026-09-13T00:00:00+00:00',
  total: { events: 29, users: 5, firstAt: '2026-10-12T01:00:00+00:00', lastAt: '2026-10-13T03:00:00+00:00' },
  screens: [{ screen: 'daily_log', events: 20, users: 4 }, { screen: 'purchase_order', events: 7, users: 2 }, { screen: 'material_request', events: 2, users: 1 }],
  rows: [
    { screen: 'daily_log', field: 'weather', events: 10, accepted: 8, edited: 2, dismissed: 0, suggestedRows: 10, acceptedRows: 8, users: 4, lastAt: null },
    { screen: 'daily_log', field: 'labor', events: 6, accepted: 4, edited: 0, dismissed: 2, suggestedRows: 30, acceptedRows: 20, users: 3, lastAt: null },
    { screen: 'daily_log', field: 'machines', events: 4, accepted: 3, edited: 0, dismissed: 1, suggestedRows: 12, acceptedRows: 9, users: 2, lastAt: null },
    { screen: 'purchase_order', field: 'header', events: 3, accepted: 2, edited: 0, dismissed: 1, suggestedRows: 6, acceptedRows: 4, users: 2, lastAt: null },
    { screen: 'purchase_order', field: 'price', events: 2, accepted: 1, edited: 1, dismissed: 0, suggestedRows: 5, acceptedRows: 3, users: 2, lastAt: null },
    { screen: 'purchase_order', field: 'spec', events: 2, accepted: 2, edited: 0, dismissed: 0, suggestedRows: 4, acceptedRows: 4, users: 1, lastAt: null },
    { screen: 'material_request', field: 'spec', events: 1, accepted: 1, edited: 0, dismissed: 0, suggestedRows: 2, acceptedRows: 2, users: 1, lastAt: null },
    { screen: 'material_request', field: 'item', events: 1, accepted: 1, edited: 0, dismissed: 0, suggestedRows: 1, acceptedRows: 1, users: 1, lastAt: null },
  ],
};
const EMPTY = { days: 7, from: '2026-10-06T00:00:00+00:00', total: { events: 0, users: 0, firstAt: null, lastAt: null }, screens: [], rows: [] };

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const requestedDays = (route: Route) => Number((route.request().postDataJSON() as { p_days?: number } | null)?.p_days);

const mockStats = async (page: Page, handler: (days: number, route: Route) => Promise<void>) => {
  await page.route('**/rest/v1/**', route => json(route, []));
  await page.route('**/rest/v1/rpc/get_ui_suggestion_stats_v1', route => handler(requestedDays(route), route));
};

test('30 ngày: 4 ô chỉ số, nhóm theo màn nhiều lượt trước, từng ô có số và tỷ lệ dùng', async ({ page }) => {
  await mockStats(page, (days, route) => json(route, days === 7 ? EMPTY : STATS));
  await page.goto(base);
  const root = page.getByTestId('suggestion-stats');
  await expect(root.getByText('Lượt gợi ý')).toBeVisible();
  await expect(root.getByText('29', { exact: true })).toBeVisible();
  await expect(root.getByText('76%', { exact: true })).toBeVisible(); // 22 dùng / 29 lượt
  await expect(root.getByText('51/70')).toBeVisible(); // dòng tự điền
  await expect(root.getByText('lần cuối 13/10/2026')).toBeVisible();

  const sections = root.getByRole('region');
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0)).toContainText('Nhật ký công trường');
  await expect(sections.nth(0)).toContainText('20 lượt · 4 người');
  await expect(sections.nth(1)).toContainText('Lập đơn mua hàng');
  await expect(sections.nth(2)).toContainText('Đề xuất vật tư');

  const rows = sections.nth(0).getByRole('row');
  await expect(rows.nth(1)).toContainText('Thời tiết');
  await expect(rows.nth(1)).toContainText('80%');
  await expect(rows.nth(2)).toContainText('Nhân công');
  await expect(rows.nth(2)).toContainText('20/30 dòng · 3 người');
  await expect(sections.nth(1).getByRole('row').nth(1)).toContainText('Đầu đơn');
});

test('đổi 7 ngày: gọi lại máy chủ với p_days = 7; chưa có lượt nào thì báo rỗng, không hiện 0 giả', async ({ page }) => {
  await mockStats(page, (days, route) => json(route, days === 7 ? EMPTY : STATS));
  await page.goto(base);
  await expect(page.getByText('29', { exact: true })).toBeVisible();
  const call = page.waitForRequest(req => req.url().includes('get_ui_suggestion_stats_v1') && (req.postDataJSON() as { p_days?: number })?.p_days === 7);
  await page.getByRole('button', { name: '7 ngày' }).click();
  await call;
  await expect(page.getByText('Chưa có lượt gợi ý nào trong 7 ngày')).toBeVisible();
  await expect(page.getByRole('button', { name: '7 ngày' })).toHaveAttribute('aria-pressed', 'true');
});

test('không phải Admin: báo không có quyền; lỗi máy chủ: báo lỗi có Thử lại', async ({ page }) => {
  let mode: 'denied' | 'error' | 'ok' = 'denied';
  await mockStats(page, (_days, route) => mode === 'denied'
    ? json(route, { code: '42501', message: 'SUGGESTION_STATS_ADMIN_REQUIRED', details: null, hint: null }, 403)
    : mode === 'error' ? json(route, { code: 'XX000', message: 'boom', details: null, hint: null }, 500) : json(route, STATS));
  await page.goto(base);
  await expect(page.getByText('Chỉ Admin xem được bảng này')).toBeVisible();
  mode = 'error';
  await page.getByRole('button', { name: /Làm mới|Tải lại số liệu/ }).click();
  await expect(page.getByRole('alert')).toContainText('Không tải được số liệu');
  mode = 'ok';
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Lượt gợi ý')).toBeVisible();
});

test('điện thoại: không tràn ngang, chọn khoảng ngày chiếm cả hàng', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'chỉ đo trên điện thoại');
  await mockStats(page, (_days, route) => json(route, STATS));
  await page.goto(base);
  await expect(page.getByText('Nhật ký công trường')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '90 ngày' }).tap();
  await expect(page.getByRole('button', { name: '90 ngày' })).toHaveAttribute('aria-pressed', 'true');
});
