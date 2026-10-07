import { test, expect, type Page } from "@playwright/test";

// Khung Trung tâm điều hành (PR-A) trên fixture: desktop 1440, tablet 820, iPhone (WebKit).
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

test("desktop: three regions, inbox and assistant toggles, light and dark", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(base);
  await expect(page.getByText("Trung tâm điều hành", { exact: true })).toBeVisible();
  const inbox = page.getByRole("complementary", { name: "Việc của tôi" });
  await expect(inbox.getByRole("tab")).toHaveText(["Chờ tôi", "Tôi gửi", "Theo dõi"]);
  await expect(inbox.getByText("Đang nối nguồn việc")).toBeVisible();
  await inbox.getByRole("tab", { name: "Tôi gửi" }).click();
  await expect(inbox.getByRole("tab", { name: "Tôi gửi" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Hôm nay" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".vcc-mnav")).toBeHidden();
  await expectToday(page);
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-light.png` });

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

test("tablet and phone: bottom tabs switch Việc / Hôm nay / Trợ lý", async ({ page }, info) => {
  test.skip(info.project.name === "desktop");
  const tag = info.project.name;
  await page.goto(base);
  const nav = page.getByRole("tablist", { name: "Chọn vùng" });
  await expect(nav).toBeVisible();
  const inbox = page.getByRole("complementary", { name: "Việc của tôi" });
  await expect(inbox.getByText("Đang nối nguồn việc")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ẩn Việc của tôi" })).toBeHidden();
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-viec.png` });

  await nav.getByRole("tab", { name: "Hôm nay" }).click();
  await expect(inbox).toBeHidden();
  await expectToday(page);
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-hom-nay.png`, fullPage: true });

  await nav.getByRole("tab", { name: "Trợ lý" }).click();
  await expect(page.getByRole("complementary", { name: "Trợ lý Vioo" })).toBeVisible();
  await page.getByRole("button", { name: "Mở menu ứng dụng" }).click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "menu");

  await nav.getByRole("tab", { name: "Hôm nay" }).click();
  await page.getByRole("button", { name: "Chuyển nền tối" }).click();
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-hom-nay-dark.png` });
});
