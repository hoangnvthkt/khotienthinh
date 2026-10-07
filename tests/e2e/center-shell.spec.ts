import { test, expect, type Page } from "@playwright/test";

// Khung Trung tâm điều hành (PR-A) + Việc của tôi (PR-B) trên fixture: desktop 1440, tablet 820, iPhone (WebKit).
const base = "/tests/center/fixture.html";
const shots = ".center-test-results";
const WIDGETS = ["Dự án", "Nhân sự", "Công việc", "Hành chính", "Mua hàng & Kho", "Tài chính dự án"];

test.beforeEach(async ({ page }) => {
  await page.route("**/*.supabase.co/**", (route) => route.abort());
});

// Trang đứng yên: không cuộn ngang, không còn animation nào (hover/focus chỉ là transition ngắn, chờ nó xong).
const expectCalmPage = async (page: Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations === Infinity).length)).toBe(0);
  await page.mouse.move(0, 0);
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
};

const expectToday = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
  await expect(page.getByText("Thứ Tư, 07/10/2026")).toBeVisible();
  for (const name of WIDGETS) await expect(page.getByRole("heading", { level: 3, name, exact: true })).toBeVisible();
  const locked = page.getByRole("button", { name: "Mở Mua hàng" });
  await expect(locked).toBeDisabled();
  await expect(locked).toHaveAttribute("title", "Bạn chưa có quyền vào module này");
  await page.getByRole("button", { name: "Mở Dự án" }).click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "/da");
};

const inboxOf = (page: Page) => page.getByRole("complementary", { name: "Việc của tôi" });

const expectInboxLoaded = async (page: Page) => {
  const inbox = inboxOf(page);
  await expect(inbox.getByRole("tab", { name: "Chờ tôi 9" })).toBeVisible();
  // Nhóm theo module, đúng thứ tự rail; đếm theo nhóm; dòng có mã, hạn, tiêu đề, người gửi.
  await expect(inbox.getByRole("button", { expanded: true })).toHaveText([/Dự án\s*3/, /Yêu cầu\s*1/, /Vioo Work\s*1/, /Mua hàng\s*1/, /Nhân sự\s*2/, /Office\s*1/]);
  const row = inbox.getByRole("button", { name: /MR-2026-2688/ });
  await expect(row).toContainText("còn 5 giờ");
  await expect(row).toContainText("Thép D16 + D10 móng nhà xưởng 3");
  await expect(row).toContainText("Nguyễn Chấp Việt lập · 4 dòng · cần 09/10 · SMB-2026");
  await expect(inbox.getByRole("button", { name: /PO-116/ })).toContainText("quá hạn 2 ngày");
};

test("desktop: inbox groups, tabs open records, light and dark", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(base);
  await expect(page.getByText("Trung tâm điều hành", { exact: true })).toBeVisible();
  const inbox = inboxOf(page);
  await expectInboxLoaded(page);
  await expect(page.getByRole("tab", { name: "Hôm nay" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".vcc-mnav")).toBeHidden();
  await expectToday(page);
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-light.png` });

  // Gập / mở nhóm.
  await inbox.getByRole("button", { name: /Nhân sự\s*2/ }).click();
  await expect(inbox.getByRole("button", { name: /NP-2026-041/ })).toBeHidden();
  await inbox.getByRole("button", { name: "Gọn" }).click();
  await expect(inbox.getByRole("button", { expanded: false })).toHaveCount(6);
  await inbox.getByRole("button", { name: "Mở" }).click();
  await expect(inbox.getByRole("button", { expanded: true })).toHaveCount(6);

  // Mở hồ sơ → tab có ✕; view nhúng cho Yêu cầu; hồ sơ chưa nhúng → nút mở màn module.
  await inbox.getByRole("button", { name: /RQ-2026-000061/ }).click();
  await expect(page.getByRole("tab", { name: "RQ-2026-000061" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("stub-renderer")).toContainText('request · {"requestId":"rq-61"}');
  await expect(inbox.getByRole("button", { name: /RQ-2026-000061/ })).toHaveAttribute("aria-current", "true");
  await inbox.getByRole("button", { name: /NK 05\/10/ }).click();
  await expect(page.getByRole("tablist", { name: "Vùng làm việc" }).getByRole("tab")).toHaveText(["Hôm nay", "RQ-2026-000061", "NK 05/10"]);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("NK 05/10 · Nhật ký 05/10 · Sơn Miền Bắc");
  await page.getByRole("button", { name: "Mở ở màn Dự án" }).last().click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "/da?projectId=smb&tab=dailylog&dailyLogId=dl-0510");
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-record.png` });
  await page.getByRole("button", { name: "Đóng NK 05/10" }).click();
  await expect(page.getByRole("tab", { name: "RQ-2026-000061" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Đóng RQ-2026-000061" }).click();
  await expect(page.getByRole("tab", { name: "Hôm nay" })).toHaveAttribute("aria-selected", "true");

  // Tab Tôi gửi / Theo dõi tải khi bấm.
  await inbox.getByRole("tab", { name: "Tôi gửi" }).click();
  await expect(inbox.getByRole("tab", { name: "Tôi gửi 3" })).toHaveAttribute("aria-selected", "true");
  await expect(inbox.getByRole("button", { name: /QCT-SMB-10/ })).toContainText("Chờ kế toán duyệt");
  await inbox.getByRole("tab", { name: "Theo dõi" }).click();
  await expect(inbox.getByRole("button", { name: /SA-2026-007/ })).toBeVisible();
  await inbox.getByRole("tab", { name: "Chờ tôi 9" }).click();

  await page.getByRole("button", { name: "Ẩn Việc của tôi" }).click();
  await expect(inbox).toBeHidden();
  await page.getByRole("button", { name: "Hiện Việc của tôi" }).click();
  await expect(inbox).toBeVisible();

  await page.getByRole("button", { name: "Trợ lý" }).click();
  await expect(page.getByRole("complementary", { name: "Trợ lý Vioo" })).toBeVisible();
  await page.getByRole("button", { name: "Chuyển nền tối" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-dark.png` });
});

test("desktop: empty and error states of the inbox", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(`${base}?inbox=empty`);
  const inbox = inboxOf(page);
  await expect(inbox.getByText("Không còn việc chờ bạn")).toBeVisible();
  await expect(inbox.getByRole("tab", { name: "Chờ tôi 0" })).toBeVisible();
  await page.goto(`${base}?inbox=error`);
  await expect(inbox.getByRole("alert")).toContainText("Chưa tải được việc");
  await expect(inbox.getByRole("button", { name: "Thử lại" })).toBeVisible();
  await expect(inbox.getByRole("tab", { name: "Chờ tôi", exact: true })).toBeVisible();
});

test("tablet and phone: bottom tabs switch Việc / Hôm nay / Trợ lý and open a record", async ({ page }, info) => {
  test.skip(info.project.name === "desktop");
  const tag = info.project.name;
  await page.goto(base);
  const nav = page.getByRole("tablist", { name: "Chọn vùng" });
  await expect(nav).toBeVisible();
  const inbox = inboxOf(page);
  await expectInboxLoaded(page);
  await expect(nav.getByRole("tab", { name: "Việc 9" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Ẩn Việc của tôi" })).toBeHidden();
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-viec.png` });

  // Bấm việc → sang vùng làm việc, có nút quay lại.
  await inbox.getByRole("button", { name: /NP-2026-041/ }).click();
  await expect(inbox).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("NP-2026-041");
  await expect(nav.getByRole("tab", { name: "Hồ sơ" })).toHaveAttribute("aria-selected", "true");
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-ho-so.png`, fullPage: true });
  await page.getByRole("button", { name: "Việc của tôi" }).click();
  await expect(inbox).toBeVisible();

  await nav.getByRole("tab", { name: "Hồ sơ" }).click();
  await page.getByRole("button", { name: "Đóng NP-2026-041" }).click();
  await expectToday(page);
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-hom-nay.png`, fullPage: true });

  await nav.getByRole("tab", { name: "Trợ lý" }).click();
  await expect(page.getByRole("complementary", { name: "Trợ lý Vioo" })).toBeVisible();
  await page.getByRole("button", { name: "Mở menu ứng dụng" }).click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "menu");

  await nav.getByRole("tab", { name: "Việc 9" }).click();
  await page.getByRole("button", { name: "Chuyển nền tối" }).click();
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-viec-dark.png` });
});
