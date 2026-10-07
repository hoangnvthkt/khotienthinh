import { test, expect } from "@playwright/test";

// Trang module chạy trong tab Center: đúng đường dẫn / id, đi lại bên trong không rời /center, không thêm lịch sử.
test("embedded module page keeps the user in the Center", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/center/embed-probe.html#/center");
  await expect(page.getByTestId("embedded-path")).toHaveText("/hrm/leave?request=np-41");
  await expect(page.getByTestId("embedded-request")).toHaveText("np-41");
  const historyLength = await page.evaluate(() => history.length);

  await page.getByRole("button", { name: "Chọn đơn khác" }).click();
  await expect(page.getByTestId("embedded-request")).toHaveText("np-42");
  await page.getByRole("button", { name: "Sang việc" }).click();
  await expect(page.getByTestId("fake-task")).toHaveText("Việc VW-1");
  expect(await page.evaluate(() => location.hash)).toBe("#/center");
  await expect(page.getByTestId("outer-path")).toHaveText("/center");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);

  await page.reload();
  await page.getByRole("button", { name: "Sang bảng lương" }).click();
  await expect(page.locator("[data-embed-exit]")).toHaveAttribute("data-embed-exit", "/hrm/payroll");
  await page.getByRole("button", { name: "Mở màn này" }).click();
  await expect(page.getByTestId("exit")).toHaveText("/hrm/payroll");
  expect(errors).toEqual([]);
});
