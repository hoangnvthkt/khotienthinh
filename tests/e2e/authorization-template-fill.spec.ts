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
  await expect(page.getByRole('checkbox', { name: 'Duyệt', exact: true })).toBeChecked();
});

test('replace removes other own grants and undo restores them', async ({ page }) => {
  await page.getByRole('radio', { name: 'Thay bằng mẫu' }).click();
  await page.getByRole('button', { name: 'Điền vào bảng' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã điền' })).toContainText('thêm 4, gỡ 1');
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(page.getByText('Chưa thay đổi quyền.')).toBeVisible();
  await expect(page.getByLabel('Reason')).toHaveText('');
});

test('links the person to the template with "Duyệt PO" after a preview, then shows the live link', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Duyệt PO' }).check();
  await page.getByRole('button', { name: 'Gắn mẫu (tự cập nhật)' }).click();
  await expect(page.getByText('Sẽ thêm 3 quyền.')).toBeVisible();
  await expect(page.getByText('Mua hàng: Duyệt PO')).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận gắn mẫu' }).click();
  await expect(page.getByText('Đang theo mẫu "Quản lý kho" · Duyệt PO')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bỏ liên kết' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gắn mẫu (tự cập nhật)' })).toHaveCount(0);
});

test('blocks linking while the permission table has unsaved edits', async ({ page }) => {
  await page.getByRole('button', { name: 'Điền vào bảng' }).click();
  await expect(page.getByRole('button', { name: 'Gắn mẫu (tự cập nhật)' })).toBeDisabled();
  await expect(page.getByText('Lưu hoặc hủy thay đổi trong bảng quyền trước.')).toBeVisible();
});

test('a linked person can untick an option and unlink without losing permissions', async ({ page }) => {
  await page.goto('/tests/authorization/template-fill-fixture.html?assigned=1');
  await expect(page.getByText('bỏ riêng 1 quyền')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Duyệt PO' }).uncheck();
  await expect(page.getByRole('button', { name: 'Lưu ô tùy chọn' })).toBeVisible();
  await page.getByRole('button', { name: 'Bỏ liên kết' }).click();
  await expect(page.getByText('quyền hiện có giữ nguyên')).toBeVisible();
  await page.getByRole('button', { name: 'Bỏ liên kết' }).last().click();
  await expect(page.getByText('Đã bỏ liên kết mẫu "Quản lý kho". Quyền hiện có giữ nguyên.')).toBeVisible();
});
