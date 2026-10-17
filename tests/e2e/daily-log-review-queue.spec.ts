import { expect, test, type Page } from '@playwright/test';

// Nhật ký · Duyệt nhanh: thẻ chờ duyệt, duyệt lần lượt tự sang ngày sau, duyệt thay. Chrome máy tính + iPhone (WebKit).
const URL = '/tests/daily-log/review-queue-fixture.html';
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `.daily-log-review-test-results/${name}-${project}.png` });

test('người được giao: thẻ đầu trang → duyệt lần lượt, xong phiếu tự mở ngày sau, hết hàng thì đóng', async ({ page }, info) => {
  await page.goto(URL);
  const card = page.getByTestId('daily-log-review-queue');
  await expect(card).toContainText('5 nhật ký chờ bạn duyệt');
  await expect(card).toContainText('01, 05–08/10 · lâu nhất 14 ngày');
  await expect(card.getByRole('link', { name: /DA29 · 1/ })).toBeVisible();
  await noSideScroll(page);
  await shot(page, 'card', info.project.name);
  await card.getByRole('button', { name: 'Duyệt lần lượt' }).click();
  const bar = page.getByTestId('daily-log-review-bar');
  await expect(bar).toContainText('Chờ bạn duyệt · 1/5');
  await expect(bar.getByRole('button', { name: '01/10' })).toHaveAttribute('aria-current', 'true');
  await shot(page, 'bar', info.project.name);
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await expect(bar).toContainText('Chờ bạn duyệt · 1/4');
  await expect(bar.getByRole('button', { name: '05/10' })).toHaveAttribute('aria-current', 'true');
  await bar.getByRole('button', { name: '08/10' }).click();
  await expect(bar).toContainText('4/4');
  await bar.getByRole('button', { name: 'Nhật ký trước' }).click();
  await expect(bar).toContainText('3/4');
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Xem nhật ký' })).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Đã xử lý hết nhật ký chờ duyệt ở dự án này');
  await expect(card).not.toContainText('chờ bạn duyệt');
  await noSideScroll(page);
});

test('người duyệt dự phòng: phiếu treo quá 2 ngày → Duyệt thay có lý do → thành phiếu của mình', async ({ page }, info) => {
  await page.goto(`${URL}?as=hoang`);
  const card = page.getByTestId('daily-log-review-queue');
  await expect(card).toContainText('5 nhật ký treo quá 2 ngày');
  await expect(card).toContainText('chờ Phạm Ngọc Sơn · bạn là người duyệt dự phòng');
  await card.getByRole('button', { name: 'Xem để duyệt thay' }).click();
  const bar = page.getByTestId('daily-log-review-bar');
  await expect(bar).toContainText('Treo quá 2 ngày · 1/5');
  await expect(bar).toContainText('Phạm Ngọc Sơn chưa duyệt · chờ 14 ngày');
  await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toBeDisabled();
  await noSideScroll(page);
  await shot(page, 'takeover', info.project.name);
  await bar.getByRole('button', { name: 'Duyệt thay' }).click();
  const ask = page.getByRole('dialog', { name: 'Duyệt thay nhật ký' });
  await ask.getByRole('textbox', { name: 'Lý do' }).fill('Anh Sơn đi công tác');
  await ask.getByRole('button', { name: 'Nhận duyệt thay' }).click();
  await expect(bar).toContainText('Chờ bạn duyệt · 1/1');
  await expect(bar).not.toContainText('Duyệt thay');
  await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toBeEnabled();
  await expect(card).toContainText('4 nhật ký treo quá 2 ngày');
});
