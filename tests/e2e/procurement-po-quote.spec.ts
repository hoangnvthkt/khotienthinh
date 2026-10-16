import { test, expect, type Page } from '@playwright/test';

// Lập đơn chủ động · Chụp / dán báo giá (fixture: danh mục thép thật, kết quả AI thật đọc báo giá HANAKA). Chrome máy tính + iPhone (WebKit).
const URL = '/tests/procurement/po-quote-fixture.html';
// Ảnh JPEG 1×1 trắng: đủ để đi hết luồng chụp → AI đọc (AI giả lập trả báo giá HANAKA).
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

const open = async (page: Page, query = '') => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // Ghi thống kê gợi ý (ui_suggestion_events) không có máy chủ trong fixture.
  await page.route('**/rest/v1/**', r => r.fulfill({ status: 201, body: '' }));
  await page.goto(`${URL}${query}`);
  await page.getByRole('combobox', { name: /Dự án nhận hàng/ }).or(page.locator('select').first()).selectOption('smb');
  return errors;
};
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

test('chụp báo giá thép bán theo kg → dòng đơn theo cây NCC ghi, tiền theo kg, đúng loại thép vằn', async ({ page }, info) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Chụp / dán báo giá' }).click();
  const quote = page.getByRole('dialog', { name: 'Đọc báo giá' });
  await expect(quote.getByRole('button', { name: 'Đọc báo giá' })).toBeDisabled();
  await quote.getByRole('button', { name: 'Chụp / chọn ảnh' }).click();
  const camera = page.getByRole('dialog', { name: 'Chụp báo giá' });
  await expect(camera).toBeVisible();
  await camera.locator('input[type=file][multiple]').setInputFiles({ name: 'bao-gia.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await camera.getByRole('button', { name: /Xong/ }).click();
  await expect(quote.getByRole('img', { name: 'Ảnh báo giá 1' })).toBeVisible();
  await expect(quote.getByRole('button', { name: 'Chụp thêm' })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: `.procurement-test-results/po-quote-dialog-${info.project.name}.png` });
  await quote.getByRole('button', { name: 'Đọc báo giá' }).click();
  await expect(quote).toContainText('AI đang đọc');

  const review = page.getByRole('dialog', { name: 'Xem trước vật tư từ báo giá' });
  await expect(review).toBeVisible({ timeout: 10_000 });
  await expect(quote).toHaveCount(0);
  const info1 = review.getByTestId('quote-info');
  await expect(info1).toContainText('không ghi rõ — chọn ở ô NCC của đơn');
  await expect(info1).toContainText('Cộng tiền hàng 985.957.679 đ (cộng dòng lệch 1 đ do làm tròn)');
  await expect(info1).toContainText('VAT 10% = 98.595.768 đ');
  await expect(info1).toContainText('8 lưu ý của AI');
  // CB500 là thép vằn → Thép XD, không phải tròn trơn cùng đường kính.
  await expect(review.getByRole('combobox', { name: 'Vật tư cho dòng 1' })).toHaveValue('xd8');
  await expect(review.getByRole('combobox', { name: 'Vật tư cho dòng 2' })).toHaveValue('xd10');
  await expect(review.getByRole('combobox', { name: 'Vật tư cho dòng 3' })).toHaveValue('xd16');
  await expect(review.getByRole('combobox', { name: 'Vật tư cho dòng 6' })).toHaveValue('xd25');
  await expect(review).toContainText('SL 21.490,1 kg · 3115 cây · 14.930 đ');
  await expect(review).toContainText('Mua 21.490,1 Kg = 3.115 Cây');
  await expect(review).toContainText('Báo giá ghi 3.115 Cây; hệ số danh mục ra 2.984,7 Cây (lệch 4,2%) — đơn lấy 3.115 Cây theo báo giá');
  await noSideScroll(page);
  await page.screenshot({ path: `.procurement-test-results/po-quote-review-${info.project.name}.png` });
  await review.getByRole('button', { name: 'Đưa 6 vật tư vào đơn' }).click();
  await expect(review).toHaveCount(0);

  await expect(page.getByRole('textbox', { name: 'SL Thép XD D10' })).toHaveValue('3115');
  await expect(page.getByRole('textbox', { name: 'SL mua Thép XD D10' })).toHaveValue('21490,1');
  await expect(page.getByRole('textbox', { name: 'Đơn giá Thép XD D10' })).toHaveValue('14930');
  await expect(page.getByRole('textbox', { name: 'SL Thép XD D8' })).toHaveValue('6300');
  await expect(page.getByRole('textbox', { name: 'SL Thép XD D16' })).toHaveValue('560');
  await expect(page.getByRole('textbox', { name: 'SL mua Thép XD D16' })).toHaveValue('10192');
  await expect(page.getByText('Chưa tìm thấy NCC trên báo giá')).toHaveCount(0);
  await noSideScroll(page);
  await page.screenshot({ path: `.procurement-test-results/po-quote-after-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => (window as any).__aiCalls)).toEqual([{ skill: 'po_quote_lines', text: '', images: 1 }]);
  expect(errors).toEqual([]);
});

test('dán chữ báo giá có tên + MST NCC: tự chọn NCC, VAT theo báo giá', async ({ page }) => {
  const errors = await open(page, '?vendor=1');
  await page.getByRole('button', { name: 'Chụp / dán báo giá' }).click();
  const quote = page.getByRole('dialog', { name: 'Đọc báo giá' });
  await quote.getByRole('textbox', { name: 'Chữ báo giá' }).fill('Báo giá thép Shengli CB500: D10 21.490,1 kg x 14.930; D16 10.192 kg x 14.750 …');
  await quote.getByRole('button', { name: 'Đọc báo giá' }).click();
  const review = page.getByRole('dialog', { name: 'Xem trước vật tư từ báo giá' });
  await expect(review.getByTestId('quote-info')).toContainText('CÔNG TY TNHH THÉP HANAKA · MST 0109876543', { timeout: 10_000 });
  await expect(review.getByTestId('quote-info')).toContainText('VAT 8% = 78.876.614 đ');
  await review.getByRole('button', { name: /^Đưa \d+ vật tư vào đơn$/ }).click();
  await expect(page.getByText('Đã chọn NCC theo báo giá')).toBeVisible();
  await expect(page.locator('#po-vendor')).toContainText('Công ty TNHH Thép HANAKA');
  await expect(page.getByRole('button', { name: '8%' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).__aiCalls[0].images)).toBe(0);
  expect(errors).toEqual([]);
});

test('AI lỗi: báo rõ, giữ ảnh / chữ để thử lại; Esc đóng hộp mà không đóng đơn', async ({ page }) => {
  await open(page, '?ai=fail');
  await page.getByRole('button', { name: 'Chụp / dán báo giá' }).click();
  const quote = page.getByRole('dialog', { name: 'Đọc báo giá' });
  await quote.getByRole('textbox', { name: 'Chữ báo giá' }).fill('Thép D10 CB500 21.490 kg x 14.930');
  await quote.getByRole('button', { name: 'Đọc báo giá' }).click();
  await expect(quote.getByRole('alert')).toContainText('Thử lại hoặc nhập từ Excel', { timeout: 10_000 });
  await expect(quote.getByRole('textbox', { name: 'Chữ báo giá' })).toHaveValue('Thép D10 CB500 21.490 kg x 14.930');
  await expect(quote.getByRole('button', { name: 'Đọc báo giá' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(quote).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nhập từ Excel' })).toBeVisible();
});

test('AI chưa bật: không có nút Chụp / dán báo giá, Nhập từ Excel vẫn dùng được', async ({ page }) => {
  await open(page, '?ai=none');
  await expect(page.getByRole('button', { name: 'Nhập từ Excel' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Chụp / dán báo giá' })).toHaveCount(0);
});
