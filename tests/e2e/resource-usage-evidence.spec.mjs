import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginPersonas } from '../daily-log/personas.mjs';
import { query, ref } from '../daily-log/cloud.mjs';

const project = 'DL-WBS-PILOT-20260925';
const memberId = '73000000-0000-4000-8000-000000000001';
const owner = '72000000-0000-4000-8000-000000000004';
const staff = '72000000-0000-4000-8002-000000000005';
const operation = readFileSync('supabase/operations/resource_usage_evidence_pilot.sql', 'utf8');
const literal = value => JSON.stringify(value).replaceAll("'", "''");
const activate = (mode, prefix = '') => {
  const config = { projectId: project, constructionSiteId: null,
    fromDate: '2026-10-18', toDate: '2026-10-18', releaseId: 'resource-evidence-browser-20260925',
    ownerUserId: owner, reason: `Browser acceptance ${mode}`,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), mode };
  return query(`begin; ${prefix}
    select set_config('app.resource_evidence_operation','${literal(config)}',true);
    ${operation}
    commit;`, false);
};

let sessions;
let active = false;
test.beforeAll(async () => {
  sessions = await loginPersonas();
  const grant = `insert into public.project_permission_room_members(
    id,project_id,room_code,project_staff_id,is_active,created_by
  ) values ('${memberId}','${project}','payment','${staff}',true,'${owner}')
  on conflict (id) do update set is_active=true;
  insert into public.project_permission_room_member_actions(
    room_member_id,action_code,is_active,granted_by,grant_source
  ) values ('${memberId}','view_resource_evidence',true,'${owner}','manual_room')
  on conflict (room_member_id,action_code) do update set is_active=true;`;
  await activate('pilot', grant);
  active = true;
});
test.afterAll(async () => {
  if (!active) return;
  await activate('audit_only', `update public.project_permission_room_member_actions
    set is_active=false where room_member_id='${memberId}' and action_code='view_resource_evidence';
    update public.project_permission_room_members set is_active=false where id='${memberId}';`);
});

for (const width of [1440, 768, 390]) {
  test(`QS can trace physical evidence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
      key: `sb-${ref}-auth-token`, session: sessions.reader.session,
    });
    await page.goto('/tests/daily-log/resource-evidence-fixture.html');
    await page.getByLabel('Từ ngày').fill('2026-10-18');
    await page.getByLabel('Đến ngày').fill('2026-10-18');
    await page.getByRole('button', { name: 'Áp dụng lọc' }).click();
    await expect(page.getByLabel('40 giờ công')).toBeVisible();
    await expect(page.getByLabel('12 giờ máy')).toBeVisible();
    await expect(page.getByRole('button', { name: /NCC kiểm thử Nhật ký/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Chủ máy anh Bình/ })).toBeVisible();
    await page.getByRole('button', { name: /NCC kiểm thử Nhật ký/ }).click();
    await expect(page.getByText('Khu A').filter({ visible: true }).first()).toBeVisible();
    const visibleWbs = page.getByRole('button', { name: /1.1.*Bê tông móng/ }).filter({ visible: true }).first();
    await visibleWbs.click();
    await expect(page.getByRole('dialog', { name: 'Chi tiết bằng chứng nguồn lực' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Mở Nhật ký gốc/ })).toHaveAttribute('href', /dailyLogId=DL-WBS-E2E-2026-10-18/);
    await page.getByRole('button', { name: 'Đóng chi tiết' }).click();
    expect(await page.locator('body').innerText()).not.toMatch(/đồng|VNĐ|Đơn giá|Thành tiền/i);
    await page.screenshot({ path: `docs/superpowers/evidence/resource-evidence-${width}.png`, fullPage: true });
  });
}

test('ungranted user sees a denial, not physical evidence or fake zeroes', async ({ page }) => {
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
    key: `sb-${ref}-auth-token`, session: sessions.denied.session,
  });
  await page.goto('/tests/daily-log/resource-evidence-fixture.html');
  await page.getByLabel('Từ ngày').fill('2026-10-18');
  await page.getByLabel('Đến ngày').fill('2026-10-18');
  await page.getByRole('button', { name: 'Áp dụng lọc' }).click();
  await expect(page.getByRole('alert')).toContainText('chưa được cấp quyền');
  await expect(page.getByText('NCC kiểm thử Nhật ký')).toHaveCount(0);
  await expect(page.getByLabel('Chưa xác định giờ công')).toBeVisible();
});
