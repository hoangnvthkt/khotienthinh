import { test, expect, type Page } from '@playwright/test';

// Gợi ý "Như đơn trước" trên Lập đơn chủ động (fixture, RPC Supabase mock): đầu đơn một khối, quy cách / giá in mờ, Tab để dùng,
// giá lệch > 5% báo cam.
const base = '/tests/procurement/prefill-fixture.html';
const ghost = (page: Page) => page.getByTestId('prefill-ghost');

const PROJECTS = { projects: [{ id: 'p1', code: 'SMB-2026', name: 'Nhà máy SMB', status: 'active', warehouses: [{ id: 'w1', name: 'Kho công trường SMB' }] }], stockWarehouses: [] };
const VENDORS = [{ id: 'v1', name: 'Hoàng Gia', taxCode: null, recentOrders: 7 }];
const ITEMS = [{ id: 'i1', name: 'Bê tông M300', sku: 'BT300', unit: 'm³', purchaseUnit: null, purchaseFactor: null, inBoq: true, boqQty: 460, orderedQty: 120 }];
const PREFILL = {
  order: { poNumber: 'PO-627', orderDate: '2026-10-08', vatRate: 8, purchaseMode: 'multiple', projectId: 'p1', constructionSiteId: null, targetWarehouseId: 'w1' },
  lines: [{ itemId: 'i1', specification: 'M300 R28', unit: 'm³', stockUnit: 'm³', factor: 1, unitPrice: 1250000, poNumber: 'PO-627', orderDate: '2026-10-08' }],
};

test.beforeEach(async ({ page }) => {
  // Route đăng ký sau được xét trước: bảng thường trả rỗng, RPC trả dữ liệu minh họa.
  await page.route('**/rest/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/rpc/**', route => {
    const fn = new URL(route.request().url()).pathname.split('/').pop();
    const body = fn === 'list_procurement_proactive_options_v1' ? PROJECTS
      : fn === 'list_procurement_vendors_v1' ? VENDORS
        : fn === 'search_procurement_items_v1' ? ITEMS
          : fn === 'get_procurement_vendor_prefill_v1' ? PREFILL
            : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(base);
  await page.getByLabel('Dự án nhận hàng').selectOption('p1');
  await page.getByLabel('Nhà cung cấp').click();
  await page.getByRole('option', { name: /Hoàng Gia/ }).click();
});

const addItem = async (page: Page) => {
  await page.getByLabel('Thêm vật tư').click();
  await page.getByRole('option', { name: /Bê tông M300/ }).click();
};

test('chọn NCC: đầu đơn in mờ VAT và hình thức giao của đơn trước; Dùng là điền', async ({ page, isMobile }) => {
  await expect(ghost(page)).toContainText('Như đơn trước');
  await expect(ghost(page)).toContainText('PO-627 (8/10)');
  await expect(ghost(page)).toContainText('VAT 8%');
  await expect(ghost(page)).toContainText('Giao nhiều đợt');
  if (isMobile) await page.getByRole('button', { name: 'Dùng' }).tap(); else await page.getByRole('button', { name: 'Dùng' }).click();
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '8%' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('radio', { name: 'Giao nhiều đợt' })).toHaveAttribute('aria-checked', 'true');
});

test('tự sửa VAT thì khối gợi ý biến mất; Bỏ cũng ẩn', async ({ page }) => {
  await page.getByRole('button', { name: '0%', exact: true }).click();
  await expect(ghost(page)).toHaveCount(0);
});

test('dòng vật tư: quy cách và đơn giá in mờ theo dòng mua gần nhất, Tab điền rồi sang ô kế; giá lệch báo cam', async ({ page, isMobile }) => {
  test.skip(isMobile, 'điện thoại không có phím Tab');
  await addItem(page);
  const spec = page.getByLabel('Quy cách Bê tông M300');
  const price = page.getByLabel('Đơn giá Bê tông M300');
  await expect(spec).toHaveAttribute('placeholder', 'M300 R28');
  await expect(price).toHaveAttribute('placeholder', '1.250.000');
  await expect(price).toHaveAttribute('title', /PO-627 \(8\/10\)/);
  await spec.focus();
  await page.keyboard.press('Tab');
  await expect(spec).toHaveValue('M300 R28');
  await expect(spec).not.toBeFocused();
  await price.focus();
  await page.keyboard.press('Tab');
  await expect(price).toHaveValue('1250000');
  await expect(page.getByText(/Lệch/)).toHaveCount(0);
  await price.fill('1400000');
  await expect(page.getByText('Lệch +12% so với PO-627 (8/10)')).toBeVisible();
  await price.fill('1230000');
  await expect(page.getByText(/Lệch/)).toHaveCount(0);
});

test('quy cách khác hẳn thì không gợi ý giá', async ({ page, isMobile }) => {
  test.skip(isMobile, 'cùng luồng với máy tính');
  await addItem(page);
  await page.getByLabel('Quy cách Bê tông M300').fill('M400');
  await expect(page.getByLabel('Đơn giá Bê tông M300')).toHaveAttribute('placeholder', '0');
});

test('điện thoại: khối gợi ý không tràn ngang, bấm Dùng điền đầu đơn', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'chỉ đo trên điện thoại');
  await expect(ghost(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Dùng' }).tap();
  await expect(page.getByRole('button', { name: '8%' })).toHaveAttribute('aria-pressed', 'true');
});
