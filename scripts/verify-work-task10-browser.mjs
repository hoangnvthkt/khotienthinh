import { chromium } from "@playwright/test";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
await mkdir("/tmp/vioo-work-task10-qa", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*.supabase.co/**", (r) => r.abort());
  const open = async (q = "") => {
    await page.goto(
      `http://127.0.0.1:5187/tests/work/task10-fixture.html?${q}`,
    );
    await page
      .getByRole("button", { name: "Phòng Quản lý dự án", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Lịch làm việc", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Sửa Lịch văn phòng", exact: true })
      .waitFor();
  };
  await open("lost=1");
  await page.getByRole("button", { name: "Sửa Lịch văn phòng" }).click();
  await page.getByLabel("Tên", { exact: true }).fill("Lịch đã cập nhật");
  await page.getByLabel("Lý do thay đổi").fill("Điều chỉnh lịch pilot");
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await page.getByRole("button", { name: "Thử lại yêu cầu đã lưu" }).waitFor();
  assert.equal(
    await page.getByLabel("Tên", { exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.getByRole("button", { name: "Thử lại yêu cầu đã lưu" }).click();
  await page
    .getByRole("button", { name: "Sửa Lịch đã cập nhật", exact: true })
    .waitFor();
  const saves = await page.evaluate(() =>
    window.workConfigQa.calls.filter((c) => c.name === "save"),
  );
  assert.deepEqual(saves[0].args, saves[1].args);
  await open("lost=1");
  await page
    .getByRole("button", { name: "Sửa Lịch văn phòng", exact: true })
    .click();
  await page.getByLabel("Lý do thay đổi").fill("Giữ yêu cầu khi tải lại trang");
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await page.getByRole("button", { name: "Thử lại yêu cầu đã lưu" }).waitFor();
  const beforeReload = await page.evaluate(
    () => window.workConfigQa.calls.find((c) => c.name === "save").args[0],
  );
  await page.evaluate(() =>
    history.replaceState(null, "", location.pathname + "?recovered=1"),
  );
  await page.reload();
  await page.getByRole("button", { name: "Thử lại yêu cầu đã lưu" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const afterReload = await page.evaluate(
    () => window.workConfigQa.calls.find((c) => c.name === "save").args[0],
  );
  assert.deepEqual(afterReload, beforeReload);
  await open("conflict=1");
  await page.getByRole("button", { name: "Sửa Lịch văn phòng" }).click();
  await page.getByLabel("Lý do thay đổi").fill("Điều chỉnh sau xung đột");
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await page
    .getByRole("button", { name: "Nạp phiên bản mới để sửa lại" })
    .click();
  assert.equal(
    await page.getByLabel("Tên", { exact: true }).inputValue(),
    "Lịch mới từ đồng nghiệp",
  );
  await page.getByLabel("Lý do thay đổi").fill("Cập nhật từ phiên bản mới");
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await page
    .getByRole("button", { name: "Sửa Lịch mới từ đồng nghiệp", exact: true })
    .waitFor();
  const writes = await page.evaluate(() =>
    window.workConfigQa.calls
      .filter((c) => c.name === "save")
      .map((c) => c.args[0]),
  );
  assert.equal(writes[1].version, 2);
  assert.notEqual(writes[0].key, writes[1].key);
  assert.equal(
    await page.evaluate(() =>
      window.workConfigQa.calls.some(
        (c) => c.name === "list" && c.args[4] === "calendar-1",
      ),
    ),
    true,
  );
  await open();
  await page
    .getByRole("button", { name: "Ngày ngoại lệ", exact: true })
    .click();
  await page.getByRole("button", { name: "Thêm ngày ngoại lệ" }).click();
  await page.getByLabel("Ngày ngoại lệ", { exact: true }).fill("2026-09-08");
  await page.getByLabel("Lý do thay đổi").fill("Ngày nghỉ bù");
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const holiday = await page.evaluate(
    () => window.workConfigQa.calls.find((c) => c.name === "save").args[0],
  );
  assert.deepEqual(holiday.data.working_intervals, []);
  assert.equal(holiday.data.is_working_day, false);
  await page
    .getByRole("button", { name: "Chính sách SLA", exact: true })
    .click();
  await page.getByRole("button", { name: "Thêm chính sách SLA" }).click();
  await page.getByLabel("Tên", { exact: true }).fill("Khẩn cấp");
  await page.getByLabel("Lịch áp dụng").selectOption("calendar-1");
  await page
    .getByRole("dialog")
    .locator('select[name="priority"]')
    .selectOption("urgent");
  await page.getByLabel("Lý do thay đổi").fill("Thử chính sách");
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Tính thử SLA" }).click();
  await page.getByText(/Hạn xác nhận:/).waitFor();
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await open();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/vioo-work-task10-qa/settings-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Sửa Lịch văn phòng" }).click();
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector("dialog").scrollWidth <=
          document.querySelector("dialog").clientWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/vioo-work-task10-qa/calendar-${width}.png`,
    });
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log("WORK_TASK10_BROWSER_PASSED");
} finally {
  await browser.close();
}
