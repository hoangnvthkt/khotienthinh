import {test,expect} from '@playwright/test';
import {createUxFixture,openUxPage,query,rpc,captureUxLayouts} from '../daily-log/ux-test-sessions.mjs';

test('two authors complete the real ERP return/edit/resend/refresh/CHT cycle without changing B or C',async({browser})=>{
  test.setTimeout(360000);
  const f=await createUxFixture(),pages:any[]=[];
  try {
    const authorA=await openUxPage(browser,f,'authorA'),authorB=await openUxPage(browser,f,'authorB');pages.push(authorA,authorB);
    const sourceIds:Record<string,string>={};
    for(const [area,page] of [['A',authorA],['C',authorA],['B',authorB]] as const) {
      if(area==='C') await page.getByRole('button',{name:'Đóng',exact:true}).click();
      await page.getByRole('button',{name:/Ghi nhật ký|Thêm nhật ký/}).first().click();
      await page.getByLabel('Ngày lập phiếu').fill(f.date);
      await expect(page.getByRole('button',{name:'Tạo phiếu khu vực khác'})).toBeEnabled();
      await page.getByRole('button',{name:'Tạo phiếu khu vực khác'}).click();
      await page.getByLabel('Mã khu vực mới').fill(area);await page.getByLabel('Tên khu vực mới').fill(`Khu ${area} nghiệm thu UX`);
      await page.getByRole('button',{name:'Tạo phiếu',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Phiếu thi công ngày',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Chọn công việc',exact:true}).click();
      await page.getByRole('checkbox',{name:`Chọn UX8 ${f.taskName}`}).check();await page.getByRole('button',{name:'Đưa vào phiếu',exact:true}).click();
      // % complete is the default entry; this acceptance flow records daily quantities.
      await page.getByLabel('Cách nhập khối lượng',{exact:true}).filter({visible:true}).selectOption('daily_quantity');
      await page.getByLabel('Khối lượng hôm nay',{exact:true}).filter({visible:true}).fill(area==='C'?'5':'30');
      await page.getByRole('button',{name:/Công tác thực hiện/}).filter({visible:true}).first().click();
      await page.getByRole('textbox',{name:'Công tác thực hiện',exact:true}).filter({visible:true}).fill(`Thi công khu ${area}, số liệu hiện trường`);
      if(area!=='C') {
        await page.getByRole('button',{name:'Chi tiết',exact:true}).filter({visible:true}).click();
        const section=page.locator('section').filter({has:page.getByRole('heading',{name:area==='A'?'Nhân công hôm nay':'Máy hôm nay',exact:true})}).last();
        await section.getByRole('button',{name:'Thêm dòng',exact:true}).click();
        await page.getByLabel(area==='A'?'Nguồn cung cấp nhân công 1':'Nguồn cung cấp máy 1').filter({visible:true}).selectOption('manual');
        await page.getByLabel('Tên nguồn').filter({visible:true}).fill(area==='A'?'Tổ tự do A':'Chủ máy B');
        await page.getByLabel(area==='A'?'Nhóm nhân công':'Loại máy').filter({visible:true}).fill(area==='A'?'Tổ bê tông':'Máy trộn');
        await page.getByLabel(area==='A'?'Số người':'Số máy',{exact:true}).filter({visible:true}).fill(area==='A'?'5':'2');
        if(area==='B') await page.getByLabel('Giờ mỗi máy',{exact:true}).filter({visible:true}).fill('6');
      }
      if(area==='A') await captureUxLayouts(page,'author', '.daily-log-engineer-slip[aria-label="Phiếu thi công ngày"]');
      await page.setViewportSize({width:1440,height:900});
      await page.getByRole('button',{name:'Gửi tổng hợp',exact:true}).click();
      await expect.poll(async()=>(await query(`select status from public.daily_log_contributions where project_id='${f.project}' and work_area_code='${area}'`))[0]?.status).toBe('submitted');
      sourceIds[area]=(await query(`select id from public.daily_log_contributions where project_id='${f.project}' and work_area_code='${area}'`))[0].id;
    }
    const beforeOthers=await query(`select id,to_jsonb(c) snapshot from public.daily_log_contributions c where id in('${sourceIds.B}','${sourceIds.C}') order by id`);
    expect((await query(`select author_user_id,work_area_code from public.daily_log_contributions where project_id='${f.project}' order by work_area_code`))).toEqual([
      {author_user_id:f.actors.authorA.profile,work_area_code:'A'},{author_user_id:f.actors.authorB.profile,work_area_code:'B'},{author_user_id:f.actors.authorA.profile,work_area_code:'C'}]);
    const wrongOwner=await f.actors.authorB.client.rpc('submit_daily_log_source_v2',{p_input:{commandId:crypto.randomUUID(),contributionId:sourceIds.A,expectedRowVersion:3}});
    expect(wrongOwner.error?.code).toBe('42501');
    const denied=await f.actors.denied.client.rpc('get_daily_log_document_bundle_v2',{p_project_id:f.project,p_construction_site_id:null,p_log_date:f.date,p_daily_log_id:null,p_contribution_id:sourceIds.A});
    expect(denied.error?.code).toBe('42501');
    const deniedPage=await openUxPage(browser,f,'denied',true);pages.push(deniedPage);
    await expect(deniedPage.getByRole('alert').filter({hasText:'Bạn không có quyền truy cập Nhật ký của dự án này.'})).toBeVisible({timeout:45000});
    await expect(deniedPage.getByText('Điều hành cần liên kết công trường HRM',{exact:true})).toHaveCount(0);
    await expect(deniedPage.getByRole('button',{name:/Gửi CHT|Duyệt & công bố|Trả phiếu sửa/})).toHaveCount(0);
    const wrongScope=await f.actors.authorA.client.rpc('get_daily_log_document_bundle_v2',{p_project_id:'DL-WBS-PILOT-20260925',p_construction_site_id:null,p_log_date:f.date,p_daily_log_id:null,p_contribution_id:sourceIds.A});expect(wrongScope.error?.code).toBe('42501');
    const evidence=()=>rpc(f.actors.reader.client,'get_verified_resource_usage_evidence_v1',{p_project_id:f.project,p_construction_site_id:null,p_from_date:f.date,p_to_date:f.date});
    const summarize=await openUxPage(browser,f,'summarizer');pages.push(summarize);
    const openSummary=async()=>{
      await summarize.reload();await summarize.locator('div.group').filter({hasText:'07/08/2099'}).last().getByRole('button',{name:'Tổng hợp',exact:true}).click();
      await expect(summarize.getByRole('heading',{name:'Tổng hợp thi công ngày',exact:true})).toBeVisible();
    };
    await openSummary();
    await summarize.getByLabel('Nội dung tổng hợp',{exact:true}).fill('Tổng hợp số liệu thi công đã đối chiếu hiện trường');
    // Native wrapping label also contains option text; match its label prefix.
    await summarize.getByLabel('CHT duyệt').selectOption(f.actors.cht.profile);
    for(const area of ['A','B']) await summarize.getByRole('checkbox',{name:new RegExp(`Khu ${area} nghiệm thu UX`)}).check();
    const saveSummary=async()=>{
      const response=summarize.waitForResponse(r=>r.url().endsWith('/rpc/save_daily_log_summary_work_v1'));
      await summarize.getByRole('button',{name:'Lưu tổng hợp',exact:true}).click();expect((await response).status()).toBe(200);
      await expect(summarize.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeEnabled();
    };
    await saveSummary();await expect(summarize.getByRole('button',{name:'Gửi CHT',exact:true})).toBeDisabled();
    const resolve=async(percent:string)=>{
      const choices=summarize.getByLabel('Cách xử lý UX8',{exact:true});
      if(!await choices.isVisible()) await summarize.locator('summary').filter({hasText:/Cần xử lý trước khi gửi|Xem cách chốt và lý do/}).click();
      await choices.selectOption('manual_override');await summarize.getByLabel('% chính thức UX8',{exact:true}).fill(percent);
      await summarize.getByLabel('Khối lượng lũy kế chính thức',{exact:true}).fill(percent);
      await summarize.getByLabel('Khối lượng trong ngày chính thức',{exact:true}).fill(percent);
      await summarize.getByLabel('Lý do quyết định UX8',{exact:true}).fill('Các phiếu có phạm vi chồng lấn; chốt theo đo đếm tổng hiện trường, không cộng các phần trăm.');
    };
    await resolve('30');await captureUxLayouts(summarize,'summary','.daily-log-summary');await saveSummary();
    expect((await evidence()).rows).toEqual([]);
    expect((await f.actors.denied.client.rpc('get_verified_resource_usage_evidence_v1',{p_project_id:f.project,p_construction_site_id:null,p_from_date:f.date,p_to_date:f.date})).error?.code).toBe('42501');
    const sendSummary=async()=>{
      await summarize.setViewportSize({width:1440,height:900});const response=summarize.waitForResponse(r=>r.url().endsWith('/rpc/submit_daily_log_summary_v1'));
      await summarize.getByRole('button',{name:'Gửi CHT',exact:true}).click();expect((await response).status()).toBe(200);
      await expect.poll(async()=>(await query(`select status from public.daily_logs where id='${f.log}'`))[0].status).toBe('submitted');
    };
    await sendSummary();
    const cht=await openUxPage(browser,f,'cht',true);pages.push(cht);const report=cht.locator('.daily-log-summary');
    await expect(report.locator('input,select')).toHaveCount(0);
    await expect(report.getByRole('heading',{name:'Ảnh hiện trường',exact:true})).toBeVisible();
    const briefingHeadings=await report.locator('h2').allTextContents();
    const positions=['Tổng quan ngày','Tiến độ theo hạng mục','Cảnh báo và vướng mắc','Các mũi thi công','Ảnh hiện trường']
      .map(heading=>briefingHeadings.indexOf(heading));
    expect(positions.every((position,index)=>position>=0 && (!index || position>positions[index-1]))).toBe(true);
    await expect(report.getByText('Mũi thi công',{exact:true})).toBeVisible();
    await expect(report.getByText(/Chưa có ngày kế hoạch để so|Đúng kế hoạch/).first()).toBeVisible();
    await expect(report.locator('.dl-report-audit')).not.toHaveAttribute('open');
    const calmColor=await report.locator('.dl-metric-calm dd').first().evaluate(element=>getComputedStyle(element).color.match(/\d+/g)!.slice(0,3).map(Number));
    expect(calmColor[1]).toBeGreaterThan(calmColor[0]);expect(calmColor[1]).toBeGreaterThan(calmColor[2]);
    await captureUxLayouts(cht,'review','.daily-log-summary');
    await cht.setViewportSize({width:1440,height:900});
    const card=report.locator('[data-testid="daily-log-area-card"]').filter({has:cht.getByRole('heading',{name:'Khu A nghiệm thu UX',exact:true})});
    await card.locator(':scope > details > summary').click();await card.locator('summary').filter({hasText:'Trả phiếu sửa'}).click();
    await expect(card.getByRole('button',{name:'Trả phiếu sửa',exact:true})).toBeDisabled();
    await card.getByLabel('Nhận xét Khu A nghiệm thu UX').fill(f.longReason);await card.getByRole('button',{name:'Trả phiếu sửa',exact:true}).click();
    await expect.poll(async()=>(await query(`select status from public.daily_log_contributions where id='${sourceIds.A}'`))[0].status).toBe('returned');
    expect(await query(`select id,to_jsonb(c) snapshot from public.daily_log_contributions c where id in('${sourceIds.B}','${sourceIds.C}') order by id`)).toEqual(beforeOthers);
    await authorA.reload();await authorA.getByRole('button',{name:/Ghi nhật ký|Thêm nhật ký/}).first().click();await authorA.getByLabel('Ngày lập phiếu').fill(f.date);
    if(await authorA.locator('details.dl-slip-selection').count()) await authorA.locator('details.dl-slip-selection > summary').click();
    await authorA.getByRole('radio',{name:/Khu A nghiệm thu UX/}).click();await expect(authorA.getByText(f.longReason,{exact:true}).filter({visible:true}).last()).toBeVisible();
    await captureUxLayouts(authorA,'returned','.daily-log-engineer-slip[aria-label="Phiếu thi công ngày"]');
    await authorA.setViewportSize({width:1440,height:900});await authorA.getByLabel('Khối lượng hôm nay',{exact:true}).filter({visible:true}).fill('32');
    await authorA.getByRole('button',{name:/Công tác thực hiện/}).filter({visible:true}).first().click();
    await authorA.getByRole('textbox',{name:'Công tác thực hiện',exact:true}).filter({visible:true}).fill('Đã đo lại A và bổ sung nguồn lực theo yêu cầu CHT');
    await authorA.getByRole('button',{name:'Chi tiết',exact:true}).filter({visible:true}).click();
    await authorA.getByLabel('Số người',{exact:true}).filter({visible:true}).fill('6');
    await authorA.getByRole('button',{name:'Gửi lại tổng hợp',exact:true}).click();
    await expect.poll(async()=>(await query(`select status,row_version from public.daily_log_contributions where id='${sourceIds.A}'`))[0]).toEqual({status:'submitted',row_version:6});
    await openSummary();
    const savedCard=summarize.locator('[data-testid="daily-log-area-card"]').filter({has:summarize.getByRole('heading',{name:'Khu A nghiệm thu UX',exact:true})});
    await expect(savedCard.getByText(f.longReason,{exact:true})).toBeVisible();
    await expect(savedCard.getByText('- Thi công khu A, số liệu hiện trường',{exact:true}).first()).toBeVisible();
    await savedCard.locator('summary').filter({hasText:'Xem thay đổi so với phiếu nguồn mới nhất'}).click();
    await expect(savedCard.getByText(/Đã đo lại A và bổ sung nguồn lực theo yêu cầu CHT/).first()).toBeVisible();
    await savedCard.getByRole('button',{name:'Cập nhật từ phiếu',exact:true}).click();await resolve('31');await saveSummary();await sendSummary();
    await cht.reload();await expect(report.getByRole('heading',{name:'Bản tổng hợp thi công ngày',exact:true})).toBeVisible({timeout:45000});
    await expect(report.getByRole('button',{name:'Đối chiếu thử nghiệm',exact:true})).toBeEnabled();
    let response=cht.waitForResponse(r=>r.url().endsWith('/rpc/publish_daily_log_summary_v1'));
    await report.getByRole('button',{name:'Đối chiếu thử nghiệm',exact:true}).click();const pilot=await (await response).json();expect(pilot.publishedProgress).toBe(false);
    expect((await evidence()).rows).toEqual([]);
    await expect(report).toBeVisible();
    // Only the disposable test project is enforced, never the preview pilot.
    await query(`update app_private.daily_log_wbs_rollout_scopes set mode='enforced' where project_id='${f.project}'`,false);await cht.reload();
    await expect(report.getByRole('heading',{name:'Bản tổng hợp thi công ngày',exact:true})).toBeVisible({timeout:45000});
    await expect(report.getByRole('button',{name:'Duyệt & công bố',exact:true})).toBeEnabled();
    await captureUxLayouts(cht,'approval','.daily-log-summary');
    response=cht.waitForResponse(r=>r.url().endsWith('/rpc/publish_daily_log_summary_v1'));
    await report.getByRole('button',{name:'Duyệt & công bố',exact:true}).dblclick();const published=await (await response).json();expect(published.publishedProgress).toBe(true);
    await expect.poll(async()=>(await query(`select status from public.daily_logs where id='${f.log}'`))[0].status).toBe('verified');
    const reader=await openUxPage(browser,f,'reader',true);pages.push(reader);const history=reader.locator('.daily-log-summary');
    await expect(history.locator('input,select,textarea')).toHaveCount(0);await expect(history.getByRole('button',{name:/Trả|Gửi|Duyệt|Xóa/})).toHaveCount(0);
    await captureUxLayouts(reader,'verified','.daily-log-summary');
    const verifiedEvidence=await evidence();expect(verifiedEvidence.rows).toHaveLength(2);expect(verifiedEvidence.totals.totalLaborHours).toBe(48);expect(verifiedEvidence.totals.totalMachineHours).toBe(12);
    const bundle=await rpc(f.actors.reader.client,'get_daily_log_wbs_bundle_v1',{p_project_id:f.project,p_construction_site_id:null,p_log_date:f.date,p_daily_log_id:f.log});
    expect(bundle.decisions[0].official_cumulative_percent??bundle.decisions[0].officialCumulativePercent).toBe(31);
    expect((await query(`select source_version,review_comment from public.daily_log_summary_sources where daily_log_id='${f.log}' and contribution_id='${sourceIds.A}'`))[0]).toMatchObject({source_version:6,review_comment:f.longReason});
    expect(Number((await query(`select total_labor_hours h from public.daily_log_labor where daily_log_id='${f.log}'`))[0].h)).toBe(48);
    const receipts=await query(`select command_id,daily_log_id,result from public.daily_log_publish_commands where daily_log_id='${f.log}'`);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({command_id:published.commandId,daily_log_id:f.log,result:{publishedTaskIds:[f.task]}});
    expect(receipts[0].result.verifiedResourceLineIds).toHaveLength(2);
    expect(await query(`select to_jsonb(c) snapshot from public.daily_log_contributions c where id='${sourceIds.C}'`)).toEqual([{snapshot:beforeOthers.find(row=>row.id===sourceIds.C)!.snapshot}]);
    // Every hand-off tells the next person, from the database; nobody hears about their own action.
    const notices=await query(`select user_id,source_type,delivery_reason,message from public.notifications where metadata->>'projectId'='${f.project}' and metadata->>'deliveredBy'='daily_log_trigger'`);
    const got=(who:string,type:string)=>notices.filter((n:any)=>n.user_id===f.actors[who].profile && n.source_type===type);
    expect(got('summarizer','dailylog_source_submitted')).toHaveLength(4);
    expect(got('authorA','dailylog_source_returned')).toHaveLength(1);
    expect(got('authorA','dailylog_source_returned')[0]).toMatchObject({delivery_reason:'assigned'});
    expect(got('authorA','dailylog_source_returned')[0].message).toContain(f.longReason.slice(0,60));
    expect(got('cht','dailylog_summary_submitted')).toHaveLength(2);
    for(const who of ['summarizer','authorA','authorB']) expect(got(who,'dailylog_verified')).toHaveLength(1);
    expect(got('cht','dailylog_verified')).toHaveLength(0);
    expect(notices.filter((n:any)=>n.user_id===f.actors.denied.profile)).toHaveLength(0);
  } catch(error) {
    for(const [index,page] of pages.entries()) {
      if(!page.isClosed()) {
        await page.screenshot({path:`.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/ux8-failure-${index}.png`});
        const selector=page.locator('section[aria-label="Phiếu của tôi"]');
        if(await selector.count()) console.log(JSON.stringify({page:index,selector:await selector.innerText()}));
      }
    }
    throw error;
  } finally {await Promise.all(pages.map(p=>p.context().close()));await f.cleanup();}
});
