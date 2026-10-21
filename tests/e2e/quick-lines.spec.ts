import { expect, test } from '@playwright/test';

// Gõ nhanh / Chụp phiếu đề xuất vật tư (fixture: 175 mã thật, AI giả lập). Chạy cả Chrome máy tính và iPhone (WebKit).
const URL = '/tests/material-request/quick-lines-fixture.html';
// Ảnh JPEG 1×1 trắng: đủ để đi hết luồng chụp → AI đọc (AI giả lập trả phiếu mẫu).
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

const noSideScroll = async (page: import('@playwright/test').Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test('gõ danh sách: khớp mã, lệch đơn vị bắt nhập lại, thêm vào phiếu với lý do chung', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('textbox', { name: 'Danh sách vật tư', exact: true }).fill('ong pvc 110 c1 20 cay, cut pvc 110 15 cai\n50 bao xi măng PCB40 cho móng M3');
  const panel = page.getByTestId('quick-lines');
  await expect(panel.getByText('3 dòng · 2 đã khớp mã · 1 chọn mã')).toBeVisible();
  await page.getByRole('textbox', { name: 'Dùng cho', exact: true }).fill('Thoát nước mưa xưởng 1');
  const cement = panel.locator('li').nth(2);
  await cement.locator('select').selectOption({ label: 'Xi măng PCB40 · Tấn · VT00045' });
  await expect(cement.getByText('Câu ghi 50 bao — mã tính theo Tấn, nhập lại số lượng.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Thêm 2 dòng' })).toBeVisible();
  await cement.getByLabel('Số lượng').fill('2,5');
  await panel.getByRole('button', { name: 'Thêm 3 dòng' }).click();
  const rows = page.getByTestId('request-lines').locator('tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Ống PVC 110 C1');
  await expect(rows.nth(0)).toContainText('Thoát nước mưa xưởng 1');
  await expect(rows.nth(2)).toContainText('2.5 Tấn');
  await expect(rows.nth(2)).toContainText('móng M3');
  await noSideScroll(page);
});

test('chụp phiếu viết tay: chọn ảnh từ album → AI đọc → dòng, ngày cần, lý do chung, cảnh báo', async ({ page }) => {
  await page.goto(URL);
  const panel = page.getByTestId('quick-lines');
  await panel.getByRole('button', { name: 'Chụp phiếu' }).click();
  const camera = page.getByRole('dialog', { name: 'Chụp phiếu đề xuất' });
  await expect(camera).toBeVisible();
  await camera.locator('input[type=file][multiple]').setInputFiles({ name: 'phieu.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await camera.getByRole('button', { name: /Xong/ }).click();
  await expect(page.getByTestId('quick-photo')).toContainText('AI đang đọc phiếu');
  await expect(page.getByTestId('quick-photo')).toContainText('AI đã đọc ảnh', { timeout: 10_000 });
  await expect(page.getByTestId('quick-photo')).toContainText('Ngày cần trên phiếu 20/10/2026');
  await expect(page.getByTestId('quick-photo')).toContainText('Dòng 3: số lượng viết đè');
  await expect(page.getByRole('textbox', { name: 'Danh sách vật tư', exact: true })).toHaveValue(/Ống PVC 110 C1 20 cây/);
  await expect(page.getByRole('textbox', { name: 'Dùng cho', exact: true })).toHaveValue('Thoát nước mưa nhà xưởng 1');
  await expect(panel.locator('li:has(select)')).toHaveCount(5);
  await noSideScroll(page);
  const add = panel.getByRole('button', { name: /^Thêm \d+ dòng$/ });
  const n = Number((await add.innerText()).match(/\d+/)![0]);
  expect(n).toBeGreaterThanOrEqual(2);
  await add.click();
  const rows = page.getByTestId('request-lines').locator('tr');
  await expect(rows).toHaveCount(n);
  await expect(rows.first()).toContainText('cần 2026-10-20');
});

test('AI chưa bật: không có nút Chụp phiếu / Nhờ AI tách, gõ nhanh vẫn chạy', async ({ page }) => {
  await page.goto(`${URL}?ai=none`);
  const panel = page.getByTestId('quick-lines');
  await page.getByRole('textbox', { name: 'Danh sách vật tư', exact: true }).fill('cut pvc 110 15 cai');
  await expect(panel.getByText('1 dòng · 1 đã khớp mã')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Chụp phiếu' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Nhờ AI tách' })).toHaveCount(0);
});

test('AI đọc ảnh lỗi: báo rõ, gõ tay vẫn được', async ({ page }) => {
  await page.goto(`${URL}?photo=fail`);
  const panel = page.getByTestId('quick-lines');
  await panel.getByRole('button', { name: 'Chụp phiếu' }).click();
  const camera = page.getByRole('dialog', { name: 'Chụp phiếu đề xuất' });
  await camera.locator('input[type=file][multiple]').setInputFiles({ name: 'phieu.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await camera.getByRole('button', { name: /Xong/ }).click();
  // B1 (21/10): lời báo theo mã lỗi máy chủ (502 → "Nhà cung cấp AI lỗi"), có nút Đọc lại cùng ảnh, không bắt chụp lại.
  const photo = page.getByTestId('quick-photo');
  await expect(photo).toContainText('Nhà cung cấp AI lỗi (502)', { timeout: 10_000 });
  await expect(photo).toContainText('Hoặc chụp lại / gõ tay');
  await expect(photo.getByRole('button', { name: 'Đọc lại' })).toBeVisible();
  await expect(photo.getByRole('button', { name: 'Chụp lại' })).toBeVisible();
  await photo.getByRole('button', { name: 'Đọc lại' }).click();
  await expect(photo).toContainText('Nhà cung cấp AI lỗi (502)', { timeout: 10_000 });
  await page.getByRole('textbox', { name: 'Danh sách vật tư', exact: true }).fill('cut pvc 110 15 cai');
  await expect(panel.getByText('1 dòng · 1 đã khớp mã')).toBeVisible();
});

test('mở từ thẻ nháp Trợ lý: dòng tách sẵn, dùng cho + ngày cần điền sẵn; dòng chưa chắc mã có nút gợi ý bấm là chọn', async ({ page }) => {
  await page.goto(`${URL}?assistant=1`);
  const panel = page.getByTestId('quick-lines');
  await expect(page.getByTestId('quick-assistant')).toContainText('Trợ lý đã tách 3 dòng');
  await expect(page.getByTestId('quick-assistant')).toContainText('Ngày cần 23/10/2026');
  await expect(page.getByRole('textbox', { name: 'Dùng cho', exact: true })).toHaveValue('Đổ bê tông sàn tầng 4');
  // Không tự bật bàn phím điện thoại khi mở từ thẻ.
  await expect(page.getByRole('textbox', { name: 'Danh sách vật tư', exact: true })).not.toBeFocused();
  await expect(panel.locator('li').nth(0).locator('select')).toHaveValue(/.+/);
  const pipe = panel.locator('li').nth(1);
  const hints = pipe.getByRole('group', { name: 'Gợi ý mã cho Ống PVC' }).getByRole('button');
  await expect(hints).toHaveCount(3);
  const pick = (await hints.first().textContent())!.split(' · ')[0];
  await hints.first().click();
  await expect(pipe.getByRole('group', { name: 'Gợi ý mã cho Ống PVC' })).toHaveCount(0);
  await expect(pipe.getByText('Đã khớp')).toBeVisible();
  await panel.getByRole('button', { name: 'Thêm 2 dòng' }).click();
  const rows = page.getByTestId('request-lines').locator('tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Xi măng PCB40');
  await expect(rows.nth(0)).toContainText('2 Tấn');
  await expect(rows.nth(0)).toContainText('cần 2026-10-23');
  await expect(rows.nth(0)).toContainText('Đổ bê tông sàn tầng 4');
  await expect(rows.nth(1)).toContainText(pick);
  await noSideScroll(page);
});
