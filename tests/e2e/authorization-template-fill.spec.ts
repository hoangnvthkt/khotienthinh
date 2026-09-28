import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/authorization/template-fill-fixture.html');
});

test('suggests the position template and fills it in with an end date and reason', async ({ page }) => {
  await expect(page.getByRole('combobox', { name: 'Mẫu quyền' })).toHaveValue('warehouse_manager');
  await page.getByRole('button', { name: 'Điền vào bảng' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã điền' })).toContainText('thêm 4, gỡ 0');
  await expect(page.getByLabel('Reason')).toHaveText('Áp mẫu quyền "Quản lý kho"');
  await page.getByRole('button', { name: 'Quyền nâng cao' }).first().click();
  await expect(page.getByRole('checkbox', { name: 'Duyệt' })).toBeChecked();
});

test('replace removes other own grants and undo restores them', async ({ page }) => {
  await page.getByRole('radio', { name: 'Thay bằng mẫu' }).click();
  await page.getByRole('button', { name: 'Điền vào bảng' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã điền' })).toContainText('thêm 4, gỡ 1');
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(page.getByText('Chưa thay đổi quyền.')).toBeVisible();
  await expect(page.getByLabel('Reason')).toHaveText('');
});
