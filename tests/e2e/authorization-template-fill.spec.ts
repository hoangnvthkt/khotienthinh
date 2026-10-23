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
  await expect(page.getByText(/Thêm:.*Mua hàng: Duyệt PO/)).toBeVisible();

  // Đợt 2c: kiêm nhiệm Mua hàng + Duyệt PO phải ghi nhận trước khi gắn.
  await expect(page.getByText('Mẫu này làm người này kiêm nhiệm — ghi nhận trước khi gắn')).toBeVisible();
  await expect(page.getByText('Mua hàng + Duyệt PO')).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Xác nhận gắn mẫu' });
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Người kiểm soát' })).toHaveValue('u-thinh');
  await page.getByRole('textbox', { name: 'Vì sao cần kiêm nhiệm' }).fill('Phó phòng vật tư kiêm duyệt đơn');
  await page.getByRole('button', { name: '+ Ban lãnh đạo xem lại đơn mua lớn hằng tuần' }).click();
  await expect(page.getByRole('radio', { name: '6 tháng' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '12 tháng' }).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const acceptances = await page.evaluate(() => (window as unknown as { __sodAcceptances: Array<Record<string, string>> }).__sodAcceptances);
  expect(acceptances).toHaveLength(1);
  expect(acceptances[0]).toMatchObject({ ruleCode: 'PROCUREMENT_BUY_APPROVE_PO', scopeType: 'global', scopeId: '*',
    controlOwnerUserId: 'u-thinh', compensatingControls: 'Ban lãnh đạo xem lại đơn mua lớn hằng tuần' });
  await expect(page.getByText('Đang theo mẫu "Quản lý kho" · Duyệt PO')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bỏ liên kết' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gắn mẫu (tự cập nhật)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cập nhật theo mẫu' })).toBeVisible();
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

test('the user screen asks for one acknowledgement covering every warehouse before saving', async ({ page }) => {
  await page.goto('/tests/authorization/template-fill-fixture.html?dialog=1');
  await expect(page.getByText('Đang kiêm nhiệm: Mua hàng + Thủ kho (Kho Tổng Hưng Yên)')).toBeVisible();
  await expect(page.getByText('· chưa ghi nhận ngoại lệ')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Ghi nhận kiêm nhiệm' });
  await expect(dialog.getByText('Kho: Kho Tổng Hưng Yên, Kho VPP Hưng Yên')).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Ghi nhận và lưu' });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('title', /Lý do kiêm nhiệm/);
  await dialog.getByRole('textbox', { name: 'Vì sao cần kiêm nhiệm' }).fill('Kế toán công trường kiêm thủ kho');
  await dialog.getByRole('button', { name: '+ Kiểm kê kho định kỳ có người thứ hai' }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByLabel('Sent')).toHaveText('["wh-1","wh-2"]');
});

test('a person who already holds both duties can be acknowledged from the notice', async ({ page }) => {
  await page.goto('/tests/authorization/template-fill-fixture.html?existing=1');
  await expect(page.getByText('Đang kiêm nhiệm: Mua hàng + Thủ kho (Kho Sơn Miền Bắc)')).toBeVisible();
  await page.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ghi nhận kiêm nhiệm' });
  await expect(dialog.getByText('Bùi Thị Tâm đang kiêm 1 việc cần tách người.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Người kiểm soát' })).toHaveValue('u-huong');
  await dialog.getByRole('textbox', { name: 'Vì sao cần kiêm nhiệm' }).fill('Kế toán kiêm thủ kho và mua hàng ở công trường');
  await dialog.getByRole('button', { name: '+ Kế toán đối chiếu phiếu nhập kho với đơn mua hằng tháng' }).click();
  await dialog.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  await expect(page.getByLabel('Sent')).toHaveText('PROCUREMENT_BUY_WAREHOUSE_KEEPER|u-huong|Kế toán đối chiếu phiếu nhập kho với đơn mua hằng tháng');
  await expect(page.getByText(/đã ghi nhận đến .*Nguyễn Thị Hương kiểm soát/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ghi nhận lại' })).toBeVisible();
});
