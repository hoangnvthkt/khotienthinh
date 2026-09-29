import { expect, test } from '@playwright/test';

for (const width of [1440, 900, 390]) {
  test(`revision reason and successor navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tests/daily-log/revision-fixture.html');
    await expect(page.getByRole('region', { name: 'Phiên bản nhật ký' })).toHaveCSS('border-radius', '12px');
    await page.getByRole('button', { name: 'Tạo bản điều chỉnh', exact: true }).click();
    const reason = page.getByPlaceholder('Nhập lý do điều chỉnh...');
    await expect(reason).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo bản điều chỉnh', exact: true }).last()).toBeDisabled();
    await reason.fill('Cập nhật khối lượng theo biên bản hiện trường');
    await expect(page.getByRole('button', { name: 'Tạo bản điều chỉnh', exact: true }).last()).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Tạo bản điều chỉnh', exact: true }).last()).toHaveCSS('background-color', 'rgb(217, 119, 6)');
    await page.screenshot({ path: `.superpowers/sdd/2026-09-23-daily-log-wbs-area-summary-progress/revision-${width}.png` });
    await page.getByRole('button', { name: 'Tạo bản điều chỉnh', exact: true }).last().click();
    await expect(page.getByLabel('Lý do đã ghi')).toHaveText('Cập nhật khối lượng theo biên bản hiện trường');
    await page.getByRole('button', { name: 'Mở bản điều chỉnh mới' }).click();
    await expect(page.getByText('Đang xem bản điều chỉnh 2')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('locked period offers hash-router reopen navigation without a revision form', async ({ page }) => {
  await page.goto('/tests/daily-log/revision-fixture.html?locked');
  await expect(page.getByRole('button', { name: 'Tạo bản điều chỉnh' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Mở Chốt tiến độ' }).click();
  await expect(page).toHaveURL(/#\/da\?projectId=p1&tab=weekly_progress$/);
});
