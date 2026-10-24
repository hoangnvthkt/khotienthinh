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

// Bước 3: Hàng loạt, Sao chép, Kiểm soát, Nhật ký.
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test('bulk: pick a site team, move them to one template, preview each person, apply with a picked reason', async ({ page }) => {
  await page.getByRole('button', { name: 'Phân quyền hàng loạt' }).click();
  await expect(page.getByRole('tab', { name: /Hàng loạt/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /^Ban chỉ huy công trình Sơn Miền Bắc\s*3/ }).click();
  await page.getByRole('button', { name: 'Chọn cả nhóm' }).click();
  await expect(page.getByText('Đã chọn 3 người')).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: /Tiếp: chọn việc/ }).click();
  await page.getByRole('radio', { name: /Gắn vào mẫu/ }).click();
  await page.getByRole('button', { name: 'Cán bộ công trường' }).click();
  await page.getByRole('button', { name: /Tiếp: xem trước/ }).click();
  await expect(page.getByText('Đã theo mẫu này')).toHaveCount(2);
  await expect(page.getByText(/1 người sẽ đổi, thêm 5, gỡ 2 quyền/)).toBeVisible();
  await page.getByRole('radio', { name: 'Điều chuyển bộ phận' }).click();
  await page.getByRole('button', { name: 'Áp dụng cho 1 người' }).click();
  await expect(page.getByText('Đã áp cho 1 người. Mỗi người một dòng nhật ký: “Điều chuyển bộ phận”.')).toBeVisible();
  await expect(page.getByText('Bỏ qua 2 người')).toBeVisible();
  const applied = (await calls(page)).find(call => call.applyBulk)?.applyBulk;
  expect(applied).toMatchObject({ userIds: ['u-luat'], action: { kind: 'template', templateCode: 'site_staff', options: [] },
    reason: 'Phân quyền hàng loạt — gắn mẫu Cán bộ công trường: Điều chuyển bộ phận', ack: null });
  await noOverflow(page);
});

test('bulk: ticking PO approval for a buyer asks for one shared acknowledgement first', async ({ page }) => {
  await page.getByRole('tab', { name: /Hàng loạt/ }).click();
  await page.getByRole('textbox', { name: 'Tìm người' }).fill('bui quang');
  await page.getByRole('checkbox', { name: /Bùi Quang Chung/ }).check();
  await page.getByRole('textbox', { name: 'Tìm người' }).fill('duong xuan');
  await page.getByRole('checkbox', { name: /Dương Xuân Thịnh/ }).check();
  await page.getByRole('button', { name: /Tiếp: chọn việc/ }).click();
  await page.getByRole('radio', { name: /Tích \/ bỏ một ô/ }).click();
  await page.getByRole('button', { name: /^Duyệt PO/ }).click();
  await page.getByRole('button', { name: /Tiếp: xem trước/ }).click();
  await expect(page.getByText('1 người sẽ kiêm nhiệm — một lần ghi nhận dùng cho cả nhóm')).toBeVisible();
  const apply = page.getByRole('button', { name: 'Áp dụng cho 2 người' });
  await expect(apply).toBeDisabled();
  await page.getByRole('textbox', { name: 'Vì sao cần kiêm nhiệm' }).fill('Chuyên viên vật tư kiêm duyệt đơn nhỏ');
  await page.getByRole('combobox', { name: 'Người kiểm soát' }).selectOption('u-mo');
  await page.getByRole('button', { name: '+ Ban lãnh đạo xem lại đơn mua lớn hằng tuần' }).click();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByText(/Đã áp cho 2 người/)).toBeVisible();
  const applied = (await calls(page)).find(call => call.applyBulk)?.applyBulk;
  expect(applied.action).toEqual({ kind: 'option', optionKey: 'po_approver', on: true });
  expect(applied.ack).toMatchObject({ controlOwnerUserId: 'u-mo', reason: 'Chuyên viên vật tư kiêm duyệt đơn nhỏ' });
});

test('bulk: a failed send keeps everyone unchanged and says so', async ({ page }) => {
  await page.goto('/tests/permissions/center-fixture.html?bulkfail=1');
  await page.getByRole('button', { name: 'Phân quyền hàng loạt' }).click();
  await page.getByRole('textbox', { name: 'Tìm người' }).fill('pham minh');
  await page.getByRole('checkbox', { name: /Phạm Minh Tiến/ }).check();
  await page.getByRole('button', { name: /Tiếp: chọn việc/ }).click();
  await page.getByRole('radio', { name: /Thêm một quyền/ }).click();
  await page.getByRole('textbox', { name: 'Tìm quyền' }).fill('duyet cong');
  await page.getByRole('button', { name: /Chấm công: Duyệt\/chốt công/ }).click();
  await page.getByRole('button', { name: /Tiếp: xem trước/ }).click();
  await page.getByRole('button', { name: 'Áp dụng cho 1 người' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Mất kết nối máy chủ' })).toBeVisible();
});

test('copy: from one person to a teammate — template, warehouse keeper — with a preview per person', async ({ page }) => {
  await page.getByRole('button', { name: /Nguyễn Văn Luật/ }).click();
  const panel = isPhone(page) ? page.getByRole('dialog', { name: 'Quyền của Nguyễn Văn Luật' }) : page.locator('aside');
  await panel.getByRole('button', { name: 'Sao chép sang người khác' }).click();
  await expect(page.getByRole('tab', { name: /Sao chép/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: 'Người làm mẫu' })).toHaveValue('u-luat');
  await expect(page.getByRole('checkbox', { name: /Mẫu và ô tích/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Thủ kho theo kho/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Quyền riêng ngoài mẫu/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Phạm Ngọc Sơn/ }).check();
  await expect(page.getByText('Mẫu: Cán bộ công trường → Cán bộ kho (thêm 20, gỡ 0)')).toBeVisible();
  await page.getByRole('button', { name: 'Chép sang 1 người' }).click();
  await expect(page.getByText('Đã chép cho 1 người. Nhật ký ghi: “Chép quyền từ Nguyễn Văn Luật”.')).toBeVisible();
  const copied = (await calls(page)).find(call => call.applyCopy)?.applyCopy;
  expect(copied).toMatchObject({ fromUserId: 'u-luat', toUserIds: ['u-son'], what: { template: true, warehouses: true, extra: false, room: false },
    reason: 'Chép quyền từ Nguyễn Văn Luật: Điều chuyển bộ phận', ack: null });
  await noOverflow(page);
});

test('control: duties to re-record, sensitive rights, expiring rights, rights outside templates', async ({ page }) => {
  await page.getByRole('tab', { name: /Kiểm soát/ }).click();
  await expect(page.getByRole('heading', { name: /Kiêm nhiệm\s*2/ })).toBeVisible();
  await expect(page.getByText(/Đang kiêm nhiệm: Mua hàng \+ Thủ kho/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Quyền nhạy cảm\s*4/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Quyền ngoài mẫu\s*4/ })).toBeVisible();
  await page.getByRole('button', { name: 'Ghi nhận lại' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Ghi nhận kiêm nhiệm' });
  await dialog.getByRole('textbox', { name: 'Vì sao cần kiêm nhiệm' }).fill('Gia hạn kiêm nhiệm thêm 6 tháng theo chủ SP');
  await dialog.getByRole('combobox', { name: 'Người kiểm soát' }).selectOption('u-mo');
  await dialog.getByRole('textbox', { name: 'Kiểm soát bù bằng cách nào' }).fill('Chị Mơ rà soát phiếu hằng tuần');
  await dialog.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await calls(page)).find(call => call.recordExisting)?.recordExisting).toMatchObject({ userId: 'u-tam', ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER' });
  await page.getByRole('button', { name: 'Gia hạn 1 năm cho 1 người' }).click();
  await expect(page.getByRole('tab', { name: /Hàng loạt/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Gia hạn 1 quyền', { exact: true })).toBeVisible();
  await noOverflow(page);
});

test('log: who changed what and why, with unclear reasons flagged and older pages on demand', async ({ page }) => {
  await page.getByRole('tab', { name: /Nhật ký/ }).click();
  await expect(page.getByText('ghi nhận kiêm nhiệm Mua hàng + Thủ kho của Bùi Thị Tâm, Nguyễn Thị Hương kiểm soát đến 23/04/2027')).toBeVisible();
  await expect(page.getByText('gắn mẫu Kế toán cho Bùi Thị Tâm (thêm 21)')).toBeVisible();
  await page.getByRole('button', { name: /^Lý do chưa rõ\s*2/ }).click();
  await expect(page.getByText('Lý do chưa rõ: “Okokokokok”')).toBeVisible();
  await expect(page.getByText('Lý do chưa rõ: “thuannq@tienthinhjsc.vn”')).toBeVisible();
  await page.getByRole('button', { name: 'Xem thêm thay đổi cũ hơn' }).click();
  await expect(page.getByText('Lý do chưa rõ: “Screenshot 2026-09-22 at 11.14.25”')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xem thêm thay đổi cũ hơn' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Room dự án\s*1/ }).click();
  await expect(page.getByText('đổi thành viên Room Nhật ký công trường — Sơn Miền Bắc')).toBeVisible();
  await noOverflow(page);
});
