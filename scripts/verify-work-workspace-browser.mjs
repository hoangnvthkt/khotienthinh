import { chromium } from "@playwright/test";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({ channel: "chrome",headless: true });
await mkdir("/tmp/vioo-work-workspace-qa",{ recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440,height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror",(error) => errors.push(error.message));
  const open = async (mode = "") => {
    await page.goto(`http://127.0.0.1:5187/tests/work/workspace-fixture.html?${mode}#/work`);
  };

  await open("pages=1");
  await page.getByRole("heading",{ name: /hôm nay mình làm việc ở đâu/ }).waitFor();
  assert.equal(await page.getByText("Phòng Quản lý dự án",{ exact: true }).count(),2);
  await page.getByRole("button",{ name: "Bỏ ghim Phòng Quản lý dự án" }).first().click();
  assert.equal(await page.getByRole("button",{ name: "Ghim Phòng Quản lý dự án" }).first().getAttribute("aria-pressed"),"false");
  assert.deepEqual(await page.evaluate(() => window.workWorkspaceQa.calls.filter((call) => call.name === "preference")[0].args),["space-department",false]);
  await page.getByRole("button",{ name: "Xem thêm không gian" }).click();
  await page.getByText("Tổ phối hợp nghiệm thu",{ exact: true }).waitFor();
  assert.equal(await page.locator(".work-space-card").count(),4);

  await page.getByLabel("Tìm không gian").fill("chậm");
  await page.getByRole("button",{ name: "Tìm",exact: true }).click();
  await page.getByLabel("Tìm không gian").fill("Nhà máy");
  await page.getByRole("button",{ name: "Tìm",exact: true }).click();
  await page.getByText("Dự án Nhà máy Bắc Ninh",{ exact: true }).waitFor();
  await page.waitForTimeout(650);
  assert.equal(await page.locator(".work-space-card").count(),1);

  await open();
  await page.getByText("Phòng Quản lý dự án",{ exact: true }).last().click();
  await page.getByRole("heading",{ name: "Phòng Quản lý dự án",exact: true }).waitFor();
  await open("error=1");
  await page.getByRole("alert").waitFor();
  await page.getByRole("button",{ name: "Thử lại" }).click();
  await page.getByText("Tổ phối hợp nghiệm thu",{ exact: true }).waitFor();
  await open("empty=1");
  await page.getByRole("heading",{ name: "Bạn chưa có không gian làm việc" }).waitFor();
  await open("expired=1");
  assert.equal(await page.getByText("Nhóm thiết kế hiện trường",{ exact: true }).count(),0);

  for (const [width,height] of [[1440,900],[768,1024],[360,800]]) {
    await page.setViewportSize({ width,height });
    await open();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.screenshot({ path: `/tmp/vioo-work-workspace-qa/home-${width}.png`,fullPage: true });
  }
  assert.deepEqual(errors,[]);
  console.log("WORK_WORKSPACE_BROWSER_PASSED");
} finally {
  await browser.close();
}
