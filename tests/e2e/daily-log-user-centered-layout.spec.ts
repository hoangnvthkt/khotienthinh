import {test,expect} from '@playwright/test';
import {createUxFixture,openUxPage,rpc,captureUxLayouts} from '../daily-log/ux-test-sessions.mjs';
import {ref} from '../daily-log/cloud.mjs';

test('changing the slip date ignores an older day response instead of hiding existing slips',async({browser})=>{
  test.setTimeout(120000);const f=await createUxFixture();let page:any;
  let releaseOld:()=>void=()=>{},oldReached:()=>void=()=>{};
  const oldHeld=new Promise<void>(resolve=>{releaseOld=resolve;}),reached=new Promise<void>(resolve=>{oldReached=resolve;});
  try {
    for(const area of ['A','C']) await rpc(f.actors.authorA.client,'create_daily_log_source_v2',{p_command_id:crypto.randomUUID(),p_project_id:f.project,p_construction_site_id:null,p_log_date:f.date,p_work_area_code:area,p_work_area_name:`Khu ${area} kiểm tra đổi ngày`});
    page=await openUxPage(browser,f,'authorA');
    await page.route('**/rpc/get_daily_log_document_bundle_v2',async route=>{
      const input=route.request().postDataJSON();
      if(input.p_log_date!==f.date && !input.p_contribution_id) {
        const response=await route.fetch();oldReached();await oldHeld;await route.fulfill({response});
      } else await route.continue();
    });
    await page.getByRole('button',{name:/Ghi nhật ký|Thêm nhật ký/}).first().click();await reached;
    await page.getByLabel('Ngày lập phiếu').fill(f.date);
    await expect(page.getByRole('radio',{name:/Khu A kiểm tra đổi ngày/})).toBeVisible();
    const olderResponse=page.waitForResponse(response=>response.url().endsWith('/rpc/get_daily_log_document_bundle_v2') && response.request().postDataJSON().p_log_date!==f.date);
    releaseOld();await olderResponse;
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(page.getByRole('radio',{name:/Khu A kiểm tra đổi ngày/})).toBeVisible();
    await expect(page.getByRole('radio',{name:/Khu C kiểm tra đổi ngày/})).toBeVisible();
    await expect(page.getByLabel('Ngày lập phiếu')).toHaveValue(f.date);
    await expect(page.getByText('Chưa có phiếu cho ngày này.',{exact:true})).toHaveCount(0);
  } finally {releaseOld();if(page) await page.context().close();await f.cleanup();}
});

test('direct report links distinguish an unknown permission result from denied or zero totals',async({browser})=>{
  test.setTimeout(120000);const f=await createUxFixture(),context=await browser.newContext();
  try {
    const page=await context.newPage();await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:`sb-${ref}-auth-token`,session:f.actors.reader.session});
    await page.route('**/rpc/get_my_project_room_pbac_exceptions',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',message:'UX8 controlled permission-read failure'})}));
    await page.goto(`/#/da?projectId=${f.project}&tab=dailylog&dailyLogId=${f.log}`);
    await expect(page.getByRole('alert').filter({hasText:'Không thể xác định quyền Nhật ký'})).toBeVisible({timeout:15000});
    await expect(page.getByText('Bạn không có quyền truy cập Nhật ký của dự án này.',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Chưa có báo cáo hoặc nhật ký nào',{exact:true})).toHaveCount(0);
    await page.unroute('**/rpc/get_my_project_room_pbac_exceptions');await page.getByRole('button',{name:'Thử tải lại quyền',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Bản tổng hợp thi công ngày',exact:true})).toBeVisible({timeout:45000});
  } finally {await context.close();await f.cleanup();}
});

test('live ERP draft retains inputs on error, focuses feedback and has reachable mobile actions',async({browser})=>{
  test.setTimeout(180000);const f=await createUxFixture();let page:any;
  try {
    await rpc(f.actors.authorA.client,'create_daily_log_source_v2',{p_command_id:crypto.randomUUID(),p_project_id:f.project,p_construction_site_id:null,p_log_date:f.date,p_work_area_code:'LAYOUT',p_work_area_name:'Khu vực thi công phía Đông — tên dài dùng để kiểm tra phiếu trên điện thoại'});
    page=await openUxPage(browser,f,'authorA');await page.getByRole('button',{name:/Ghi nhật ký|Thêm nhật ký/}).first().click();
    await page.getByLabel('Ngày lập phiếu').fill(f.date);await page.getByRole('radio',{name:/Khu vực thi công phía Đông/}).click();
    await page.getByRole('button',{name:'Chọn công việc',exact:true}).click();await page.getByRole('checkbox',{name:`Chọn UX8 ${f.taskName}`}).check();await page.getByRole('button',{name:'Đưa vào phiếu',exact:true}).click();
    const qty=page.getByLabel('Khối lượng hôm nay',{exact:true}).filter({visible:true});
    await qty.fill('-1');await expect(qty).toHaveAttribute('aria-invalid','true');await expect(page.getByRole('button',{name:'Gửi tổng hợp',exact:true})).toBeDisabled();
    await qty.fill('12,5');await qty.focus();expect(await qty.evaluate(node=>getComputedStyle(node).outlineWidth)).toBe('2px');
    await page.keyboard.press('Tab');expect(await qty.evaluate(node=>document.activeElement===node)).toBe(false);
    await page.getByLabel('Nội dung trong ngày').fill(f.longReason);
    await page.route('**/rpc/save_daily_log_source_document_v2',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'PT409',message:'UX8 controlled stale-save result'})}));
    await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();
    const alert=page.getByRole('alert').filter({hasText:'UX8 controlled stale-save result'});await expect(alert).toBeVisible();await expect(alert).toBeFocused();await expect(qty).toHaveValue('12,5');
    await captureUxLayouts(page,'author-error','.daily-log-engineer-slip[aria-label="Phiếu thi công ngày"]');
    await page.unroute('**/rpc/save_daily_log_source_document_v2');await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();await expect(page.getByText('Đã lưu phiếu. Có thể tiếp tục ghi hoặc gửi tổng hợp.')).toBeVisible();
    await page.getByRole('button',{name:'Chi tiết',exact:true}).filter({visible:true}).click();
    const labor=page.locator('section').filter({has:page.getByRole('heading',{name:'Nhân công hôm nay',exact:true})}).last();await labor.getByRole('button',{name:'Thêm dòng'}).click();
    for(const width of [390,360]) {
      await page.setViewportSize({width,height:width===390?844:800});
      const actions=page.locator('.daily-log-document-actionbar');await expect(actions.getByRole('button',{name:'Đóng',exact:true})).toBeVisible();
      const selection=await page.locator('summary').filter({hasText:'Đổi ngày hoặc phiếu'}).boundingBox();expect(selection!.height).toBeGreaterThanOrEqual(44);
      const deleteRow=page.getByRole('button',{name:'Xóa dòng nhân công 1'}).filter({visible:true});
      const rect=await deleteRow.boundingBox();expect(rect!.height).toBeGreaterThanOrEqual(44);expect(rect!.width).toBeGreaterThanOrEqual(44);
      for(const button of await actions.getByRole('button').all()) {const r=await button.boundingBox();expect(r!.height).toBeGreaterThanOrEqual(44);expect(r!.width).toBeGreaterThanOrEqual(44);expect(r!.y+r!.height).toBeLessThanOrEqual(width===390?844:800);}
      const last=page.getByLabel('Sự cố / vướng mắc');await last.scrollIntoViewIfNeeded();
      await page.locator('.daily-log-engineer-slip[aria-label="Phiếu thi công ngày"]').evaluate(node=>{let p=node.parentElement;while(p){if(p.scrollHeight>p.clientHeight)p.scrollTop=p.scrollHeight;p=p.parentElement;}});
      const field=await last.boundingBox(),bar=await actions.boundingBox();expect(field!.y+field!.height).toBeLessThan(bar!.y);
    }
  } finally {if(page)await page.context().close();await f.cleanup();}
});
