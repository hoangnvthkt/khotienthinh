import { expect, test, type Page } from '@playwright/test';

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __wmsCalls: Array<Record<string, any>> }).__wmsCalls);

const addChungAsKeeper = async (page: Page) => {
  const card = page.locator('div.rounded-xl').filter({ has: page.getByText('Kho Sơn Miền Bắc', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Thêm' }) }).first();
  await card.getByRole('button', { name: 'Thêm' }).click();
  await page.getByRole('textbox', { name: 'thủ kho Kho Sơn Miền Bắc' }).fill('bui quang');
  await page.getByRole('button', { name: 'Bùi Quang Chung' }).click();
  await page.getByRole('button', { name: 'Lưu', exact: true }).first().click();
  return page.getByRole('dialog', { name: 'Lưu phân quyền kho' });
};

test('kho: a buyer made warehouse keeper must be acknowledged before saving, with a picked reason', async ({ page }) => {
  await page.goto('/tests/wms/access-sod-fixture.html');
  const dialog = await addChungAsKeeper(page);
  await expect(dialog.getByText('+ Bùi Quang Chung — Giao dịch kho: Thủ kho @ Kho Sơn Miền Bắc')).toBeVisible();
  await expect(dialog.getByText('Gồm phần máy chủ tự chuẩn hóa', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Bùi Quang Chung sẽ kiêm nhiệm — ghi nhận trước khi lưu')).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Lưu', exact: true });
  await expect(save).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Vì sao cần kiêm nhiệm' }).fill('Thủ kho tạm khi chị Nhung nghỉ phép');
  await dialog.getByRole('combobox', { name: 'Người kiểm soát' }).selectOption('u-mo');
  await dialog.getByRole('button', { name: '+ Người khác đối chiếu phiếu nhập với đơn mua hằng tuần' }).click();
  await dialog.getByRole('radio', { name: 'Điều chuyển bộ phận' }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toHaveCount(0);
  const saved = (await calls(page)).find(call => call.save)?.save;
  expect(saved.reason).toBe('Điều chuyển bộ phận');
  expect(saved.ack).toMatchObject({ controlOwnerUserId: 'u-mo', reason: 'Thủ kho tạm khi chị Nhung nghỉ phép' });
  expect(saved.keepers['wh-smb']).toContain('u-chung');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('kho: someone who cannot manage permissions is told to ask the permission manager', async ({ page }) => {
  await page.goto('/tests/wms/access-sod-fixture.html?staff=1');
  const dialog = await addChungAsKeeper(page);
  await expect(dialog.getByRole('alert').filter({ hasText: 'nhờ người quản lý phân quyền lưu và ghi nhận' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
});
