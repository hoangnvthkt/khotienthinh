import { test, expect, type Page } from "@playwright/test";

// Tab Trợ lý v2 · T0 (chủ SP 17/10): khung chat — bản tin gọn (một câu · Làm trước ≤ 3 · Đáng lo ≤ 3) là khối đầu của hội thoại hôm nay;
// hỏi tiếp, chữ chạy dần, Lịch sử, Dừng. Fixture Trung tâm (SMB-2026, 11 việc); ?ai=gemini giả lập cổng AI (hội thoại lưu sessionStorage).
// Desktop 1440 + iPhone (WebKit).
const base = "/tests/center/fixture.html";
const workTabs = (page: Page) => page.getByRole("tablist", { name: "Vùng làm việc" });
const brief = (page: Page) => page.getByRole("region", { name: "Bản tin hôm nay" });
const chat = (page: Page) => page.getByRole("region", { name: "Trợ lý", exact: true });
const ask = async (page: Page, text: string) => {
  const box = page.getByLabel("Câu hỏi", { exact: true });
  await box.fill(text);
  await box.press("Enter");
};
const aiCalls = (page: Page) => page.evaluate(() => (window as unknown as { __aiCalls: Array<Record<string, unknown>> }).__aiCalls);

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
  await expect(page.getByLabel("Câu hỏi", { exact: true })).toHaveCount(0);
  await expect(chat(page).getByRole("group", { name: "Hỏi nhanh" }).getByRole("button")).toHaveText(["Dự án đang thế nào?", "Vật tư, đơn hàng ra sao?", "Tiền của dự án?", "Công, phép của tôi?"]);
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

  await chat(page).getByRole("button", { name: "Dự án đang thế nào?" }).click();
  await expect(chat(page).locator('.vcc-msg[data-role="user"]').first()).toHaveText("Dự án đang thế nào?");
  const turn = chat(page).getByTestId("turn").first();
  await expect(turn.locator(".vcc-qline")).toHaveCount(4);
  await expect(turn).toContainText("3/5 mũi đã gửi phiếu · 39 công");
  await expect(turn).toContainText("6 PO · 5,36 tỷ · PO-116 09/10");
});

test("có khóa AI: hỏi → chữ chạy dần, khóa thành nút mở chứng từ, chấm đúng/sai; hỏi tiếp nối đúng hội thoại; Tóm tắt", async ({ page, isMobile }) => {
  test.skip(isMobile, "luồng AI đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  const c = chat(page);
  await expect(c.locator(".vcc-chat-title")).toHaveText("Hội thoại mới");
  await ask(page, "Hôm nay việc gì gấp nhất?");
  await expect(c.locator('.vcc-msg[data-role="user"]').first()).toHaveText("Hôm nay việc gì gấp nhất?");
  const turn = c.getByTestId("turn").first();
  await expect(turn).toHaveAttribute("data-state", "done");
  await expect(turn.locator(".vcc-msg-a")).toContainText("Anh có 7 việc trễ trên tiến độ SMB-2026");
  await expect(turn.locator(".vcc-msg-a li")).toHaveCount(2);
  await expect(turn.locator(".vcc-msg-a strong").first()).toHaveText("PO-116");
  await expect(turn.locator(".vcc-msg-a")).not.toContainText("[[");
  const sources = turn.getByRole("group", { name: "Chứng từ, màn gốc" });
  await expect(sources.getByRole("button")).toHaveText(["Tiến độ", "Cần mua của SMB-2026", "PO-116"]);
  await expect(c.locator(".vcc-chat-title")).toHaveText("Hôm nay việc gì gấp nhất?");
  // Đã hỏi thì ẩn câu hỏi nhanh, giữ ô nhập.
  await expect(c.getByRole("group", { name: "Hỏi nhanh" })).toHaveCount(0);
  await turn.getByRole("button", { name: "Trả lời đúng" }).click();
  await expect(turn.getByRole("button", { name: "Trả lời đúng" })).toHaveAttribute("aria-pressed", "true");

  await sources.getByRole("button", { name: "PO-116" }).click();
  await expect(workTabs(page).getByRole("tab", { name: /PO-116/ })).toHaveAttribute("aria-selected", "true");
  await workTabs(page).getByRole("tab", { name: "Trợ lý" }).click();

  await ask(page, "Còn PO-116 thì sao?");
  const second = c.getByTestId("turn").nth(1);
  await expect(second).toHaveAttribute("data-state", "done");
  await expect(second).toContainText("em nhớ 1 lượt");

  await brief(page).getByRole("button", { name: "Tóm tắt" }).click();
  await expect(brief(page).getByTestId("narration")).toContainText("PO-116 quá hạn 2 ngày");
  const calls = await aiCalls(page);
  const chats = calls.filter(call => call.skill === "assistant_chat");
  expect(chats[0]).toMatchObject({ question: "Hôm nay việc gì gấp nhất?", threadId: null, pronoun: "Anh", context: { projectId: "smb", tab: "assistant" } });
  expect(Number(chats[0].factLines)).toBeGreaterThan(10);
  expect(chats[1]).toMatchObject({ question: "Còn PO-116 thì sao?", prior: 2 });
  expect(chats[1].threadId).toBeTruthy();
  expect(calls.find(call => call.feedback)).toEqual({ feedback: { runId: "run-1", accepted: true } });
  expect(calls.find(call => call.skill === "morning_brief")).toBeTruthy();
});

test("tải lại trang: hội thoại hôm nay tự mở lại; Hội thoại mới về bản tin; Lịch sử mở lại hội thoại", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, "Việc gì quá hạn?");
  await expect(chat(page).getByTestId("turn")).toHaveAttribute("data-state", "done");
  await page.reload();
  await openAssistant(page, false);
  const c = chat(page);
  await expect(c.locator(".vcc-chat-title")).toHaveText("Việc gì quá hạn?");
  await expect(c.locator('.vcc-msg[data-role="user"]')).toHaveText(["Việc gì quá hạn?"]);
  await expect(c.getByTestId("turn")).toContainText("Anh có 7 việc trễ");

  await c.getByRole("button", { name: "Hội thoại mới" }).click();
  await expect(c.getByTestId("turn")).toHaveCount(0);
  await expect(brief(page)).toBeVisible();
  await expect(page.getByLabel("Câu hỏi", { exact: true })).toBeFocused();

  await c.getByRole("button", { name: "Lịch sử" }).click();
  const list = page.getByRole("dialog", { name: "Lịch sử hội thoại" });
  await expect(list.getByRole("button")).toHaveText([/Việc gì quá hạn\?/]);
  await list.getByRole("button", { name: /Việc gì quá hạn/ }).click();
  await expect(list).toHaveCount(0);
  await expect(c.getByTestId("turn")).toHaveCount(1);
});

test("hội thoại ngày cũ: không tự mở; mở từ Lịch sử thấy ngày, chấm đúng đã lưu, không có bản tin hôm nay", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini&threads=old`);
  await openAssistant(page, false);
  const c = chat(page);
  await expect(c.locator(".vcc-chat-title")).toHaveText("Hội thoại mới");
  await c.getByRole("button", { name: "Lịch sử" }).click();
  const list = page.getByRole("dialog", { name: "Lịch sử hội thoại" });
  await expect(list).toContainText("Hội thoại của bạn · giữ 90 ngày");
  await expect(list.getByRole("button")).toHaveText([/PO nào sắp giao\?\s*04\/10/]);
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await c.getByRole("button", { name: "Lịch sử" }).click();
  await list.getByRole("button", { name: /PO nào sắp giao/ }).click();
  await expect(c.getByText("Hội thoại ngày 04/10")).toBeVisible();
  await expect(brief(page)).toHaveCount(0);
  const turn = c.getByTestId("turn");
  await expect(turn.locator("strong")).toHaveText("đã quá hạn 2 ngày");
  await expect(turn.getByRole("button", { name: "Trả lời đúng" })).toHaveAttribute("aria-pressed", "true");
  await expect(turn.getByRole("group", { name: "Chứng từ, màn gốc" }).getByRole("button")).toHaveText(["PO-116"]);
});

test("AI đứt giữa chừng: bỏ nửa câu, báo lý do + Thử lại; hết lượt báo số lượt; Shift+Enter xuống dòng; Dừng giữ phần đã viết", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=fail`);
  await openAssistant(page, false);
  await ask(page, "Việc gì gấp?");
  const turn = chat(page).getByTestId("turn");
  await expect(turn).toHaveAttribute("data-state", "error");
  await expect(turn.getByRole("alert")).toContainText("AI chưa trả lời được.");
  await expect(turn.locator(".vcc-msg-a")).toHaveCount(0);
  await turn.getByRole("button", { name: "Thử lại" }).click();
  await expect(chat(page).getByTestId("turn")).toHaveCount(1);
  await expect(chat(page).locator('.vcc-msg[data-role="user"]')).toHaveCount(1);
  await expect(chat(page).getByTestId("turn")).toHaveAttribute("data-state", "error");

  await page.goto(`${base}?ai=quota`);
  await openAssistant(page, false);
  await ask(page, "Việc gì gấp?");
  await expect(chat(page).getByTestId("turn").getByRole("alert")).toContainText("Hết lượt AI hôm nay (80/80).");

  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  const box = page.getByLabel("Câu hỏi", { exact: true });
  await box.fill("Dòng 1");
  await box.press("Shift+Enter");
  await box.pressSequentially("Dòng 2");
  await expect(box).toHaveValue("Dòng 1\nDòng 2");
  await expect(chat(page).getByTestId("turn")).toHaveCount(0);
  await box.press("Enter");
  await chat(page).getByRole("button", { name: "Dừng" }).click();
  await expect(chat(page).getByRole("button", { name: "Gửi", exact: true })).toBeVisible();
  await expect(chat(page).getByTestId("turn")).not.toHaveAttribute("data-state", /pending|streaming/);
});

test("điện thoại: nút Trợ lý ở thanh đáy mở bản tin, việc xuống 2 dòng không tràn, quay về Hôm nay", async ({ page, isMobile }) => {
  test.skip(!isMobile, "chỉ đo trên điện thoại");
  await page.goto(base);
  await openAssistant(page, true);
  const nav = page.getByRole("tablist", { name: "Chọn vùng" });
  await expect(nav.getByRole("tab", { name: "Trợ lý" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Công, phép của tôi?" }).tap();
  await expect(page.getByTestId("turn").first()).toContainText("Phép năm còn");
  // Ô nhập luôn trong khung nhìn, trên thanh tab đáy.
  const nav2 = await page.getByRole("tablist", { name: "Chọn vùng" }).boundingBox();
  const chips = await chat(page).getByRole("group", { name: "Hỏi nhanh" }).boundingBox();
  expect(chips && nav2 && chips.y + chips.height <= nav2.y + 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await nav.getByRole("tab", { name: "Hôm nay" }).tap();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
  await expect(nav.getByRole("tab", { name: "Hôm nay" })).toHaveAttribute("aria-selected", "true");
});

test("điện thoại có khóa AI: hỏi ngay ở ô nhập đáy, trả lời trong khung, không tràn ngang", async ({ page, isMobile }) => {
  test.skip(!isMobile, "chỉ đo trên điện thoại");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, true);
  const box = page.getByLabel("Câu hỏi", { exact: true });
  await expect(box).toHaveAttribute("placeholder", "Hỏi về việc, vật tư, tiền…");
  const empty = await box.boundingBox();
  expect(empty && empty.height <= 40).toBe(true);
  await box.tap();
  await box.fill("Việc gì gấp nhất?");
  await chat(page).getByRole("button", { name: "Gửi", exact: true }).tap();
  await expect(chat(page).getByTestId("turn")).toHaveAttribute("data-state", "done");
  await expect(chat(page).getByTestId("turn").getByRole("group", { name: "Chứng từ, màn gốc" }).getByRole("button")).toHaveCount(3);
  const form = await page.locator(".vcc-composer").boundingBox();
  const nav = await page.getByRole("tablist", { name: "Chọn vùng" }).boundingBox();
  expect(form && nav && form.y + form.height <= nav.y + 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("như app thật (không truyền hàm tải việc): mở Trợ lý không sập, báo chưa đọc được việc khi mất mạng", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}?loader=app`);
  await openAssistant(page, false);
  await expect(brief(page).getByRole("region", { name: "Làm trước" })).toContainText("Chưa đọc được Việc của tôi");
  await expect(page.getByText("Đã xảy ra lỗi hệ thống")).toHaveCount(0);
  expect(errors.filter(message => /is not a function/.test(message))).toEqual([]);
});
