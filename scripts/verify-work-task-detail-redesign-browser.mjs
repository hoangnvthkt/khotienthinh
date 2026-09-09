import { chromium } from "@playwright/test";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";

const base = process.env.WORK_QA_URL || "http://127.0.0.1:5187/tests/work/task8-fixture.html";
const output = process.env.WORK_QA_OUTPUT || "/tmp/vioo-work-detail-v2-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 20000 });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  await page.route("**/*.supabase.co/**", (route) => route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}?task9=true&autoComplete=true#/work/tasks/VW-2026-000001`);
  await page.getByRole("heading", { name: "Chuẩn bị hồ sơ nghiệm thu", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Công việc con", exact: true }).waitFor();

  await page.getByRole("button", { name: "Thêm công việc con", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Tạo công việc con", exact: true }).waitFor();
  assert.equal(await dialog.locator("label", { hasText: "Phạm vi" }).locator("output").getAttribute("class"), "work-input work-scope-locked");
  assert.equal(await dialog.locator("label", { hasText: "Quyền xem" }).locator("select").isDisabled(), true);
  await dialog.getByLabel("Tên công việc *", { exact: true }).fill("Bổ sung ảnh hiện trường");
  await dialog.getByText("1 người nhận hợp lệ", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Tạo công việc", exact: true }).click();
  await page.getByText("Bổ sung ảnh hiện trường", { exact: true }).waitFor();
  await page.getByText("0/1 hoàn thành", { exact: true }).waitFor();
  const createInput = await page.evaluate(() => window.workQa.calls.find((call) => call.name === "create").args[0]);
  assert.equal(createInput.parentTaskId, "1");
  assert.equal(createInput.privacy, "standard");

  await page.getByRole("button", { name: "Thêm / bỏ người theo dõi" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("Lê Minh An", { exact: true }).click();
  await dialog.getByRole("button", { name: "Lưu người theo dõi", exact: true }).click();
  await page.waitForFunction(() => window.workQa.calls.some((call) => call.name === "collaborate" && call.args[0].command === "watchers_update"));

  await page.locator(".work-task-header").getByRole("button", { name: "Chỉnh sửa", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ngày bắt đầu").fill("2026-09-12T08:00");
  await dialog.getByLabel("Ngày kết thúc").fill("2026-09-11T17:00");
  await dialog.getByRole("button", { name: "Lưu thời hạn" }).click();
  await dialog.getByText("Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.").waitFor();
  await dialog.getByLabel("Ngày kết thúc").fill("2026-09-12T17:00");
  await dialog.getByRole("button", { name: "Lưu thời hạn" }).click();
  await page.waitForFunction(() => window.workQa.calls.some((call) => call.name === "collaborate" && call.args[0].command === "schedule_update"));

  assert.equal(await page.getByLabel("Tiến độ 65%").count(), 1);
  const descriptionSection = page.locator(".work-task-section", { has: page.getByRole("heading", { name: "Mô tả công việc", exact: true }) });
  await descriptionSection.getByRole("button", { name: "Chỉnh sửa", exact: true }).click();
  const descriptionEditor = descriptionSection.getByRole("textbox", { name: "Mô tả công việc" });
  await descriptionEditor.fill("Mô tả đã cập nhật từ trình soạn thảo.");
  await descriptionSection.getByRole("button", { name: "Lưu mô tả", exact: true }).click();
  await page.waitForFunction(() => window.workQa.calls.some((call) => call.name === "collaborate" && call.args[0].command === "description_update"));
  await descriptionSection.getByText("Mô tả đã cập nhật từ trình soạn thảo.", { exact: true }).waitFor();

  const resultSection = page.locator(".work-task-section", { has: page.getByRole("heading", { name: "Kết quả công việc", exact: true }) });
  const resultEditor = resultSection.getByRole("textbox", { name: "Kết quả công việc" });
  await resultEditor.fill("Đã hoàn tất phần việc cha.");
  await resultEditor.press("ControlOrMeta+A");
  await resultSection.getByRole("button", { name: "Đậm", exact: true }).click();
  await resultSection.getByRole("button", { name: "Lưu kết quả", exact: true }).click();
  await page.waitForFunction(() => window.workQa.calls.some((call) => call.name === "collaborate" && call.args[0].command === "result_draft_update"));
  const resultDraftInput = await page.evaluate(() => window.workQa.calls.find((call) => call.name === "collaborate" && call.args[0].command === "result_draft_update").args[0]);
  assert.equal(resultDraftInput.payload.content.content[0].content[0].marks[0].type, "bold");

  const progress = page.getByRole("slider", { name: "Phần trăm hoàn thành" });
  await progress.fill("80");
  await page.getByRole("button", { name: "Lưu tiến độ", exact: true }).click();
  await page.waitForFunction(() => window.workQa.calls.some((call) => call.name === "collaborate" && call.args[0].command === "progress_update"));
  assert.equal(await page.locator(".work-progress-card output").textContent(), "80%");
  await page.screenshot({ path: `${output}/desktop-editors.png`, fullPage: false });

  assert.equal(await page.locator(".work-action-bar").count(), 1);
  const approvedLayout = await page.evaluate(() => {
    const rail = document.querySelector(".work-task-rail").getBoundingClientRect();
    const side = document.querySelector(".work-responsibility").getBoundingClientRect();
    const action = document.querySelector(".work-action-bar");
    const card = document.querySelector(".work-task-header");
    return {
      moduleDetail: document.querySelector(".work-module")?.classList.contains("work-module-detail"),
      railWidth: rail.width,
      sideWidth: side.width,
      actionInsidePane: action?.parentElement?.classList.contains("work-detail-pane"),
      cardRadius: getComputedStyle(card).borderRadius,
      sideCards: document.querySelectorAll(".work-side-card").length,
    };
  });
  assert.equal(approvedLayout.moduleDetail, true);
  assert.ok(Math.abs(approvedLayout.railWidth - 280) < 1, `task rail is ${approvedLayout.railWidth}px`);
  assert.ok(Math.abs(approvedLayout.sideWidth - 220) < 1, `responsibility rail is ${approvedLayout.sideWidth}px`);
  assert.equal(approvedLayout.actionInsidePane, true);
  assert.equal(approvedLayout.cardRadius, "4px");
  assert.ok(approvedLayout.sideCards >= 5);

  const content = page.locator(".work-detail-content");
  for (const y of [0, 900, 100000]) {
    await content.evaluate((element, top) => element.scrollTo(0, top), y);
    await page.waitForTimeout(50);
    const rect = await page.locator(".work-action-bar").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    });
    assert.ok(rect.height > 0 && rect.bottom > 0 && rect.top < 900, `action bar outside viewport at content scroll ${y}`);
  }

  await page.setViewportSize({ width: 320, height: 700 });
  await resultSection.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `${output}/mobile-editor-320.png`, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 900));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const compactBar = await page.locator(".work-action-bar").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  });
  assert.ok(compactBar.top < 700 && compactBar.bottom > 0);
  const discussionToggle = page.getByRole("button", { name: /^Thảo luận/ });
  if ((await discussionToggle.getAttribute("aria-expanded")) !== "true") await discussionToggle.click();
  const composer = page.getByLabel("Nội dung bình luận");
  await composer.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const visibility = await page.evaluate(() => {
    const composerBox = document.querySelector("textarea[aria-label='Nội dung bình luận']")?.getBoundingClientRect();
    const barBox = document.querySelector(".work-action-bar")?.getBoundingClientRect();
    return { composerBottom: composerBox?.bottom || 0, barTop: barBox?.top || 0 };
  });
  assert.ok(visibility.composerBottom <= visibility.barTop, "comment composer is obscured by action bar");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Nộp kết quả", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("Đã hoàn tất phần việc cha.", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("Nội dung kết quả").count(), 0);
  let warning = "";
  page.once("dialog", async (nativeDialog) => { warning = nativeDialog.message(); await nativeDialog.dismiss(); });
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page.waitForTimeout(100);
  assert.match(warning, /Còn 1 công việc con/);
  assert.equal(await page.evaluate(() => window.workQa.calls.filter((call) => call.name === "command").length), 0);
  page.once("dialog", async (nativeDialog) => nativeDialog.accept());
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page.waitForFunction(() => window.workQa.calls.some((call) => call.name === "command" && call.args[0].command === "submit"));
  const submitInput = await page.evaluate(() => window.workQa.calls.find((call) => call.name === "command" && call.args[0].command === "submit").args[0]);
  assert.equal(submitInput.payload.result.content[0].content[0].text, "Đã hoàn tất phần việc cha.");

  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const mobile = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= window.innerWidth,
      overlapping: [...document.querySelectorAll(".work-task-section-header, .work-editor-actions")].some((element) => element.scrollWidth > element.clientWidth + 1),
    }));
    assert.equal(mobile.fits, true, `page overflows at ${width}px`);
    assert.equal(mobile.overlapping, false, `section controls overlap at ${width}px`);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Trách nhiệm & SLA" }).click();
  const peopleSheet = page.getByRole("dialog", { name: "Trách nhiệm và SLA" });
  await peopleSheet.getByText("Người giao việc", { exact: true }).waitFor();
  await peopleSheet.getByRole("button", { name: "Đóng thông tin" }).click();
  await page.screenshot({ path: `${output}/mobile-detail.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${output}/desktop-detail.png`, fullPage: true });

  await page.goto(`${base}?images=true#/work/tasks/VW-2026-000001`);
  await page.getByText("bien-ban-nghiem-thu.pdf", { exact: true }).waitFor();
  const pdfPreview = page.getByRole("button", { name: "Xem trước bien-ban-nghiem-thu.pdf", exact: true });
  await pdfPreview.click();
  await page.getByRole("dialog").getByTitle("Xem trước bien-ban-nghiem-thu.pdf").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Xem trước bien-ban-nghiem-thu.pdf");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Xem trước bien-ban-nghiem-thu.pdf");

  const textPreview = page.getByRole("button", { name: "Xem trước ghi-chu-hien-truong.txt", exact: true });
  await textPreview.click();
  await page.getByRole("dialog").getByText("Ghi chú an toàn tại hiện trường.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Đóng xem trước" }).click();
  await page.evaluate(() => { window.workQa.denyReads = true; });
  await textPreview.click();
  await page.getByRole("dialog").getByText("Thao tác không còn phù hợp", { exact: false }).waitFor();
  assert.equal(await page.getByRole("dialog").locator("pre").count(), 0);
  await page.evaluate(() => { window.workQa.denyReads = false; });
  await page.getByRole("dialog").getByRole("button", { name: "Thử tải lại" }).click();
  await page.getByRole("dialog").getByText("Ghi chú an toàn tại hiện trường.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Đóng xem trước" }).click();
  const unsupported = page.locator(".work-attachment-grid > li", { hasText: "du-lieu-cu.xls" });
  assert.equal(await unsupported.getByRole("button", { name: /Xem trước/ }).count(), 0);
  await unsupported.getByRole("button", { name: "Tải bản gốc" }).waitFor();

  await pdfPreview.click();
  await page.getByRole("dialog").waitFor();
  await page.evaluate(() => { window.location.hash = "/work/my"; });
  await page.getByRole("heading", { name: "Công việc của tôi", exact: true }).waitFor();
  assert.equal(await page.locator(".work-attachment-preview").count(), 0);

  await page.goto(`${base}?images=true&previewExpired=true#/work/tasks/VW-2026-000001`);
  await page.getByRole("button", { name: "Xem trước anh-nghiem-thu.webp", exact: true }).click();
  await page.getByRole("dialog").getByRole("img").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Thử tải lại" }).waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  console.log(`WORK_TASK_DETAIL_REDESIGN_BROWSER_PASSED ${output}`);
} finally {
  await browser.close();
}
