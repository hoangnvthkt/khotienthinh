import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

// Báo giá NCC "tự do": dòng tiêu đề, tên cột riêng, tên không dấu, ĐVT là đơn vị mua, dòng trùng, vật tư chưa có mã.
const quote = () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['BÁO GIÁ VẬT TƯ — CÔNG TY THÉP VIỆT'],
    [],
    ['STT', 'Tên hàng hóa', 'ĐVT', 'KL', 'Đơn giá (VNĐ)', 'Thành tiền'],
    [1, 'Thép D10 CB300', 'cây', 20, '185.000', 3700000],
    [2, 'Xi mang PCB40', 'bao', 50, 92000, 4600000],
    [3, 'Ống nhựa PPR 25', 'm', 100, 21000, 2100000],
    [4, 'Thép D10 CB300', 'cây', 5, 185000, 925000],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Bao gia');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
};

test('nhập báo giá Excel vào đơn chủ động: khớp danh mục, quy đổi đơn vị, gộp dòng trùng', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tests/procurement/po-excel-import-fixture.html');
  await expect(page.getByRole('button', { name: 'Nhập từ Excel' })).toBeDisabled();
  await page.getByRole('combobox', { name: /Dự án nhận hàng/ }).or(page.locator('select').first()).selectOption('smb');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải mẫu Excel' }).click()]);
  expect(download.suggestedFilename()).toBe('Mau_vat_tu_don_hang.xlsx');

  await page.locator('input[type=file][accept=".xlsx,.xls,.csv"]').setInputFiles({ name: 'bao-gia.xlsx', mimeType: 'application/octet-stream', buffer: quote() });
  const dialog = page.getByRole('dialog', { name: 'Xem trước vật tư nhập từ Excel' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('2 khớp chắc chắn');
  await expect(dialog).toContainText('1 gợi ý theo tên');
  await expect(dialog).toContainText('1 chưa có trong danh mục');
  await expect(dialog).toContainText('Mua 20 cây = 144,4 kg');
  await expect(dialog.getByRole('combobox', { name: 'Vật tư cho dòng 2' })).toHaveValue('xm40');
  await expect(dialog.getByRole('combobox', { name: 'Vật tư cho dòng 3' })).toHaveValue('__skip__');
  await expect(dialog).toContainText('Gộp 1 dòng trùng vật tư thành một');
  await page.screenshot({ path: `.procurement-test-results/po-import-${info.project.name}.png` });
  await dialog.getByRole('button', { name: 'Đưa 2 vật tư vào đơn' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByRole('textbox', { name: 'SL Thép D10 CB300' })).toHaveValue('180,5');
  await expect(page.getByRole('textbox', { name: 'Đơn giá Thép D10 CB300' })).toHaveValue('185000');
  await expect(page.getByRole('textbox', { name: 'SL Xi măng PCB40 Bút Sơn' })).toHaveValue('50');
  await page.screenshot({ path: `.procurement-test-results/po-import-after-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
