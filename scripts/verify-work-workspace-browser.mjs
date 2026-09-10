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
  const openPath = async (mode = "",path = "/work") => {
    await page.goto(`http://127.0.0.1:5187/tests/work/workspace-fixture.html?${mode}#${path}`);
  };
  const open = (mode = "") => openPath(mode,"/work");

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
  await page.getByRole("heading",{ name: "Hoạt động công việc" }).waitFor();
  await page.getByRole("button",{ name: "Tạo công việc",exact: true }).click();
  const taskDialog = page.getByRole("dialog");
  await taskDialog.getByText("Phòng Quản lý dự án",{ exact: true }).waitFor();
  assert.equal(await taskDialog.getByRole("button",{ name: /Chọn phạm vi/ }).count(),0);
  await taskDialog.getByRole("button",{ name: "Đóng cửa sổ tạo công việc" }).click();
  await page.getByText("Kiểm tra hồ sơ nghiệm thu",{ exact: true }).click();
  await page.getByRole("heading",{ name: "CV-0001",exact: true }).waitFor();
  assert.equal(await page.getByText("Workspace quay lại: space-department").count(),1);

  await openPath("memberRetry=1","/work/spaces/space-department/members");
  await page.getByRole("heading",{ name: "Thành viên",exact: true }).waitFor();
  await page.getByText("Phạm Ngọc Sơn",{ exact: true }).waitFor();
  await page.getByRole("button",{ name: "Thêm thành viên",exact: true }).click();
  await page.getByLabel("Tìm nhân viên").waitFor();
  await page.getByRole("checkbox",{ name: /Nguyễn Minh Anh/ }).check();
  await page.getByRole("button",{ name: "Xem trước thay đổi" }).click();
  await page.getByRole("button",{ name: "Áp dụng thay đổi" }).click();
  await page.getByRole("alert").filter({ hasText: "Yêu cầu đang được giữ nguyên" }).waitFor();
  await page.getByRole("button",{ name: "Thử lại cùng yêu cầu" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const memberApplyCalls = await page.evaluate(() => window.workWorkspaceQa.calls.filter((call) => call.name === "memberApply"));
  assert.equal(memberApplyCalls.length,2);
  assert.deepEqual(memberApplyCalls[0].args,memberApplyCalls[1].args);
  await page.getByText("Nguyễn Minh Anh",{ exact: true }).waitFor();

  await openPath("","/work/spaces/new");
  await page.getByRole("heading",{ name: "Tạo không gian làm việc" }).waitFor();
  await page.getByRole("button",{ name: /Phòng Kỹ thuật/ }).click();
  await page.getByLabel("Tên Workspace").fill("Không gian Kỹ thuật");
  await page.getByRole("button",{ name: "Tạo Workspace",exact: true }).click();
  await page.getByRole("heading",{ name: "Không gian Kỹ thuật",exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.workWorkspaceQa.calls.filter((call) => call.name === "create").length),1);

  await openPath("","/work/spaces/space-department/settings");
  await page.getByRole("heading",{ name: "Cấu hình Workspace" }).waitFor();
  await page.getByRole("heading",{ name: "Nhóm việc",exact: true }).waitFor();

  await openPath("archived=1","/work/spaces/space-department");
  await page.getByText("Đã lưu trữ · chỉ đọc",{ exact: true }).waitFor();
  assert.equal(await page.getByRole("button",{ name: "Tạo công việc",exact: true }).count(),0);
  await openPath("","/work/spaces/restricted-space");
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("heading",{ name: "Hoạt động công việc" }).count(),0);

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
    await openPath("","/work/spaces/space-department");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.screenshot({ path: `/tmp/vioo-work-workspace-qa/space-${width}.png`,fullPage: true });
  }
  assert.deepEqual(errors,[]);
  console.log("WORK_WORKSPACE_BROWSER_PASSED");
} finally {
  await browser.close();
}
