import { expect, test, type Page } from '@playwright/test';

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __centerCalls: Array<Record<string, any>> }).__centerCalls);
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 1024;

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/permissions/center-fixture.html');
  await expect(page.getByRole('heading', { name: 'Phân quyền', level: 1 })).toBeVisible();
});

test('shows the company at a glance: tiles, departments and people coloured by template', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Người\s*11/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Đã theo mẫu\s*10\/11/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Kiêm nhiệm\s*2/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ban chỉ huy công trình Sơn Miền Bắc' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chưa có phòng' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Nguyễn Văn Vĩnh.*Chưa gắn mẫu/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Phân quyền kho/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('search without accents and the tiles narrow the list', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Tìm người' }).fill('duong xuan');
  await expect(page.getByText('1 người · 1 phòng ban, công trường')).toBeVisible();
  await page.getByRole('button', { name: 'Xóa lọc' }).first().click();
  await page.getByRole('button', { name: /Kiêm nhiệm\s*2/ }).click();
  await expect(page.getByText('2 người · 2 phòng ban, công trường')).toBeVisible();
  await expect(page.getByRole('button', { name: /Bùi Thị Tâm/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Đặng Thị Thu Hà/ })).toBeVisible();
});

test('one person: template, what they can do, what differs, and duties held elsewhere', async ({ page }) => {
  await page.getByRole('button', { name: /Bùi Thị Tâm/ }).click();
  const panel = isPhone(page) ? page.getByRole('dialog', { name: 'Quyền của Bùi Thị Tâm' }) : page.locator('aside');
  await expect(panel.getByRole('heading', { name: 'Bùi Thị Tâm' })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Mẫu quyền' })).toHaveValue('accountant');
  await expect(panel.getByRole('checkbox', { name: /Kế toán kho/ })).toBeChecked();
  await expect(panel.getByText('Công nợ, đề nghị chi, thu chi, sao kê, hóa đơn')).toBeVisible();
  await expect(panel.getByText('Có 22 quyền riêng ngoài mẫu')).toBeVisible();
  await expect(panel.getByText('Mua hàng + Thủ kho')).toBeVisible();
  await expect(panel.getByText(/Nguyễn Thị Hương đến 23\/4\/2027|Nguyễn Thị Hương đến 23\/04\/2027/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Chỉnh chi tiết' }).click();
  expect((await calls(page)).some(call => call.openDetail === 'u-tam')).toBe(true);
});

test('changing the template previews the change and asks to record a conflicting duty before saving', async ({ page }) => {
  await page.getByRole('button', { name: /Bùi Quang Chung/ }).click();
  const panel = isPhone(page) ? page.getByRole('dialog', { name: 'Quyền của Bùi Quang Chung' }) : page.locator('aside');
  await panel.getByRole('checkbox', { name: /Duyệt PO/ }).check();
  await expect(panel.getByText('Sẽ thêm 2 quyền, gỡ 0 quyền mẫu cũ. Quyền ngoài mẫu giữ nguyên.')).toBeVisible();
  await expect(panel.getByText('Thay đổi này làm người này kiêm nhiệm — ghi nhận trước khi lưu')).toBeVisible();
  const save = panel.getByRole('button', { name: 'Lưu thay đổi' });
  await expect(save).toBeDisabled();
  await expect(panel.getByRole('combobox', { name: 'Người kiểm soát' })).toHaveValue('u-ha');
  await panel.getByRole('textbox', { name: 'Vì sao cần kiêm nhiệm' }).fill('Chuyên viên vật tư kiêm duyệt đơn nhỏ');
  await panel.getByRole('button', { name: '+ Ban lãnh đạo xem lại đơn mua lớn hằng tuần' }).click();
  await panel.getByRole('radio', { name: 'Chủ SP duyệt' }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByText('Đã lưu: thêm 2, gỡ 0 quyền.')).toBeVisible();
  const saved = (await calls(page)).find(call => call.save)?.save;
  expect(saved).toMatchObject({ userId: 'u-chung', code: 'material_staff', options: ['po_approver'], reason: 'Trung tâm phân quyền: Chủ SP duyệt — mẫu "Mua hàng"' });
  expect(saved.acceptances[0]).toMatchObject({ ruleCode: 'PROCUREMENT_BUY_APPROVE_PO', controlOwnerUserId: 'u-ha' });
});

test('templates tab: colours, what each template allows, its people, and editing the plain-language summary', async ({ page }) => {
  await page.getByRole('tab', { name: /Theo vị trí/ }).click();
  await page.getByRole('button', { name: /^Kế toán\s/ }).click();
  await expect(page.getByRole('heading', { name: 'Kế toán', level: 2 })).toBeVisible();
  await expect(page.getByText('Ô tích: Kế toán trưởng').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Người đang theo mẫu (2)' })).toBeVisible();
  await page.getByRole('button', { name: 'Sửa mô tả' }).click();
  await page.getByRole('textbox', { name: 'Làm được gì' }).first().fill('Công nợ, đề nghị chi, thu chi');
  await page.getByRole('button', { name: 'Lưu mô tả' }).click();
  await expect(page.getByText('Công nợ, đề nghị chi, thu chi', { exact: true })).toBeVisible();
  expect((await calls(page)).find(call => call.saveSummary)?.saveSummary.code).toBe('accountant');
  await page.getByRole('button', { name: 'Nguyễn Thị Hương' }).click();
  await expect(page.getByRole('heading', { name: 'Nguyễn Thị Hương' })).toBeVisible();
});

test('a phone opens one person full screen and closes back to the list', async ({ page }) => {
  test.skip(!isPhone(page), 'chỉ khổ điện thoại / tablet');
  await page.getByRole('button', { name: /Phạm Ngọc Sơn/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Quyền của Phạm Ngọc Sơn' });
  await expect(dialog.getByRole('button', { name: 'Lưu thay đổi' })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Phạm Ngọc Sơn/ })).toBeVisible();
});

test('denied and error states say what happened instead of showing zeros', async ({ page }) => {
  await page.goto('/tests/permissions/center-fixture.html?denied=1');
  await expect(page.getByText('Bạn chưa có quyền phân quyền')).toBeVisible();
  await page.goto('/tests/permissions/center-fixture.html?fail=1');
  await expect(page.getByRole('alert')).toContainText('Mất kết nối máy chủ');
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
});
