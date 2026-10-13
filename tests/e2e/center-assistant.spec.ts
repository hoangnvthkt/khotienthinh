import { test, expect, type Page } from "@playwright/test";

// Tab Trợ lý (lộ trình A1, đợt đầu chỉ đọc): bản tin từ cùng số liệu Hôm nay / Việc của tôi, câu hỏi nhanh không cần AI,
// hỏi tự do khi có khóa (?ai=gemini, giả lập). Desktop 1440 + iPhone (WebKit).
const base = "/tests/center/fixture.html";
const workTabs = (page: Page) => page.getByRole("tablist", { name: "Vùng làm việc" });

test.beforeEach(async ({ page }) => {
  await page.route("**/*.supabase.co/**", (route) => route.abort());
});

const openAssistant = async (page: Page, isMobile: boolean) => {
  if (isMobile) await page.getByRole("tablist", { name: "Chọn vùng" }).getByRole("tab", { name: "Trợ lý" }).tap();
  else await page.getByRole("button", { name: "Trợ lý" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bản tin hôm nay" })).toBeVisible();
  await expect(workTabs(page).getByRole("tab", { name: "Trợ lý" })).toHaveAttribute("aria-selected", "true");
};

test("bản tin: cần chú ý trước, số liệu đúng như Hôm nay, không có quyền thì khóa chứ không hiện 0", async ({ page, isMobile }) => {
  await page.goto(base);
  await openAssistant(page, isMobile);
  const assistant = page.getByTestId("assistant");
  await expect(assistant.getByText(/^Thứ tư 07\/10 · số liệu lúc 08:30 · \d+ điểm cần chú ý$/)).toBeVisible();
  const attention = assistant.getByRole("region", { name: "Cần chú ý" });
  await expect(attention.locator(".vcc-brief-line").first()).toContainText("81% · hạn HĐ 21/10 · 7 việc trễ");
  await expect(attention.getByText("PO-116 · quá hạn 2 ngày")).toBeVisible();
  await expect(attention.getByText("4 chờ duyệt (Phòng vật tư duyệt) · 29 đang cung ứng")).toBeVisible();
  // Tổng việc khớp cột Việc của tôi (11 việc, 2 quá hạn / hôm nay... theo fixture).
  const mine = assistant.getByRole("region", { name: "Việc chờ bạn" });
  await expect(mine.locator(".vcc-brief-line").first()).toContainText("11 việc");
  const supply = assistant.getByRole("region", { name: "Mua hàng & Kho" });
  await expect(supply.getByText("Cần quyền xem đơn hàng")).toBeVisible();
  await expect(supply.locator('.vcc-brief-line[data-key="supply.orders"]')).toBeDisabled();
  await expect(assistant.getByText("Chưa có khóa AI")).toBeVisible();
  await expect(assistant.getByLabel("Câu hỏi", { exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("bấm dòng việc mở hồ sơ thành tab; bấm dòng số liệu mở đúng màn; câu hỏi nhanh trả lời từ bản tin", async ({ page, isMobile }) => {
  test.skip(isMobile, "luồng tab đo trên máy tính");
  await page.goto(base);
  await openAssistant(page, false);
  const assistant = page.getByTestId("assistant");
  await assistant.locator('.vcc-brief-line[data-key="item.po.po-116"]').click();
  await expect(workTabs(page).getByRole("tab", { name: /PO-116/ })).toHaveAttribute("aria-selected", "true");
  await workTabs(page).getByRole("tab", { name: "Trợ lý" }).click();
  // Dòng số liệu xuất hiện ở "Cần chú ý" lẫn nhóm Dự án — chọn trong Cần chú ý.
  await assistant.getByRole("region", { name: "Cần chú ý" }).locator('.vcc-brief-line[data-key="project.progress"]').click();
  await expect(workTabs(page).getByRole("tab", { name: "Tiến độ" })).toHaveAttribute("aria-selected", "true");
  await workTabs(page).getByRole("tab", { name: "Trợ lý" }).click();

  await assistant.getByRole("button", { name: "Dự án đang thế nào?" }).click();
  const turn = assistant.getByTestId("turn").first();
  await expect(turn).toContainText("Dự án đang thế nào?");
  await expect(turn.getByRole("region", { name: "Dự án · SMB-2026" })).toBeVisible();
  await expect(turn).toContainText("3/5 mũi đã gửi phiếu · 39 công");
  await expect(turn).toContainText("6 PO · 5,36 tỷ · PO-116 09/10");
});

test("có khóa AI (giả lập): hỏi tự do → trả lời kèm nút mở chứng từ gốc; chấm nhận ghi lại; Kể lại bằng lời", async ({ page, isMobile }) => {
  test.skip(isMobile, "luồng AI đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  const assistant = page.getByTestId("assistant");
  await expect(assistant.getByText("AI · Google (Gemini)")).toBeVisible();
  await assistant.getByLabel("Câu hỏi", { exact: true }).fill("Hôm nay việc gì gấp nhất?");
  await assistant.getByRole("button", { name: "Hỏi" }).click();
  const turn = assistant.getByTestId("turn").first();
  await expect(turn).toContainText("Bạn có 7 việc trễ trên tiến độ SMB-2026");
  const sources = turn.getByRole("group", { name: "Chứng từ, màn gốc" });
  await expect(sources.getByRole("button")).toHaveText(["Tiến độ", "PO-116", "Cần mua của SMB-2026"]);
  await turn.getByRole("button", { name: "Trả lời đúng" }).click();
  await sources.getByRole("button", { name: "PO-116" }).click();
  await expect(workTabs(page).getByRole("tab", { name: /PO-116/ })).toHaveAttribute("aria-selected", "true");
  await workTabs(page).getByRole("tab", { name: "Trợ lý" }).click();

  await assistant.getByRole("button", { name: "Kể lại bằng lời" }).click();
  await expect(assistant.getByTestId("narration")).toContainText("PO-116 quá hạn 2 ngày");
  const calls = await page.evaluate(() => (window as unknown as { __aiCalls: Array<Record<string, unknown>> }).__aiCalls);
  expect(calls.find(c => c.skill === "center_question")).toMatchObject({ question: "Hôm nay việc gì gấp nhất?", context: { projectId: "smb", tab: "assistant" } });
  expect(Number((calls.find(c => c.skill === "center_question") as { factLines: number }).factLines)).toBeGreaterThan(10);
  expect(calls.find(c => c.feedback)).toEqual({ feedback: { runId: "run-1", accepted: true } });
  expect(calls.find(c => c.skill === "morning_brief")).toBeTruthy();
});

test("điện thoại: nút Trợ lý ở thanh đáy mở bản tin, câu hỏi nhanh chạy, quay về Hôm nay", async ({ page, isMobile }) => {
  test.skip(!isMobile, "chỉ đo trên điện thoại");
  await page.goto(base);
  await openAssistant(page, true);
  const nav = page.getByRole("tablist", { name: "Chọn vùng" });
  await expect(nav.getByRole("tab", { name: "Trợ lý" })).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("assistant").getByRole("button", { name: "Việc nào đang chờ tôi?" }).tap();
  await expect(page.getByTestId("turn").first().getByRole("region", { name: "Việc chờ bạn" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await nav.getByRole("tab", { name: "Hôm nay" }).tap();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
  await expect(nav.getByRole("tab", { name: "Hôm nay" })).toHaveAttribute("aria-selected", "true");
});
