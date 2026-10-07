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

const stat = (page: Page, widget: string, key: string) => page.locator(`[data-widget="${widget}"] [data-stat="${key}"]`);

const expectToday = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
  await expect(page.getByText("Thứ Tư, 07/10/2026 · 9 việc chờ bạn · 14 ngày tới hạn hợp đồng SMB-2026")).toBeVisible();
  for (const name of WIDGETS) await expect(page.getByRole("heading", { level: 3, name, exact: true })).toBeVisible();
  // Số thật của mockup, mỗi số là một nút mở đúng nơi; thiếu quyền thì khóa kèm lý do, không hiện 0.
  await expect(stat(page, "project", "construction")).toContainText("3/5 mũi đã gửi phiếu · 39 công");
  await expect(stat(page, "project", "supply")).toContainText("6 PO · 5,36 tỷ · PO-116 09/10");
  await expect(stat(page, "project", "progress")).toContainText("81% · hạn HĐ 21/10 · 7 việc trễ");
  await expect(stat(page, "hrm", "attendance")).toContainText("Vào 07:52 · chưa chấm ra");
  await expect(stat(page, "hrm", "team")).toContainText("21/28 đã chấm công · 6 điều động hiệu lực");
  await expect(stat(page, "work", "assigned")).toContainText("3 đang làm · 1 trễ hạn");
  await expect(stat(page, "office", "documents")).toContainText("1 cần xác nhận đã đọc · TB-12/2026");
  await expect(stat(page, "office", "weather")).toContainText("29° · Mưa rào · hạn chế đổ bê tông");
  await expect(stat(page, "supply", "requests")).toContainText("4 chờ duyệt (Phòng vật tư duyệt) · 29 đang cung ứng");
  const lockedOrders = stat(page, "supply", "orders").locator("[data-locked]");
  await expect(lockedOrders).toHaveText(/Cần quyền xem đơn hàng/);
  await expect(lockedOrders).toHaveAttribute("title", /quyền/);
  await expect(stat(page, "finance", "contract")).toContainText("105,84 tỷ");
  await expect(stat(page, "finance", "received")).toContainText("chưa khai đầu kỳ");
  await expect(page.getByText("Lịch: không có chuyến xe hôm nay")).toBeVisible();
  await stat(page, "project", "progress").getByRole("button").click();
  await expect(page.locator("[data-last-route]")).toHaveAttribute("data-last-route", "/da?projectId=smb&tab=gantt");
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
  // "Chờ bạn: 3 việc của dự án" đưa về cột việc thay vì rời Center.
  await stat(page, "project", "waiting").getByRole("button").click();
  await expect(inbox).toBeVisible();

  // Đổi dự án → tải lại số liệu; dự án không có nhật ký / Work → khóa kèm lý do.
  await page.getByRole("combobox", { name: "Chọn dự án" }).selectOption("da29");
  await expect(page.getByRole("heading", { level: 3, name: "Dự án · DA29", exact: true })).toBeVisible();
  await expect(stat(page, "project", "construction").locator("[data-locked]")).toHaveText(/Cần quyền xem nhật ký/);
  await expect(stat(page, "project", "progress")).toContainText("Chưa có tiến độ");
  await expect(stat(page, "work", "assigned").locator("[data-locked]")).toHaveText(/Vioo Work chưa bật/);
  await expect(page.getByRole("heading", { level: 3, name: "Tài chính dự án", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Chọn dự án" }).selectOption("smb");
  await expect(page.getByRole("heading", { level: 3, name: "Dự án · SMB-2026", exact: true })).toBeVisible();

  // Bấm vào ô → thư mục thao tác bung ra từ ô (transform/opacity, hữu hạn); nút theo quyền; bấm ngoài / Esc thu lại.
  await expect(page.locator('[data-widget="project"]').getByRole("button", { name: "Thao tác Dự án · SMB-2026" })).toHaveText(/Thao tác · 3/);
  await page.locator('[data-widget="project"] .vcc-whead h3').click();
  const folder = page.getByRole("dialog", { name: "Dự án · SMB-2026" });
  await expect(folder).toBeVisible();
  await expect(folder.getByRole("group", { name: "Thao tác Dự án · SMB-2026" }).getByRole("button")).toHaveText([/Lập đề xuất vật tư/, /Tạo nhật ký/, /Kế hoạch tuần/, /Báo cáo ngày/]);
  const lockedPlan = folder.getByRole("button", { name: /Kế hoạch tuần/ });
  await expect(lockedPlan).toBeDisabled();
  await expect(lockedPlan).toHaveAttribute("title", /Tổ chức dự án/);
  await expect(folder).toContainText("3/4 theo quyền của bạn");
  await expectCalmPage(page);
  await page.screenshot({ path: `${shots}/desktop-folder.png` });
  await page.locator(".vcc-fold-backdrop").click({ position: { x: 20, y: 20 } });
  await expect(folder).toHaveCount(0);
  await expectCalmPage(page);

  await page.locator('[data-widget="hrm"]').getByRole("button", { name: /Thao tác/ }).click();
  const hrmFolder = page.getByRole("dialog", { name: "Nhân sự" });
  await expect(hrmFolder).toBeVisible();
  await hrmFolder.getByRole("button", { name: /Xin nghỉ phép/ }).click();
  await expect(hrmFolder).toHaveCount(0);
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
  await expect(stat(page, "office", "weather")).toContainText("Chưa chọn dự án");
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

  await page.locator('[data-widget="hrm"]').getByRole("button", { name: /Thao tác/ }).click();
  const folder = page.getByRole("dialog", { name: "Nhân sự" });
  await expect(folder).toBeVisible();
  await expect(folder.getByRole("button", { name: /Điều động/ })).toBeDisabled();
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
  await page.locator('[data-widget="hrm"]').getByRole("button", { name: /Thao tác/ }).click();
  const folder = page.getByRole("dialog", { name: "Nhân sự" });
  await expect(folder).toBeVisible();
  await back();
  await expect(folder).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chào anh Sơn");
});
