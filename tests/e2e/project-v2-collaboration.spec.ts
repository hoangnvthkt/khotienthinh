import { expect, test } from '@playwright/test';

for (const width of [390, 768, 1440]) {
  test(`collaboration and protected reference fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tests/project-v2/collaboration-fixture.html');
    await expect(page.getByText('Tài liệu liên quan được bảo vệ')).toBeVisible();
    await expect(page.getByText('Cần kiểm tra nguồn vật tư trước khi duyệt.')).toBeVisible();
    await page.getByRole('button', { name: 'Xem trao đổi cũ hơn' }).click();
    await expect(page.getByText('Đã đối chiếu khối lượng.')).toBeVisible();
    await expect(page.getByText('Đã phê duyệt')).toBeVisible();
    await page.getByRole('textbox', { name: 'Thêm trao đổi' }).fill('Đề nghị xem bản 2.');
    await page.getByRole('checkbox', { name: 'Biểu mẫu đang sửa' }).check();
    await expect(page.getByText('Lưu hoặc bỏ thay đổi trước khi trao đổi.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gửi trao đổi' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/project-v2-collaboration-${width}.png`, fullPage: true });
  });
}

test('collaboration remains usable at 200% zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/tests/project-v2/collaboration-fixture.html');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect(page.getByRole('textbox', { name: 'Thêm trao đổi' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
