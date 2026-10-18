import { test, expect, type Page } from "@playwright/test";

// Trung tâm AI (chủ SP chốt 18/10/2026): Quản trị AI cấp AI theo người — mẫu + chỉnh riêng, bật / tắt, skill "chỉ người được cấp".
// Fixture không gọi Supabase (tests/center/ai-center.tsx). Desktop 1440 + iPhone (WebKit).
const base = "/tests/center/ai-center.html";
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __aiAdminCalls: Array<Record<string, unknown>> }).__aiAdminCalls);
const list = (page: Page) => page.getByRole("list", { name: "Danh sách được cấp" });

test("thấy ai đang được cấp, đã dùng bao nhiêu so với trần; tắt AI một người; không tràn ngang", async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Trung tâm AI" })).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(2);
  const son = list(page).getByRole("listitem", { name: "Phạm Ngọc Sơn" });
  await expect(son).toContainText("Tiêu chuẩn");
  await expect(son).toContainText("chỉnh riêng");
  await expect(son).toContainText("28/40 câu");
  await expect(son).toContainText("$0.56 / $3.00");
  await son.getByRole("switch", { name: "Tắt AI của Phạm Ngọc Sơn" }).click();
  await expect(son.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  expect((await calls(page)).at(-1)).toMatchObject({ saveGrants: ["u-son"], values: { enabled: false, templateId: "t-std", dailyQuestionCap: 40 } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("Cấp AI: chọn nhiều người, chọn mẫu, chỉnh riêng model + trần → lưu một lần; dòng Hiệu lực nói đúng", async ({ page, isMobile }) => {
  test.skip(isMobile, "luồng cấp đo trên máy tính");
  await page.goto(base);
  await page.getByRole("button", { name: "Cấp AI" }).click();
  const drawer = page.getByRole("dialog", { name: "Cấp AI" });
  await drawer.getByRole("button", { name: /Bùi Thị Tâm/ }).click();
  await drawer.getByRole("button", { name: /Hà Đức Chuẩn/ }).click();
  await expect(drawer.getByRole("button", { name: /Cấp cho 2 người/ })).toBeEnabled();
  await drawer.getByRole("radio", { name: /Nâng cao/ }).click();
  await expect(drawer.locator("p", { hasText: "Hiệu lực:" })).toContainText("Claude Sonnet 5.5 (+ DeepSeek Flash) · $10/tháng · 80 câu/ngày · Trợ lý · hội thoại");
  await drawer.getByText("Chỉnh riêng (đè lên mẫu)").click();
  await drawer.getByLabel("Model riêng").selectOption("c-deepseek");
  await drawer.getByLabel("Số câu một ngày riêng").fill("20");
  await expect(drawer.locator("p", { hasText: "Hiệu lực:" })).toContainText("DeepSeek Flash · $10/tháng · 20 câu/ngày");
  await drawer.getByRole("button", { name: /Cấp cho 2 người/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(list(page).getByRole("listitem")).toHaveCount(4);
  expect((await calls(page)).at(-1)).toEqual({ saveGrants: ["u-tam", "u-chuan"],
    values: { enabled: true, templateId: "t-pro", connectionId: "c-deepseek", extraConnectionIds: null, monthlyCostCapUsd: null, dailyQuestionCap: 20, skills: null, note: "" } });
  await expect(list(page).getByRole("listitem", { name: "Bùi Thị Tâm" })).toContainText("DeepSeek Flash");
});

test("Mẫu cấp phát: thêm mẫu mới; mẫu đang dùng không xóa được; Skill: đổi sang chỉ người được cấp phải xác nhận", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(base);
  await page.getByRole("tab", { name: /Mẫu cấp phát/ }).click();
  await page.getByRole("button", { name: "Sửa mẫu Tiêu chuẩn" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Xóa mẫu" })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Hủy" }).click();
  await page.getByRole("button", { name: "Mẫu mới" }).click();
  const drawer = page.getByRole("dialog", { name: "Mẫu cấp phát mới" });
  await drawer.getByLabel("Tên mẫu").fill("Mua hàng");
  await drawer.getByLabel("Trần tiền tháng").fill("5");
  await drawer.getByRole("button", { name: "Lưu mẫu" }).click();
  await expect(page.getByRole("article", { name: "Mẫu Mua hàng" })).toContainText("$5.00");

  await page.getByRole("tab", { name: /Skill/ }).click();
  const quote = page.getByRole("radiogroup", { name: "Ai được dùng Đọc báo giá thành dòng đơn" });
  await quote.getByRole("radio", { name: "Chỉ người được cấp" }).click();
  await expect(page.getByText("Người chưa được cấp skill này sẽ bị chặn ngay")).toBeVisible();
  await page.getByRole("button", { name: "Đổi" }).click();
  await expect(quote.getByRole("radio", { name: "Chỉ người được cấp" })).toHaveAttribute("aria-checked", "true");
  expect((await calls(page)).at(-1)).toEqual({ setSkillAccess: "po_quote_lines", access: "granted" });
});

test("người không phải Quản trị AI: báo rõ và mời mở Trợ lý", async ({ page }) => {
  await page.goto(`${base}?role=staff`);
  await expect(page.getByText("Trung tâm AI dành cho Quản trị AI")).toBeVisible();
  await page.getByRole("button", { name: "Mở Trợ lý" }).click();
  await expect(page.getByTestId("route")).toHaveText("/center");
});

test("Model: đặt tên dễ hiểu, mô tả, đọc ảnh; mẫu có model mặc định + model thêm cho người dùng chọn ở ô hỏi", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(base);
  await page.getByRole("tab", { name: /Model/ }).click();
  const deep = page.getByRole("article", { name: "Model DeepSeek Flash" });
  await expect(deep.getByRole("button", { name: "Không đọc ảnh" })).toHaveAttribute("aria-pressed", "false");
  await deep.getByLabel("Tên hiển thị deepseek-v4.1-flash").fill("DeepSeek nhanh");
  await deep.getByLabel("Mô tả deepseek-v4.1-flash").fill("Hỏi nhanh, tra cứu");
  await deep.getByRole("button", { name: "Lưu" }).click();
  expect((await calls(page)).at(-1)).toEqual({ saveModel: { id: "c-deepseek", displayName: "DeepSeek nhanh", blurb: "Hỏi nhanh, tra cứu", icon: "⚡", vision: false } });
  await expect(page.getByRole("article", { name: "Model DeepSeek nhanh" })).toBeVisible();

  await page.getByRole("tab", { name: /Mẫu cấp phát/ }).click();
  await expect(page.getByRole("article", { name: "Mẫu Nâng cao" })).toContainText("Claude Sonnet 5.5 +1");
  await page.getByRole("button", { name: "Mẫu mới" }).click();
  const drawer = page.getByRole("dialog", { name: "Mẫu cấp phát mới" });
  await drawer.getByLabel("Tên mẫu").fill("Hai model");
  await drawer.getByRole("group", { name: /Model thêm/ }).getByRole("button", { name: /DeepSeek nhanh/ }).click();
  await drawer.getByRole("button", { name: "Lưu mẫu" }).click();
  expect((await calls(page)).at(-1)).toMatchObject({ saveTemplate: { name: "Hai model", connectionId: "c-claude", extraConnectionIds: ["c-deepseek"] } });
});
