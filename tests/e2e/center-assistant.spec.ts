import { readFileSync } from "node:fs";
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

test("T1 tự tra: hiện đang tra gì, ghi 'Đã tra', nút hồ sơ mở đúng màn thành tab", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, "Thép D16 còn tồn bao nhiêu?");
  const turn = chat(page).getByTestId("turn");
  await expect(turn.getByRole("status")).toHaveText("Đang tra tồn kho: thép D16…");
  await expect(turn).toHaveAttribute("data-state", "done");
  await expect(turn.locator(".vcc-msg-a")).toHaveText("Thép CB400 D16 còn 42,4 tấn: Kho SMB 12,4 tấn, Kho tổng Hưng Yên 30 tấn.");
  await expect(turn.locator(".vcc-msg-tools")).toHaveText("Đã tra: Tồn kho");
  await turn.getByRole("group", { name: "Chứng từ, màn gốc" }).getByRole("button", { name: "THEP-D16" }).click();
  await expect(workTabs(page).getByRole("tab", { name: /THEP-D16/ })).toHaveAttribute("aria-selected", "true");
});

test("T2a lệnh nháp: Trợ lý chuẩn bị đơn nghỉ phép → thẻ → sửa lý do → Gửi đơn → biên nhận; tải lại vẫn thấy; Mở màn Nghỉ phép", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, "Cho anh xin nghỉ phép năm thứ 4 21/10, việc gia đình");
  const card = chat(page).getByTestId("command");
  await expect(card).toHaveAttribute("data-state", "prepared");
  await expect(card.getByText("Đơn phép năm 21/10")).toBeVisible();
  await expect(card.locator(".vcc-cmd-facts")).toContainText("21/10 cả ngày · 1 ngày");
  await expect(card.locator(".vcc-cmd-facts")).toContainText("Quản lý trực tiếp — Hà Đức Chuẩn");
  await expect(card.getByText("Chưa gửi gì tới khi anh bấm.")).toBeVisible();
  // Chuẩn bị không phải "tra": không có dòng "Đã tra".
  await expect(chat(page).getByTestId("turn").locator(".vcc-msg-tools")).toHaveCount(0);
  await card.getByLabel("Lý do nghỉ").fill("Đưa con đi khám");
  await card.getByRole("button", { name: "Gửi đơn" }).click();
  await expect(card).toHaveAttribute("data-state", "done");
  await expect(card).toContainText("Đã gửi đơn NP-2026-0099 · chờ Hà Đức Chuẩn duyệt");
  expect((await aiCalls(page)).find(call => call.command === "run")).toMatchObject({ reason: "Đưa con đi khám" });
  await page.reload();
  await openAssistant(page, false);
  const again = chat(page).getByTestId("command");
  await expect(again).toHaveAttribute("data-state", "done");
  await again.getByRole("button", { name: "Mở" }).click();
  await expect(workTabs(page).getByRole("tab", { name: /NP-2026-0099/ })).toHaveAttribute("aria-selected", "true");
});

test("T2a: Bỏ thẻ; thiếu phép khóa nút Gửi; gửi lỗi báo lý do rồi Gửi lại được", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, "Xin nghỉ phép năm 21/10");
  await chat(page).getByTestId("command").getByRole("button", { name: "Bỏ" }).click();
  await expect(chat(page).getByTestId("command")).toHaveAttribute("data-state", "cancelled");
  await expect(chat(page).getByTestId("command")).toHaveText("Đã bỏ đơn phép năm 21/10.");

  // Mỗi tình huống một hội thoại sạch (fixture giữ hội thoại qua sessionStorage để thử tải lại trang).
  const fresh = async (mode: string) => {
    await page.evaluate(() => sessionStorage.removeItem("center-fixture-ai-threads"));
    await page.goto(`${base}?ai=${mode}`);
    await openAssistant(page, false);
  };
  await fresh("leave-short");
  await ask(page, "Xin nghỉ phép năm 21/10");
  const short = chat(page).getByTestId("command");
  await expect(short.getByRole("alert")).toContainText("Phép năm còn 0,5 ngày, không đủ 1 ngày.");
  await expect(short.getByRole("button", { name: "Gửi đơn" })).toBeDisabled();

  await fresh("leave-fail");
  await ask(page, "Xin nghỉ phép năm 21/10");
  const fail = chat(page).getByTestId("command");
  await fail.getByRole("button", { name: "Gửi đơn" }).click();
  await expect(fail.getByRole("alert")).toContainText("Ngày 21/10 đã có đơn nghỉ khác.");
  await fail.getByRole("button", { name: "Gửi đơn" }).click();
  await expect(fail).toHaveAttribute("data-state", "done");
});

test("T2a điện thoại: thẻ đơn nghỉ không tràn ngang, bấm Gửi đơn ra biên nhận", async ({ page, isMobile }) => {
  test.skip(!isMobile, "chỉ đo trên điện thoại");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, true);
  const box = page.getByLabel("Câu hỏi", { exact: true });
  await box.fill("Xin nghỉ phép năm 21/10, việc gia đình");
  await chat(page).getByRole("button", { name: "Gửi", exact: true }).tap();
  const card = chat(page).getByTestId("command");
  await expect(card).toHaveAttribute("data-state", "prepared");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.getByRole("button", { name: "Gửi đơn" }).tap();
  await expect(card).toContainText("Đã gửi đơn NP-2026-0099");
});

test("gợi ý bấm: Trợ lý hỏi lại kèm phương án → nút; bấm là gửi đúng câu, ra thẻ đơn; nhãn không hiện thành chữ", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, "Xin nghỉ");
  const turn = chat(page).getByTestId("turn").last();
  await expect(turn.locator(".vcc-msg-a")).toHaveText("Anh nghỉ loại nào?");
  const options = chat(page).getByRole("group", { name: "Gợi ý trả lời" });
  await expect(options.getByRole("button")).toHaveText(["Phép năm", "Ốm đau (BHXH)", "Việc riêng không lương"]);
  await options.getByRole("button", { name: "Phép năm" }).click();
  await expect(chat(page).locator(".vcc-msg-q").last()).toHaveText("Phép năm");
  await expect(chat(page).getByTestId("command")).toHaveAttribute("data-state", "prepared");
  // Đã trả lời rồi thì gợi ý cũ biến mất (chỉ câu trả lời cuối có nút).
  await expect(chat(page).getByRole("group", { name: "Gợi ý trả lời" })).toHaveCount(0);
  expect((await aiCalls(page)).filter(call => call.skill === "assistant_chat").map(call => call.question)).toEqual(["Xin nghỉ", "Phép năm"]);
});

test("T2b (bản không có form trong chat): thẻ dòng vật tư → Mở form đề xuất đúng dự án; form lưu xong thẻ thành biên nhận; tải lại vẫn thấy", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini&mrform=0`);
  await openAssistant(page, false);
  await ask(page, "Đề xuất cho SMB 2 tấn xi măng PCB40, 50 cây thép D16, dây thép buộc, cần 23/10 đổ sàn tầng 4");
  const card = chat(page).getByTestId("command");
  await expect(card).toHaveAttribute("data-state", "prepared");
  await expect(card.locator(".vcc-cmd-title")).toHaveText("Vật tư đổ bê tông sàn tầng 4");
  await expect(card.locator(".vcc-cmd-facts")).toContainText("SMB-2026 · Nhà máy SMB");
  await expect(card.locator(".vcc-cmd-facts")).toContainText("23/10");
  await expect(card.getByRole("list", { name: "Vật tư" }).getByRole("listitem")).toHaveText(["Xi măng PCB402 tấn", "Thép D1650 cây", "Ống PVC20 cây", "Dây thép buộcchưa có SL"]);
  await expect(card.getByText("Chọn mã và gửi ở form — chưa gửi gì tới khi anh bấm.")).toBeVisible();
  await expect(chat(page).getByTestId("turn").locator(".vcc-msg-tools")).toHaveCount(0);
  await card.getByRole("button", { name: "Mở form đề xuất" }).click();
  await expect(workTabs(page).getByRole("tab", { name: /Đề xuất · SMB-2026/ })).toHaveAttribute("aria-selected", "true");
  // Form thật lưu / gửi xong báo về thẻ (bản thử gọi thẳng) → biên nhận, có nút mở phiếu.
  await page.evaluate(() => (window as unknown as { __fxSaveMr: (submitted: boolean) => void }).__fxSaveMr(true));
  await openAssistant(page, false);
  const done = chat(page).getByTestId("command");
  await expect(done).toHaveAttribute("data-state", "done");
  await expect(done).toContainText("Đã gửi đề xuất MR-2026-0042");
  await page.reload();
  await openAssistant(page, false);
  await expect(chat(page).getByTestId("command")).toContainText("Đã gửi đề xuất MR-2026-0042");
  await chat(page).getByTestId("command").getByRole("button", { name: "Mở" }).click();
  await expect(workTabs(page).getByRole("tab", { name: /MR-2026-0042/ })).toHaveAttribute("aria-selected", "true");
});

test("T2b điện thoại: form đề xuất trong chat không tràn ngang, có nút Gửi duyệt", async ({ page, isMobile }) => {
  test.skip(!isMobile, "chỉ đo trên điện thoại");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, true);
  const box = page.getByLabel("Câu hỏi", { exact: true });
  await box.fill("Đề xuất 2 tấn xi măng PCB40, 50 cây thép D16, dây thép buộc");
  await chat(page).getByRole("button", { name: "Gửi", exact: true }).tap();
  const card = chat(page).getByTestId("command");
  await expect(card).toHaveAttribute("data-state", "prepared");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(card.getByTestId("mr-form")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(card.getByRole("button", { name: "Gửi duyệt" })).toBeVisible();
});

const MR_ASK = "Đề xuất cho SMB 2 tấn xi măng PCB40, 50 cây thép D16, 20 cây ống PVC, dây thép buộc, cần 23/10 đổ sàn tầng 4";

test("T2b form trong chat: mã tự khớp, chọn mã bằng gợi ý, bỏ dòng, chọn người duyệt rồi Gửi duyệt ngay trên thẻ → biên nhận", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, MR_ASK);
  const card = chat(page).getByTestId("command");
  const form = card.getByTestId("mr-form");
  await expect(form.getByLabel("Tên đề xuất")).toHaveValue("Vật tư đổ bê tông sàn tầng 4");
  await expect(form.getByLabel("Dùng cho")).toHaveValue("Đổ bê tông sàn tầng 4");
  await expect(form.getByLabel("Kho nhận")).toHaveValue("wh-smb");
  await expect(form.getByLabel("Cần ngày")).toHaveValue("2026-10-23");
  const rows = form.getByRole("list", { name: "Dòng vật tư" }).locator(":scope > li");
  await expect(rows).toHaveCount(4);
  await expect(form.getByLabel("Mã vật tư cho Xi măng PCB40")).toHaveValue("it-boq-ximang-pcb40");
  await expect(form.getByLabel("Số lượng Xi măng PCB40")).toHaveValue("2");
  // "Thép D16 · 50 cây": đơn vị phân định → Thép XD D16 (Cây), không phải thép tròn trơn tính Kg.
  await expect(form.getByLabel("Mã vật tư cho Thép")).toHaveValue("it-1779153359828-833-2jd93");
  const hints = form.getByRole("group", { name: "Gợi ý mã cho Ống PVC" }).getByRole("button");
  await expect(hints).toHaveCount(3);
  await hints.first().click();
  await expect(rows.nth(2)).toContainText("Đã khớp");
  await expect(form.getByRole("group", { name: "Gợi ý mã cho Ống PVC" })).toHaveCount(0);
  await form.getByRole("button", { name: "Bỏ dòng Dây thép buộc" }).click();
  await expect(rows).toHaveCount(3);
  await form.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(form.getByRole("alert")).toContainText("Chọn người duyệt.");
  await form.getByRole("group", { name: "Chọn người duyệt" }).getByRole("button", { name: "Hà Đức Chuẩn" }).click();
  await form.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(card).toHaveAttribute("data-state", "done");
  await expect(card).toContainText("Đã gửi đề xuất MR-2026-0042 · chờ Hà Đức Chuẩn duyệt");
  const submit = (await aiCalls(page)).find(call => call.mrForm === "submit") as Record<string, unknown> & { lines: Array<Record<string, unknown>> };
  expect(submit).toMatchObject({ mode: "send", warehouseId: "wh-smb", neededDate: "2026-10-23", approverIds: ["u-chuan"], title: "Vật tư đổ bê tông sàn tầng 4" });
  expect(submit.lines.map(line => line.item).slice(0, 2)).toEqual(["Xi măng PCB40", "Thép XD D16"]);
  expect(String(submit.lines[2].item)).toMatch(/^Ống PVC/);
  expect(submit.lines[0]).toMatchObject({ qty: 2, reason: "Đổ bê tông sàn tầng 4" });
  expect(submit.lines[1]).toMatchObject({ qty: 50 });
  await page.reload();
  await openAssistant(page, false);
  await expect(chat(page).getByTestId("command")).toContainText("Đã gửi đề xuất MR-2026-0042 · chờ Hà Đức Chuẩn duyệt");
});

test("T4a học từ thẻ: cách gọi đã xác nhận lần trước chọn sẵn mã (Đã nhớ), không bắt chọn lại; gửi xong dạy lại đúng chữ người dùng", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini&memory=1`);
  await openAssistant(page, false);
  await ask(page, MR_ASK);
  const card = chat(page).getByTestId("command");
  const form = card.getByTestId("mr-form");
  const rows = form.getByRole("list", { name: "Dòng vật tư" }).locator(":scope > li");
  await expect(rows.nth(2)).toContainText("Đã nhớ");
  await expect(form.getByLabel("Mã vật tư cho Ống PVC")).toHaveValue("it-1a7f772d34ab4306be08e57a597b0641");
  await expect(form.getByRole("group", { name: "Gợi ý mã cho Ống PVC" })).toHaveCount(0);
  await expect(rows.nth(0)).toContainText("Đã khớp");
  await form.getByRole("button", { name: "Bỏ dòng Dây thép buộc" }).click();
  await form.getByRole("group", { name: "Chọn người duyệt" }).getByRole("button", { name: "Hà Đức Chuẩn" }).click();
  await form.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(card).toHaveAttribute("data-state", "done");
  const submit = (await aiCalls(page)).find(call => call.mrForm === "submit") as Record<string, unknown> & { lines: Array<Record<string, unknown>> };
  expect(submit.lines.map(line => line.said)).toEqual(["Xi măng PCB40", "Thép D16", "Ống PVC"]);
  expect(submit.lines[2]).toMatchObject({ item: "Ống PVC 42", qty: 20 });
});

test("T4a chưa đúng có lý do: bấm Chưa đúng → chọn lý do một chạm; Khác cho ghi chú; gửi về Quản trị AI", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, "Hôm nay việc gì gấp nhất?");
  const turn = chat(page).getByTestId("turn").first();
  await expect(turn).toHaveAttribute("data-state", "done");
  await turn.getByRole("button", { name: "Trả lời chưa đúng" }).click();
  const reasons = turn.getByRole("group", { name: "Vì sao chưa đúng" });
  await expect(reasons.getByRole("button")).toHaveText(["Sai số liệu", "Hiểu sai ý", "Thiếu thông tin", "Chậm", "Khác"]);
  await reasons.getByRole("button", { name: "Hiểu sai ý" }).click();
  await expect(turn.getByRole("status").filter({ hasText: "Cảm ơn" })).toBeVisible();
  await expect(reasons).toHaveCount(0);

  await ask(page, "Còn PO-116 thì sao?");
  const second = chat(page).getByTestId("turn").nth(1);
  await expect(second).toHaveAttribute("data-state", "done");
  await second.getByRole("button", { name: "Trả lời chưa đúng" }).click();
  await second.getByRole("group", { name: "Vì sao chưa đúng" }).getByRole("button", { name: "Khác" }).click();
  await second.getByLabel("Ghi chú lý do").fill("Thiếu ngày giao của PO");
  await second.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(second.getByRole("status").filter({ hasText: "Cảm ơn" })).toBeVisible();
  const feedback = (await aiCalls(page)).filter(call => call.feedback).map(call => call.feedback as Record<string, unknown>);
  expect(feedback.map(({ runId: _id, ...rest }) => rest)).toEqual([
    { accepted: false }, { accepted: false, reason: "misunderstood", note: null },
    { accepted: false }, { accepted: false, reason: "other", note: "Thiếu ngày giao của PO" },
  ]);
  expect(feedback[1].runId).toBe(feedback[0].runId);
  expect(feedback[3].runId).toBe(feedback[2].runId);
  expect(feedback[2].runId).not.toBe(feedback[0].runId);
});

test("T4b nhớ giúp: Trợ lý chỉ chuẩn bị thẻ, người dùng sửa rồi Lưu ghi nhớ; Trí nhớ hiện ghi nhớ, thêm, Quên", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, "Nhớ giúp anh là anh phụ trách SMB-2026 và DA29, báo cáo ngắn gọn số liệu trước");
  const card = chat(page).getByTestId("command");
  await expect(card).toHaveAttribute("data-state", "prepared");
  await expect(card).toContainText("Nháp · chưa nhớ");
  // Chưa bấm Lưu thì chưa nhớ gì.
  expect((await aiCalls(page)).filter(call => call.memory)).toEqual([]);
  await card.getByLabel("Nội dung ghi nhớ").fill("Phụ trách SMB-2026 và DA29");
  await card.getByRole("button", { name: "Lưu ghi nhớ" }).click();
  await expect(card).toHaveAttribute("data-state", "done");
  await expect(card).toContainText("Đã lưu ghi nhớ: “Phụ trách SMB-2026 và DA29”");
  expect((await aiCalls(page)).filter(call => call.memory)).toEqual([{ memory: "save-command", text: "Phụ trách SMB-2026 và DA29" }]);

  await card.getByRole("button", { name: "Trí nhớ" }).click();
  const panel = page.getByRole("region", { name: "Trí nhớ của Trợ lý" });
  await expect(panel).toBeVisible();
  await expect(page.getByLabel("Câu hỏi", { exact: true })).toBeHidden();
  const notes = panel.getByRole("region", { name: "Ghi nhớ" }).getByRole("listitem");
  await expect(notes).toHaveCount(1);
  await expect(notes.first()).toContainText("Phụ trách SMB-2026 và DA29");
  await expect(notes.first()).toContainText("Từ hội thoại");
  await expect(panel.getByRole("region", { name: "Lựa chọn đã nhớ" })).toContainText("lần sau thẻ chọn sẵn người duyệt và kho");

  await panel.getByLabel("Ghi nhớ mới").fill("Trả lời ngắn gọn, số liệu trước");
  await panel.getByRole("button", { name: "Thêm" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Đã lưu ghi nhớ" })).toBeVisible();
  await expect(notes).toHaveCount(2);
  await panel.getByRole("button", { name: "Quên ghi nhớ: Phụ trách SMB-2026 và DA29" }).click();
  await expect(notes).toHaveCount(1);
  expect((await aiCalls(page)).filter(call => call.memory === "forget")).toEqual([{ memory: "forget", scope: "personal", id: expect.stringMatching(/^note-/) }]);
  await panel.getByRole("button", { name: "Về hội thoại" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("Câu hỏi", { exact: true })).toBeVisible();
});

test("T4b đã nhớ: thẻ đề xuất chọn sẵn kho + người duyệt lần trước (Đã nhớ); cách gọi chung quên phải xác nhận", async ({ page, isMobile }) => {
  await page.goto(`${base}?ai=gemini&memory=1`);
  await openAssistant(page, isMobile);
  if (!isMobile) {
    await ask(page, MR_ASK);
    const form = chat(page).getByTestId("mr-form");
    await expect(form.getByLabel("Kho nhận")).toHaveValue("wh-xh");
    await expect(form.getByRole("group", { name: "Chọn người duyệt" }).getByRole("button", { name: "Bùi Thị Tâm" })).toHaveAttribute("aria-pressed", "true");
    await expect(form.getByRole("group", { name: "Chọn người duyệt" }).getByRole("button", { name: "Hà Đức Chuẩn" })).toHaveAttribute("aria-pressed", "false");
    await expect(form.locator(".vcc-mem-pill")).toHaveCount(2);
    await form.getByLabel("Kho nhận").selectOption("wh-smb");
    await expect(form.locator(".vcc-mem-pill")).toHaveCount(1);
  }
  await chat(page).getByRole("button", { name: /Trí nhớ/ }).first().click();
  const panel = page.getByRole("region", { name: "Trí nhớ của Trợ lý" });
  await expect(panel.getByRole("region", { name: "Lựa chọn đã nhớ" }).getByRole("listitem")).toHaveText([/Người duyệt đề xuất · SMB-2026: Bùi Thị Tâm/, /Kho nhận đề xuất · SMB-2026: Kho Xin Hai Vina/]);
  await panel.getByRole("tab", { name: /Cách gọi chung · 2/ }).click();
  await expect(panel.locator("details summary")).toHaveText([/Mua hàng · Báo giá/, /SMB-2026 · Đề xuất vật tư/]);
  await panel.getByRole("button", { name: "Quên cách gọi: Ống PVC" }).click();
  const confirm = panel.getByRole("group", { name: "Xác nhận quên “Ống PVC”" });
  await expect(confirm).toContainText("Quên cho mọi người?");
  await confirm.getByRole("button", { name: "Giữ" }).click();
  expect((await aiCalls(page)).filter(call => call.memory === "forget")).toEqual([]);
  await panel.getByRole("button", { name: "Quên cách gọi: Ống PVC" }).click();
  await panel.getByRole("group", { name: "Xác nhận quên “Ống PVC”" }).getByRole("button", { name: "Quên" }).click();
  await expect(panel.locator("details summary")).toHaveText([/Mua hàng · Báo giá/]);
  expect((await aiCalls(page)).filter(call => call.memory === "forget")).toEqual([{ memory: "forget", scope: "shared", id: "al-1" }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("T3 tệp trong chat: ghim Excel + ảnh → khay tệp (bỏ được), tệp lạ báo lý do; chỉ gửi tệp → Trợ lý hỏi làm gì; bấm gợi ý gửi lại đúng tệp", async ({ page, isMobile }) => {
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, isMobile);
  const files = "tests/center/files";
  const send = page.getByRole("button", { name: "Gửi", exact: true });
  await expect(send).toBeDisabled();
  const file = (name: string, mimeType: string) => ({ name, mimeType, buffer: readFileSync(`${files}/${name}`) });
  await page.locator('input[type="file"]').setInputFiles([file("bao-gia-hanaka.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    file("bao-gia-hanaka.jpg", "image/jpeg"), { name: "hop-dong.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK") }]);
  const tray = page.getByRole("group", { name: "Tệp đính kèm" });
  await expect(tray.getByText("bao-gia-hanaka.xlsx · 6 hàng")).toBeVisible();
  await expect(tray.getByText("bao-gia-hanaka.jpg")).toBeVisible();
  await expect(tray.getByRole("alert")).toHaveText("hop-dong.docx: chưa đọc được loại tệp này (dùng ảnh, PDF, Excel hoặc CSV).");
  await expect(send).toBeEnabled();
  await send.click();
  const user = chat(page).locator('.vcc-msg[data-role="user"]').last();
  await expect(user).toContainText("Xem tệp đính kèm.");
  await expect(user).toContainText("📎 bao-gia-hanaka.xlsx · 1 ảnh");
  await expect(tray).toHaveCount(0);
  const turn = chat(page).getByTestId("turn").last();
  await expect(turn).toHaveAttribute("data-state", "done");
  const first = (await aiCalls(page)).filter(call => call.skill === "assistant_chat").at(-1) as Record<string, unknown> & { files: Array<{ name: string; head: string }> };
  expect(first).toMatchObject({ question: "Xem tệp đính kèm.", images: 1 });
  expect(first.files[0].name).toBe("bao-gia-hanaka.xlsx");
  expect(first.files[0].head).toContain("| STT | Tên hàng | ĐVT | Số lượng | Đơn giá | Thành tiền |");
  expect(first.files[0].head).toContain("| 1 | Thép vằn D16 CB400 | kg | 6300 | 15850 | 99855000 |");
  await turn.getByRole("group", { name: "Gợi ý trả lời" }).getByRole("button", { name: "Lập đơn mua theo báo giá này" }).click();
  await expect(chat(page).getByTestId("command")).toBeVisible();
  const second = (await aiCalls(page)).filter(call => call.skill === "assistant_chat").at(-1) as Record<string, unknown> & { files: unknown[] };
  expect(second).toMatchObject({ question: "Lập đơn mua theo báo giá này", images: 1 });
  expect(second.files).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("T3: bỏ tệp khỏi khay trước khi gửi; dán ảnh vào ô hỏi cũng đính kèm", async ({ page, isMobile }) => {
  test.skip(isMobile, "dán ảnh đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await page.locator('input[type="file"]').setInputFiles(["tests/center/files/bao-gia-hanaka.xlsx"]);
  const tray = page.getByRole("group", { name: "Tệp đính kèm" });
  await tray.getByRole("button", { name: "Bỏ tệp bao-gia-hanaka.xlsx" }).click();
  await expect(tray).toHaveCount(0);
  await page.getByLabel("Câu hỏi", { exact: true }).evaluate(async el => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "chup-man-hinh.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(tray.locator('[data-kind="image"]')).toHaveCount(1);
});

test("T2b form: gửi lỗi giữa chừng báo lý do rồi gửi lại được; dự án chưa có quy trình thì khóa Gửi duyệt, vẫn Lưu nháp", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=mr-fail`);
  await openAssistant(page, false);
  await ask(page, MR_ASK);
  const form = chat(page).getByTestId("mr-form");
  await form.getByRole("group", { name: "Gợi ý mã cho Ống PVC" }).getByRole("button").first().click();
  await form.getByRole("group", { name: "Chọn người duyệt" }).getByRole("button", { name: "Bùi Thị Tâm" }).click();
  await form.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(form.getByRole("alert")).toContainText("Mất kết nối, chưa gửi được.");
  await form.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(chat(page).getByTestId("command")).toContainText("Đã gửi đề xuất MR-2026-0042 · chờ Bùi Thị Tâm duyệt");

  await page.evaluate(() => sessionStorage.removeItem("center-fixture-ai-threads"));
  await page.goto(`${base}?ai=mr-noflow`);
  await openAssistant(page, false);
  await ask(page, MR_ASK);
  const blocked = chat(page).getByTestId("mr-form");
  await expect(blocked).toContainText("Dự án chưa cấu hình workflow đề xuất vật tư hợp lệ. Vẫn lưu nháp được.");
  await expect(blocked.getByRole("button", { name: "Gửi duyệt" })).toBeDisabled();
  await blocked.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(chat(page).getByTestId("command")).toContainText("Đã lưu nháp đề xuất MR-2026-0042 · mở để gửi duyệt");
  expect((await aiCalls(page)).filter(call => call.mrForm === "submit").at(-1)).toMatchObject({ mode: "draft", approverIds: [] });
});

const PO_ASK = "Lập đơn mua theo báo giá Hòa Phát cho SMB: xi măng PCB40 10 tấn 1.650.000, thép XD D16 50 cây 280.000, ống PVC 20 cây 95.000, VAT 8%, giao 25/10";

test("T2c đơn mua trong chat: báo giá → khớp mã, NCC bấm chọn, lý do, vượt BOQ, người duyệt, tổng tiền → Gửi duyệt ra biên nhận", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, PO_ASK);
  const card = chat(page).getByTestId("command");
  const form = card.getByTestId("po-form");
  await expect(form.getByLabel("Mã vật tư cho Xi măng PCB40")).toHaveValue("it-boq-ximang-pcb40");
  await expect(form.getByLabel("Số lượng Xi măng PCB40")).toHaveValue("10");
  await expect(form.getByLabel("Đơn giá Xi măng PCB40")).toHaveValue("1650000");
  await expect(form.getByLabel("Mã vật tư cho Thép XD D16")).toHaveValue("it-1779153359828-833-2jd93");
  await expect(form.getByLabel("Ngày giao")).toHaveValue("2026-10-25");
  await expect(form.getByLabel("Thuế VAT %")).toHaveValue("8");
  const rows = form.getByRole("list", { name: "Dòng đơn mua" }).locator(":scope > li");
  await expect(rows.nth(0)).toContainText("Vượt BOQ");
  await expect(rows.nth(1)).toContainText("Ngoài BOQ");
  await expect(form.getByLabel("Tiền đơn")).toContainText("Tạm tính 32.400.000đ");
  await expect(form.getByLabel("Tiền đơn")).toContainText("Tổng 34.992.000đ");
  await form.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(form.getByRole("alert")).toContainText("Chọn nhà cung cấp.");
  await expect(form.getByRole("alert")).toContainText("Chọn lý do mua chủ động.");
  await expect(form.getByRole("alert")).toContainText("ghi lý do mua vượt");
  await expect(form.getByRole("alert")).toContainText("Chọn người duyệt.");
  await form.getByRole("group", { name: "Chọn nhà cung cấp" }).getByRole("button", { name: /Công ty CP Thép Hòa Phát/ }).click();
  await expect(form.getByRole("group", { name: "Nhà cung cấp đã chọn" })).toContainText("Công ty CP Thép Hòa Phát");
  await form.getByRole("group", { name: "Lý do mua chủ động" }).getByRole("button", { name: "Chốt giá tốt" }).click();
  await form.getByLabel("Lý do mua vượt BOQ").fill("Chốt giá trước tăng giá tháng 11");
  await form.getByRole("group", { name: "Chọn người duyệt" }).getByRole("button", { name: "Hà Đức Chuẩn" }).click();
  await form.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(card).toHaveAttribute("data-state", "done");
  await expect(card).toContainText("Đã gửi đơn PO-2026-0712");
  await expect(card).toContainText("chờ Hà Đức Chuẩn duyệt");
  const submit = (await aiCalls(page)).find(call => call.poForm === "submit") as Record<string, unknown> & { lines: unknown[] };
  expect(submit).toMatchObject({ mode: "send", vendorId: "v-hp", warehouseId: "wh-smb", vat: 8, reasonCode: "price_lock", approverId: "u-chuan", deliveryDate: "2026-10-25",
    overBoqReason: "Chốt giá trước tăng giá tháng 11" });
  expect(submit.lines).toHaveLength(3);
  await card.getByRole("button", { name: "Mở" }).click();
  await expect(workTabs(page).getByRole("tab", { name: /PO-2026-0712/ })).toHaveAttribute("aria-selected", "true");
});

test("19/10 nháp đơn mua: sửa VAT, chọn NCC, lý do rồi rời đi (tải lại trang) → quay lại form vẫn giữ nguyên, không tốn lượt AI", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, PO_ASK);
  const form = chat(page).getByTestId("command").getByTestId("po-form");
  await expect(form.getByLabel("Thuế VAT %")).toHaveValue("8");
  await form.getByLabel("Thuế VAT %").fill("10");
  await form.getByRole("group", { name: "Chọn nhà cung cấp" }).getByRole("button", { name: /Công ty CP Thép Hòa Phát/ }).click();
  await form.getByRole("group", { name: "Lý do mua chủ động" }).getByRole("button", { name: "Chốt giá tốt" }).click();
  await form.getByLabel("Lý do mua vượt BOQ").fill("Giữ giá tháng 11");
  await form.getByLabel("Số lượng Xi măng PCB40").fill("12");
  // Ghi nháp trễ 400 ms → chờ rồi mới rời.
  await page.waitForTimeout(600);
  const before = (await aiCalls(page)).length;
  await page.reload();
  await openAssistant(page, false);
  const again = chat(page).getByTestId("command").getByTestId("po-form");
  await expect(again.getByLabel("Thuế VAT %")).toHaveValue("10");
  await expect(again.getByLabel("Số lượng Xi măng PCB40")).toHaveValue("12");
  await expect(again.getByRole("group", { name: "Nhà cung cấp đã chọn" })).toContainText("Công ty CP Thép Hòa Phát");
  await expect(again.getByLabel("Lý do mua vượt BOQ")).toHaveValue("Giữ giá tháng 11");
  // Mở lại không gọi AI thêm lần nào (hội thoại chỉ đọc lại từ máy chủ).
  expect((await aiCalls(page)).filter(call => call.skill === "assistant_chat").length).toBeLessThanOrEqual(before);
  // Bỏ thẻ → nháp xóa.
  await again.getByRole("button", { name: "Bỏ", exact: true }).click();
  await expect(chat(page).getByTestId("command")).toHaveAttribute("data-state", "cancelled");
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("vioo.assistant.formDraft.")).length)).toBe(0);
});

test("19/10 ô hỏi hai tầng: gõ mã / tên → hồ sơ hiện ngay, Enter / bấm mở không hỏi AI; câu hỏi thật → gửi AI kèm hồ sơ vừa thấy; Esc ẩn", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  const box = page.getByLabel("Câu hỏi", { exact: true });
  // Tầng 1: mã nhân viên → một dòng khớp chắc (đúng mã) + dòng "Hỏi Trợ lý"; Enter mở hồ sơ, không gọi AI.
  await box.fill("TT006974");
  const hits = chat(page).getByTestId("instant-hits");
  await expect(hits.getByRole("option")).toHaveCount(2);
  await expect(hits.getByRole("option").first()).toContainText("TT006974");
  await expect(hits.getByRole("option").first()).toContainText("Nguyễn Văn Thanh");
  await expect(hits.getByRole("option").last()).toContainText("Hỏi Trợ lý: “TT006974”");
  await box.press("Enter");
  await expect(workTabs(page).getByRole("tab", { name: /TT006974/ })).toHaveAttribute("aria-selected", "true");
  expect((await aiCalls(page)).filter(c => c.skill === "assistant_chat")).toHaveLength(0);
  // Tên người: khớp nhưng chưa chắc → Enter không tự mở; ↓ rồi Enter mới mở.
  await openAssistant(page, false);
  await box.fill("Thanh");
  await expect(hits.getByRole("option").first()).toContainText("Nguyễn Văn Thanh");
  await box.press("ArrowDown");
  await expect(hits.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await box.press("Escape");
  await expect(hits).toHaveCount(0);
  // Tầng 2: câu hỏi thật → gửi AI kèm hồ sơ vừa thấy (AI khỏi gọi công cụ tìm).
  await box.fill("nhân viên Hương còn bao nhiêu ngày phép năm");
  await expect(hits.getByRole("option").first()).toContainText("Nguyễn Thị Hương");
  await box.press("Enter");
  await expect(hits).toHaveCount(0);
  await expect(chat(page).getByTestId("turn").last()).toBeVisible();
  const call = (await aiCalls(page)).filter(c => c.skill === "assistant_chat").pop() as { question: string; hits?: string[] };
  expect(call.question).toBe("nhân viên Hương còn bao nhiêu ngày phép năm");
  expect(call.hits).toEqual(["TT004431"]);
});

test("19/10 tầng tìm ngay có cả màn hình + thao tác: 'mua hàng' mở màn, 'tạo đề xuất' mở hộp thoại ngay; nghỉ phép là việc Trợ lý tự lo nên Enter đi AI", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  const box = page.getByLabel("Câu hỏi", { exact: true });
  const hits = chat(page).getByTestId("instant-hits");
  await box.fill("mua hàng");
  await expect(hits.getByRole("option").filter({ hasText: "Màn hình" }).first()).toContainText("Mua hàng");
  await box.press("Enter");
  await expect(workTabs(page).getByRole("tab", { name: /Mua hàng/ })).toHaveAttribute("aria-selected", "true");
  await openAssistant(page, false);
  await box.fill("tạo đề xuất");
  await expect(hits.getByRole("option").first()).toContainText("Tạo đề xuất");
  await expect(hits.getByRole("option").first()).toContainText("Thao tác");
  await box.press("Enter");
  await expect.poll(async () => (await aiCalls(page)).some(c => c.modal === "request")).toBe(true);
  expect((await aiCalls(page)).filter(c => c.skill === "assistant_chat")).toHaveLength(0);
  // Nghỉ phép là việc Trợ lý tự lo trong chat (hỏi lại bằng nút): thao tác vẫn hiện để bấm, nhưng Enter đi AI.
  await box.fill("Xin nghỉ");
  await expect(hits.getByRole("option").first()).toContainText("Xin nghỉ phép");
  await box.press("Enter");
  await expect(chat(page).getByTestId("turn").last().locator(".vcc-msg-a")).toHaveText("Anh nghỉ loại nào?");
  expect((await aiCalls(page)).filter(c => c.skill === "assistant_chat")).toHaveLength(1);
  expect((await aiCalls(page)).filter(c => c.modal)).toHaveLength(1);
});

test("T2c điện thoại: form đơn mua không tràn ngang, Lưu nháp được khi chưa có người duyệt", async ({ page, isMobile }) => {
  test.skip(!isMobile, "chỉ đo trên điện thoại");
  await page.goto(`${base}?ai=po-noapprover`);
  await openAssistant(page, true);
  await page.getByLabel("Câu hỏi", { exact: true }).fill(PO_ASK);
  await chat(page).getByRole("button", { name: "Gửi", exact: true }).tap();
  const form = chat(page).getByTestId("po-form");
  await expect(form).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(form.getByRole("button", { name: "Gửi duyệt" })).toBeDisabled();
  await form.getByRole("group", { name: "Chọn nhà cung cấp" }).getByRole("button").first().tap();
  await expect(form.getByRole("group", { name: "Nhà cung cấp đã chọn" })).toBeVisible();
  await form.getByRole("group", { name: "Lý do mua chủ động" }).getByRole("button", { name: "Hàng đặt dài ngày" }).tap();
  await form.getByLabel("Lý do mua vượt BOQ").fill("Đặt sớm cho kịp tiến độ");
  await form.getByRole("button", { name: "Lưu nháp" }).tap();
  await expect(chat(page).getByTestId("command")).toContainText("Đã lưu nháp đơn PO-2026-0712");
});

const DL_PASTE = `BC ngày 13/10
Tổ a Ích 40 ng, công nhật a Đoàn 2
- SXLD ván khuôn cột tầng 1 nhà Văn Phòng
- Xây bể làm mát nhà xưởng
- SXLD ván khuôn cốt thép sàn mái, lắp đặt ubot sàn mái tầng 2 nhà nghỉ ca

BC ngày 14/10
Tổ a Ích 40, công nhật 1
- Tập kết vật liệu

15/10:
Tổ Mr Ích 35 người, cn a Đoàn 2
- Xây tường hành lang nhà xưởng`;

test("T2d nhật ký trong chat: dán báo cáo Zalo → thẻ đọc ngày × mũi × hạng mục → bỏ hạng mục, bỏ mũi → Tạo phiếu nháp → biên nhận, Mở phiếu", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, false);
  await ask(page, DL_PASTE);
  const card = chat(page).getByTestId("command");
  const form = card.getByTestId("dl-form");
  await expect(form).toContainText("17 dòng việc · 8 phiếu · 3 ngày");
  await expect(form.getByRole("region")).toHaveCount(3);
  await expect(form.getByTestId("dl-slip")).toHaveCount(8);
  await expect(form).toContainText("ngoài kế hoạch — chờ QS");
  const chips = form.getByRole("button", { name: /^Bỏ hạng mục/ });
  const before = await chips.count();
  expect(before).toBeGreaterThan(0);
  await chips.first().click();
  await expect(chips).toHaveCount(before - 1);
  await form.getByRole("region", { name: /15\/10/ }).getByTestId("dl-slip").first().getByLabel("Tạo phiếu").uncheck();
  await expect(form).toContainText("7 phiếu");
  await form.getByRole("button", { name: "Tạo 7 phiếu nháp" }).click();
  await expect(card).toHaveAttribute("data-state", "done");
  await expect(card).toContainText("Đã tạo 6 phiếu nhật ký nháp · DA29 · Nhà xưởng XinHai");
  await expect(card).toContainText("Đã có phiếu của mũi này trong ngày — mở để bổ sung.");
  const calls = await aiCalls(page);
  expect(calls.filter(c => c.dailyLog === "create")).toHaveLength(7);
  expect(calls.some(c => c.dailyLog === "learn")).toBe(true);
  expect(calls.find(c => c.dailyLog === "read")).toMatchObject({ reportDate: "2026-10-15" });
  await card.getByRole("button", { name: "Mở phiếu" }).first().click();
  await expect(workTabs(page).getByRole("tab", { name: /Nhật ký 13\/10/ })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await openAssistant(page, false);
  await expect(chat(page).getByTestId("command")).toContainText("Đã tạo 6 phiếu nhật ký nháp");
});

test("T2d: AI đọc lỗi thì báo rõ, Đọc lại được; điện thoại không tràn ngang", async ({ page, isMobile }) => {
  await page.goto(`${base}?ai=dl-fail`);
  await openAssistant(page, isMobile);
  const box = page.getByLabel("Câu hỏi", { exact: true });
  await box.fill(DL_PASTE);
  if (isMobile) await chat(page).getByRole("button", { name: "Gửi", exact: true }).tap(); else await box.press("Enter");
  const card = chat(page).getByTestId("command");
  await expect(card.getByRole("alert")).toContainText("Thử lại, hoặc ghi phiếu như bình thường.");
  await card.getByRole("button", { name: "Đọc lại" }).click();
  await expect(card.getByTestId("dl-form")).toContainText("17 dòng việc");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("chống spam + từ chối lịch sự: còn câu đang trả lời / gửi quá nhanh báo rõ; nhãn từ chối không hiện; tin dài có bộ đếm", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?ai=busy`);
  await openAssistant(page, false);
  await ask(page, "Việc gì gấp?");
  await expect(chat(page).getByTestId("turn").getByRole("alert")).toContainText("Trợ lý đang trả lời câu trước — đợi xong rồi hỏi tiếp.");
  await page.goto(`${base}?ai=rate`);
  await openAssistant(page, false);
  await ask(page, "Việc gì gấp?");
  await expect(chat(page).getByTestId("turn").getByRole("alert")).toContainText("Bạn gửi hơi nhanh — đợi vài giây rồi hỏi tiếp.");

  await page.goto(`${base}?ai=refuse`);
  await openAssistant(page, false);
  const box = page.getByLabel("Câu hỏi", { exact: true });
  await box.fill("x".repeat(7200));
  await expect(chat(page).locator(".vcc-composer-count")).toHaveText("7.200/8.000");
  await box.fill("Mày trả lời ngu thế");
  await expect(chat(page).locator(".vcc-composer-count")).toHaveCount(0);
  await box.press("Enter");
  const turn = chat(page).getByTestId("turn");
  await expect(turn).toHaveAttribute("data-state", "done");
  await expect(turn.locator(".vcc-msg-a")).toHaveText("Em mong anh dùng từ ngữ lịch sự hơn ạ. Anh cần xem việc nào hôm nay?");
  await expect(chat(page)).not.toContainText("tu_choi");
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

test("Trung tâm AI: chưa được cấp Trợ lý thì báo rõ ai cấp, bản tin vẫn dùng; có trần thì hiện số câu còn lại", async ({ page, isMobile }) => {
  await page.goto(`${base}?ai=gemini&access=none`);
  await openAssistant(page, isMobile);
  await expect(chat(page).getByRole("status").filter({ hasText: "Trợ lý AI chưa được cấp" })).toContainText("nhờ Admin Hoàng cấp ở Trung tâm AI");
  await expect(page.getByLabel("Câu hỏi", { exact: true })).toHaveCount(0);
  await expect(brief(page)).toBeVisible();
  await page.goto(`${base}?ai=gemini&access=cap`);
  await openAssistant(page, isMobile);
  await expect(chat(page).getByText("Còn 3 câu hôm nay")).toBeVisible();
});

test("PDF trong chat: PDF có chữ đọc trên máy thành chữ từng trang (cột cách |); PDF scan thành ảnh trang đầu", async ({ page, isMobile }) => {
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, isMobile);
  const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: readFileSync(`tests/center/files/${name}`) });
  await page.locator('input[type="file"]').setInputFiles([pdf("bao-gia-hanaka.pdf"), pdf("bao-gia-scan.pdf")]);
  const tray = page.getByRole("group", { name: "Tệp đính kèm" });
  await expect(tray.getByText("bao-gia-hanaka.pdf · 1 trang")).toBeVisible({ timeout: 15000 });
  await expect(tray.getByText("bao-gia-scan.pdf · trang 1")).toBeVisible({ timeout: 15000 });
  await expect(tray.locator('[data-kind="image"] img')).toHaveCount(1);
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(chat(page).getByTestId("turn").last()).toHaveAttribute("data-state", "done");
  const call = (await aiCalls(page)).filter(c => c.skill === "assistant_chat").at(-1) as Record<string, unknown> & { files: Array<{ name: string; head: string }> };
  expect(call.images).toBe(1);
  expect(call.files.map(f => f.name)).toEqual(["bao-gia-hanaka.pdf"]);
  expect(call.files[0].head).toContain("[PDF · 1 trang]");
  expect(call.files[0].head).toContain("STT | Tên hàng | ĐVT | Số lượng | Đơn giá | Thành tiền");
  await expect(chat(page).locator('.vcc-msg[data-role="user"]').last()).toContainText("📎 bao-gia-hanaka.pdf · 1 ảnh");
});

test("chọn model ở ô hỏi: chỉ model được cấp, nhớ lựa chọn; câu có ảnh tự dùng model đọc ảnh; một model thì chỉ hiện tên", async ({ page, isMobile }) => {
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, isMobile);
  const picker = chat(page).getByRole("button", { name: /^Model: Claude Sonnet 5.5/ });
  await picker.click();
  const menu = page.getByRole("listbox", { name: "Chọn model AI" });
  await expect(menu.getByRole("option")).toHaveCount(2);
  await expect(menu.getByRole("option", { name: /Claude Sonnet 5.5/ })).toHaveAttribute("aria-selected", "true");
  await expect(menu.getByRole("option", { name: /DeepSeek Flash/ })).toContainText("Không đọc ảnh");
  await menu.getByRole("option", { name: /DeepSeek Flash/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(chat(page).getByRole("button", { name: /^Model: DeepSeek Flash/ })).toBeVisible();
  const box = page.getByLabel("Câu hỏi", { exact: true });
  await box.fill("Hôm nay việc gì gấp nhất?");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(chat(page).getByTestId("turn").last()).toHaveAttribute("data-state", "done");
  const chats = () => aiCalls(page).then(calls => calls.filter(c => c.skill === "assistant_chat") as Array<{ context: Record<string, unknown> }>);
  expect((await chats()).at(-1)!.context).toMatchObject({ connectionId: "c-deepseek" });
  // Có ảnh mà DeepSeek không đọc ảnh → câu này gửi bằng Claude, báo rõ.
  await page.locator('input[type="file"]').setInputFiles({ name: "bao-gia.jpg", mimeType: "image/jpeg", buffer: readFileSync("tests/center/files/bao-gia-hanaka.jpg") });
  await expect(chat(page).getByRole("status").filter({ hasText: "câu này dùng Claude Sonnet 5.5" })).toBeVisible();
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(chat(page).getByTestId("turn").last()).toHaveAttribute("data-state", "done");
  expect((await chats()).at(-1)!.context).toMatchObject({ connectionId: "c-claude" });
  // Tải lại: vẫn nhớ DeepSeek.
  await page.reload();
  await openAssistant(page, isMobile);
  await expect(chat(page).getByRole("button", { name: /^Model: DeepSeek Flash/ })).toBeVisible();
  await page.goto(`${base}?ai=gemini&models=1`);
  await openAssistant(page, isMobile);
  await expect(chat(page).getByText("Claude Sonnet 5.5", { exact: true })).toBeVisible();
  await expect(chat(page).getByRole("button", { name: /^Model:/ })).toHaveCount(0);
});

test("lần đầu được cấp: tin chào + thẻ Thử ngay (gửi ngay / điền sẵn để sửa); Đã hiểu thì ẩn hẳn", async ({ page, isMobile }) => {
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, isMobile);
  const welcome = chat(page).getByRole("region", { name: "Chào mừng đến Trợ lý" });
  await expect(welcome).toContainText("Trợ lý AI đã mở cho anh");
  const cards = welcome.getByRole("group", { name: "Thử ngay" }).getByRole("button");
  await expect(cards).toHaveCount(5);
  await cards.filter({ hasText: "Xin nghỉ phép" }).click();
  await expect(page.getByLabel("Câu hỏi", { exact: true })).toHaveValue("Xin nghỉ phép năm ngày mai, lý do ");
  await expect(page.getByLabel("Câu hỏi", { exact: true })).toBeFocused();
  await page.getByLabel("Câu hỏi", { exact: true }).fill("");
  await cards.filter({ hasText: "Việc gì gấp nhất?" }).click();
  await expect(chat(page).getByTestId("turn").first()).toHaveAttribute("data-state", "done");
  expect((await aiCalls(page)).filter(c => c.skill === "assistant_chat").map(c => c.question)).toEqual(["Hôm nay việc gì gấp nhất?"]);
  await expect(welcome).toHaveCount(0);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await openAssistant(page, isMobile);
  await chat(page).getByRole("region", { name: "Chào mừng đến Trợ lý" }).getByRole("button", { name: "Đã hiểu" }).click();
  await page.reload();
  await openAssistant(page, isMobile);
  await expect(chat(page).getByRole("region", { name: "Chào mừng đến Trợ lý" })).toHaveCount(0);
});

test("biểu đồ biến động nhân sự: thẻ ô số + 2 khung, nghỉ việc chưa có số hiện —, Bảng xem số từng tháng; tải lại vẫn thấy; không quyền thì không có thẻ", async ({ page, isMobile }) => {
  await page.goto(`${base}?ai=gemini`);
  await openAssistant(page, isMobile);
  await ask(page, "Hãy thống kê giúp tôi biểu đồ biến động nhân sự 6 tháng đầu năm");
  const card = chat(page).getByTestId("chart-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Biến động nhân sự T1–T6/2026");
  await expect(card.locator(".vcc-chart-stats dd")).toHaveText(["61", "68", "7", "—"]);
  await expect(card.locator(".vcc-chart-plot svg")).toHaveCount(2);
  await expect(card).toContainText("3 người đã nghỉ chưa có ngày nghỉ việc");
  await expect(chat(page).getByTestId("turn").last()).toContainText("Đã tra: Biến động nhân sự");
  await card.getByRole("button", { name: "Bảng" }).click();
  await expect(card.getByRole("table").first().getByRole("row")).toHaveCount(7);
  await expect(card.getByRole("table").nth(1).getByRole("row").last()).toContainText("T6");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.reload();
  await openAssistant(page, isMobile);
  await expect(chat(page).getByTestId("chart-card")).toContainText("Biến động nhân sự T1–T6/2026");

  await page.goto(`${base}?ai=hc-denied`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await openAssistant(page, isMobile);
  await ask(page, "Biểu đồ biến động nhân sự 6 tháng đầu năm");
  await expect(chat(page).getByTestId("turn").last()).toContainText("ngoài phạm vi anh được xem");
  await expect(chat(page).getByTestId("chart-card")).toHaveCount(0);
});
