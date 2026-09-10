import { chromium } from '@playwright/test';
import { strict as assert } from 'node:assert';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*.supabase.co/**', route => route.abort());
  for (const [fixture, route, selector] of [
    ['task8', '/work/my', '.work-task-list li'],
    ['workspace', '/work/spaces/space-department', '.work-task-list li'],
    ['task8', '/work/tasks/VW-2026-000001', '#work-comment-first'],
  ]) {
    await page.goto(`http://127.0.0.1:5187/tests/work/${fixture}-fixture.html?task9=true&slowRefresh=1#${route}`);
    if (selector.startsWith('#')) await page.getByRole('button', { name: /^Thảo luận/ }).click();
    await page.locator(selector).first().waitFor();
    await page.evaluate((selector) => {
      window.refreshRemovals = 0;
      const observed = document.querySelector(selector);
      window.refreshObserver = new MutationObserver(() => {
        if (!observed.isConnected) window.refreshRemovals++;
      });
      window.refreshObserver.observe(document.body, { childList: true, subtree: true });
      window.dispatchEvent(new Event('focus'));
    }, selector);
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => window.refreshRemovals), 0, `${fixture} ${route}: refresh removed existing content`);
    await page.evaluate(() => window.refreshObserver.disconnect());
    if (fixture === 'task8') {
      // A retained view must disappear once the server denies this same query.
      await page.evaluate(() => {
        window.workQa.denyReads = true;
        window.dispatchEvent(new Event('focus'));
      });
      await page.locator(selector).first().waitFor({ state: 'detached' });
    }
  }
  await page.goto('http://127.0.0.1:5187/tests/work/task8-fixture.html?slowRefresh=1&longList=true&layout=true#/work/my');
  await page.locator('.work-task-list li').first().waitFor();
  await page.waitForTimeout(100);
  const scrollHost = page.locator('[data-work-scroll-host]');
  await scrollHost.evaluate(el => { el.scrollTop = 500; });
  const top = await scrollHost.evaluate(el => el.scrollTop);
  assert.ok(top > 0, 'fixture must have scrollable content');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(900);
  assert.equal(await scrollHost.evaluate(el => el.scrollTop), top, 'refresh changed the reader’s scroll position');
  // New queries still replace old results; they must never show the previous scope.
  await page.goto('http://127.0.0.1:5187/tests/work/task8-fixture.html?slowRefresh=1#/work/my');
  await page.locator('.work-task-list li').waitFor();
  await page.getByLabel('Tìm công việc', { exact: true }).fill('mới');
  await page.waitForURL(/q=/);
  assert.equal(await page.getByText('Chuẩn bị hồ sơ nghiệm thu', { exact: true }).count(), 0);
  await page.getByText('Kết quả mới', { exact: true }).waitFor();
  console.log('WORK_REFRESH_BROWSER_PASSED');
} finally { await browser.close(); }
