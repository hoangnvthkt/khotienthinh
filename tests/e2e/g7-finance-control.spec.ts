import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/tests/finance/g7-finance-fixture.html'); });

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
  test(`keeps supplier finance decisions clear at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: 'Nhận mua → tồn kho → tiêu hao → công nợ → tiền chi' })).toBeVisible();
    await expect(page.getByText('Chưa xác định', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const openButton = page.getByRole('button', { name: 'Đối soát hóa đơn NCC' });
    await openButton.click();
    const dialog = page.getByRole('dialog', { name: 'Công ty Vật liệu An Phát' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('không tự tạo credit', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await dialog.getByRole('button', { name: 'Hủy' }).focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Đóng' })).toBeFocused();
    await page.screenshot({ path: `/tmp/g7-finance-${viewport.width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(openButton).toBeFocused();
  });
}
