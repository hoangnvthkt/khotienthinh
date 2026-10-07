import { test, expect, type Page } from "@playwright/test";

// Khung Trung tâm điều hành (PR-A) + Việc của tôi (PR-B) trên fixture: desktop 1440, tablet 820, iPhone (WebKit).
const base = "/tests/center/fixture.html";
const shots = ".center-test-results";
const WIDGETS = ["Dự án · SMB-2026", "Nhân sự", "Công việc", "Hành chính", "Mua hàng & Kho", "Tài chính dự án"];

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

// Ô Hôm nay = nút thao tác nhanh (việc chờ đã ở cột Việc của tôi): bấm là làm ngay; nút chưa có quyền gom vào "N chưa có quyền".
const tiles = (page: Page, widget: string) => page.locator(`[data-widget="${widget}"]`).getByRole("group", { name: /^Thao tác nhanh/ }).getByRole("button");

const expectToday = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
  await expect(page.getByText("Thứ Tư, 07/10/2026 · 9 việc chờ bạn · 14 ngày tới hạn hợp đồng SMB-2026")).toBeVisible();
  for (const name of WIDGETS) await expect(page.getByRole("heading", { level: 3, name, exact: true })).toBeVisible();
  // Tối đa 4 nút được phép; còn nút khác (thêm / chưa có quyền) → "Xem thêm".
  await expect(tiles(page, "project")).toHaveText(["Lập đề xuất vật tư", "Tạo nhật ký", "Báo cáo ngày", "Xem thêm"]);
  await expect(tiles(page, "hrm")).toHaveText(["Chấm công", "Xin nghỉ phép", "Chấm công bù", "Bảng công của tôi", "Xem thêm"]);
  await expect(tiles(page, "work")).toHaveText(["Tạo đề xuất", "Tạo công việc", "Xem thêm"]);
  await expect(tiles(page, "office")).toHaveText(["Đặt xe", "Soạn văn bản", "Văn bản đến", "Tra cứu nhân viên"]);
  await expect(tiles(page, "supply")).toHaveText(["Mua nóng / CCDC", "Xem thêm"]);
  await expect(tiles(page, "finance")).toHaveText(["Chi quỹ công trường", "Tài chính dự án", "Xem thêm"]);
  // Ô không còn số liệu công việc.
  await expect(page.locator(".vcc-grid .vcc-stat")).toHaveCount(0);
  await expect(page.getByText("Lịch: không có chuyến xe hôm nay")).toBeVisible();
  // Bấm nút là làm ngay, không qua bước trung gian.
  await tiles(page, "project").filter({ hasText: "Tạo nhật ký" }).click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "/da?projectId=smb&tab=dailylog");
  const locked = page.getByRole("button", { name: "Mở Mua hàng" });
  await expect(locked).toBeDisabled();
  await expect(locked).toHaveAttribute("title", "Bạn chưa có quyền vào module này");
  await page.getByRole("button", { name: "Mở Dự án" }).click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "/da?projectId=smb");
};

const inboxOf = (page: Page) => page.getByRole("complementary", { name: "Việc của tôi" });

const expectInboxLoaded = async (page: Page) => {
  const inbox = inboxOf(page);
  await expect(inbox.getByRole("tab", { name: "Chờ tôi 9" })).toBeVisible();
  // Nhóm theo module, đúng thứ tự rail, mặc định thu gọn; đếm theo nhóm + số việc gấp (quá hạn / hết hạn hôm nay).
  await expect(inbox.getByRole("button", { expanded: false })).toHaveText([/^Dự án\s*3 gấp\s*3$/, /^Yêu cầu\s*1$/, /^Vioo Work\s*1 gấp\s*1$/, /^Mua hàng\s*1 gấp\s*1$/, /^Nhân sự\s*2$/, /^Office\s*1$/]);
  await expect(inbox.getByRole("button", { name: /MR-2026-2688/ })).toHaveCount(0);
  // "Mở" mở mọi nhóm; dòng có mã, hạn, tiêu đề, người gửi.
  await inbox.getByRole("button", { name: "Mở", exact: true }).click();
  await expect(inbox.getByRole("button", { expanded: true })).toHaveCount(6);
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
  // Hồ sơ chưa tách view → trang module chạy ngay trong tab, đúng id (không qua bước "Mở ở màn …").
  await expect(inbox.getByRole("button", { name: /RQ-2026-000061/ })).toHaveAttribute("aria-current", "true");
  await inbox.getByRole("button", { name: /NK 05\/10/ }).click();
  await expect(page.getByRole("tablist", { name: "Vùng làm việc" }).getByRole("tab")).toHaveText(["Hôm nay", "RQ-2026-000061", "NK 05/10"]);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("NK 05/10 · Nhật ký 05/10 · Sơn Miền Bắc");
  await expect(page.getByTestId("stub-renderer")).toContainText('route · {"path":"/da?projectId=smb&tab=dailylog&dailyLogId=dl-0510"}');
  await expect(page.getByText("Hồ sơ này xử lý ở màn")).toHaveCount(0);
  await page.getByRole("button", { name: "Mở ở màn Dự án" }).click();
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
  await inbox.getByRole("button", { name: "Mở", exact: true }).click();
  await expect(inbox.getByRole("button", { name: /QCT-SMB-10/ })).toContainText("Chờ kế toán duyệt");
  await inbox.getByRole("tab", { name: "Theo dõi" }).click();
  await inbox.getByRole("button", { name: "Mở", exact: true }).click();
  await expect(inbox.getByRole("button", { name: /SA-2026-007/ })).toBeVisible();
  await inbox.getByRole("tab", { name: "Chờ tôi 9" }).click();

  await page.getByRole("button", { name: "Ẩn Việc của tôi" }).click();
  await expect(inbox).toBeHidden();
  await page.getByRole("button", { name: "Hiện Việc của tôi" }).click();
  await expect(inbox).toBeVisible();

  // Đổi dự án → nút theo quyền ở dự án mới; không có quyền nào thì chỉ còn "N thao tác chưa có quyền".
  await page.getByRole("combobox", { name: "Chọn dự án" }).selectOption("da29");
  await expect(page.getByRole("heading", { level: 3, name: "Dự án · DA29", exact: true })).toBeVisible();
  await expect(tiles(page, "project")).toHaveText(["Xem thêm"]);
  await expect(tiles(page, "work")).toHaveText(["Tạo đề xuất", "Xem thêm"]);
  await expect(page.getByRole("heading", { level: 3, name: "Tài chính dự án", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Chọn dự án" }).selectOption("smb");
  await expect(page.getByRole("heading", { level: 3, name: "Dự án · SMB-2026", exact: true })).toBeVisible();

  // Bấm nền ô → thư mục đủ thao tác bung ra từ ô (transform/opacity, hữu hạn), nút khóa kèm lý do; bấm ngoài / Esc thu lại.
  await expect(page.getByRole("button", { name: /Thao tác/ })).toHaveCount(0);
  await page.locator('[data-widget="project"] .vcc-whead h3').click();
  const folder = page.getByRole("dialog", { name: "Dự án · SMB-2026" });
  await expect(folder).toBeVisible();
  await expect(folder.getByRole("group", { name: "Thao tác Dự án · SMB-2026" }).getByRole("button")).toHaveText([/Lập đề xuất vật tư/, /Tạo nhật ký/, /Kế hoạch tuần/, /Báo cáo ngày/]);
  const lockedPlan = folder.getByRole("button", { name: /Kế hoạch tuần/ });
  await expect(lockedPlan).toBeDisabled();
  await expect(lockedPlan).toHaveAttribute("title", /Tổ chức dự án/);
  await expect(lockedPlan).toContainText("Chưa có quyền này trong Tổ chức dự án");
  await expect(folder).toContainText("3/4 thao tác theo quyền của bạn");
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-folder.png` });
  await page.locator(".vcc-fold-backdrop").click({ position: { x: 20, y: 20 } });
  await expect(folder).toHaveCount(0);
  await expectCalmPage(page);

  // Nút trong ô mở form thật ngay.
  await tiles(page, "hrm").filter({ hasText: "Xin nghỉ phép" }).click();
  await expect(page.getByRole("dialog", { name: "Nhân sự" })).toHaveCount(0);
  await expect(page.getByTestId("stub-modal")).toContainText("Form thật: leave");
  await page.getByTestId("stub-modal").getByRole("button", { name: "Gửi" }).click();
  await expect(page.getByTestId("stub-modal")).toHaveCount(0);

  await page.locator('[data-widget="work"] .vcc-whead h3').click();
  const workFolder = page.getByRole("dialog", { name: "Công việc" });
  await expect(workFolder).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(workFolder).toHaveCount(0);
  await page.locator('[data-widget="work"] .vcc-whead h3').click();
  await workFolder.getByRole("button", { name: /Tạo công việc/ }).click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "/work/my?create=1");
  await expect(workFolder).toHaveCount(0);

  await page.getByRole("button", { name: "Trợ lý" }).click();
  await expect(page.getByRole("complementary", { name: "Trợ lý Vioo" })).toBeVisible();
  await page.getByRole("button", { name: "Chuyển nền tối" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-dark.png` });
});

test("desktop: customise widgets — reorder, hide, restore, saved for the account", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(base);
  const grid = page.locator(".vcc-grid");
  const order = () => grid.locator("[data-widget]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-widget")));
  await expect(grid.locator("[data-widget]")).toHaveCount(6);
  // Mặc định theo quyền: thuộc dự án, không phải kế toán / Mua hàng → Dự án trước.
  expect(await order()).toEqual(["project", "hrm", "work", "office", "supply", "finance"]);

  await page.getByRole("button", { name: "Tùy chỉnh" }).click();
  await expect(grid).toHaveAttribute("data-editing", "true");
  // Đang tùy chỉnh thì bấm ô không bung thư mục.
  await grid.locator('[data-widget="hrm"] .vcc-whead h3').click();
  await expect(page.getByRole("dialog", { name: "Nhân sự" })).toHaveCount(0);
  await page.getByRole("button", { name: "Đưa Dự án · SMB-2026 xuống sau" }).click();
  await page.getByRole("button", { name: "Ẩn Hành chính" }).click();
  expect(await order()).toEqual(["hrm", "project", "work", "supply", "finance"]);
  const hidden = page.getByLabel("Ô đã ẩn");
  await expect(hidden.getByRole("button")).toHaveText([/Hành chính/]);
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-customise.png` });
  await page.getByRole("button", { name: "Xong" }).click();
  await expect(page.getByText("Đã lưu bố cục")).toBeVisible();
  await expect(page.getByText("1 ô đang ẩn ·")).toBeVisible();

  // Tải lại: bố cục đã lưu (máy chủ giả lập) vẫn giữ.
  await page.reload();
  await expect(grid.locator("[data-widget]")).toHaveCount(5);
  expect(await order()).toEqual(["hrm", "project", "work", "supply", "finance"]);

  // Thêm lại ô đã ẩn và về mặc định.
  await page.getByRole("button", { name: "Tùy chỉnh" }).click();
  await page.getByLabel("Ô đã ẩn").getByRole("button", { name: /Hành chính/ }).click();
  await expect(grid.locator("[data-widget]")).toHaveCount(6);
  await page.getByRole("button", { name: "Về mặc định" }).click();
  expect(await order()).toEqual(["project", "hrm", "work", "office", "supply", "finance"]);
  await page.getByRole("button", { name: "Xong" }).click();
  await expect(page.getByText("Đã lưu bố cục")).toBeVisible();
});

test("desktop: customise is locked without the layout permission", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(`${base}?layout=locked`);
  const button = page.getByRole("button", { name: "Tùy chỉnh" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", /Tùy chỉnh bố cục của tôi/);
});

test("desktop: no project / today error", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(`${base}?today=loner`);
  // Không thuộc dự án → mặc định chỉ Nhân sự, Công việc, Hành chính; ô theo dự án vào "Ô đã ẩn".
  await expect(page.locator(".vcc-grid [data-widget]")).toHaveCount(3);
  await expect(page.getByText("2 ô đang ẩn ·")).toBeVisible();
  await page.getByRole("button", { name: "Tùy chỉnh" }).click();
  await page.getByLabel("Ô đã ẩn").getByRole("button", { name: /Dự án/ }).click();
  await expect(page.getByText("Bạn chưa thuộc dự án nào.")).toBeVisible();
  await page.getByRole("button", { name: "Xong" }).click();
  await expect(page.getByText("Tài khoản chưa gắn với hồ sơ nhân viên.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Tài chính dự án", exact: true })).toHaveCount(0);
  await expect(page.getByText("Chưa chọn dự án / công trường")).toBeVisible();
  await expect(tiles(page, "hrm")).toHaveText(["Xem thêm"]);
  await page.goto(`${base}?today=error`);
  await expect(page.getByRole("alert")).toContainText("Chưa đọc được số liệu hôm nay");
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
  await expectCalmPage(page);
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

  await tiles(page, "hrm").filter({ hasText: "Xem thêm" }).click();
  const folder = page.getByRole("dialog", { name: "Nhân sự" });
  await expect(folder).toBeVisible();
  await expect(folder.getByRole("button", { name: /Điều động/ })).toBeDisabled();
  await expect(folder.getByRole("button", { name: /Điều động/ })).toContainText("Chỉ HR / HR Manage lập điều động");
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-folder.png` });
  await page.keyboard.press("Escape");
  await expect(folder).toHaveCount(0);

  await nav.getByRole("tab", { name: "Trợ lý" }).click();
  await expect(page.getByRole("complementary", { name: "Trợ lý Vioo" })).toBeVisible();
  await page.getByRole("button", { name: "Mở menu ứng dụng" }).click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "menu");

  await nav.getByRole("tab", { name: "Việc 9" }).click();
  await page.getByRole("button", { name: "Chuyển nền tối" }).click();
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/${tag}-viec-dark.png` });
});

test("Back closes the open layer instead of leaving the Center", async ({ page }, info) => {
  await page.goto(base);
  const inbox = inboxOf(page);
  await expect(inbox.getByRole("tab", { name: "Chờ tôi 9" })).toBeVisible();
  const startLength = await page.evaluate(() => history.length);
  const back = () => page.evaluate(() => history.back());

  if (info.project.name === "desktop") {
    // Thư mục thao tác: Back thu lại, vẫn ở Center.
    await page.locator('[data-widget="project"] .vcc-whead h3').click();
    const folder = page.getByRole("dialog", { name: "Dự án · SMB-2026" });
    await expect(folder).toBeVisible();
    await back();
    await expect(folder).toHaveCount(0);
    await expect(page.getByText("Trung tâm điều hành", { exact: true })).toBeVisible();
    // Đóng bằng Esc thì mốc lịch sử được gỡ: không còn lần Back "chết".
    await page.locator('[data-widget="hrm"] .vcc-whead h3').click();
    await expect(page.getByRole("dialog", { name: "Nhân sự" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Nhân sự" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => history.length)).toBeGreaterThanOrEqual(startLength);
    expect(await page.evaluate(() => (history.state || {}).vccLayer ?? null)).toBeNull();
    return;
  }

  // Điện thoại / máy tính bảng: mở hồ sơ từ danh sách → Back về danh sách.
  await inbox.getByRole("button", { name: /^Yêu cầu/ }).click();
  await inbox.getByRole("button", { name: /RQ-2026-000061/ }).click();
  await expect(inbox).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("RQ-2026-000061");
  await back();
  await expect(inbox).toBeVisible();
  await expect(inbox.getByRole("button", { name: /RQ-2026-000061/ })).toBeVisible();
  // Thư mục thao tác trên điện thoại: Back thu lại.
  const nav = page.getByRole("tablist", { name: "Chọn vùng" });
  await nav.getByRole("tab", { name: "Hồ sơ" }).click();
  await page.getByRole("button", { name: "Đóng RQ-2026-000061" }).click();
  await tiles(page, "hrm").filter({ hasText: "Xem thêm" }).click();
  const folder = page.getByRole("dialog", { name: "Nhân sự" });
  await expect(folder).toBeVisible();
  await back();
  await expect(folder).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
});

test("desktop: choose which quick actions show on a card (max 4), saved for the account", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(base);
  await expect(tiles(page, "hrm")).toHaveText(["Chấm công", "Xin nghỉ phép", "Chấm công bù", "Bảng công của tôi", "Xem thêm"]);
  await tiles(page, "hrm").filter({ hasText: "Xem thêm" }).click();
  const folder = page.getByRole("dialog", { name: "Nhân sự" });
  await folder.getByRole("button", { name: /Chọn nút trên ô/ }).click();
  const pick = folder.getByRole("group", { name: "Chọn nút trên ô Nhân sự" });
  await expect(folder).toContainText("đã chọn 4/4");
  // Đủ 4 nút thì nút chưa chọn bị khóa; nút chưa có quyền không chọn được.
  await expect(pick.getByRole("button", { name: /Điều động/ })).toBeDisabled();
  await pick.getByRole("button", { name: /Chấm công bù/ }).click();
  await pick.getByRole("button", { name: /Chấm công$/ }).click();
  await expect(pick.getByRole("button", { name: /Chấm công$/ })).toHaveAttribute("aria-pressed", "false");
  await pick.getByRole("button", { name: /Chấm công$/ }).click();
  await expect(folder).toContainText("đã chọn 3/4");
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-pick.png` });
  await folder.getByRole("button", { name: "Lưu" }).click();
  await expect(folder.getByRole("button", { name: /Chọn nút trên ô/ })).toBeVisible();
  await page.keyboard.press("Escape");
  // Thứ tự theo lần chọn: bỏ rồi chọn lại "Chấm công" → xuống cuối.
  await expect(tiles(page, "hrm")).toHaveText(["Xin nghỉ phép", "Bảng công của tôi", "Chấm công", "Xem thêm"]);
  await page.reload();
  await expect(tiles(page, "hrm")).toHaveText(["Xin nghỉ phép", "Bảng công của tôi", "Chấm công", "Xem thêm"]);
  // Đổi thứ tự ô sau đó vẫn giữ nút đã chọn.
  await page.getByRole("button", { name: "Tùy chỉnh" }).click();
  await page.getByRole("button", { name: "Đưa Nhân sự lên trước" }).click();
  await page.getByRole("button", { name: "Xong" }).click();
  await expect(page.getByText("Đã lưu bố cục")).toBeVisible();
  await page.reload();
  await expect(tiles(page, "hrm")).toHaveText(["Xin nghỉ phép", "Bảng công của tôi", "Chấm công", "Xem thêm"]);
});

test("desktop: choosing quick actions is locked without the layout permission", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(`${base}?layout=locked`);
  await tiles(page, "hrm").filter({ hasText: "Xem thêm" }).click();
  const button = page.getByRole("dialog", { name: "Nhân sự" }).getByRole("button", { name: /Chọn nút trên ô/ });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", /Tùy chỉnh bố cục của tôi/);
});
