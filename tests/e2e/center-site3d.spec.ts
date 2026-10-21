import { test, expect, type Page } from "@playwright/test";

// Công trường 3D trong Trung tâm điều hành (fixture, không gọi Supabase). Kiểm theo việc người dùng làm:
// có quyền mới thấy tab → xem tiến độ → Ẩn thông tin → Xem hoàn thiện → Trình chiếu (Esc thoát); Admin tải mô hình lên;
// đứng yên thì cảnh không vẽ thêm khung nào (vẽ theo yêu cầu, docs/ui/VIOO-UI-UX.md mục 6).
const base = "/tests/center/fixture.html";
type Debug = { frames: () => number; finished: () => boolean; presenting: () => boolean; infoHidden: () => boolean; motion: () => boolean; hq: () => boolean; softwareGl: () => boolean; real: () => { loaded: boolean; meshes: number; tekla: number } };
const ready = (page: Page) => page.waitForFunction(() => !!(window as unknown as { __site3d?: unknown }).__site3d, null, { timeout: 60_000 });
const call = <T,>(page: Page, name: keyof Debug) => page.evaluate(n => (window as unknown as { __site3d: Record<string, () => unknown> }).__site3d[n](), name) as Promise<T>;
const tool = (page: Page, id: string) => page.locator(`[data-s3d="${id}"]`);

test("không có quyền thì không có tab Công trường 3D", async ({ page }) => {
  await page.goto(`${base}?site3d=none`);
  await expect(page.getByRole("tab", { name: "Hôm nay" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Công trường 3D" })).toHaveCount(0);
});

test("người xem: tiến độ, ẩn thông tin, xem hoàn thiện, trình chiếu", async ({ page }, info) => {
  test.skip(info.project.name.includes("phone"), "điện thoại có ca riêng");
  await page.goto(`${base}?site3d=viewer`);
  await page.getByRole("tab", { name: "Công trường 3D" }).click();
  await ready(page);
  const left = tool(page, "left"), right = tool(page, "info");
  await expect(tool(page, "title")).toHaveText("Công trường XinHai (Thú nhồi bông GĐ2)");
  await expect(left).toBeVisible();
  await expect(right).toContainText("Công nhân");
  await expect(tool(page, "btnModels")).toBeHidden(); // chỉ Admin
  // Ẩn thông tin: chỉ còn mô hình + góc nhìn + thời gian.
  await tool(page, "btnInfo").click();
  await expect(left).toBeHidden(); await expect(right).toBeHidden();
  await expect(tool(page, "btnInfo")).toHaveText("Hiện thông tin");
  await tool(page, "btnInfo").click();
  await expect(left).toBeVisible();
  // Xem hoàn thiện: bảng nói rõ đang xem hình dung, số thật vẫn giữ.
  await tool(page, "btnFinish").click();
  await expect(tool(page, "btnFinish")).toHaveAttribute("aria-pressed", "true");
  await expect(right).toContainText("Khi hoàn thiện");
  await expect(right).toContainText("Đã làm tới 17/10");
  await expect(tool(page, "dateText")).toContainText("Khi hoàn thiện");
  expect(await call<boolean>(page, "finished")).toBe(true);
  await right.getByRole("button", { name: "← Về tiến độ thực tế" }).click();
  await expect(tool(page, "dateText")).toContainText("17/10/2026");
  // Trình chiếu: ẩn bảng, hiện bảng tóm tắt + thanh điều khiển; Esc thoát và trả lại như cũ.
  await tool(page, "btnPresent").click();
  await expect(tool(page, "hud")).toBeVisible();
  await expect(tool(page, "hud")).toContainText("78%");
  await expect(tool(page, "presentBar")).toBeVisible();
  await expect(left).toBeHidden();
  expect(await call<boolean>(page, "presenting")).toBe(true);
  expect(await call<boolean>(page, "motion")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(tool(page, "hud")).toBeHidden();
  await expect(left).toBeVisible();
  expect(await call<boolean>(page, "motion")).toBe(false);
  // Thanh thời gian (tự dựng, dùng được bằng phím): Home về ngày đầu, End về hôm nay.
  const slider = page.getByRole("slider", { name: "Ngày đang xem" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(tool(page, "dateText")).not.toContainText("hôm nay");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("End");
  await expect(tool(page, "dateText")).toContainText("17/10/2026 · hôm nay");
  // Đổi công trường giữ được trong tab.
  await page.locator('[data-site="SMB-2026"]').click();
  await expect(tool(page, "title")).toHaveText("Công trường Sơn Miền Bắc");
});

test("Chất lượng cao: bật / tắt, đứng yên vẫn không vẽ, trình chiếu tự bật rồi trả lại", async ({ page }, info) => {
  test.skip(info.project.name.includes("phone"), "chỉ máy tính");
  await page.goto(`${base}?site3d=viewer&view=site3d`);
  await ready(page);
  const btn = tool(page, "btnHq");
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  expect(await call<boolean>(page, "hq")).toBe(true);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  const before = await call<number>(page, "frames");
  await page.waitForTimeout(1500);
  expect(await call<number>(page, "frames"), "chất lượng cao đứng yên cũng không vẽ lại").toBe(before);
  await btn.click();
  expect(await call<boolean>(page, "hq")).toBe(false);
  // Trình chiếu trên máy tính tự bật chất lượng cao (trừ khi vẽ bằng phần mềm như Chrome headless); thoát thì trả về như trước.
  await tool(page, "btnPresent").click();
  await expect(tool(page, "hud")).toBeVisible();
  expect(await call<boolean>(page, "hq")).toBe(!(await call<boolean>(page, "softwareGl")));
  await page.keyboard.press("Escape");
  await expect(tool(page, "hud")).toBeHidden();
  expect(await call<boolean>(page, "hq")).toBe(false);
});

test("đứng yên thì không vẽ thêm khung nào", async ({ page }, info) => {
  test.skip(info.project.name.includes("phone"), "đo trên máy tính");
  await page.goto(`${base}?site3d=viewer&view=site3d`);
  await ready(page);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1200);
  const before = await call<number>(page, "frames");
  await page.waitForTimeout(2000);
  expect(await call<number>(page, "frames"), "không chuyển động: không vẽ lại khi không có gì đổi").toBe(before);
  // Bật chuyển động thì vẽ liên tục; tắt lại thì dừng.
  await tool(page, "btnMotion").click();
  await page.waitForTimeout(800);
  expect(await call<number>(page, "frames")).toBeGreaterThan(before + 5);
  await tool(page, "btnMotion").click();
  await page.waitForTimeout(600);
  const stopped = await call<number>(page, "frames");
  await page.waitForTimeout(1500);
  expect(await call<number>(page, "frames")).toBe(stopped);
  // Rời tab thì không vẽ.
  await page.getByRole("tab", { name: "Hôm nay" }).click();
  await page.waitForTimeout(300);
  const away = await call<number>(page, "frames");
  await page.waitForTimeout(1200);
  expect(await call<number>(page, "frames")).toBe(away);
});

test("Admin tải mô hình lên kho của dự án", async ({ page }, info) => {
  test.skip(info.project.name.includes("phone"), "Admin dùng máy tính");
  await page.goto(`${base}?site3d=admin&view=site3d`);
  await ready(page);
  await tool(page, "btnModels").click();
  const dialog = page.getByRole("dialog", { name: "Mô hình công trường" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Mô hình thiết kế (SketchUp)");
  await expect(dialog.getByText("Chưa có").first()).toBeVisible();
  await dialog.locator('input[type="file"]').first().setInputFiles({ name: "xinhai.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("glTF-test") });
  await expect(dialog).toContainText("Đã tải lên mô hình thiết kế (sketchup)");
  const uploads = await page.evaluate(() => (window as unknown as { __site3dUploads: Record<string, { name: string }> }).__site3dUploads);
  expect(uploads["00000000-0000-4000-8000-0000000000d2/architecture"].name).toBe("xinhai.glb");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("lỗi tải số liệu có nút Thử lại", async ({ page }, info) => {
  test.skip(info.project.name.includes("phone"), "trạng thái giống máy tính");
  await page.goto(`${base}?site3d=error&view=site3d`);
  await expect(page.getByText("Chưa tải được số liệu công trường")).toBeVisible();
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
});

test("điện thoại: báo trước rồi mở bản nhẹ, mô hình thiết kế chỉ tải khi bấm", async ({ page }, info) => {
  test.skip(!info.project.name.includes("phone"), "chỉ điện thoại");
  await page.goto(`${base}?site3d=viewer&view=site3d&site3dModel=1`);
  await expect(page.getByText("Công trường 3D xem tốt nhất trên máy tính")).toBeVisible();
  await page.getByRole("button", { name: "Vẫn mở trên điện thoại" }).click();
  await ready(page);
  await expect(tool(page, "left")).toBeHidden(); // khung hẹp: mặc định chỉ mô hình
  await expect(tool(page, "realStatus").getByRole("button", { name: /Tải mô hình thiết kế/ })).toBeVisible();
  expect((await call<{ loaded: boolean }>(page, "real")).loaded).toBe(false);
  await tool(page, "btnFinish").click();
  await expect(tool(page, "btnFinish")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
