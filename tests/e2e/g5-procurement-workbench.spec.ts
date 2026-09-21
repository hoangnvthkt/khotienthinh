import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/procurement/workbench-fixture.html');
});

test('keeps the work queue legible and opens a usable mobile detail overlay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Nhu cầu đúng người, xử lý tại một nơi' })).toBeVisible();
  await expect(page.getByText('Chưa xác định')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const demandRow = page.getByRole('button', { name: /Thép D16/ });
  await demandRow.click();
  await expect(page.getByRole('complementary', { name: 'Chi tiết nhu cầu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lập phương án mua' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PO-2026-0102' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Tài khoản đã khóa' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/g5-workbench-mobile.png', fullPage: true });

  const planButton = page.getByRole('button', { name: 'Lập phương án mua' });
  await planButton.click();
  await expect(page.getByRole('dialog', { name: 'Chọn cách đáp ứng nhu cầu' })).toBeVisible();
  await expect(page.getByText('Chưa mở command giữ tồn theo demand allocation.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Chọn cách đáp ứng nhu cầu' })).toHaveCount(0);
  await expect(planButton).toBeFocused();

  await page.getByRole('button', { name: 'Đóng chi tiết' }).click();
  await expect(page.getByRole('complementary', { name: 'Chi tiết nhu cầu' })).toHaveCount(0);
  await expect(demandRow).toBeFocused();
});

test('keeps the tablet overlay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole('button', { name: /Thép D16/ }).click();
  await expect(page.getByRole('complementary', { name: 'Chi tiết nhu cầu' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  await page.screenshot({ path: '/tmp/g5-workbench-tablet.png', fullPage: true });
});

test('shows queue and decision detail together on desktop with accessible primary actions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /Thép D16/ }).click();
  const panel = page.getByRole('complementary', { name: 'Chi tiết nhu cầu' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Còn bố trí')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Giao việc' })).toBeDisabled();
  await panel.getByRole('combobox', { name: 'Người phụ trách' }).selectOption('buyer-a');
  await expect(panel.getByRole('button', { name: 'Giao việc' })).toBeEnabled();
  await expect(page.getByRole('navigation', { name: 'Khu vực mua hàng' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: '/tmp/g5-workbench-desktop.png', fullPage: true });
});
