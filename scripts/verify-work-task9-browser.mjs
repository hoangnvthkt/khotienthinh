import { chromium } from "@playwright/test";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  timeout: 20000,
});
const output = process.env.WORK_QA_OUTPUT || "/tmp/vioo-work-task9-qa";
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(15000);
  await page.route("**/*.supabase.co/**", (route) => route.abort());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const open = async (query = "", route = "/work/tasks/VW-2026-000001") => {
    await page.goto(
      `http://127.0.0.1:5187/tests/work/task8-fixture.html?task9=true&${query}#${route}`,
    );
    await page
      .getByRole("heading", { name: "Chuẩn bị hồ sơ nghiệm thu", exact: true })
      .waitFor();
    await page.getByText("Đối chiếu biên bản", { exact: true }).waitFor();
  };
  await open("commentConflict=true");
  await page.getByRole("button", { name: /^Thảo luận/ }).click();
  await page.getByRole("button", { name: "Bình luận cũ hơn" }).click();
  await page
    .locator("#work-comment-older")
    .getByRole("button", { name: "Sửa bình luận", exact: true })
    .click();
  await page
    .getByLabel("Nội dung bình luận")
    .fill("Chỉnh sửa bình luận ở trang cũ");
  await page
    .getByRole("button", { name: "Lưu bình luận", exact: true })
    .click();
  await page.getByRole("button", { name: "Nạp lại bình luận mới" }).click();
  await page
    .getByLabel("Nội dung bình luận")
    .fill("Chỉnh sửa từ phiên bản mới");
  await page
    .getByRole("button", { name: "Lưu bình luận", exact: true })
    .click();
  await page.getByText("Chỉnh sửa từ phiên bản mới", { exact: true }).waitFor();
  const editCalls = await page.evaluate(() =>
    window.workQa.calls
      .filter(
        (c) => c.name === "collaborate" && c.args[0].command === "comment_edit",
      )
      .map((c) => c.args[0]),
  );
  assert.equal(editCalls[0].payload.expectedLockVersion, 1);
  assert.equal(editCalls[1].payload.expectedLockVersion, 2);
  assert.notEqual(editCalls[0].idempotencyKey, editCalls[1].idempotencyKey);
  await open();
  assert.equal(
    await page.evaluate(
      () => window.workQa.calls.filter((c) => c.name === "history").length,
    ),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => window.workQa.calls.filter((c) => c.name === "comments").length,
    ),
    0,
  );
  await page
    .getByRole("checkbox", { name: "Hoàn tất Đối chiếu biên bản" })
    .check();
  await page.waitForFunction(() =>
    window.workQa.calls.some(
      (c) =>
        c.name === "collaborate" &&
        c.args[0].command === "checklist_set_completed",
    ),
  );
  await page.getByRole("button", { name: /^Thảo luận/ }).click();
  const composer = page.getByLabel("Nội dung bình luận");
  const mentionQuery = "Đã đối chiếu xong hồ sơ. @Nguyễn";
  const suggestions = page.getByRole("listbox", { name: "Gợi ý nhắc tên" });
  await composer.fill(mentionQuery);
  await suggestions.getByRole("option").first().waitFor();
  await page.keyboard.press("Escape");
  await suggestions.waitFor({ state: "hidden" });
  assert.equal(await composer.inputValue(), mentionQuery);
  await composer.fill("");
  await composer.fill(mentionQuery);
  await suggestions.getByRole("option").first().waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await composer.inputValue(), "Đã đối chiếu xong hồ sơ. @Nguyễn Thu Hà ");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  assert.equal(await composer.inputValue(), "Đã đối chiếu xong hồ sơ. ");
  await composer.fill(mentionQuery);
  await suggestions.getByRole("option").first().waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const selectedDraft = await composer.inputValue();
  await page.getByRole("heading", { name: "Chuẩn bị hồ sơ nghiệm thu", exact: true }).click();
  assert.equal(await composer.inputValue(), selectedDraft);
  await composer.focus();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(50);
  assert.equal(await composer.inputValue(), selectedDraft);
  assert.equal(await composer.evaluate((element) => document.activeElement === element), true);
  await page
    .getByRole("button", { name: "Gửi bình luận", exact: true })
    .click();
  await page.getByText(/Đã đối chiếu xong hồ sơ\. @Nguyễn Thu Hà/).waitFor();
  const mentions = await page.evaluate(
    () =>
      window.workQa.calls.find(
        (c) =>
          c.name === "collaborate" && c.args[0].command === "comment_create",
      ).args[0].payload.content.content.flatMap((p) => p.content.filter((n) => n.type === "mention").map((n) => n.userId)),
  );
  assert.deepEqual(mentions, ["second"]);
  await page.getByRole("button", { name: "Bình luận cũ hơn" }).click();
  await page.getByText("Nội dung bình luận cũ", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^Lịch sử hoạt động/ }).click();
  await page.getByLabel("Lọc lịch sử").selectOption("sla");
  await page.waitForFunction(() =>
    window.workQa.calls.some(
      (c) => c.name === "history" && c.args[1].category === "sla",
    ),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${output}/desktop-detail.png`,
    fullPage: true,
  });
  await open("state=pending_acknowledgement&conflict=true");
  await page.getByRole("button", { name: "Nhận việc", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.getByRole("button", { name: "Đã kiểm tra bản mới" }).waitFor();
  await dialog.getByRole("button", { name: "Đã kiểm tra bản mới" }).click();
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page.getByRole("button", { name: "Bắt đầu", exact: true }).waitFor();
  let calls = await page.evaluate(() =>
    window.workQa.calls
      .filter((c) => c.name === "command")
      .map((c) => c.args[0]),
  );
  assert.equal(calls[0].expectedLockVersion, 1);
  assert.equal(calls[1].expectedLockVersion, 2);
  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
  await open("lostCommand=true");
  await page.getByRole("button", { name: "Báo bị chặn", exact: true }).click();
  dialog = page.getByRole("dialog");
  assert.equal(
    await dialog.getByRole("button", { name: "Xác nhận" }).isDisabled(),
    true,
  );
  await dialog
    .getByLabel("Lý do", { exact: true })
    .fill("Chờ xác nhận vật tư.");
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  await dialog.getByRole("button", { name: "Thử lại đúng yêu cầu" }).click();
  await page
    .getByRole("button", { name: "Tiếp tục thực hiện", exact: true })
    .waitFor();
  calls = await page.evaluate(() =>
    window.workQa.calls
      .filter((c) => c.name === "command")
      .map((c) => c.args[0]),
  );
  assert.deepEqual(calls[0], calls[1]);
  await open();
  await page.getByRole("button", { name: "Chuyển việc", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Nguyễn Thu Hà", exact: true })
    .click();
  await dialog.getByLabel("Lý do").fill("Điều phối lại nhân sự.");
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  calls = await page.evaluate(() =>
    window.workQa.calls
      .filter((c) => c.name === "command")
      .map((c) => c.args[0]),
  );
  assert.equal(calls[0].payload.userId, "second");
  assert.equal(calls[0].payload.reason, "Điều phối lại nhân sự.");
  await open("role=watcher");
  assert.equal(
    await page.getByRole("button", { name: "Bắt đầu", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Nộp kết quả", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Lịch sử hoạt động/ }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Hoàn tất Đối chiếu biên bản" })
      .isDisabled(),
    true,
  );
  await open("role=reviewer&state=awaiting_review");
  await page
    .getByRole("button", { name: "Yêu cầu chỉnh sửa", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  assert.equal(
    await dialog.getByRole("button", { name: "Xác nhận" }).isDisabled(),
    true,
  );
  await dialog.getByLabel("Lý do").fill("Bổ sung biên bản kiểm tra.");
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  await dialog.waitFor({ state: "hidden" });
  await open("images=true", "/work/tasks/VW-2026-000001?comment=anchored");
  await page
    .getByText("Bình luận đích từ thông báo", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Xem trước anh-nghiem-thu.webp", exact: true }).click();
  await page.getByRole("dialog").getByRole("img").waitFor();
  await page.getByRole("button", { name: "Đóng xem trước", exact: true }).click();
  assert.ok(
    await page.evaluate(() =>
      window.workQa.calls.some(
        (c) => c.name === "attachment.read" && c.args[1] === "display",
      ),
    ),
  );
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Trách nhiệm & SLA" }).click();
  await page.getByRole("dialog", { name: "Trách nhiệm và SLA" }).waitFor();
  await page.screenshot({
    path: `${output}/tablet-metadata.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Đóng thông tin" }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${output}/mobile-detail.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "Nộp kết quả", exact: true }).click();
  await page.screenshot({
    path: `${output}/mobile-action.png`,
    fullPage: false,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await page.goto(
    "http://127.0.0.1:5187/tests/work/task8-fixture.html?task9=true#/work/my?view=created_by_me&priority=urgent",
  );
  await page
    .getByRole("heading", { name: "Công việc tôi đã giao", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Công việc tôi đã giao", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Chuẩn bị hồ sơ nghiệm thu", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Công việc của tôi", exact: true })
    .click();
  assert.ok(page.url().includes("view=created_by_me"));
  assert.ok(page.url().includes("priority=urgent"));
  await page.goto(
    "http://127.0.0.1:5187/tests/work/task8-fixture.html?task9=true&layout=true&longList=true#/work/my?priority=urgent",
  );
  await page
    .getByRole("heading", { name: "Công việc số 1", exact: true })
    .waitFor();
  // Let the initial list restoration finish before simulating the user's scroll.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page
    .locator("[data-work-scroll-host]")
    .evaluate((el) => (el.scrollTop = 500));
  const previousScroll = await page
    .locator("[data-work-scroll-host]")
    .evaluate((el) => el.scrollTop);
  await page
    .getByRole("heading", { name: "Công việc số 4", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Chuẩn bị hồ sơ nghiệm thu", exact: true })
    .waitFor();
  await page
    .locator("[data-work-scroll-host]")
    .evaluate((el) => (el.scrollTop = 0));
  const bar = await page.locator(".work-action-bar").boundingBox();
  assert.ok(bar.y + bar.height <= 800 - 64 + 1);
  await page.screenshot({
    path: `${output}/mobile-app-layout.png`,
    fullPage: false,
  });
  await page
    .getByRole("link", { name: "Công việc của tôi", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Công việc số 1", exact: true })
    .waitFor();
  await page.waitForFunction(
    (top) =>
      document.querySelector("[data-work-scroll-host]").scrollTop === top,
    previousScroll,
  );
  assert.equal(
    await page
      .locator("[data-work-scroll-host]")
      .evaluate((el) => el.scrollTop),
    previousScroll,
  );
  await open("fileFailure=true");
  await page.getByLabel("Thêm đính kèm công việc").setInputFiles({
    name: "evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("fixture"),
  });
  await page.getByRole("button", { name: "Nộp kết quả", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("Bản nháp kết quả ban đầu.", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  await dialog.getByText(/Còn tệp chưa tải xong/).waitFor();
  assert.equal(
    await page.evaluate(
      () => window.workQa.calls.filter((c) => c.name === "command").length,
    ),
    0,
  );
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .getByRole("button", { name: "Tải các tệp đã chọn", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tải các tệp đã chọn", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Tải các tệp đã chọn", exact: true })
    .click();
  await page.getByText("Đã tải", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.workQa.calls.filter((c) => c.name === "attachment.begin").length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.workQa.calls.filter((c) => c.name === "attachment.upload")
          .length,
    ),
    1,
  );
  await open("lostCommand=true");
  await page.getByRole("button", { name: "Báo bị chặn", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Lý do")
    .fill("Kiểm tra giữ yêu cầu khi đổi màn hình");
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  await dialog.getByRole("button", { name: "Thử lại đúng yêu cầu" }).waitFor();
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .getByRole("link", { name: "Công việc của tôi", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Chuẩn bị hồ sơ nghiệm thu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Thử lại đúng yêu cầu", exact: true })
    .click();
  await page.waitForFunction(
    () => window.workQa.calls.filter((c) => c.name === "command").length === 2,
  );
  calls = await page.evaluate(() =>
    window.workQa.calls
      .filter((c) => c.name === "command")
      .map((c) => c.args[0]),
  );
  assert.deepEqual(calls[0], calls[1]);
  const imageResult = await page.evaluate(async () => {
    const { prepareWorkImage } = await import("/lib/work/workImageInput.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 4032;
    canvas.height = 3024;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f766e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    const file = new File([blob], "camera.jpg", { type: "image/jpeg" });
    const prepared = await prepareWorkImage(file, false);
    const bitmap = await createImageBitmap(prepared);
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      mime: prepared.type,
      retained: (await prepareWorkImage(file, true)) === file,
    };
    bitmap.close();
    return result;
  });
  assert.deepEqual(imageResult, {
    width: 1920,
    height: 1440,
    mime: "image/webp",
    retained: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Task 9 browser checks passed: capability roles, lazy feeds, mention/checklist, conflict, immutable retry, transfer reason, review, deep comment, private image, 1440/768/360 and list return. Screenshots:",
    output,
  );
} finally {
  await browser.close();
}
