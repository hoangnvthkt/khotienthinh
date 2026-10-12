import { test, expect } from '@playwright/test';

// Gợi ý "Như hôm qua" trong Chi tiết thi công (fixture, không gọi Supabase): Tab / bấm để dùng, Esc để bỏ, đổi nguồn thì hiện lại.
const base = '/tests/daily-log/prefill-fixture.html';
const ghost = (page: import('@playwright/test').Page) => page.getByTestId('daily-log-prefill');
const laborInputs = (page: import('@playwright/test').Page) => page.locator('[data-prefill-rows="labor"] input');

test.beforeEach(async ({ page }) => {
  await page.route('**/*.supabase.co/**', route => route.abort());
  await page.goto(base);
});

test('tab còn trống thì in mờ; Tab tới khối rồi Tab lần nữa là điền, con trỏ vào ô đầu', async ({ page, isMobile }) => {
  test.skip(isMobile, 'điện thoại không có phím Tab');
  await page.getByRole('button', { name: 'Nhân công' }).click();
  await expect(ghost(page)).toContainText('Như hôm qua');
  await expect(ghost(page)).toContainText('3 dòng');
  await expect(laborInputs(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Máy TC' }).focus();
  await page.keyboard.press('Tab');
  await expect(ghost(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(ghost(page)).toHaveCount(0);
  await expect(laborInputs(page)).toHaveCount(18);
  await expect(laborInputs(page).first()).toBeFocused();
  await expect(laborInputs(page).first()).toHaveValue('Tổ anh Minh');
  await expect(page.locator('#events')).toContainText('labor · accepted · 3 dòng');
});

test('Esc bỏ gợi ý máy, nhãn trên tab biến mất; đổi nguồn thì gợi ý hiện lại', async ({ page, isMobile }) => {
  test.skip(isMobile, 'điện thoại không có phím Esc');
  await page.getByRole('button', { name: 'Máy TC' }).click();
  await expect(page.getByTitle('Có gợi ý như hôm qua')).toHaveCount(2);
  await ghost(page).focus();
  await page.keyboard.press('Escape');
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.getByTitle('Có gợi ý như hôm qua')).toHaveCount(1);
  await expect(page.locator('#events')).toContainText('machines · dismissed · 2 dòng');
  await page.getByRole('button', { name: 'Đổi ngày (nguồn khác)' }).click();
  await expect(ghost(page)).toContainText('nhật ký 10/10 của bạn');
});

test('điện thoại: bấm Dùng điền cả nhóm, thanh tab không tràn ngang', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'chỉ đo trên điện thoại');
  await page.getByRole('button', { name: 'Nhân công' }).tap();
  await expect(ghost(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Dùng' }).tap();
  await expect(laborInputs(page)).toHaveCount(18);
  await expect(page.locator('#events')).toContainText('labor · accepted · 3 dòng');
});

test('không có nhật ký trước thì không có gì thay đổi', async ({ page }) => {
  await page.goto(`${base}?empty=1`);
  await page.getByRole('button', { name: 'Nhân công' }).click();
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.getByTitle('Có gợi ý như hôm qua')).toHaveCount(0);
});
