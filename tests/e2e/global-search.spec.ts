import { test, expect, type Page } from "@playwright/test";

// Tìm kiếm toàn hệ thống trên fixture: hiểu tiếng Việt, theo quyền, thao tác nhanh, chọn dự án, trạng thái lỗi.
const base = "/tests/search/fixture.html";
const shots = ".search-test-results";

test.beforeEach(async ({ page }) => {
  await page.route("**/*.supabase.co/**", (route) => route.abort());
});

const input = (page: Page) => page.getByRole("textbox", { name: "Nội dung tìm kiếm" });
const lastAction = (page: Page) => page.getByTestId("last-action");
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 640;

// Không cuộn ngang, không animation lặp vô hạn khi đứng yên (bài học Safari #117).
const expectCalm = async (page: Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations === Infinity).length)).toBe(0);
};

test("ô trống: thao tác nhanh theo quyền, mẹo tìm, phủ kín màn điện thoại", async ({ page }, info) => {
  await page.goto(base);
  await expect(input(page)).toBeFocused();
  const quick = page.getByRole("region", { name: "Thao tác nhanh" });
  await expect(quick.getByRole("button")).toHaveText(["Chấm công", "Xin nghỉ phép", "Tạo đề xuất", "Lập đề xuất vật tư", "Ghi nhật ký công trường", "Lập đơn hàng", "Lập đề nghị chi", "Đặt xe"]);
  await expect(page.getByText(/Mẹo: gõ không dấu hoặc viết tắt/)).toBeVisible();
  if (isPhone(page)) {
    const box = await page.locator(".global-search-panel").boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0 });
    expect(Math.round(box!.height)).toBe(page.viewportSize()!.height);
  }
  await expectCalm(page);
  await page.screenshot({ path: `${shots}/${info.project.name}-empty.png` });
});

test("po thép: hiểu viết tắt, đúng hồ sơ, mở đúng màn", async ({ page }, info) => {
  await page.goto(`${base}?q=po%20th%C3%A9p`);
  await expect(page.getByText("Ưu tiên đơn hàng")).toBeVisible();
  const row = page.getByRole("button", { name: /Kết cấu thép nhà xưởng 3/ }).first();
  await expect(row).toBeVisible();
  await expect(page.getByRole("button", { name: /Xi măng PCB40 đợt 2/ })).toHaveCount(0);
  if (!isPhone(page) && (page.viewportSize()?.width || 0) >= 1024) {
    const preview = page.getByRole("complementary", { name: "Xem trước" });
    await expect(preview.getByText("1.325.000.000 đ")).toBeVisible();
    await expect(preview.getByRole("button", { name: "Mở dự án" })).toBeVisible();
  }
  await expectCalm(page);
  await page.screenshot({ path: `${shots}/${info.project.name}-po-thep.png` });
  await input(page).press("Enter");
  await expect(lastAction(page)).toHaveText("navigate /procurement?po=po116");
});

test("gõ Telex khi quên bật bộ gõ, chữ cái đầu tên người", async ({ page }) => {
  await page.goto(`${base}?q=nhaapj%20kho`);
  await expect(page.getByText(/Hiểu là “nhập kho”/)).toBeVisible();
  await expect(page.locator('[data-selected="true"]')).toContainText("Lập phiếu nhập kho");
  await input(page).fill("nvh");
  await expect(page.getByRole("button", { name: /Nguyễn Văn Hoàng/ }).first()).toBeVisible();
  await input(page).fill("chấm công");
  await expect(page.getByRole("button", { name: /Mua nóng/ })).toHaveCount(0);
});

test("thao tác cần dự án: chọn dự án rồi mở đúng tab", async ({ page }) => {
  await page.goto(`${base}?q=ghi%20nhat%20ky`);
  await expect(page.getByRole("button", { name: /Ghi nhật ký công trường/ }).first()).toBeVisible();
  await input(page).press("Enter");
  await expect(page.getByText("Ghi nhật ký công trường · chọn dự án")).toBeVisible();
  await expect(page.getByRole("button", { name: /Nhà máy Sơn Miền Bắc/ }).first()).toBeVisible();
  // Gõ rồi Enter ngay (không chờ máy chủ): danh sách đã lọc tại chỗ, chọn đúng DA29.
  await input(page).fill("da29");
  await expect(page.getByRole("button", { name: /Nhà máy Sơn Miền Bắc/ })).toHaveCount(0);
  await input(page).press("Enter");
  await expect(lastAction(page)).toHaveText("navigate /da?projectId=da29&tab=dailylog");
});

test("thao tác ngay tại chỗ: xin nghỉ phép mở hộp thoại, không rời trang", async ({ page }) => {
  await page.goto(`${base}?q=xin%20nghi`);
  await input(page).press("Enter");
  await expect(lastAction(page)).toHaveText("modal leave");
});

test("theo quyền: nhân viên văn phòng không thấy dự án, đơn hàng, tài chính", async ({ page }) => {
  await page.goto(`${base}?role=staff&q=hoa%20phat`);
  await expect(page.getByText("Không thấy kết quả cho “hoa phat”")).toBeVisible();
  await input(page).fill("lap don hang");
  await expect(page.getByRole("button", { name: /Lập đơn hàng/ })).toHaveCount(0);
  await input(page).fill("cham cong");
  await expect(page.getByRole("button", { name: /^Chấm công/ }).first()).toBeVisible();
});

test("máy chủ lỗi: báo rõ, vẫn tìm được chức năng và thao tác", async ({ page }, info) => {
  await page.goto(`${base}?server=error&q=cham%20cong`);
  await expect(page.getByRole("alert")).toContainText("Chưa tìm được trong hồ sơ");
  await expect(page.getByRole("button", { name: /^Chấm công/ }).first()).toBeVisible();
  await page.screenshot({ path: `${shots}/${info.project.name}-error.png` });
});

test("điện thoại / tablet: bung thao tác liên quan ngay trên dòng", async ({ page }, info) => {
  test.skip((page.viewportSize()?.width || 0) >= 1024, "Máy tính có ngăn xem trước");
  await page.goto(`${base}?q=thep%20hoa%20phat`);
  await page.getByRole("button", { name: "Thao tác liên quan: Kho thép Hòa Phát Hưng Yên" }).click();
  await expect(page.getByRole("button", { name: "Nhật ký công trường" })).toBeVisible();
  await expectCalm(page);
  await page.screenshot({ path: `${shots}/${info.project.name}-related.png` });
  await page.getByRole("button", { name: "Nhật ký công trường" }).click();
  await expect(lastAction(page)).toHaveText("navigate /da?projectId=hpg&tab=dailylog");
});

test("Esc đóng; Tab đổi nhóm", async ({ page }) => {
  test.skip(isPhone(page), "Bàn phím vật lý");
  await page.goto(`${base}?q=thep`);
  await expect(page.getByRole("tab", { name: /Tất cả/ })).toHaveAttribute("aria-selected", "true");
  await input(page).press("Tab");
  await expect(page.getByRole("tab", { name: /Tất cả/ })).toHaveAttribute("aria-selected", "false");
  await input(page).press("Escape");
  await expect(page.locator(".global-search-panel")).toHaveCount(0);
});
