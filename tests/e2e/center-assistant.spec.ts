import { test, expect, type Page } from "@playwright/test";

// Tab Trợ lý — bản tin gọn (chủ SP 13/10): một câu · Làm trước (≤ 3 việc) · Đáng lo (≤ 3 điều) · Hỏi.
// Fixture Trung tâm (SMB-2026, 11 việc); ?ai=gemini giả lập cổng AI. Desktop 1440 + iPhone (WebKit).
const base = "/tests/center/fixture.html";
const workTabs = (page: Page) => page.getByRole("tablist", { name: "Vùng làm việc" });
const brief = (page: Page) => page.getByRole("region", { name: "Bản tin hôm nay" });

test.beforeEach(async ({ page }) => {
  await page.route("**/*.supabase.co/**", (route) => route.abort());
});

const openAssistant = async (page: Page, isMobile: boolean) => {
  if (isMobile) await page.getByRole("tablist", { name: "Chọn vùng" }).getByRole("tab", { name: "Trợ lý" }).tap();
  else await page.getByRole("button", { name: "Trợ lý" }).click();
  await expect(brief(page)).toBeVisible();
  await expect(workTabs(page).getByRole("tab", { name: "Trợ lý" })).toHaveAttribute("aria-selected", "true");
};

test("một câu + 3 việc làm trước + 3 điều đáng lo; không lặp số liệu của Hôm nay", async ({ page, isMobile }) => {
  await page.goto(base);
  await openAssistant(page, isMobile);
  const b = brief(page);
  await expect(b.getByText("Thứ tư 07/10")).toBeVisible();
  await expect(b.getByRole("heading", { level: 1 })).toHaveText("Anh có 11 việc chờ, 5 việc phải xong hôm nay");

  const first = b.getByRole("region", { name: "Làm trước" });
  const tasks = first.locator(".vcc-task");
  await expect(tasks).toHaveCount(3);
  await expect(tasks.nth(0)).toContainText("PO-116");
  await expect(tasks.nth(0).locator(".vcc-task-due")).toHaveText("quá hạn 2 ngày");
  await expect(tasks.nth(0).locator(".vcc-task-due")).toHaveAttribute("data-tone", "overdue");
  await expect(tasks.nth(1)).toContainText("MR-2026-2688");
  await expect(tasks.nth(1).locator(".vcc-task-due")).toHaveAttribute("data-tone", "today");
  await expect(tasks.nth(2)).toContainText("KH-2026-41");
  await expect(first.getByRole("button", { name: /\+ 2 việc khác hạn hôm nay/ })).toBeVisible();

  const worries = b.getByRole("region", { name: "Đáng lo" }).locator(".vcc-worry");
  await expect(worries).toHaveText([
    /Tiến độ SMB-2026: 7 việc trễ · hạn HĐ 21\/10/,
    /Thi công hôm nay: 2\/5 mũi chưa gửi phiếu/,
    /4 đề xuất vật tư đang chờ Phòng vật tư duyệt/,
  ]);
  await expect(worries.nth(0)).toHaveAttribute("data-tone", "danger");

  // Gọn: không còn khung theo nhóm, không thông tin cá nhân (phép, xe), không ô nhập khi chưa có khóa AI.
  await expect(b.getByText("Phép năm còn")).toHaveCount(0);
  await expect(b.getByText(/xe 29A/)).toHaveCount(0);
  await expect(b.getByLabel("Câu hỏi", { exact: true })).toHaveCount(0);
  await expect(b.getByRole("group", { name: "Hỏi nhanh" }).getByRole("button")).toHaveText(["Dự án đang thế nào?", "Vật tư, đơn hàng ra sao?", "Tiền của dự án?", "Công, phép của tôi?"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("bấm việc mở hồ sơ thành tab; bấm điều đáng lo mở đúng màn; '+ 2 việc khác' về cột việc; hỏi nhanh hiện số của nhóm", async ({ page, isMobile }) => {
  test.skip(isMobile, "luồng tab đo trên máy tính");
  await page.goto(base);
  await openAssistant(page, false);
  const b = brief(page);
  await b.locator('.vcc-task[data-key="item.po.po-116"]').click();
  await expect(workTabs(page).getByRole("tab", { name: /PO-116/ })).toHaveAttribute("aria-selected", "true");
  await workTabs(page).getByRole("tab", { name: "Trợ lý" }).click();
  await b.locator('.vcc-worry[data-key="project.progress"]').click();
  await expect(workTabs(page).getByRole("tab", { name: "Tiến độ" })).toHaveAttribute("aria-selected", "true");
  await workTabs(page).getByRole("tab", { name: "Trợ lý" }).click();

  await b.getByRole("button", { name: "Dự án đang thế nào?" }).click();
  const turn = b.getByTestId("turn").first();
  await expect(turn).toContainText("Dự án đang thế nào?");
  await expect(turn.locator(".vcc-qline")).toHaveCount(4);
  await expect(turn).toContainText("3/5 mũi đã gửi phiếu · 39 công");
  await expect(turn).toContainText("6 PO · 5,36 tỷ · PO-116 09/10");
});

test("có khóa AI (giả lập): ô hỏi tự do, trả lời kèm nút mở chứng từ, chấm đúng/sai, Tóm tắt", async ({ page, isMobile }) => {
  test.skip(isMobile, "luồng AI đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  const b = brief(page);
  await b.getByLabel("Câu hỏi", { exact: true }).fill("Hôm nay việc gì gấp nhất?");
  await b.getByRole("button", { name: "Hỏi" }).click();
  const turn = b.getByTestId("turn").first();
  await expect(turn).toContainText("Bạn có 7 việc trễ trên tiến độ SMB-2026");
  const sources = turn.getByRole("group", { name: "Chứng từ, màn gốc" });
  await expect(sources.getByRole("button")).toHaveText(["Tiến độ", "Cần mua của SMB-2026", "PO-116"]);
  await turn.getByRole("button", { name: "Trả lời đúng" }).click();
  await sources.getByRole("button", { name: "PO-116" }).click();
  await expect(workTabs(page).getByRole("tab", { name: /PO-116/ })).toHaveAttribute("aria-selected", "true");
  await workTabs(page).getByRole("tab", { name: "Trợ lý" }).click();

  await b.getByRole("button", { name: "Tóm tắt" }).click();
  await expect(b.getByTestId("narration")).toContainText("PO-116 quá hạn 2 ngày");
  const calls = await page.evaluate(() => (window as unknown as { __aiCalls: Array<Record<string, unknown>> }).__aiCalls);
  expect(calls.find(c => c.skill === "center_question")).toMatchObject({ question: "Hôm nay việc gì gấp nhất?", context: { projectId: "smb", tab: "assistant" } });
  expect(Number((calls.find(c => c.skill === "center_question") as { factLines: number }).factLines)).toBeGreaterThan(10);
  expect(calls.find(c => c.feedback)).toEqual({ feedback: { runId: "run-1", accepted: true } });
  expect(calls.find(c => c.skill === "morning_brief")).toBeTruthy();
});

test("điện thoại: nút Trợ lý ở thanh đáy mở bản tin, việc xuống 2 dòng không tràn, quay về Hôm nay", async ({ page, isMobile }) => {
  test.skip(!isMobile, "chỉ đo trên điện thoại");
  await page.goto(base);
  await openAssistant(page, true);
  const nav = page.getByRole("tablist", { name: "Chọn vùng" });
  await expect(nav.getByRole("tab", { name: "Trợ lý" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Công, phép của tôi?" }).tap();
  await expect(page.getByTestId("turn").first()).toContainText("Phép năm còn");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await nav.getByRole("tab", { name: "Hôm nay" }).tap();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
  await expect(nav.getByRole("tab", { name: "Hôm nay" })).toHaveAttribute("aria-selected", "true");
});
