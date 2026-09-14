import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/authorization/editor-fixture.html');
});

test('removing warehouse A preserves global, B and inherited C', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Cấp quyền Xem cho Tài sản', exact: true }).click();
  const scope = page.getByRole('combobox', { name: 'Phạm vi cần gỡ' });
  await expect(scope).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Xác nhận gỡ', exact: true })).toHaveCount(0);
  await scope.selectOption({ label: 'Kho · A' });
  await page.getByRole('button', { name: 'Xác nhận gỡ', exact: true }).click();
  await expect(page.getByLabel('Stored draft')).toHaveText('["global","B"]');
  await expect(page.getByText(/Warehouse-C-role/).first()).toBeVisible();
});

test('individual row uncheck removes the correct tuple after a previous removal', async ({ page }) => {
  const rows = page.locator('div.rounded-xl').filter({ has: page.getByText('Cấp trực tiếp · Kho · A', { exact: true }) });
  await rows.last().getByRole('checkbox').click();
  await expect(page.getByLabel('Stored draft')).toHaveText('["global","B"]');
  const b = page.locator('div.rounded-xl').filter({ has: page.getByText('Cấp trực tiếp · Kho · B', { exact: true }) });
  await b.last().getByRole('checkbox').click();
  await expect(page.getByLabel('Stored draft')).toHaveText('["global"]');
});

test('reload invalidates an outstanding removal confirmation', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Cấp quyền Xem cho Tài sản', exact: true }).click();
  await page.getByRole('combobox', { name: 'Phạm vi cần gỡ' }).selectOption({ label: 'Kho · A' });
  await page.getByRole('button', { name: 'Simulate reload' }).click();
  await expect(page.getByRole('button', { name: 'Xác nhận gỡ', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Stored draft')).toHaveText('["global","A","B"]');
});
