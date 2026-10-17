import { expect, test, type Page } from '@playwright/test';

// Nhật ký · Dán báo cáo Zalo → phiếu nháp: tách 3 ngày × mũi, sửa hạng mục, tạo phiếu, học cách gọi. Chrome + iPhone (WebKit).
const URL = '/tests/daily-log/report-import-fixture.html';
const PASTE = `BC ngày 13/10
Tổ a Ích 40 ng, công nhật a Đoàn 2
- SXLD ván khuôn cột tầng 1 nhà Văn Phòng
- Xây bể làm mát nhà xưởng
- SXLD ván khuôn cốt thép sàn mái, lắp đặt ubot sàn mái tầng 2 nhà nghỉ ca

BC ngày 14/10
Tổ a Ích 40, công nhật 1
- Tập kết vật liệu

15/10:
Tổ Mr Ích 35 người, cn a Đoàn 2
- Xây tường hành lang nhà xưởng`;
const UBOT = 'SXLD ván khuôn cốt thép sàn mái, lắp đặt ubot sàn mái tầng 2 nhà nghỉ ca';
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `.daily-log-report-test-results/${name}-${project}.png` });

const readReport = async (page: Page, query = '') => {
  await page.goto(`${URL}${query}`);
  const dialog = page.getByRole('dialog', { name: 'Nhật ký từ báo cáo Zalo' });
  await dialog.getByRole('textbox', { name: 'Báo cáo Zalo' }).fill(PASTE);
  await expect(dialog).toContainText('Thấy 3 ngày trong tin: 13/10, 14/10, 15/10');
  await noSideScroll(page);
  await dialog.getByRole('button', { name: 'AI đọc báo cáo' }).click();
  await expect(dialog).toContainText('AI đang đọc');
  await expect(dialog.getByTestId('report-summary')).toBeVisible({ timeout: 10_000 });
  return dialog;
};

test('dán tin 3 ngày → phiếu nháp theo ngày × mũi, sửa việc phát sinh, tạo phiếu và nhớ cách gọi', async ({ page }, info) => {
  const dialog = await readReport(page);
  await expect(dialog.getByTestId('report-summary')).toContainText('17 dòng việc');
  await expect(dialog.getByTestId('report-summary')).toContainText('ngoài kế hoạch — chờ QS');
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveCount(3);
  await expect(dialog.getByTestId('report-slip')).toHaveCount(8);
  expect(await page.evaluate(() => (window as any).__aiInput)).toMatchObject({ reportDate: '2026-10-17', crews: 'Tổ Đỗ Duy Ích\nTổ Phan Hữu Trịnh\nTổ công nhật Đỗ Hiệp Đoàn' });
  const hall = dialog.locator('li', { hasText: 'Xây tường hành lang nhà xưởng' });
  await expect(hall).toContainText('4.1.3.12');
  await expect(dialog.getByTestId('report-slip').first()).toContainText('Tổ Đỗ Duy Ích· 40 người');
  const ubot = dialog.locator('li', { hasText: UBOT });
  await expect(ubot).toContainText('Ngoài kế hoạch — chờ QS');
  await shot(page, 'review', info.project.name);
  await ubot.getByRole('combobox').fill('3.3.6');
  await page.getByRole('option').first().click();
  await expect(ubot).toContainText('3.3.6');
  await expect(ubot).not.toContainText('Ngoài kế hoạch — chờ QS');
  await noSideScroll(page);
  const nvp14 = dialog.getByTestId('report-slip').nth(3);
  await nvp14.getByRole('checkbox', { name: 'Tạo phiếu' }).uncheck();
  await dialog.getByRole('button', { name: 'Tạo 7 phiếu nháp' }).click();
  const results = dialog.getByTestId('report-results');
  await expect(results).toContainText('13/10 · Nhà xưởng — Đã có phiếu của mũi này trong ngày');
  await expect(results.getByRole('button', { name: 'Mở phiếu' })).toHaveCount(7);
  await shot(page, 'results', info.project.name);
  const learned = await page.evaluate(() => (window as any).__learned as Array<{ kind: string; alias: string; targetLabel: string }>);
  expect(learned.some(p => p.kind === 'task' && p.alias === UBOT && p.targetLabel.startsWith('3.3.6'))).toBe(true);
  expect(learned.some(p => p.kind === 'crew' && p.targetLabel === 'Tổ Đỗ Duy Ích')).toBe(true);
  expect(learned.some(p => p.alias.includes('Xây bể'))).toBe(false);
  await results.getByRole('button', { name: 'Mở phiếu' }).first().click();
  await expect(page.getByRole('status')).toHaveText(/^Mở phiếu 2026-10-13 c-2026-10-13-/);
});

test('đã nhớ cách gọi: dòng "ubot sàn mái tầng 2" tự gắn 3.3.6, tổ công nhật lấy tên chuẩn, AI nhận gợi ý', async ({ page }) => {
  const dialog = await readReport(page, '?memory=1');
  const ubot = dialog.locator('li', { hasText: UBOT });
  await expect(ubot).toContainText('Đã nhớ');
  await expect(ubot).toContainText('3.3.6');
  await expect(dialog.getByTestId('report-slip').nth(3)).toContainText('Tổ công nhật Đỗ Hiệp Đoàn');
  expect((await page.evaluate(() => (window as any).__aiInput)).hints).toContain('→ 3.3.6');
});

test('AI lỗi: báo rõ, giữ chữ đã dán để thử lại', async ({ page }) => {
  await page.goto(`${URL}?ai=fail`);
  const dialog = page.getByRole('dialog', { name: 'Nhật ký từ báo cáo Zalo' });
  await dialog.getByRole('textbox', { name: 'Báo cáo Zalo' }).fill(PASTE);
  await dialog.getByRole('button', { name: 'AI đọc báo cáo' }).click();
  await expect(dialog.getByRole('alert')).toContainText('ghi phiếu như bình thường', { timeout: 10_000 });
  await expect(dialog.getByRole('textbox', { name: 'Báo cáo Zalo' })).toHaveValue(PASTE);
});
