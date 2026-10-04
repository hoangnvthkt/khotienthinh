import { test, expect } from "@playwright/test";
const base = "/tests/office/fixture.html";
test.beforeEach(async ({ page }) => {
  await page.route("**/*.supabase.co/**", (route) => route.abort());
});
for (const [label, width, height] of [
  ["desktop", 1440, 1050],
  ["tablet", 820, 1180],
  ["mobile", 390, 844],
] as const) {
  test(`${label}: overview, list, document and wizard remain usable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}#/office`);
    await expect(
      page.getByRole("heading", {
        name: "Văn bản rõ ràng. Công việc thông suốt.",
      }),
    ).toBeVisible();
    await expect(page.locator(".office-kpis")).toContainText("Chờ tôi duyệt");
    await page.getByRole("link", { name: "Mẫu văn bản", exact: true }).click();
    await expect(page).toHaveURL(/#\/office\/templates$/);
    await expect(page.getByRole("heading", { name: "Mẫu văn bản", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Mẫu văn bản", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Báo cáo", exact: true }).click();
    await expect(page).toHaveURL(/#\/office\/reports$/);
    await expect(page.getByRole("heading", { name: "Báo cáo văn bản", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Báo cáo văn bản", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Tổng quan", exact: true }).click();
    await expect(page.locator(".office-document-row")).toHaveCount(5);
    await page.screenshot({
      path: `.office-test-results/${label}-overview.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "Xem tất cả", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Tất cả văn bản", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Bộ lọc", exact: true }).click();
    await page.getByLabel("Lọc trạng thái").selectOption("ISSUED");
    await expect(page.locator(".office-document-row")).toHaveCount(3);
    await page.screenshot({
      path: `.office-test-results/${label}-list.png`,
      fullPage: true,
    });
    await page
      .getByRole("link")
      .filter({ hasText: "Thông báo kế hoạch kiểm kê quý IV năm 2026" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Thông báo kế hoạch kiểm kê quý IV năm 2026",
      }),
    ).toBeVisible();
    await expect(page.locator(".work-rich-view")).toContainText("Kính gửi");
    await page.screenshot({
      path: `.office-test-results/${label}-detail.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("tab", { name: /Người nhận/ }).click();
    await page.getByRole("button", { name: "Xem người chưa đọc" }).click();
    await expect(page.locator(".office-recipient-list")).toContainText(
      "Chưa đọc",
    );
    await page.getByRole("link", { name: "Tạo văn bản", exact: true }).click();
    await page.getByRole("button", { name: /Thông báo Phổ biến/ }).click();
    await page.getByRole("button", { name: /Thông báo TB/ }).click();
    await page.getByLabel("Tiêu đề văn bản").fill("Thông báo mới từ UI test");
    await page
      .getByRole("textbox", { name: "Nội dung văn bản" })
      .fill("Nội dung gửi đến các phòng ban.");
    await page.getByLabel("Nhóm người nhận").selectOption("company");
    await page.getByRole("button", { name: "Thêm toàn công ty" }).click();
    await page.screenshot({
      path: `.office-test-results/${label}-draft.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Thông báo mới từ UI test" }),
    ).toBeVisible();
    await expect(page.locator(".office-detail-code")).toContainText("Bản nháp");
  });
}
test("approval, numbering and publication are separate UI actions", async ({
  page,
}) => {
  await page.goto(`${base}#/office/documents/doc-5`);
  await page
    .getByRole("button", { name: "Duyệt nội dung", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Duyệt nội dung", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cấp số văn bản", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cấp số văn bản", exact: true })
    .click();
  await expect(page.locator(".office-detail-code")).toContainText(
    "236/2026/TB-TT",
  );
  await page
    .getByRole("button", { name: "Phát hành văn bản", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Phát hành văn bản", exact: true })
    .click();
  await expect(page.locator(".office-detail-code")).toContainText(
    "Đã phát hành",
  );
  await expect(
    page.getByRole("link", { name: "Chỉnh sửa", exact: true }),
  ).toHaveCount(0);
  const actions = await page.evaluate(() =>
    (window as any).officeTest.commands.map((x: any) => x.p_command),
  );
  expect(actions.slice(0, 3)).toEqual(["approve", "issue_number", "publish"]);
});
test("configuration uses a searchable picker inside dialog", async ({
  page,
}) => {
  await page.goto(`${base}#/office/settings`);
  await page.getByRole("button", { name: "Tuyến duyệt", exact: true }).click();
  await page.getByRole("button", { name: "Thêm mới" }).click();
  await page.getByLabel("Tên cấu hình").fill("Duyệt công văn dự án");
  await page.getByLabel("Người duyệt bước 1").fill("Nguyễn");
  await page
    .getByRole("button", { name: "Nguyễn Minh An", exact: true })
    .click();
  await expect(page.getByLabel("Người duyệt bước 1")).toHaveValue(
    "Nguyễn Minh An",
  );
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("dashboard failure is visible and does not become zero", async ({
  page,
}) => {
  await page.goto(`${base}?error=1#/office`);
  await expect(page.getByRole("alert")).toContainText("Không thực hiện được");
  await expect(page.locator(".office-kpis")).toHaveCount(0);
});
test("archiving a revoked document retains its warning", async ({ page }) => {
  await page.goto(`${base}#/office/documents/doc-1`);
  await page
    .getByRole("button", { name: "Thu hồi văn bản", exact: true })
    .click();
  await page
    .getByLabel("Lý do / ghi chú")
    .fill("Được thay thế bằng thông báo mới");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Thu hồi văn bản", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lưu trữ văn bản", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Lưu trữ", exact: true })
    .click();
  await expect(page.locator(".office-detail-code")).toContainText("Đã lưu trữ");
  await expect(page.locator(".office-detail-code")).toContainText("Đã thu hồi");
  await expect(page.locator(".office-action-banner")).toContainText(
    "Không sử dụng nội dung này",
  );
});

test("incoming document supports assignment, acceptance and completion", async ({
  page,
}) => {
  await page.goto(`${base}#/office/documents/doc-3`);
  await page.getByRole("button", { name: "Giao lại", exact: true }).click();
  await page.getByLabel("Chọn người phụ trách").fill("Nguyễn");
  await page
    .getByRole("button", { name: "Nguyễn Minh An", exact: true })
    .click();
  await page.getByLabel("Hạn xử lý").fill("2026-10-10");
  await page
    .getByLabel("Yêu cầu xử lý")
    .fill("Đối chiếu và phản hồi chủ đầu tư");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Giao xử lý", exact: true })
    .click();
  for (const name of ["Xác nhận tiếp nhận", "Bắt đầu xử lý"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name, exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Hoàn thành xử lý", exact: true })
    .click();
  await page.getByLabel("Kết quả xử lý").fill("Đã kiểm tra và gửi phản hồi");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hoàn thành xử lý", exact: true })
    .click();
  await expect(page.locator(".office-result")).toContainText(
    "Đã kiểm tra và gửi phản hồi",
  );
  await expect(
    page.getByRole("button", { name: "Hoàn thành xử lý", exact: true }),
  ).toHaveCount(0);
});

test("explicit acknowledgement is separate from the automatic read receipt", async ({
  page,
}) => {
  await page.goto(`${base}#/office/documents/doc-1`);
  await expect(page.locator(".office-confirm-banner")).toContainText(
    "Mở văn bản chỉ ghi nhận đã xem",
  );
  expect(
    await page.evaluate(() =>
      (window as any).officeTest.commands.some(
        (x: any) => x.p_command === "confirm_read",
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Tôi đã đọc và hiểu nội dung", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tôi đã đọc và hiểu nội dung", exact: true })
    .click();
  await expect(page.locator(".office-confirm-banner")).toContainText(
    "Bạn đã xác nhận",
  );
});
test("mobile rich editor, template variables and report remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}#/office/new?group=ANNOUNCEMENT`);
  await page.getByRole("button", { name: /Thông báo TB/ }).click();
  await page.getByLabel("Tiêu đề văn bản").fill("Thông báo định dạng");
  await page
    .getByRole("button", { name: "Chọn mẫu văn bản", exact: true })
    .click();
  await page
    .getByLabel("Mẫu văn bản", { exact: true })
    .selectOption("template-1");
  await page.getByLabel("Tên công ty", { exact: true }).fill("Tiến Thịnh");
  await page.getByRole("button", { name: "Áp dụng mẫu", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Nội dung văn bản",
    exact: true,
  });
  await expect(editor).toContainText("Kính gửi Tiến Thịnh");
  await editor.click();
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await page.getByRole("button", { name: "Chèn bảng", exact: true }).click();
  await page.getByLabel("Số hàng", { exact: true }).fill("2");
  await page.getByLabel("Số cột", { exact: true }).fill("2");
  await page
    .locator(".office-editor-tool")
    .getByRole("button", { name: "Chèn bảng", exact: true })
    .click();
  await expect(editor.locator("table")).toHaveCount(1);
  await editor.locator("td").first().fill("Thông tin");
  await page.getByLabel("Yêu cầu người nhận xác nhận đã đọc và hiểu").check();
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Thông báo định dạng" }),
  ).toBeVisible();
  await expect(page.locator(".office-rich-view table")).toContainText(
    "Thông tin",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".office-test-results/mobile-rich-document.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Báo cáo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Báo cáo văn bản", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".office-report-kpis")).toContainText(
    "Chưa có dữ liệu",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("filtered Excel export has a real workbook and complete title", async ({
  page,
}) => {
  await page.goto(`${base}#/office/documents?group=INCOMING`);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất Excel", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toContain("Sổ-văn-bản-đến.xlsx");
  const XLSX = await import("xlsx");
  const fs = await import("node:fs");
  const workbook = XLSX.read(fs.readFileSync((await download.path())!));
  const rows = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
  );
  expect(rows).toHaveLength(1);
  expect((rows[0] as any)["Tiêu đề"]).toBe(
    "Công văn đề nghị xác nhận tiến độ bàn giao mặt bằng",
  );
});
test("late department tagging and version comparison are accessible", async ({
  page,
}) => {
  await page.goto(`${base}#/office/documents/doc-1`);
  await page
    .getByRole("button", { name: "Gửi bổ sung / tag bộ phận", exact: true })
    .click();
  await page.getByLabel("Nhóm người nhận").selectOption("department");
  await page.getByRole("dialog").getByRole("textbox").fill("Hành");
  await page
    .getByRole("button", { name: "Hành chính Nhân sự", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Gửi bổ sung", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "Phiên bản", exact: true }).click();
  await page.getByRole("button", { name: /v2 · Nguyễn/ }).click();
  await expect(page.locator(".office-version-compare")).toContainText(
    "Tiêu đề ban đầu",
  );
  await expect(page.locator(".office-version-preview")).toContainText(
    "Thay đổi: Tiêu đề",
  );
});
