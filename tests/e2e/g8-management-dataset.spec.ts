import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/tests/management/g8-management-fixture.html'); });

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
  test(`keeps management decisions clear at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: 'Trung tâm điều hành' })).toBeVisible();
    await expect(page.getByText('Khu phức hợp An Phú', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Chưa xác định', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Một số chỉ tiêu chưa thể công bố')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    await page.getByRole('button', { name: /Mua hàng/ }).click();
    await expect(page.getByText('Đợt giao hàng đã quá ngày hẹn').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trace' }).filter({ visible: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `/tmp/g8-management-${viewport.width}.png`, fullPage: true });
  });
}

test('does not let a slow previous filter replace the current dataset', async ({ page }) => {
  const search = page.getByPlaceholder('Tìm dự án, hồ sơ, người xử lý…');
  await search.fill('slow');
  await page.waitForTimeout(50);
  await search.fill('current');
  await expect(page.getByText('Kết quả current').filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByText('Kết quả slow')).toHaveCount(0);
});
