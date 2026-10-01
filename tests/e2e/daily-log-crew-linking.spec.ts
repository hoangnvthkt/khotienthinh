import { test, expect } from '@playwright/test';

const links = {
  pending: [
    { key: 'phan huu trinh', names: ['tổ Phan Hữu Trịnh', 'Phan Hữu Trịnh'], lineIds: ['l1', 'l2', 'l3'], lines: 3, people: 12, laborHours: 96, firstDate: '2026-09-20', lastDate: '2026-09-28', legacyLines: 1 },
    { key: 'do hiep doan', names: ['Tổ Đỗ Hiệp Đoàn', 'tổ Đổ Hiệp Đoàn'], lineIds: ['l4', 'l5'], lines: 2, people: 8, laborHours: 64, firstDate: '2026-09-21', lastDate: '2026-09-22', legacyLines: 0 },
  ],
  linked: [{ contractItemId: 'item-2', contractCode: 'HĐGK-02', crewName: 'Tổ Vũ Văn Vui', lineCode: 'CN01', lineName: 'Công nhật xây trát', unit: 'công', names: ['Vũ Văn Vui'], lineIds: ['l9'], lines: 1, people: 4, laborHours: 32 }],
  contractLines: [
    { id: 'item-1', code: 'CN01', name: 'Công nhật cốt thép', unit: 'công', contractId: 'sc-1', contractCode: 'HĐGK-01', crewName: 'Tổ Phan Hữu Trịnh' },
    { id: 'item-2', code: 'CN01', name: 'Công nhật xây trát', unit: 'công', contractId: 'sc-2', contractCode: 'HĐGK-02', crewName: 'Tổ Vũ Văn Vui' },
  ],
};

test('QS groups crew names, links chosen groups to a contract line and can undo with a reason', async ({ page }) => {
  const calls: Array<{ name: string; body: any }> = [];
  await page.route('**/rest/v1/rpc/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON();
    calls.push({ name, body });
    const payload = name === 'link_daily_log_labor_to_contract_v1' ? { linked: 3 }
      : name === 'unlink_daily_log_labor_contract_v1' ? { unlinked: 1 } : links;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.goto('/tests/daily-log/crew-linking-fixture.html');
  const panel = page.getByRole('region', { name: 'Nhân công chờ gắn hợp đồng' });
  await expect(panel.getByText('2 tổ chờ ghép')).toBeVisible();
  await panel.getByRole('button', { name: /Nhân công từ nhật ký/ }).click();
  await expect(panel.getByText('tổ Phan Hữu Trịnh · Phan Hữu Trịnh')).toBeVisible();
  await expect(panel.getByText(/3 dòng · 12 lượt người · 96 giờ công .* gồm 1 dòng nhật ký cũ/)).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Ghép/ })).toBeDisabled();
  await panel.getByRole('checkbox').first().check();
  await panel.getByLabel('Ghép vào dòng hợp đồng').selectOption('item-1');
  await page.screenshot({ path: 'test-results/crew-linking-1440.png' });
  await panel.getByRole('button', { name: 'Ghép 3 dòng' }).click();
  await expect(panel.getByRole('status')).toHaveText('Đã ghép 3 dòng nhân công vào hợp đồng.');
  expect(calls.find(call => call.name === 'link_daily_log_labor_to_contract_v1')?.body).toMatchObject({ p_line_ids: ['l1', 'l2', 'l3'], p_contract_item_id: 'item-1' });

  await panel.getByText('Đã ghép (1 dòng hợp đồng)').click();
  await panel.getByRole('button', { name: 'Bỏ ghép' }).click();
  await expect(panel.getByRole('button', { name: 'Xác nhận bỏ ghép' })).toBeDisabled();
  await panel.getByPlaceholder('Lý do bỏ ghép (bắt buộc)').fill('Ghép nhầm tổ');
  await panel.getByRole('button', { name: 'Xác nhận bỏ ghép' }).click();
  await expect(panel.getByRole('status')).toHaveText('Đã bỏ ghép 1 dòng; chúng quay lại danh sách chờ.');
  expect(calls.find(call => call.name === 'unlink_daily_log_labor_contract_v1')?.body).toMatchObject({ p_line_ids: ['l9'], p_reason: 'Ghép nhầm tổ' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/crew-linking-390.png', fullPage: true });
});

test('stays hidden for people without acceptance edit rights', async ({ page }) => {
  await page.route('**/rest/v1/rpc/*', route => route.fulfill({ status: 403, contentType: 'application/json',
    body: JSON.stringify({ code: '42501', message: 'DAILY_LOG_CONTRACT_LINK_DENIED' }) }));
  await page.goto('/tests/daily-log/crew-linking-fixture.html');
  await page.waitForTimeout(1000);
  await expect(page.getByRole('region', { name: 'Nhân công chờ gắn hợp đồng' })).toHaveCount(0);
});
