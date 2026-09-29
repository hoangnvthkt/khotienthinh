import { test, expect } from '@playwright/test';
import { engineerBundle } from '../daily-log/engineer-bundle';
const workNotes = async (page: any) => {
  await page.getByRole('button', { name: /Công tác thực hiện/ }).filter({ visible: true }).first().click();
  return page.getByRole('textbox',{name:'Công tác thực hiện',exact:true}).filter({ visible: true });
};
test('duplicate area creation offers the existing slip rather than trapping an editable form', async ({page}) => {
  await page.route('**/rest/v1/rpc/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({status:name === 'create_daily_log_source_v2' ? 409 : 200,contentType:'application/json',
      body:JSON.stringify(name === 'create_daily_log_source_v2' ? {code:'23505',message:'DAILY_LOG_SOURCE_AREA_EXISTS',details:JSON.stringify({contributionId:'source-A'})} : engineerBundle)});
  });
  await page.goto('/tests/daily-log/engineer-fixture.html?workspace');
  await page.getByRole('button',{name:'Tạo phiếu khu vực khác'}).click();
  await page.getByLabel('Mã khu vực mới').fill('A'); await page.getByLabel('Tên khu vực mới').fill('Khu A');
  await page.getByRole('button',{name:'Tạo phiếu',exact:true}).click();
  await expect(page.getByLabel('Mã khu vực mới')).toBeEnabled();
  await page.getByRole('button',{name:'Mở phiếu có sẵn'}).click();
  await expect(page.getByText('Nội dung cũ', { exact: true })).toBeVisible();
});
test('work notes and issues are bullet lists under each item, collapsed until opened', async ({ page }) => {
  await page.goto('/tests/daily-log/engineer-fixture.html');
  await expect(page.getByRole('textbox',{name:'Công tác thực hiện',exact:true})).toHaveCount(0);
  const work = await workNotes(page);
  await work.fill('');
  await page.keyboard.type('Ép 3 cọc');
  await expect(work).toHaveValue('- Ép 3 cọc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Nghiệm thu tim');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(work).toHaveValue('- Ép 3 cọc\n- Nghiệm thu tim\n- ');
  const issues = page.getByRole('textbox',{name:'Sự cố / vướng mắc',exact:true}).filter({ visible: true });
  await issues.click();
  await expect(issues).toHaveValue('- ');
  await expect(work).toHaveValue('- Ép 3 cọc\n- Nghiệm thu tim');
  await page.keyboard.type('Máy ép hỏng 2 giờ');
  await expect(page.getByRole('button', { name: /2 công tác/ }).filter({ visible: true })).toBeVisible();
});
test('one quantity input derives today/cumulative and mode switch preserves the result', async ({ page }) => {
  await page.goto('/tests/daily-log/engineer-fixture.html');
  const entry = page.getByLabel('Khối lượng hôm nay', { exact: true }).filter({ visible: true });
  await expect(entry).toHaveValue('12,5');
  await entry.fill('12');
  await expect(page.getByText('52 m³', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Cách nhập khối lượng').filter({ visible: true }).selectOption('cumulative_quantity');
  await expect(page.getByLabel('Khối lượng lũy kế', { exact: true }).filter({ visible: true })).toHaveValue('52');
  await expect(entry).toHaveCount(0);
});
test('atomic save then submit uses receipt version, and failed submit retries the same command without saving again', async ({ page }) => {
  const calls: { name: string; body: any }[] = [];
  let submits = 0;
  await page.route('**/rest/v1/rpc/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    calls.push({name, body: route.request().postDataJSON()});
    if (name === 'submit_daily_log_source_v2' && submits++ === 0) {
      await route.abort('failed'); return;
    }
    await route.fulfill({ contentType:'application/json', body:JSON.stringify(name === 'save_daily_log_source_document_v2'
      ? { row_version:5, updated_at:'2026-09-27T03:00:00Z', source_fingerprint:'saved', conflicts:[] }
      : { contribution_id:'source-A', status:'submitted', row_version:6, updated_at:'2026-09-27T03:00:01Z', source_fingerprint:'saved' }) });
  });
  await page.goto('/tests/daily-log/engineer-fixture.html');
  await (await workNotes(page)).fill('Bê tông đã đổ');
  await page.getByRole('button', { name:'Gửi lại tổng hợp', exact:true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', {name:'Đóng',exact:true})).toBeDisabled();
  await expect(page.getByRole('textbox',{name:'Công tác thực hiện',exact:true}).filter({ visible: true })).toHaveValue('- Bê tông đã đổ');
  await page.getByRole('button', { name:'Thử gửi lại', exact:true }).click();
  await expect(page.getByText('Đã gửi', {exact:true})).toBeVisible();
  await expect(page.getByText('52,5 m³', {exact:true}).first()).toBeVisible();
  await expect(page.getByText('Phiếu cần chỉnh sửa',{exact:true})).toHaveCount(0);
  expect(calls.map(c=>c.name)).toEqual(['save_daily_log_source_document_v2','submit_daily_log_source_v2','submit_daily_log_source_v2']);
  expect(calls[0].body.p_input).toMatchObject({contributionId:'source-A', expectedRowVersion:4,
    content:'1.1 Bê tông móng:\n  - Bê tông đã đổ\nNội dung cũ', issues:'Lối vào hẹp', photos:[{name:'Ảnh hiện trường',url:'/existing-photo.png'}]});
  expect(calls[0].body.p_input.items[0]).toMatchObject({ note:'- Bê tông đã đổ', issues:'' });
  expect(calls[1].body.p_input.expectedRowVersion).toBe(5);
  expect(calls[2].body).toEqual(calls[1].body);
});
test('switching slips cannot carry the previous unsaved draft', async ({page}) => {
  await page.goto('/tests/daily-log/engineer-fixture.html');
  await (await workNotes(page)).fill('Không được mang sang B');
  await page.getByRole('button',{name:'Đổi phiếu A/B'}).click();
  await expect(await workNotes(page)).toHaveValue('Ghi chú hạng mục');
  await expect(page.getByText('Nội dung B', { exact: true })).toBeVisible();
});
test('empty draft saves but cannot send; submitted slip is a report', async ({page}) => {
  await page.goto('/tests/daily-log/engineer-fixture.html?blank');
  await expect(page.getByRole('button',{name:'Lưu chỉnh sửa',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Gửi lại tổng hợp',exact:true})).toBeDisabled();
  await page.goto('/tests/daily-log/engineer-fixture.html?submitted');
  await expect(page.getByText('Đã gửi để tổng hợp').first()).toBeVisible();
  await expect(page.locator('input, textarea, select')).toHaveCount(0);
});
