import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1440]) {
  test(`buyer dossier fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tests/procurement-v2/dossier-fixture.html');
    await expect(page.getByRole('heading', { name: 'Hồ sơ cần xử lý' })).toBeVisible();
    await expect(page.locator('article span').getByText('Kế hoạch vật tư', { exact: true }).first()).toBeVisible();
    await expect(page.locator('article span').getByText('Đề xuất vật tư', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/procurement-v2-inbox-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Mở hồ sơ' }).first().click();
    await expect(page.getByRole('heading', { name: 'KHV-10-01' })).toBeVisible();
    await expect(page.getByText('Chưa rõ', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/procurement-v2-dossier-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Xem phương án' }).click();
    await expect(page.getByRole('dialog', { name: 'Chọn cách đáp ứng nhu cầu' })).toBeVisible();
    await expect(page.getByText('Hồ sơ cần đối chiếu trước khi lập PO.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Xem phương án' })).toBeFocused();
  });
}

test('request PO option is available with keyboard focus and layout survives 200% zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/tests/procurement-v2/dossier-fixture.html');
  await page.getByRole('button', { name: 'Mở hồ sơ' }).nth(1).click();
  await page.getByRole('button', { name: 'Chọn phương án cung ứng' }).click();
  await expect(page.getByRole('button', { name: 'Tiếp tục lập PO' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog')).toContainText('Mua theo PO');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Chọn phương án cung ứng' })).toBeFocused();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; document.documentElement.classList.add('dark'); });
  await expect(page.getByRole('heading', { name: 'MR-10-02' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('approved material-plan demand opens the PO editor with required buyer fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/tests/procurement-v2/dossier-fixture.html');
  await page.getByRole('button', { name: 'Mở hồ sơ' }).nth(2).click();
  await expect(page.getByRole('heading', { name: 'KHV-10-03' })).toBeVisible();
  await page.getByRole('button', { name: 'Chọn phương án cung ứng' }).click();
  await page.getByRole('button', { name: 'Tiếp tục lập PO' }).click();
  await expect(page.getByRole('dialog', { name: 'Lập PO từ nhu cầu đã duyệt' })).toBeVisible();
  for (const name of ['Nhà cung cấp', 'Kho nhận', 'Ngày giao dự kiến',
    'Số lượng cần mua', 'Đơn vị mua', 'Đơn giá', 'Ghi chú']) {
    await expect(page.getByRole('dialog').locator('label').filter({ hasText: name }).first()).toBeVisible();
  }
  await expect(page.getByRole('spinbutton', { name: 'Tử số quy đổi' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Mẫu số quy đổi' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/procurement-v2-purchase-390.png', fullPage: true });
  await page.getByRole('button', { name: 'Lập PO', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Lập PO', exact: true })).toBeVisible();
});
