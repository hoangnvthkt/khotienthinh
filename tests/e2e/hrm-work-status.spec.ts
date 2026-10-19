import { test, expect, type Page, type Route } from '@playwright/test';

// Ngày nghỉ việc (19/10): đổi "Đã nghỉ việc" bắt buộc ngày + lý do, đi làm lại hỏi ngày, dải "Thiếu ngày công tác" cho HR.
// Fixture dùng component thật; RPC Supabase giả lập trong bộ nhớ. Desktop + iPhone WebKit.
const base = '/tests/hrm/work-status-fixture.html';

const server = (page: Page) => {
  const state = { calls: [] as Array<{ fn: string; body: Record<string, unknown> }>, failNext: null as string | null };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  return {
    state,
    calls: (fn: string) => state.calls.filter(call => call.fn === fn).map(call => call.body),
    install: async () => {
      await page.route('http://127.0.0.1:4231/**', route => json(route, {}));
      await page.route('http://127.0.0.1:4231/rest/v1/rpc/*', route => {
        const fn = new URL(route.request().url()).pathname.split('/').pop()!;
        const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
        state.calls.push({ fn, body });
        if (state.failNext) {
          const message = state.failNext;
          state.failNext = null;
          return json(route, { code: message.includes('PROFILE_EDIT') ? '42501' : '22023', message, details: null, hint: null }, 400);
        }
        if (fn === 'set_hrm_employee_work_status') {
          return json(route, { employeeId: body.p_employee_id, status: body.p_status, eventType: 'NGHI_VIEC', eventDate: body.p_effective_date,
            exitDate: body.p_status === 'Đã nghỉ việc' ? body.p_effective_date : null });
        }
        if (fn === 'set_hrm_employee_start_date') return json(route, { employeeId: body.p_employee_id, startDate: body.p_start_date });
        if (fn === 'update_hrm_employee_core_profile') return json(route, { employeeId: body.p_employee_id });
        return json(route, null);
      });
    },
  };
};

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test('Thiếu ngày công tác: bổ sung ngày nghỉ và ngày vào làm ngay trên danh sách', async ({ page }) => {
  const api = server(page);
  await api.install();
  await page.goto(base);

  const panel = page.getByRole('region', { name: 'Thiếu ngày công tác' });
  await expect(panel).toContainText('1 đã nghỉ chưa có ngày nghỉ · 1 đang làm chưa có ngày vào làm');
  await panel.getByRole('button', { name: /Thiếu ngày công tác/ }).click();
  await expect(panel).toContainText('Trần Văn Cường');
  await expect(panel).toContainText('Lê Thị Bình');
  await noHorizontalScroll(page);

  await panel.getByRole('button', { name: 'Bổ sung ngày nghỉ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bổ sung ngày nghỉ việc' });
  await expect(dialog).toContainText('Vào làm 03/06/2024');
  await dialog.getByRole('button', { name: 'Lưu ngày nghỉ' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Chọn ngày nghỉ việc.');

  await dialog.getByLabel('Ngày nghỉ việc', { exact: true }).fill('2024-05-01');
  await dialog.getByRole('button', { name: 'Tự xin nghỉ' }).click();
  await expect(dialog.getByLabel('Lý do', { exact: true })).toHaveValue('Tự xin nghỉ');
  await dialog.getByRole('button', { name: 'Lưu ngày nghỉ' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Ngày nghỉ việc không được trước ngày vào làm 03/06/2024.');
  expect(api.calls('set_hrm_employee_work_status')).toHaveLength(0);

  await dialog.getByLabel('Ngày nghỉ việc', { exact: true }).fill('2026-08-15');
  if (test.info().project.name === 'desktop') await page.screenshot({ path: test.info().outputPath('bo-sung-ngay-nghi.png') });
  await dialog.getByRole('button', { name: 'Lưu ngày nghỉ' }).click();
  await expect(dialog).toBeHidden();
  expect(api.calls('set_hrm_employee_work_status')).toEqual([{
    p_employee_id: 'e-noexit', p_status: 'Đã nghỉ việc', p_effective_date: '2026-08-15', p_note: 'Tự xin nghỉ',
    p_source_reference: null, p_reason: 'Nghỉ việc TT103 từ 15/08/2026: Tự xin nghỉ',
  }]);
  await expect(page.getByTestId('status-e-noexit')).toContainText('Đã nghỉ việc từ 15/08/2026');
  await expect(panel).toContainText('1 đang làm chưa có ngày vào làm');
  await expect(panel).not.toContainText('Trần Văn Cường');

  await panel.getByRole('button', { name: 'Bổ sung ngày vào' }).click();
  const startDialog = page.getByRole('dialog', { name: 'Bổ sung ngày vào làm' });
  await startDialog.getByLabel('Ngày vào làm', { exact: true }).fill('2025-11-03');
  await startDialog.getByRole('button', { name: 'Lưu ngày vào làm' }).click();
  await expect(startDialog).toBeHidden();
  expect(api.calls('set_hrm_employee_start_date')).toEqual([{
    p_employee_id: 'e-nostart', p_start_date: '2025-11-03', p_reason: 'Bổ sung ngày vào làm TT102 từ 03/11/2025',
  }]);
  await expect(page.getByTestId('status-e-nostart')).toContainText('vào 03/11/2025');
  await expect(panel).toBeHidden();
});

test('Sửa hồ sơ: chọn "Đã nghỉ việc" bắt buộc ngày nghỉ + lý do, lưu cùng một lệnh', async ({ page }) => {
  const api = server(page);
  await api.install();
  await page.goto(base);

  await page.getByRole('button', { name: 'Sửa TT101' }).click();
  await page.locator('#employee-status').selectOption('Đã nghỉ việc');
  const block = page.getByLabel('Nghỉ việc', { exact: true });
  await expect(block).toBeVisible();
  await page.getByRole('button', { name: 'Lưu Thông Tin' }).click();
  await expect(block.getByRole('alert')).toHaveText('Chọn ngày nghỉ việc.');
  expect(api.calls('update_hrm_employee_core_profile')).toHaveLength(0);

  await block.getByLabel('Ngày nghỉ việc', { exact: true }).fill('2026-10-10');
  await block.getByRole('button', { name: 'Hết hợp đồng' }).click();
  await block.getByLabel('Số quyết định', { exact: true }).fill('QĐ 15/2026/QĐ-TT');
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath(`form-nghi-viec-${test.info().project.name}.png`) });
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Lưu Thông Tin' }).click();
  await expect(page.locator('#employee-status')).toBeHidden();

  const [saved] = api.calls('update_hrm_employee_core_profile');
  expect(saved).toMatchObject({
    p_employee_id: 'e-active', p_status: 'Đã nghỉ việc', p_status_date: '2026-10-10', p_status_note: 'Hết hợp đồng',
    p_status_reference: 'QĐ 15/2026/QĐ-TT', p_start_date: '2025-03-10',
  });
  expect(api.calls('set_hrm_employee_work_status')).toHaveLength(0);
  await expect(page.getByTestId('status-e-active')).toContainText('Đã nghỉ việc từ 10/10/2026');
});

test('Đi làm lại: hỏi ngày sau ngày nghỉ, báo lỗi máy chủ bằng tiếng Việt', async ({ page }) => {
  const api = server(page);
  await api.install();
  await page.goto(base);

  await page.getByRole('button', { name: 'Sửa TT104' }).click();
  await expect(page.getByText('Nghỉ từ 31/03/2026')).toBeVisible();
  await page.locator('#employee-status').selectOption('Đang làm việc');
  const block = page.getByLabel('Đi làm lại', { exact: true });
  await expect(block).toContainText('nghỉ từ 31/03/2026');
  await block.getByLabel('Ngày đi làm lại', { exact: true }).fill('2026-03-31');
  await block.getByRole('button', { name: 'Quay lại làm việc' }).click();
  await page.getByRole('button', { name: 'Lưu Thông Tin' }).click();
  await expect(block.getByRole('alert')).toHaveText('Ngày đi làm lại phải sau ngày nghỉ 31/03/2026.');

  await block.getByLabel('Ngày đi làm lại', { exact: true }).fill('2026-09-01');
  api.state.failNext = 'HRM_PROFILE_EDIT_REQUIRED';
  await page.getByRole('button', { name: 'Lưu Thông Tin' }).click();
  await expect(block.getByRole('alert')).toHaveText('Bạn chưa có quyền sửa hồ sơ nhân sự.');
  await expect(page.getByTestId('status-e-exited')).toContainText('Đã nghỉ việc từ 31/03/2026');

  await page.getByRole('button', { name: 'Lưu Thông Tin' }).click();
  await expect(page.locator('#employee-status')).toBeHidden();
  expect(api.calls('update_hrm_employee_core_profile').at(-1)).toMatchObject({
    p_status: 'Đang làm việc', p_status_date: '2026-09-01', p_status_note: 'Quay lại làm việc',
  });
  await expect(page.getByTestId('status-e-exited')).toHaveText(/^Đang làm việc · vào 01\/02\/2023$/);
});

test('Nút Cho nghỉ việc mở hộp hỏi ngày, Esc đóng không lưu', async ({ page }) => {
  const api = server(page);
  await api.install();
  await page.goto(base);

  await page.getByRole('button', { name: 'Cho nghỉ TT101' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cho nghỉ việc' });
  await expect(dialog.getByLabel('Ngày nghỉ việc', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Cho nghỉ TT101' }).click();
  await dialog.getByLabel('Ngày nghỉ việc', { exact: true }).fill('2026-10-18');
  await dialog.getByLabel('Lý do', { exact: true }).fill('Chuyển công tác');
  await noHorizontalScroll(page);
  await dialog.getByRole('button', { name: 'Cho nghỉ việc' }).click();
  await expect(dialog).toBeHidden();
  expect(api.calls('set_hrm_employee_work_status')).toMatchObject([{ p_employee_id: 'e-active', p_note: 'Chuyển công tác', p_effective_date: '2026-10-18' }]);
  await expect(page.getByTestId('status-e-active')).toContainText('Đã nghỉ việc từ 18/10/2026');
  await expect(page.getByRole('button', { name: 'Cho nghỉ TT101' })).toBeHidden();
});
