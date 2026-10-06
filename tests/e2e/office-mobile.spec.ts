import { test, expect } from "@playwright/test";
const base = "/tests/office/fixture.html";
test.beforeEach(async ({ page }) => {
  await page.route("**/*.supabase.co/**", (r) => r.abort());
});
test("phone reading: long title, full body, acknowledgement and department tagging", async ({
  page,
}) => {
  await page.goto(`${base}#/office/documents/doc-1`);
  await expect(
    page.getByRole("heading", {
      name: "Thông báo kế hoạch kiểm kê quý IV năm 2026",
    }),
  ).toBeVisible();
  await expect(page.locator(".office-rich-view")).toContainText(
    "Rà soát hồ sơ",
  );
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
  await page
    .getByRole("button", { name: "Gửi bổ sung / tag bộ phận", exact: true })
    .click();
  await page.getByLabel("Nhóm người nhận").selectOption("site");
  await page.getByRole("dialog").getByRole("textbox").fill("RICO");
  await page
    .getByRole("button", { name: "Công trường RICO", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Gửi bổ sung", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".office-test-results/phone-reader.png",
    fullPage: true,
  });
});
test("phone composing supports formatting, safe paste and saved content", async ({
  page,
}) => {
  await page.goto(`${base}#/office/new?group=ANNOUNCEMENT`);
  await page.getByLabel("Loại văn bản").selectOption({ label: "Thông báo (TB)" });
  await page.getByLabel("Tiêu đề văn bản").fill("Thông báo từ điện thoại");
  const editor = page.getByRole("textbox", {
    name: "Nội dung văn bản",
    exact: true,
  });
  await editor.fill("Nội dung cần đọc trên điện thoại.");
  await editor.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Đậm", exact: true }).click();
  await page.getByRole("button", { name: "Căn giữa", exact: true }).click();
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await page.getByLabel("Cỡ chữ", { exact: true }).selectOption("20");
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(page.locator(".office-rich-view strong")).toContainText(
    "Nội dung cần đọc",
  );
  await expect(page.locator(".office-rich-view p")).toHaveCSS(
    "text-align",
    "center",
  );
  await expect(page.locator(".office-rich-view span").first()).toHaveCSS(
    "font-size",
    "20px",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("phone templates, report, AI unavailable and permission errors are clear", async ({
  page,
}) => {
  await page.goto(`${base}#/office/templates`);
  await expect(
    page.getByRole("heading", { name: "Mẫu văn bản", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tạo mẫu", exact: true }).click();
  await page.getByLabel("Tên mẫu", { exact: true }).fill("Mẫu trên điện thoại");
  await page
    .getByRole("textbox", { name: "Nội dung mẫu" })
    .fill("Nội dung mẫu sử dụng hằng ngày.");
  await page.getByRole("button", { name: "Lưu mẫu", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mẫu trên điện thoại" }),
  ).toBeVisible();
  await page.goto(`${base}#/office/documents/doc-1`);
  await page.getByRole("button", { name: "AI hỗ trợ", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "AI/OCR chưa được kích hoạt",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("pasted formatting is preserved without executable HTML", async ({
  page,
}) => {
  await page.goto(`${base}#/office/new?group=ANNOUNCEMENT`);
  await page.getByLabel("Loại văn bản").selectOption({ label: "Thông báo (TB)" });
  await page.getByLabel("Tiêu đề văn bản").fill("Văn bản dán từ tài liệu");
  const editor = page.getByRole("textbox", {
    name: "Nội dung văn bản",
    exact: true,
  });
  await editor.click();
  await editor.evaluate((el) => {
    const clipboard = new DataTransfer();
    clipboard.setData(
      "text/html",
      '<p style="text-align:right"><strong style="color:#cc0000">Nội dung hợp lệ</strong><a href="javascript:alert(1)">liên kết không an toàn</a><script>window.officeUnsafe=true</script><img src=x onerror="window.officeUnsafe=true"></p>',
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor).toContainText("Nội dung hợp lệ");
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(page.locator(".office-rich-view strong")).toContainText(
    "Nội dung hợp lệ",
  );
  expect(
    await page
      .locator(".office-rich-view")
      .locator('script,img,a[href^="javascript:"]')
      .count(),
  ).toBe(0);
  expect(
    await page.evaluate(() => (window as any).officeUnsafe),
  ).toBeUndefined();
  await expect(page.locator(".office-rich-view p")).toHaveCSS(
    "text-align",
    "right",
  );
  await expect(page.locator(".office-rich-view span").first()).toHaveCSS(
    "color",
    "rgb(204, 0, 0)",
  );
});

test("an inline image is saved once, stays private through the adapter and renders after save", async ({
  page,
}) => {
  await page.goto(`${base}#/office/new?group=ANNOUNCEMENT`);
  await page.getByLabel("Loại văn bản").selectOption({ label: "Thông báo (TB)" });
  await page.getByLabel("Tiêu đề văn bản").fill("Thông báo có ảnh");
  await page
    .getByRole("textbox", { name: "Nội dung văn bản" })
    .fill("Ảnh minh họa đính kèm:");
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await page.getByRole("button", { name: "Chèn ảnh", exact: true }).click();
  await page.locator(".office-editor-tool input[type=file]").setInputFiles({
    name: "anh-minh-hoa.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE1cAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    page.locator(".office-inline-image-placeholder"),
  ).toHaveAttribute("alt", "Ảnh đính kèm: anh-minh-hoa.png");
  await expect(
    page.getByRole("textbox", { name: "Nội dung văn bản" }),
  ).toContainText("Ảnh minh họa đính kèm:");
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).click();
  await expect(page.locator(".office-inline-image-placeholder")).toHaveCount(0);
  await page.getByRole("button", { name: "Làm lại", exact: true }).click();
  await expect(page.locator(".office-inline-image-placeholder")).toHaveCount(1);
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Thông báo có ảnh" }),
  ).toBeVisible();
  await expect(page.locator(".office-rich-view img")).toBeVisible();
  expect(
    await page
      .locator(".office-rich-view img")
      .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
  ).toBe(true);
  await expect(page.locator(".office-rich-view")).toContainText(
    "Ảnh minh họa đính kèm:",
  );
  const commands = await page.evaluate(() =>
    (window as any).officeTest.commands.map((x: any) => x.p_command),
  );
  expect(commands.filter((c: string) => c === "create")).toHaveLength(1);
  expect(commands).toEqual(
    expect.arrayContaining(["attachment_begin", "attachment_finish", "save"]),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Chỉnh sửa", exact: true }).click();
  await page
    .getByRole("button", { name: "Bỏ anh-minh-hoa.png", exact: true })
    .click();
  await expect(page.locator(".office-inline-image-placeholder")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Nội dung văn bản" }),
  ).toContainText("Ảnh minh họa đính kèm:");
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(page.locator(".office-rich-view")).toContainText(
    "Ảnh minh họa đính kèm:",
  );
  await expect(page.locator(".office-rich-view img")).toHaveCount(0);
});
