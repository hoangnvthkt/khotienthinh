import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {branchConfig,query,ref} from '../daily-log/cloud.mjs';

test('CHT returns an exact slip, publishes an isolated report; reader, locked period and revision stay read-only',async({browser})=>{
  test.setTimeout(240000);
  const config=branchConfig(),options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,options);
  const project=`__DL_UX7_${crypto.randomUUID()}`,date='2099-08-06',log=`${project}_LOG`,task=`${project}_TASK`;
  const base='DL-WBS-PILOT-20260925',actor='72000000-0000-4000-8000-000000000004';
  const unknownUnit=process.env.DAILY_LOG_CHT_UNKNOWN_UNIT==='1';
  const clients:any[]=[],contexts:any[]=[],sourceIds:string[]=[];
  let created=false;
  const pilotBefore=await query(`select to_jsonb(s) snapshot from app_private.daily_log_wbs_rollout_scopes s where project_id='${base}'`);
  const camel=(value:any):any=>Array.isArray(value)?value.map(camel):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),camel(item)])):value;
  const rpc=async(client:any,name:string,input:any={})=>{const result=await client.rpc(name,input);expect(result.error,`${name}: ${result.error?.message}`).toBeNull();return name==='get_daily_log_wbs_bundle_v1'?camel(result.data):result.data;};
  const login=async(id:string)=>{
    const identity=await admin.auth.admin.getUserById(id);expect(identity.error).toBeNull();
    const link=await admin.auth.admin.generateLink({type:'magiclink',email:identity.data.user!.email!});expect(link.error).toBeNull();
    const client=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,options);clients.push(client);
    const signed=await client.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties!.hashed_token});expect(signed.error).toBeNull();expect(await rpc(client,'is_admin')).toBe(false);
    return {client,session:signed.data.session};
  };
  const open=async(persona:any,id=log,checkLoading=false)=>{
    const context=await browser.newContext({viewport:{width:1440,height:900}});contexts.push(context);
    const page=await context.newPage();
    await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:`sb-${ref}-auth-token`,session:persona.session});
    let release=()=>{},arrived=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;}),requestSeen=new Promise<void>(resolve=>{arrived=resolve;});
    // Observe the actual retry click before releasing intercepted requests.
    // Releasing before Playwright clicks can hide/detach the retry button.
    if(checkLoading) await page.addInitScript(()=>{
      document.addEventListener('click',event=>{
        if(event.target instanceof Element && event.target.closest('button')?.textContent?.trim()==='Thử lại')
          (window as any).__ux7ReportRetryRequested=true;
      },true);
    });
    let reportRetryCompleted=false;
    if(checkLoading) await page.route('**/rpc/get_daily_log_wbs_bundle_v1',async route=>{
      const input=route.request().postDataJSON();
      // Once observed, keep the interception released across later reloads.
      if(!reportRetryCompleted) reportRetryCompleted=await page.evaluate(()=>Boolean((window as any).__ux7ReportRetryRequested));
      if(input.p_daily_log_id===id && !reportRetryCompleted) {
        arrived();await gate;
        await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',message:'UX7 controlled report-load failure'})});
        return;
      }
      await route.continue();
    });
    await page.goto(`/#/da?projectId=${project}&tab=dailylog&dailyLogId=${id}`);
    if(checkLoading) try {
      await requestSeen;
      await expect(page.getByRole('status').filter({hasText:'Đang tải bản tổng hợp…'})).toBeVisible();
      await expect(page.getByRole('button',{name:'Đóng',exact:true})).toBeVisible();
    } finally {release();}
    if(checkLoading) {
      await expect(page.getByRole('alert').filter({hasText:'UX7 controlled report-load failure'})).toBeVisible();
      await expect(page.getByRole('button',{name:'Đóng',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'Thử lại',exact:true}).click();
    }
    await expect(page.getByRole('heading',{name:'Bản tổng hợp thi công ngày',exact:true})).toBeVisible({timeout:45000});
    return page;
  };
  const getBundle=(client:any)=>rpc(client,'get_daily_log_wbs_bundle_v1',{p_project_id:project,p_construction_site_id:null,p_log_date:date,p_daily_log_id:log});
  const save=async(client:any,percentA=30,refresh=false)=>{
    const b=await getBundle(client),original=b.workItems.filter((item:any)=>item.contributionId && sourceIds.includes(item.contributionId));
    const sources=b.contributionsForSummary.filter((source:any)=>sourceIds.includes(source.id));
    const percent=(percentA+30)/2;
    return rpc(client,'save_daily_log_summary_work_v1',{p_daily_log_id:log,p_expected_updated_at:b.summaryLog.lastActionAt,
      p_sources:sources.map((s:any)=>({summaryDocumentVersion:2,contributionId:s.id,sourceVersion:s.rowVersion,sourceFingerprint:s.sourceFingerprint,refreshSource:refresh})),
      p_items:original.map((i:any)=>({clientKey:i.id,contributionId:i.contributionId,sourceWorkItemId:i.id,taskId:i.taskId,cumulativeProgressPercent:i.cumulativeProgressPercent,cumulativeQuantityDone:i.cumulativeQuantityDone,dailyQuantityDone:i.dailyQuantityDone,forecastFinishDate:i.forecastFinishDate})),
      p_decisions:[{taskId:task,officialCumulativePercent:percent,officialCumulativeQuantity:unknownUnit?null:percent,officialDailyQuantity:unknownUnit?null:percent,forecastFinishDate:'2099-08-30',aggregationMethod:'manual_override',dailyQuantityMethod:'sum_non_overlapping',resolutionReason:unknownUnit?'Chốt % sau đối chiếu các khu; chưa đủ đơn vị để quy đổi khối lượng.':'Người tổng hợp xác nhận A/B là hai phần riêng 50 m³ của WBS 100 m³; chốt theo khối lượng đã đo.',includedSourceWorkItemIds:original.map((i:any)=>i.id)}],
      p_labor:b.labor.filter((line:any)=>sourceIds.includes(line.contributionId) && !line.dailyLogId).map((line:any,index:number)=>({workItemClientKey:line.dailyLogWorkItemId,laborType:line.laborType,peopleCount:line.peopleCount,hoursPerPerson:line.hoursPerPerson,sourceLaborLineId:line.id,sourceIndex:index,provider:{entryMode:'manual',manualProviderType:line.manualProviderType,manualProviderName:line.manualProviderName}})),
      p_machines:b.machines.filter((line:any)=>sourceIds.includes(line.contributionId) && !line.dailyLogId).map((line:any,index:number)=>({workItemClientKey:line.dailyLogWorkItemId,machineType:line.machineType,machineCount:line.machineCount,hoursPerMachine:line.hoursPerMachine,sourceMachineLineId:line.id,sourceIndex:index,provider:{entryMode:'manual',manualProviderType:line.manualProviderType,manualProviderName:line.manualProviderName}}))});
  };
  const submit=async(client:any)=>{const b=await getBundle(client);return rpc(client,'submit_daily_log_summary_v1',{p_daily_log_id:log,p_expected_updated_at:b.summaryLog.lastActionAt,p_approver_user_id:actor});};
  try {
    const author=await login('f30d5711-1a9d-47b2-a536-9424cc66b822'),sum=await login('55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8'),cht=await login('195531b5-e124-41bb-8648-e7acb106971a'),reader=await login('89441ea9-ec40-46f3-b8ef-b647e6ede9b8');
    await query(`insert into public.projects(id,code,name,project_type,status) values('${project}','${project}','Disposable Daily Log CHT UX fixture','construction','active')`,false);created=true;
    await query(`insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,is_active,granted_by,grant_reason,expires_at)
      select user_id,permission_code,'project','${project}',true,'${actor}','Disposable Daily Log ERP entry only',now()+interval '1 hour' from public.user_permission_grants
      where scope_type='project' and scope_id='${base}' and permission_code='project.daily_log.view' and is_active
      and user_id in('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','${actor}','72000000-0000-4000-8000-000000000005');
      insert into public.project_staff(id,project_id,user_id,position_id,start_date)
      select gen_random_uuid(),'${project}',user_id,position_id,current_date from public.project_staff where project_id='${base}' and construction_site_id is null and end_date is null
      and user_id in('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','${actor}','72000000-0000-4000-8000-000000000005');
      insert into public.project_permission_room_members(id,project_id,room_code,project_staff_id,is_active,created_by)
      select gen_random_uuid(),'${project}','daily_log',id,true,'${actor}' from public.project_staff where project_id='${project}';
      insert into public.project_permission_room_member_actions(room_member_id,action_code,is_active,granted_by,grant_source)
      select m.id,a.action_code,true,'${actor}','manual_room' from public.project_permission_room_members m
      join public.project_staff ns on ns.id=m.project_staff_id join public.project_staff os on os.user_id=ns.user_id and os.project_id='${base}' and os.end_date is null
      join public.project_permission_room_members om on om.project_staff_id=os.id and om.room_code='daily_log' and om.is_active
      join public.project_permission_room_member_actions a on a.room_member_id=om.id and a.is_active where m.project_id='${project}';
      insert into app_private.daily_log_wbs_rollout_scopes(project_id,mode,cutover_date,release_id,owner_user_id,reason,created_by)
      values('${project}','pilot','2026-09-25','${project}_RELEASE','${actor}','Disposable CHT UX test only; existing pilot unchanged','${actor}');
      insert into public.project_tasks(id,project_id,name,wbs_code,start_date,end_date,fallback_unit,provisional_quantity)
      values('${task}','${project}','Móng báo cáo CHT','UX7','${date}','2099-08-30',${unknownUnit?'null':"'m³'"},100);
      insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at,description)
      values('${log}','${project}','${date}','UX7 summarizer','72000000-0000-4000-8000-000000000003','draft','member_contributions','${date}T12:00:00Z','Ghi nhận CHT UX7')`,false);
    const payloads:any[]=[];
    for(const area of ['A','B']) {
      const made=await rpc(author.client,'create_daily_log_source_v2',{p_command_id:crypto.randomUUID(),p_project_id:project,p_construction_site_id:null,p_log_date:date,p_work_area_code:area,p_work_area_name:`Khu ${area} CHT`});sourceIds.push(made.contributionId);
      const b=await rpc(author.client,'get_daily_log_document_bundle_v2',{p_project_id:project,p_construction_site_id:null,p_log_date:date,p_daily_log_id:null,p_contribution_id:made.contributionId});
      const payload={contributionId:made.contributionId,expectedRowVersion:1,workAreaCode:area,workAreaName:`Khu ${area} CHT`,content:`Công việc ${area}`,issues:'',photos:[],items:[{clientKey:'w',taskId:task,areaPlannedQuantity:50,entryMode:'percent',enteredValue:30,forecastFinishDate:'2099-08-30',baselineFingerprint:b.baselineQuantityFingerprints[task]}],
        labor:area==='A'?[{workItemClientKey:'w',laborType:'Tổ móng CHT',peopleCount:5,hoursPerPerson:8,provider:{entryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Tổ tự do CHT'}}]:[],
        machines:area==='B'?[{workItemClientKey:'w',machineType:'Máy trộn CHT',machineCount:2,hoursPerMachine:6,provider:{entryMode:'manual',manualProviderType:'machine_owner',manualProviderName:'Chủ máy CHT'}}]:[]};
      payloads.push(payload);await rpc(author.client,'save_daily_log_source_document_v2',{p_input:payload});await rpc(author.client,'submit_daily_log_source_v2',{p_input:{commandId:crypto.randomUUID(),contributionId:made.contributionId,expectedRowVersion:2}});
    }
    await save(sum.client);await submit(sum.client);
    const page=await open(cht,log,true),report=page.locator('.daily-log-summary');
    await expect(report.locator('input,select')).toHaveCount(0);
    await expect(report.getByRole('button',{name:'Đối chiếu thử nghiệm',exact:true})).toBeEnabled();
    const shadow=page.waitForResponse(response=>response.url().endsWith('/rpc/publish_daily_log_summary_v1'));
    await report.getByRole('button',{name:'Đối chiếu thử nghiệm',exact:true}).click();
    const shadowResponse=await shadow,shadowReceipt=await shadowResponse.json();
    expect(shadowResponse.status(),JSON.stringify({code:shadowReceipt.code,message:shadowReceipt.message})).toBe(200);
    expect(shadowReceipt.publishedProgress).toBe(false);
    await expect(report.getByRole('heading',{name:'Bản tổng hợp thi công ngày',exact:true})).toBeVisible();expect((await getBundle(cht.client)).summaryLog.status).toBe('submitted');
    await query(`update app_private.daily_log_wbs_rollout_scopes set mode='enforced' where project_id='${project}'`,false);await page.reload();
    await expect(report.getByRole('button',{name:'Duyệt & công bố',exact:true})).toBeEnabled();
    const beforeSources=await query(`select id,to_jsonb(c) snapshot from public.daily_log_contributions c where project_id='${project}' order by id`);
    await report.getByRole('button',{name:'Trả bản tổng hợp',exact:true}).click();
    const reason=page.getByPlaceholder('Nhập lý do trả lại...');await expect(reason).toBeVisible();
    await reason.fill('Bổ sung phần tổng hợp, không trả phiếu kỹ sư');await page.getByRole('button',{name:'Trả bản tổng hợp',exact:true}).last().click();
    await expect.poll(async()=>(await getBundle(sum.client)).summaryLog.status).toBe('rejected');
    expect(await query(`select id,to_jsonb(c) snapshot from public.daily_log_contributions c where project_id='${project}' order by id`)).toEqual(beforeSources);
    const returnedSummary=await getBundle(sum.client);
    // The existing last trigger preserves the summary's CHT route even while
    // its revision assignment belongs to the summarizer.
    expect((await query(`select status,submitted_to_permission from public.daily_logs where id='${log}'`))[0]).toEqual({status:'rejected',submitted_to_permission:'approve'});
    expect(returnedSummary.permissions.canSummarize).toBe(true);
    expect(returnedSummary.permissions.canApprove).toBe(false);
    await submit(sum.client);await page.reload();await expect(report.getByRole('button',{name:'Duyệt & công bố',exact:true})).toBeEnabled();
    const card=report.locator('[data-testid="daily-log-area-card"]').filter({has:page.getByRole('heading',{name:'Khu A CHT',exact:true})});
    await card.locator(':scope > details > summary').click();await card.locator('summary').filter({hasText:'Trả phiếu sửa'}).click();
    await card.getByLabel('Nhận xét Khu A CHT').fill('Đo lại móng A, giữ nguyên B');await card.getByRole('button',{name:'Trả phiếu sửa',exact:true}).click();
    await expect.poll(async()=>(await query(`select status,row_version from public.daily_log_contributions where id='${sourceIds[0]}'`))[0]).toEqual({status:'returned',row_version:4});
    expect((await query(`select to_jsonb(c) snapshot from public.daily_log_contributions c where id='${sourceIds[1]}'`))[0]).toEqual(beforeSources.find(row=>row.id===sourceIds[1]) && {snapshot:beforeSources.find(row=>row.id===sourceIds[1]).snapshot});
    await rpc(author.client,'save_daily_log_source_document_v2',{p_input:{...payloads[0],expectedRowVersion:4,content:'Đã đo lại móng A',items:[{...payloads[0].items[0],enteredValue:32}]}});
    await rpc(author.client,'submit_daily_log_source_v2',{p_input:{commandId:crypto.randomUUID(),contributionId:sourceIds[0],expectedRowVersion:5}});
    await save(sum.client,32,true);await submit(sum.client);await page.reload();
    await expect(report.getByRole('button',{name:'Duyệt & công bố',exact:true})).toBeEnabled();
    const publication=page.waitForResponse(response=>response.url().endsWith('/rpc/publish_daily_log_summary_v1'));
    await report.getByRole('button',{name:'Duyệt & công bố',exact:true}).click();const receipt=await (await publication).json();expect(receipt.publishedProgress).toBe(true);
    await expect.poll(async()=>(await getBundle(cht.client)).summaryLog.status).toBe('verified');
    const readerPage=await open(reader),history=readerPage.locator('.daily-log-summary');
    await expect(history.locator('input,select,textarea')).toHaveCount(0);await expect(history.getByRole('button',{name:/Trả|Gửi|Duyệt|Xóa/})).toHaveCount(0);
    await expect(history.getByText('Người duyệt',{exact:true})).toBeVisible();await expect(history.getByText('Chưa xác định người duyệt',{exact:true})).toHaveCount(0);
    const savedHistory=await getBundle(reader.client);
    expect(savedHistory.decisions[0].officialCumulativePercent).toBe(31);
    expect(savedHistory.labor.filter((line:any)=>line.dailyLogId===log).map((line:any)=>line.totalLaborHours)).toEqual([40]);
    expect(savedHistory.machines.filter((line:any)=>line.dailyLogId===log).map((line:any)=>line.totalMachineHours)).toEqual([12]);
    if(unknownUnit) {
      expect(savedHistory.decisions[0].officialCumulativeQuantity).toBeNull();
      const copies=await query(`select unit_snapshot,daily_quantity_done from public.daily_log_work_items where daily_log_id='${log}' order by id`);
      expect(copies).toEqual([{unit_snapshot:null,daily_quantity_done:null},{unit_snapshot:null,daily_quantity_done:null}]);
      await history.locator('[data-testid="daily-log-area-card"]').first().locator(':scope > details > summary').click();
      await expect(history.getByText('Chất lượng dữ liệu: có hạng mục chưa xác định đơn vị.',{exact:false}).first()).toBeVisible();
      await expect(history.getByText('Chưa xác định đơn vị',{exact:true}).first()).toBeVisible();
    }
    const denied=await reader.client.rpc('return_daily_log_source_v2',{p_input:{commandId:crypto.randomUUID(),dailyLogId:log,summarySourceId:(await getBundle(reader.client)).summarySources[0].id,contributionId:sourceIds[0],expectedSummaryUpdatedAt:(await getBundle(reader.client)).summaryLog.lastActionAt,expectedRowVersion:6,reason:'Reader must not mutate'}});expect(denied.error?.code).toBe('42501');
    for(const theme of ['light','dark']) {
      if(theme==='dark') {
        await readerPage.setViewportSize({width:1440,height:900});await history.getByRole('button',{name:'Đóng',exact:true}).click();
        await readerPage.getByRole('button',{name:'Dark Mode',exact:true}).click();
        await readerPage.reload();
        await expect(history.getByRole('heading',{name:'Bản tổng hợp thi công ngày',exact:true})).toBeVisible({timeout:45000});
      }
      for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[360,800]]) {
        await readerPage.setViewportSize({width,height});expect(await readerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await history.evaluate(node=>{let parent=node.parentElement;while(parent){if(parent.scrollHeight>parent.clientHeight)parent.scrollTop=0;parent=parent.parentElement;}});
        await readerPage.screenshot({path:`.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/commander-${unknownUnit?'unknown':'known'}-${theme}-${width}.png`});
        if(width===1440 || width===390) {
          const firstCard=history.locator('[data-testid="daily-log-area-card"]').first(),details=firstCard.locator(':scope > details');
          if(!await details.evaluate(node=>node.hasAttribute('open'))) await details.locator(':scope > summary').click();
          const workDetails=firstCard.locator('.daily-log-work-report details:visible').first();
          if(!await workDetails.evaluate(node=>node.hasAttribute('open'))) await workDetails.locator(':scope > summary').click();
          await expect(firstCard.locator('p:visible').filter({hasText:'Tổ tự do CHT'}).first()).toBeVisible();
          await firstCard.scrollIntoViewIfNeeded();
          await readerPage.screenshot({path:`.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/commander-details-${unknownUnit?'unknown':'known'}-${theme}-${width}.png`});
        }
      }
    }
    await query(`insert into public.project_progress_period_states(scope_key,project_id,period_type,period_start,is_locked,locked_by,locked_at)
      values('${project}','${project}','weekly',date_trunc('week','${date}'::date)::date,true,'${actor}',now()) on conflict(scope_key,period_type,period_start) do update set is_locked=true,locked_by='${actor}',locked_at=now()`,false);
    await page.reload();await expect(page.getByRole('button',{name:'Tạo bản điều chỉnh',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Mở Chốt tiến độ'}).first()).toBeVisible();
    await query(`update public.project_progress_period_states set is_locked=false,locked_by=null,locked_at=null where project_id='${project}'`,false);
    await page.reload();await page.getByRole('button',{name:'Tạo bản điều chỉnh',exact:true}).click();const revisionReason=page.getByPlaceholder('Nhập lý do điều chỉnh...');await expect(revisionReason).toBeVisible();await revisionReason.fill('Biên bản bổ sung sau duyệt');await page.getByRole('button',{name:'Tạo bản điều chỉnh',exact:true}).last().click();
    await expect.poll(async()=>(await query(`select count(*)::int n from public.daily_logs where project_id='${project}' and supersedes_daily_log_id='${log}'`))[0].n).toBe(1);
    expect((await query(`select status from public.daily_logs where id='${log}'`))[0].status).toBe('verified');
  } finally {
    await Promise.all(contexts.map(context=>context.close()));await Promise.all(clients.map(client=>client.auth.signOut({scope:'local'})));
    if(created) await query(`delete from public.notifications where metadata->>'projectId'='${project}' and metadata->>'logId'='${log}' and source_id like 'dailylog_rejected_%';
      delete from public.app_assignment_events where assignment_id in(select id from public.app_assignments where scope_id='${project}' and subject_type='daily_log');
      delete from public.app_assignments where scope_id='${project}' and subject_type='daily_log';
      delete from public.daily_log_publish_commands where daily_log_id in(select id from public.daily_logs where project_id='${project}');
      delete from public.project_daily_task_progress where project_id='${project}';delete from public.weekly_progress_snapshots where project_id='${project}';delete from public.project_progress_period_states where project_id='${project}';
      delete from app_private.daily_log_shadow_comparisons where daily_log_id in(select id from public.daily_logs where project_id='${project}');
      select set_config('app.daily_log_revision_context','on',true);
      update public.daily_logs set supersedes_daily_log_id=null,superseded_by_daily_log_id=null,revision_reason=null,revision_no=1 where project_id='${project}';
      delete from public.daily_progress_exception_audit where source_daily_log_id in(select id from public.daily_logs where project_id='${project}');
      delete from public.daily_log_contributions where project_id='${project}';
      delete from public.daily_logs where project_id='${project}';
      delete from app_private.daily_log_source_command_receipts where project_id='${project}';
      delete from app_private.daily_log_wbs_rollout_scopes where project_id='${project}';delete from public.project_tasks where project_id='${project}';delete from public.project_staff where project_id='${project}';
      delete from public.user_permission_grants where scope_type='project' and scope_id='${project}' and permission_code='project.daily_log.view';
      delete from public.projects where id='${project}' and name='Disposable Daily Log CHT UX fixture'`,false);
    expect((await query(`select count(*)::int n from public.projects where id='${project}'`))[0].n).toBe(0);
    expect((await query(`select
      (select count(*) from public.daily_logs where project_id='${project}')::int logs,
      (select count(*) from public.daily_log_contributions where project_id='${project}')::int sources,
      (select count(*) from app_private.daily_log_source_command_receipts where project_id='${project}')::int receipts,
      (select count(*) from public.user_permission_grants where scope_type='project' and scope_id='${project}')::int grants,
      (select count(*) from public.notifications where metadata->>'projectId'='${project}')::int notifications`))[0]).toEqual({logs:0,sources:0,receipts:0,grants:0,notifications:0});
    expect(await query(`select to_jsonb(s) snapshot from app_private.daily_log_wbs_rollout_scopes s where project_id='${base}'`)).toEqual(pilotBefore);
  }
});
