import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1440]) {
  test(`planning source and editors fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tests/project-v2/planning-fixture.html');
    await expect(page.getByRole('heading', { name: 'Chọn công việc và khối lượng' })).toBeVisible();
    await expect(page.getByText('Khả dụng:', { exact: false }).first()).toBeVisible();
    await page.getByRole('checkbox').nth(1).check();
    await expect(page.getByRole('columnheader', { name: 'Kế hoạch kỳ này' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Thi công', exact: true }).click();
    await page.getByRole('checkbox').first().check();
    await expect(page.getByRole('columnheader', { name: 'Tổ đội' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/project-v2-planning-${width}.png`, fullPage: true });
  });
}
