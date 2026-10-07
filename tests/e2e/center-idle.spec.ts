import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

// Đo WebKit khi Trung tâm điều hành đứng yên (docs/ui/VIOO-UI-UX.md mục 6, sự cố #117).
// Chặn cứng: trong 5 giây đứng yên trang KHÔNG tự làm việc gì — 0 animation, 0 setTimeout/setInterval,
// 0 requestAnimationFrame, 0 thay đổi DOM. CPU = tổng thời gian CPU các tiến trình WebKit của Playwright
// trong 10 giây, so với trang trống cùng trình duyệt; ngưỡng 5 điểm % để bắt lỗi kiểu #117 (~25%) mà không
// báo nhầm vì nhiễu của WebKit headless + HMR máy chủ dev. Số đo ghi ở .center-test-results/webkit-idle.json.
const base = "/tests/center/fixture.html";
const IDLE_SECONDS = 10;
const OUT = ".center-test-results/webkit-idle.json";

// Ghi ngay từng số đo (worker có thể khởi động lại sau một ca hỏng).
const record = (key: string, value: unknown) => {
  mkdirSync(".center-test-results", { recursive: true });
  const current = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { idleSeconds: IDLE_SECONDS, results: {} };
  current.measuredAt = new Date().toISOString();
  current.results[key] = value;
  writeFileSync(OUT, `${JSON.stringify(current, null, 2)}\n`);
};
const baselinePercent = (): number | null => {
  try { return JSON.parse(readFileSync(OUT, "utf8")).results.baseline.cpuPercent; } catch { return null; }
};

const webkitCpuSeconds = (): number => {
  const out = execFileSync("ps", ["-A", "-o", "time=,command="], { encoding: "utf8" });
  return out.split("\n")
    .filter(line => line.includes("ms-playwright/webkit"))
    .reduce((sum, line) => {
      const parts = line.trim().split(/\s+/)[0].split(":").map(Number);
      const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
      return sum + (Number.isFinite(seconds) ? seconds : 0);
    }, 0);
};

// Đếm việc trang tự làm khi đứng yên (chỉ đếm sau khi "armed").
const installProbe = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { __vccIdle: Record<string, number>; __vccArmed: boolean };
  w.__vccIdle = { timeout: 0, interval: 0, raf: 0, mutations: 0 };
  w.__vccArmed = false;
  const note = (kind: string) => { if (w.__vccArmed) w.__vccIdle[kind] += 1; };
  const st = window.setTimeout;
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => { note("timeout"); return st(fn, ms, ...args); }) as typeof window.setTimeout;
  const si = window.setInterval;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => { note("interval"); return si(fn, ms, ...args); }) as typeof window.setInterval;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => { note("raf"); return raf(cb); }) as typeof window.requestAnimationFrame;
  new MutationObserver(list => { if (w.__vccArmed) w.__vccIdle.mutations += list.length; })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});

const measureIdle = async (page: Page, label: string) => {
  await page.mouse.move(0, 0);
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const w = window as unknown as { __vccIdle: Record<string, number>; __vccArmed: boolean };
    Object.keys(w.__vccIdle).forEach(key => { w.__vccIdle[key] = 0; });
    w.__vccArmed = true;
  });
  const before = webkitCpuSeconds();
  await page.waitForTimeout(IDLE_SECONDS * 1000);
  const cpuPercent = Math.round(((webkitCpuSeconds() - before) / IDLE_SECONDS) * 1000) / 10;
  const activity = await page.evaluate(() => {
    const w = window as unknown as { __vccIdle: { timeout: number; interval: number; raf: number; mutations: number }; __vccArmed: boolean };
    w.__vccArmed = false;
    return { ...w.__vccIdle, animations: document.getAnimations().length, domNodes: document.getElementsByTagName("*").length };
  });
  const baseline = baselinePercent();
  const overBaseline = baseline === null ? null : Math.round((cpuPercent - baseline) * 10) / 10;
  record(label, { ...activity, cpuPercent, overBaseline });
  expect({ animations: activity.animations, timeout: activity.timeout, interval: activity.interval, raf: activity.raf, mutations: activity.mutations },
    `${label}: page must do nothing while idle`).toEqual({ animations: 0, timeout: 0, interval: 0, raf: 0, mutations: 0 });
  expect(overBaseline ?? cpuPercent, `${label}: CPU % above blank-page baseline`).toBeLessThan(5);
};

test.beforeEach(async ({ page }) => {
  await installProbe(page);
  await page.route("**/*.supabase.co/**", route => route.abort());
  await page.route("**/api.open-meteo.com/**", route => route.abort());
});

test("WebKit idle: baseline (blank page, same browser)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("about:blank");
  await page.waitForTimeout(1500);
  const before = webkitCpuSeconds();
  await page.waitForTimeout(IDLE_SECONDS * 1000);
  record("baseline", { cpuPercent: Math.round(((webkitCpuSeconds() - before) / IDLE_SECONDS) * 1000) / 10 });
});

test("WebKit idle: Việc của tôi, Hôm nay, thư mục thao tác", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(base);
  await expect(page.getByRole("tab", { name: "Chờ tôi 9" })).toBeVisible();
  await measureIdle(page, "inbox");
  await page.getByRole("tablist", { name: "Chọn vùng" }).getByRole("tab", { name: "Hôm nay" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
  await measureIdle(page, "today");
  await page.locator('[data-widget="hrm"] .vcc-whead h3').click();
  await expect(page.getByRole("dialog", { name: "Nhân sự" })).toBeVisible();
  await measureIdle(page, "folder-open");
});

test("WebKit idle: 200 việc trong Chờ tôi", async ({ page }) => {
  test.setTimeout(90_000);
  const started = Date.now();
  await page.goto(`${base}?inbox=many`);
  await expect(page.getByRole("tab", { name: "Chờ tôi 200" })).toBeVisible();
  record("inbox-200-render-ms", Date.now() - started);
  // Nhóm mặc định thu gọn: mở hết để đo khi cả 200 dòng hiện.
  await page.getByRole("complementary", { name: "Việc của tôi" }).getByRole("button", { name: "Mở", exact: true }).click();
  await expect(page.locator(".vcc-inbox .vcc-row")).toHaveCount(200);
  await page.locator(".vcc-inbox .vcc-scroll").evaluate(node => node.scrollTo({ top: node.scrollHeight }));
  await measureIdle(page, "inbox-200");
});
