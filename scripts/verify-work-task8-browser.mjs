// Run against Vite localhost. All service data is synthetic; Cloud traffic is blocked.
import { chromium } from "@playwright/test";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
const base =
  process.env.WORK_QA_URL ||
  "http://127.0.0.1:5187/tests/work/task8-fixture.html";
console.log("Launching isolated browser");
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  timeout: 20000,
});
console.log("Browser ready");
const output = process.env.WORK_QA_OUTPUT || "/tmp/vioo-work-task8-qa";
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*.supabase.co/**", (route) => route.abort());
  const open = async (query = "", route = "/work/my") => {
    await page.goto(`${base}${query}#${route}`);
    await page
      .getByRole("heading", {
        name: route === "/work/my" ? "Công việc của tôi" : "Công việc",
        exact: true,
      })
      .waitFor();
    console.log("Opened", query, route);
  };
  await open();
  await page
    .getByRole("heading", { name: "Chuẩn bị hồ sơ nghiệm thu" })
    .waitFor();
  await page.getByRole("button", { name: "Xem thêm công việc" }).click();
  await page
    .getByRole("heading", { name: "Tổng hợp kết quả kiểm tra" })
    .waitFor();
  await page.screenshot({ path: `${output}/desktop-list.png`, fullPage: true });
  await page.getByRole("button", { name: "Tôi đã giao", exact: true }).click();
  await page.getByRole("heading", { name: "Công việc tôi đã giao" }).waitFor();
  await page.getByRole("textbox", { name: "Tìm công việc" }).fill("chậm");
  await page.waitForTimeout(360);
  await page.getByRole("textbox", { name: "Tìm công việc" }).fill("nhanh");
  await page.getByRole("heading", { name: "Kết quả nhanh" }).waitFor();
  await page.waitForTimeout(850);
  assert.equal(
    await page.getByRole("heading", { name: "Kết quả chậm" }).count(),
    0,
  );
  await open("?ambiguous=true&fileFailure=true");
  await page
    .getByRole("button", { name: "Tạo công việc", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog
    .getByLabel("Tên công việc *", { exact: true })
    .fill("Kiểm tra quy trình nghiệm thu");
  assert.equal(
    await dialog
      .getByRole("button", { name: "Tạo công việc", exact: true })
      .isDisabled(),
    true,
  );
  await dialog
    .getByRole("button", { name: "Chọn người nhận", exact: false })
    .click();
  await dialog
    .getByRole("button", { name: "Lê Minh An", exact: false })
    .click();
  await dialog.getByText("1 người nhận hợp lệ", { exact: true }).waitFor();
  await dialog.getByLabel("Chọn tệp đính kèm").setInputFiles({
    name: "fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic QA"),
  });
  await dialog.getByRole("button", { name: "Mở trình soạn đầy đủ" }).click();
  await dialog.getByRole("button", { name: "Thêm mục", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Mục checklist 1", exact: true })
    .fill("Kiểm tra chứng từ");
  await dialog.getByText("fixture.txt", { exact: true }).waitFor();
  await dialog.locator(".work-drawer-body").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: `${output}/desktop-create.png`,
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Tạo công việc", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Thử lại yêu cầu", exact: true })
    .waitFor();
  assert.equal(
    await dialog.getByLabel("Tên công việc *", { exact: true }).isDisabled(),
    true,
  );
  await dialog
    .getByRole("button", { name: "Thử lại yêu cầu", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Thử tải lại tệp", exact: true })
    .waitFor();
  await dialog
    .getByRole("button", { name: "Thử tải lại tệp", exact: true })
    .click();
  await dialog.getByText("Đã tải", { exact: true }).waitFor();
  const calls = await page.evaluate(() => window.workQa.calls);
  const creates = calls.filter((x) => x.name === "create");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].args, creates[1].args);
  assert.equal(calls.filter((x) => x.name === "attachment.begin").length, 1);
  assert.equal(calls.filter((x) => x.name === "attachment.upload").length, 1);
  await open("", "/work/tasks/VW-2026-000001");
  await page.getByRole("button", { name: "Nhân bản", exact: true }).click();
  await dialog.getByRole("heading", { name: "Nhân bản công việc" }).waitFor();
  await dialog
    .locator(".work-chip")
    .filter({ hasText: "Nguyễn Thu Hà" })
    .waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Tạo công việc", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => window.workQa.calls.filter((x) => x.name === "create").length,
    ),
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile-clone.png`, fullPage: true });
  assert.ok(
    await dialog.evaluate(
      (el) => el.getBoundingClientRect().width <= window.innerWidth,
    ),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await open("?calendar=off");
  await page
    .getByRole("button", { name: "Tạo công việc", exact: true })
    .click();
  await dialog.getByText(/Chưa có lịch làm việc phù hợp/).waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Tạo công việc", exact: true })
      .isDisabled(),
    true,
  );
  await open("?deny=true", "/work/tasks/VW-2026-000001");
  await page
    .getByText("Công việc không tồn tại hoặc bạn không còn quyền xem.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Nhân bản", exact: true }).count(),
    0,
  );
  await open();
  await page
    .getByRole("heading", { name: "Chuẩn bị hồ sơ nghiệm thu" })
    .waitFor();
  await page.screenshot({ path: `${output}/mobile-list.png`, fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    `Work Task 8 browser checks passed: pagination, tabs, stale search, preview gate, ambiguous create, attachment retry, clone read-only/deadline gate, calendar gate, denied subject, desktop/mobile. Screenshots: ${output}`,
  );
} finally {
  await browser.close();
}
