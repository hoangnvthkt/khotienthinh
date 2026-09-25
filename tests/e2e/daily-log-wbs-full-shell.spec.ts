import { expect, test } from '@playwright/test';
import { loginPersonas } from '../daily-log/personas.mjs';
import { query, ref } from '../daily-log/cloud.mjs';

test('published WBS summary opens through the real ERP project route', async ({ page }) => {
  const sessions = await loginPersonas();
  // Room access governs Daily Log commands; the ERP project list also needs
  // its project-scoped navigation grant for the five authorized test personas.
  await query(`insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,is_active,granted_by,grant_reason)
    select person.id,'project.daily_log.view','project','DL-WBS-PILOT-20260925',true,
      '72000000-0000-4000-8000-000000000004'::uuid,'Daily Log full-shell pilot fixture'
    from (select ('72000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid as id from generate_series(1,5) n) person
    where not exists(select 1 from public.user_permission_grants grant_row where grant_row.user_id=person.id
      and grant_row.permission_code='project.daily_log.view' and grant_row.scope_type='project'
      and grant_row.scope_id='DL-WBS-PILOT-20260925' and grant_row.is_active)`, false);
  const summaries = await query("select id from public.daily_logs where project_id='DL-WBS-PILOT-20260925' and id like 'DL-WBS-E2E-%' and status='verified' order by date desc limit 1");
  expect(summaries).toHaveLength(1);
  const key = `sb-${ref}-auth-token`;
  await page.addInitScript(({ storageKey, session }) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
  }, { storageKey: key, session: sessions.approver.session });
  await page.goto(`/#/da?projectId=DL-WBS-PILOT-20260925&tab=dailylog&dailyLogId=${summaries[0].id}`);
  await expect(page.getByText('Nhật ký WBS — dữ liệu kiểm thử riêng').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Bê tông móng').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Chủ máy anh Bình').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trả lại toàn bộ' })).toHaveCount(0);
});
