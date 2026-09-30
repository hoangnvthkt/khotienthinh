import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/tests/wms/g6-control-fixture.html'); });

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
  test(`keeps WMS decisions clear at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: 'Tồn, hàng đang đi và trách nhiệm giữ hàng' })).toBeVisible();
    const unknownRow = page.getByRole('row').filter({ hasText: 'Xi măng PCB40' });
    await expect(unknownRow.getByRole('cell').nth(2)).toHaveText('Chưa xác định');
    await expect(unknownRow.getByRole('cell').nth(4)).toHaveText('Chưa xác định');
    await expect(page.getByText('4', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    await page.getByRole('button', { name: 'Đội đang giữ' }).click();
    await expect(page.getByText('Đội thi công móng')).toBeVisible();
    await expect(page.getByText('Chưa đủ phân bổ công tác/ngân sách — không tự gán.')).toBeVisible();

    await page.getByRole('button', { name: 'Kho' }).click();
    // Kiểm kê đi qua màn K5 có duyệt.
    await expect(page.getByRole('link', { name: 'Mở kiểm kê' })).toHaveAttribute('href', '#/audit');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `/tmp/g6-wms-${viewport.width}.png`, fullPage: true });
  });
}
