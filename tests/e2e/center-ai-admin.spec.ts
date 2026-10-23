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

test("Hoạt động: câu hỏi, thẻ gửi thật / chuẩn bị, hỏi về gì, theo người (ai chưa dùng), 👎 gần đây; đổi kỳ 7 / 14 / 30 ngày", async ({ page, isMobile }) => {
  await page.goto(base);
  await page.getByRole("tab", { name: /Hoạt động/ }).click();
  const act = page.getByRole("region", { name: "Hoạt động AI" });
  await expect(act).toContainText("186");
  await expect(act).toContainText("44/59");
  await expect(act).toContainText("9/16 người đã hỏi · 1 chưa dùng");
  await expect(act.getByRole("list", { name: "Chủ đề câu hỏi" }).getByRole("listitem").first()).toContainText("Tra cứu hồ sơ, tồn kho, việc");
  await expect(act.getByRole("table", { name: "Thẻ nháp theo loại" }).getByRole("row", { name: /Đơn mua/ })).toContainText("21");
  await expect(act.getByRole("row", { name: "Đoàn Văn Dương" })).toContainText("Chưa dùng");
  await expect(act.getByRole("list", { name: "Đánh giá chưa đúng gần đây" })).toContainText("Báo giá Hòa Phát đọc sai đơn giá dòng 3");
  await act.getByRole("radio", { name: "30 ngày" }).click();
  await expect(act.getByRole("radio", { name: "30 ngày" })).toHaveAttribute("aria-checked", "true");
  expect((await calls(page)).filter(c => "activity" in c).map(c => c.activity)).toEqual([14, 30]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("B4 Bản tin tuần: tuần trước đã gửi với 3 việc + tín hiệu; dựng thử tuần này chưa gửi; Gửi Admin ngay có xác nhận → đã gửi 3 Admin; mở từ ?tab=digest; điện thoại không tràn", async ({ page, isMobile }) => {
  await page.goto(`${base}?tab=digest`);
  const panel = page.getByRole("tabpanel", { name: "Bản tin tuần" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("tab", { name: /Bản tin tuần/ })).toHaveAttribute("aria-selected", "true");
  const latest = panel.getByRole("article", { name: "Bản tin tuần 12/10–18/10" });
  await expect(latest).toContainText("Đã gửi 3 Admin");
  const picks = latest.getByRole("list", { name: "Việc nên làm" }).getByRole("listitem");
  await expect(picks).toHaveCount(3);
  await expect(picks.first()).toContainText("Kiểm cổng AI: 5 lượt lỗi trong tuần");
  await expect(picks.nth(2)).toContainText("10/16 người được cấp chưa hỏi Trợ lý");
  await latest.getByText("Tín hiệu phía sau").click();
  await expect(latest).toContainText("Chưa hỏi Trợ lý tuần này (10): Lê Thị Mơ, Nguyễn Văn Chuẩn…");
  await expect(latest).toContainText("56 %");
  if (isMobile) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await panel.getByRole("button", { name: "Dựng thử tuần này" }).click();
  const current = panel.getByRole("article", { name: "Bản tin tuần 19/10–21/10" });
  await expect(current).toContainText("Chưa gửi");
  await expect(current.getByRole("list", { name: "Việc nên làm" }).getByRole("listitem")).toHaveCount(1);
  await expect(panel.getByRole("region", { name: "Bản tin trước" })).toContainText("Tuần 12/10 – 18/10");
  await current.getByRole("button", { name: "Gửi Admin ngay" }).click();
  await expect(page.getByText("Gửi bản tin cho mọi Admin?")).toBeVisible();
  await expect(page.getByText("Mỗi tuần chỉ gửi một lần")).toBeVisible();
  await page.getByRole("button", { name: "Gửi ngay" }).click();
  await expect(current).toContainText("Đã gửi 3 Admin");
  await expect(current.getByRole("button", { name: "Gửi Admin ngay" })).toHaveCount(0);
  expect((await calls(page)).filter(c => c.digest)).toEqual([{ digest: "preview", weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }, { digest: "send", weekStart: "2026-10-19" }]);
});

test("Skill · xem bên trong: dòng có lượt 7 ngày + màn gọi; skill chưa gắn màn báo rõ; công cụ mở ngăn chỉ xem (dùng khi, quyền, thẻ, lượt); từ Trợ lý mở công cụ rồi quay lại", async ({ page }) => {
  await page.goto(base);
  await page.getByRole("tab", { name: /Skill/ }).click();
  const panel = page.getByRole("tabpanel", { name: "Skill" });
  await expect(panel.getByRole("listitem", { name: "Trợ lý · hội thoại" })).toContainText("142 lượt · 11 người");
  await expect(panel.getByRole("listitem", { name: "Tóm tắt đơn trước khi duyệt" })).toContainText("Mua hàng → đơn chờ duyệt");
  await expect(panel.getByRole("listitem", { name: "Tóm tắt văn bản" })).toContainText("Chưa gắn màn nào");
  // 23 công cụ Trợ lý (23/10): tim_ho_so … so_tay, quyen_cua_toi, giai_thich_loi, lech_kiem_soat, bao_cao, bien_dong_nhan_su, 5 chuan_bi_*, chuan_bi_su_co, 4 Vioo Work.
  await expect(panel.getByRole("button", { name: /^Xem công cụ / })).toHaveCount(23);

  await panel.getByRole("button", { name: "Xem công cụ Chuẩn bị đơn mua" }).click();
  const tool = page.getByRole("dialog", { name: "Công cụ Chuẩn bị đơn mua" });
  await expect(tool.getByTestId("tool-when")).toContainText("Dùng khi người dùng muốn lập / đặt đơn mua");
  await expect(tool).toContainText("Quản lý Mua hàng");
  await expect(tool).toContainText("Form đơn mua trong chat");
  await expect(tool.getByLabel("Lượt dùng 7 ngày")).toContainText("Thẻ đã tạo21");
  await expect(tool.getByLabel("Lượt dùng 7 ngày")).toContainText("Gửi thật14");
  await expect(tool).not.toContainText("Mọi người"); // ngăn chỉ xem: không có nút đổi quyền
  await tool.getByRole("button", { name: "Đóng" }).last().click();

  await panel.getByRole("button", { name: "Xem bên trong Trợ lý · hội thoại" }).click();
  const chat = page.getByRole("dialog", { name: "Skill Trợ lý · hội thoại" });
  await expect(chat).toContainText("Chỉ người được cấp ở Trung tâm AI");
  await chat.getByText("Lời dặn gửi model").click();
  await expect(chat.getByTestId("prompt")).toContainText("bien_dong_nhan_su");
  await expect(chat).not.toContainText("Quy tắc an toàn chung");
  await chat.getByRole("button", { name: /Biến động nhân sự/ }).click();
  const chart = page.getByRole("dialog", { name: "Công cụ Biến động nhân sự" });
  await expect(chart).toContainText("get_hrm_headcount_trend_v1");
  await chart.getByRole("button", { name: "Về Trợ lý · hội thoại" }).click();
  await expect(page.getByRole("dialog", { name: "Skill Trợ lý · hội thoại" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("Skill · cổng chưa cập nhật / lỗi lượt dùng: báo rõ + Thử lại, đổi quyền skill vẫn dùng được", async ({ page, isMobile }) => {
  test.skip(isMobile, "đo trên máy tính");
  await page.goto(`${base}?catalog=fail&usage=fail`);
  await page.getByRole("tab", { name: /Skill/ }).click();
  const panel = page.getByRole("tabpanel", { name: "Skill" });
  await expect(panel.getByRole("alert")).toContainText("Chưa đọc được lượt dùng");
  await expect(panel).toContainText("Chưa đọc được lời dặn từ cổng AI");
  await expect(panel.getByRole("listitem", { name: "Trợ lý · hội thoại" })).toContainText("—");
  await panel.getByRole("button", { name: "Xem bên trong Đọc báo giá thành dòng đơn" }).click();
  await expect(page.getByRole("dialog", { name: "Skill Đọc báo giá thành dòng đơn" })).toContainText("Chưa đọc được lời dặn");
  await page.getByRole("dialog").getByRole("button", { name: "Đóng" }).last().click();
  await expect(panel.getByRole("radiogroup", { name: "Ai được dùng Đọc báo giá thành dòng đơn" })).toBeVisible();
});

test("Kiểm soát (K0): ô số + lọc theo trạng thái / phân hệ, bung luật thấy cách xử lý, chấp nhận lệch phải có lý do, Mở chứng từ; không tràn ngang", async ({ page }) => {
  await page.goto(`${base}?tab=control`);
  const panel = page.getByRole("tabpanel", { name: "Kiểm soát" });
  await expect(panel.getByText("2/5 luật đang báo")).toBeVisible();
  const group = panel.getByRole("list", { name: "Lệch theo luật" });
  await expect(group.locator("[data-rule]")).toHaveCount(3);
  await panel.getByRole("button", { name: /Dữ liệu cũ/ }).click();
  await expect(group.locator("[data-rule]")).toHaveCount(2);
  expect((await calls(page)).at(-1)).toMatchObject({ controlFindings: { status: "open", legacy: true } });
  await panel.getByRole("button", { name: /Lệch mới/ }).click();
  await panel.getByRole("button", { name: "Đề xuất", exact: true }).click();
  await expect(group.locator("[data-rule]")).toHaveCount(1);
  await panel.getByRole("button", { name: "Tất cả", exact: true }).click();
  const price = group.locator('[data-rule="statement_price_no_reason"]');
  await price.getByRole("button").first().click();
  await expect(price).toContainText("Xử lý:");
  await expect(price).toContainText("Kế toán công nợ");
  await price.getByRole("button", { name: "Chấp nhận" }).click();
  const reason = price.getByRole("textbox", { name: "Lý do chấp nhận" });
  await reason.fill("ngắn");
  await expect(price.getByRole("button", { name: "Chấp nhận" })).toBeDisabled();
  await reason.fill("Giá mới theo phụ lục hợp đồng tháng 10");
  await price.getByRole("button", { name: "Chấp nhận" }).click();
  await expect(panel.getByRole("button", { name: /Đã chấp nhận\s*1/ })).toBeVisible();
  expect((await calls(page)).find(c => c.controlAccept)).toMatchObject({ controlAccept: { id: "f1", reason: "Giá mới theo phụ lục hợp đồng tháng 10" } });
  await group.locator('[data-rule="batch_vat_differs"]').getByRole("button").first().click();
  await group.locator('[data-rule="batch_vat_differs"]').getByRole("button", { name: "Mở" }).first().click();
  await expect(page.getByTestId("route")).toHaveText("/procurement");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("Kiểm soát: chưa có lệch → báo yên; lỗi tải → nút thử lại", async ({ page }) => {
  await page.goto(`${base}?tab=control&control=empty`);
  await expect(page.getByText("Không có lệch mới.")).toBeVisible();
  await page.goto(`${base}?tab=control&control=fail`);
  await expect(page.getByText("Chưa tải được kiểm soát")).toBeVisible();
});

test("Kiểm soát K1 — Admin bật / tắt Báo người xử lý từng luật (có xác nhận)", async ({ page }) => {
  await page.goto(`${base}?tab=control`);
  const panel = page.getByRole("tabpanel", { name: "Kiểm soát" });
  await expect(panel.getByText("2/5 luật đang báo")).toBeVisible();
  await panel.getByRole("button", { name: "Bật báo người xử lý: VAT đợt nhận khác VAT đơn" }).click();
  await page.getByRole("button", { name: "Bật báo", exact: true }).click();
  await expect(panel.getByText("3/5 luật đang báo")).toBeVisible();
  expect((await calls(page)).find(c => c.controlMode)).toMatchObject({ controlMode: { code: "batch_vat_differs", mode: "live" } });
});

test("Kiểm soát K1 — người xử lý: chỉ lệch luật đã bật của mình, không Dữ liệu cũ / Chạy lại / bật luật / Chấp nhận; thấy người xử lý + Quá 3 ngày", async ({ page }) => {
  await page.goto(`${base}?tab=control&control=mine`);
  const panel = page.getByRole("tabpanel", { name: "Kiểm soát" });
  await expect(panel.getByText("Lệch giao cho bạn hoặc bộ phận bạn")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Chạy lại" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Dữ liệu cũ/ })).toHaveCount(0);
  const group = panel.getByRole("list", { name: "Lệch theo luật" });
  await expect(group.locator("[data-rule]")).toHaveCount(2);
  await expect(panel.getByRole("button", { name: /báo người xử lý/ })).toHaveCount(0);
  const mr = group.locator('[data-rule="mr_ended_po_open"]');
  await mr.getByRole("button").first().click();
  await expect(mr).toContainText("Xử lý: Người mua C");
  await expect(mr).toContainText("Quá 3 ngày");
  await expect(mr.getByRole("button", { name: "Chấp nhận" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
