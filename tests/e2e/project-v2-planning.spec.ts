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
  test(`material plan and calculation basis fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tests/project-v2/planning-fixture.html');
    await page.getByRole('button', { name: 'Vật tư', exact: true }).click();
    await expect(page.getByText('Xi măng PCB40').filter({ visible: true }).first()).toBeVisible();
    if (width >= 1024) await expect(page.getByRole('columnheader', { name: 'Nhu cầu tính toán' })).toBeVisible();
    else await expect(page.getByText('Nhu cầu tính toán:', { exact: false }).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('checkbox', { name: /Chọn Xi măng PCB40|Xi măng PCB40/ }).first().check();
    await expect(page.getByRole('textbox', { name: 'Lý do điều chỉnh số lượng' })).toBeVisible();
    await page.getByRole('button', { name: 'Cơ sở tính toán' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Cơ sở tính toán' })).toBeVisible();
    await expect(page.getByText('Còn khả dụng:', { exact: false }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/project-v2-material-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Đóng cơ sở tính toán' }).click();
    await page.screenshot({ path: `/tmp/project-v2-material-editor-${width}.png`, fullPage: true });
  });
}
